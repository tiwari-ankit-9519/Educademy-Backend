import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";
import notificationService from "../../utils/notificationservice.js";
import socketManager from "../../utils/socket-io.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `learning_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const generateCacheKey = (prefix, params) => {
  return `${prefix}:${Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(":")}`;
};

const invalidateUserCache = async (userId, patterns = []) => {
  const defaultPatterns = [
    `enrolled_courses:*userId=${userId}*`,
    `course_content:*userId=${userId}*`,
    `lesson:*userId=${userId}*`,
    `analytics:*userId=${userId}*`,
    `certificate:*userId=${userId}*`,
  ];

  for (const pattern of [...defaultPatterns, ...patterns]) {
    await redisService.invalidateCache(pattern);
  }
};

export const getEnrolledCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 12,
      status = "ACTIVE",
      sortBy = "lastAccessed",
      search,
      category,
    } = req.query;

    const cacheKey = generateCacheKey("enrolled_courses", {
      userId: req.userAuthId,
      page,
      limit,
      status,
      sortBy,
      search: search || "",
      category: category || "",
    });

    const cached = await redisService.getCache(cacheKey);
    if (cached) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        ...cached,
        meta: {
          ...cached.meta,
          requestId,
          executionTime: Math.round(executionTime),
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const studentProfile = await prisma.student.findUnique({
      where: { userId: req.userAuthId },
      select: { id: true },
    });

    if (!studentProfile) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found",
        code: "STUDENT_NOT_FOUND",
      });
    }

    const where = {
      studentId: studentProfile.id,
    };

    if (status && status !== "ALL") {
      where.status = status;
    }

    if (search) {
      where.course = {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { shortDescription: { contains: search, mode: "insensitive" } },
          {
            instructor: {
              user: {
                OR: [
                  { firstName: { contains: search, mode: "insensitive" } },
                  { lastName: { contains: search, mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      };
    }

    if (category) {
      where.course = {
        ...where.course,
        category: { slug: category },
      };
    }

    let orderBy = { lastAccessedAt: "desc" };
    if (sortBy === "enrollmentDate") {
      orderBy = { createdAt: "desc" };
    } else if (sortBy === "progress") {
      orderBy = { progress: "desc" };
    } else if (sortBy === "alphabetical") {
      orderBy = { course: { title: "asc" } };
    }

    const [enrollments, total] = await Promise.all([
      prisma.enrollment.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          course: {
            include: {
              instructor: {
                include: {
                  user: {
                    select: {
                      firstName: true,
                      lastName: true,
                      profileImage: true,
                    },
                  },
                },
              },
              category: true,
              _count: {
                select: {
                  sections: true,
                  reviews: true,
                },
              },
            },
          },
          courseProgress: true,
          certificate: true,
        },
      }),
      prisma.enrollment.count({ where }),
    ]);

    const result = {
      enrollments: enrollments.map((enrollment) => ({
        id: enrollment.id,
        studentId: enrollment.studentId,
        enrolledAt: enrollment.createdAt,
        lastAccessedAt: enrollment.lastAccessedAt,
        progress: enrollment.progress,
        status: enrollment.status,
        lessonsCompleted: enrollment.lessonsCompleted,
        quizzesCompleted: enrollment.quizzesCompleted,
        assignmentsCompleted: enrollment.assignmentsCompleted,
        totalTimeSpent: enrollment.totalTimeSpent,
        hasCertificate: !!enrollment.certificate,
        course: {
          id: enrollment.course.id,
          title: enrollment.course.title,
          slug: enrollment.course.slug,
          shortDescription: enrollment.course.shortDescription,
          thumbnail: enrollment.course.thumbnail,
          duration: enrollment.course.duration,
          level: enrollment.course.level,
          totalLessons: enrollment.course.totalLessons,
          totalQuizzes: enrollment.course.totalQuizzes,
          totalAssignments: enrollment.course.totalAssignments,
          averageRating: enrollment.course.averageRating,
          totalRatings: enrollment.course.totalRatings,
          instructor: {
            id: enrollment.course.instructor.id,
            name: `${enrollment.course.instructor.user.firstName} ${enrollment.course.instructor.user.lastName}`,
            profileImage: enrollment.course.instructor.user.profileImage,
            rating: enrollment.course.instructor.rating,
          },
          category: enrollment.course.category,
          sectionsCount: enrollment.course._count.sections,
          reviewsCount: enrollment.course._count.reviews,
        },
        currentProgress: enrollment.courseProgress
          ? {
              totalContentItems: enrollment.courseProgress.totalContentItems,
              completedItems: enrollment.courseProgress.completedItems,
              progressPercentage: enrollment.courseProgress.progressPercentage,
              lastActivityAt: enrollment.courseProgress.lastActivityAt,
              currentSectionId: enrollment.courseProgress.currentSectionId,
              currentLessonId: enrollment.courseProgress.currentLessonId,
              estimatedTimeLeft: enrollment.courseProgress.estimatedTimeLeft,
            }
          : null,
      })),

      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      summary: {
        totalEnrolled: total,
        activeEnrollments: enrollments.filter((e) => e.status === "ACTIVE")
          .length,
        completedCourses: enrollments.filter((e) => e.status === "COMPLETED")
          .length,
        averageProgress:
          enrollments.length > 0
            ? enrollments.reduce((sum, e) => sum + e.progress, 0) /
              enrollments.length
            : 0,
      },
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Enrolled courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    };

    await redisService.setCache(cacheKey, response, 300);

    res.status(200).json(response);
  } catch (error) {
    console.error(`GET_ENROLLED_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve enrolled courses",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCourseContent = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    const cacheKey = generateCacheKey("course_content", {
      userId: req.userAuthId,
      courseId,
    });

    const cached = await redisService.getCache(cacheKey);
    if (cached) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        ...cached,
        meta: {
          ...cached.meta,
          requestId,
          executionTime: Math.round(executionTime),
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: req.studentProfile.id,
          courseId: courseId,
        },
      },
      include: {
        course: {
          include: {
            instructor: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    profileImage: true,
                  },
                },
              },
            },
            category: true,
            subcategory: true,
            sections: {
              orderBy: { order: "asc" },
              include: {
                lessons: {
                  orderBy: { order: "asc" },
                  include: {
                    completions: {
                      where: { studentId: req.studentProfile.id },
                    },
                    attachments: true,
                    bookmarks: {
                      where: { userId: req.userAuthId },
                    },
                  },
                },
                quizzes: {
                  orderBy: { order: "asc" },
                  include: {
                    attempts: {
                      where: { studentId: req.studentProfile.id },
                      orderBy: { attemptNumber: "desc" },
                      take: 1,
                    },
                    _count: {
                      select: { questions: true },
                    },
                  },
                },
                assignments: {
                  orderBy: { order: "asc" },
                  include: {
                    submissions: {
                      where: { studentId: req.studentProfile.id },
                      orderBy: { createdAt: "desc" },
                      take: 1,
                    },
                  },
                },
              },
            },
            courseSettings: true,
          },
        },
        courseProgress: true,
        certificate: true,
      },
    });

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this course",
        code: "NOT_ENROLLED",
      });
    }

    if (enrollment.status === "EXPIRED" || enrollment.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        message: `Your enrollment is ${enrollment.status.toLowerCase()}`,
        code: "ENROLLMENT_INACTIVE",
      });
    }

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { lastAccessedAt: new Date() },
    });

    const course = enrollment.course;
    const progress = enrollment.courseProgress;

    const sectionsWithProgress = course.sections.map((section) => {
      const lessons = section.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        order: lesson.order,
        duration: lesson.duration,
        type: lesson.type,
        isFree: lesson.isFree,
        isPreview: lesson.isPreview,
        isCompleted: lesson.completions.length > 0,
        completedAt: lesson.completions[0]?.completedAt || null,
        timeSpent: lesson.completions[0]?.timeSpent || 0,
        watchTime: lesson.completions[0]?.watchTime || 0,
        hasBookmarks: lesson.bookmarks.length > 0,
        attachmentsCount: lesson.attachments.length,
        canAccess:
          lesson.isFree || lesson.isPreview || enrollment.status === "ACTIVE",
      }));

      const quizzes = section.quizzes.map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        order: quiz.order,
        duration: quiz.duration,
        passingScore: quiz.passingScore,
        maxAttempts: quiz.maxAttempts,
        questionsCount: quiz._count.questions,
        isRequired: quiz.isRequired,
        hasAttempt: quiz.attempts.length > 0,
        lastAttempt: quiz.attempts[0] || null,
        canAccess: enrollment.status === "ACTIVE",
      }));

      const assignments = section.assignments.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        order: assignment.order,
        dueDate: assignment.dueDate,
        totalPoints: assignment.totalPoints,
        hasSubmission: assignment.submissions.length > 0,
        lastSubmission: assignment.submissions[0] || null,
        canAccess: enrollment.status === "ACTIVE",
      }));

      const totalItems = lessons.length + quizzes.length + assignments.length;
      const completedItems =
        lessons.filter((l) => l.isCompleted).length +
        quizzes.filter((q) => q.hasAttempt && q.lastAttempt?.isPassed).length +
        assignments.filter(
          (a) => a.hasSubmission && a.lastSubmission?.status === "GRADED"
        ).length;

      return {
        id: section.id,
        title: section.title,
        description: section.description,
        order: section.order,
        isPublished: section.isPublished,
        isRequired: section.isRequired,
        isFree: section.isFree,
        estimatedTime: section.estimatedTime,
        totalItems,
        completedItems,
        progressPercentage:
          totalItems > 0 ? (completedItems / totalItems) * 100 : 0,
        lessons,
        quizzes,
        assignments,
      };
    });

    const nextContent = await getNextContent(
      sectionsWithProgress,
      progress?.currentLessonId
    );

    const result = {
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        enrolledAt: enrollment.createdAt,
        lastAccessedAt: enrollment.lastAccessedAt,
        progress: enrollment.progress,
        lessonsCompleted: enrollment.lessonsCompleted,
        quizzesCompleted: enrollment.quizzesCompleted,
        assignmentsCompleted: enrollment.assignmentsCompleted,
        totalTimeSpent: enrollment.totalTimeSpent,
        hasCertificate: !!enrollment.certificate,
      },
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug,
        description: course.description,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        duration: course.duration,
        level: course.level,
        language: course.language,
        subtitles: course.subtitles,
        requirements: course.requirements,
        learningOutcomes: course.learningOutcomes,
        targetAudience: course.targetAudience,
        totalLessons: course.totalLessons,
        totalQuizzes: course.totalQuizzes,
        totalAssignments: course.totalAssignments,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          title: course.instructor.title,
          expertise: course.instructor.expertise,
          rating: course.instructor.rating,
          biography: course.instructor.biography,
        },
        category: course.category,
        subcategory: course.subcategory,
        settings: course.courseSettings,
      },
      progress: progress
        ? {
            totalContentItems: progress.totalContentItems,
            completedItems: progress.completedItems,
            progressPercentage: progress.progressPercentage,
            lastActivityAt: progress.lastActivityAt,
            currentSectionId: progress.currentSectionId,
            currentLessonId: progress.currentLessonId,
            estimatedTimeLeft: progress.estimatedTimeLeft,
          }
        : null,
      sections: sectionsWithProgress,
      certificate: enrollment.certificate
        ? {
            id: enrollment.certificate.id,
            url: enrollment.certificate.url,
            certificateId: enrollment.certificate.certificateId,
            issueDate: enrollment.certificate.issueDate,
            isVerified: enrollment.certificate.isVerified,
          }
        : null,
      nextContent,
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Course content retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    };

    await redisService.setCache(cacheKey, response, 600);

    res.status(200).json(response);
  } catch (error) {
    console.error(`GET_COURSE_CONTENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course content",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const accessLesson = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { lessonId } = req.params;

    const cacheKey = generateCacheKey("lesson", {
      userId: req.userAuthId,
      lessonId,
    });

    const cached = await redisService.getCache(cacheKey);
    if (cached) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        ...cached,
        meta: {
          ...cached.meta,
          requestId,
          executionTime: Math.round(executionTime),
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        section: {
          include: {
            course: {
              include: {
                enrollments: {
                  where: { studentId: req.studentProfile.id },
                },
                instructor: {
                  include: {
                    user: {
                      select: {
                        firstName: true,
                        lastName: true,
                        profileImage: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        completions: {
          where: { studentId: req.studentProfile.id },
        },
        attachments: true,
        notes: {
          where: { userId: req.userAuthId },
          orderBy: { createdAt: "desc" },
        },
        bookmarks: {
          where: { userId: req.userAuthId },
          orderBy: { createdAt: "desc" },
        },
        postLessonQuiz: {
          include: {
            attempts: {
              where: { studentId: req.studentProfile.id },
              orderBy: { attemptNumber: "desc" },
              take: 1,
            },
            _count: {
              select: { questions: true },
            },
          },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found",
        code: "LESSON_NOT_FOUND",
      });
    }

    const enrollment = lesson.section.course.enrollments[0];
    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this course",
        code: "NOT_ENROLLED",
      });
    }

    if (!lesson.isFree && !lesson.isPreview && enrollment.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Your enrollment is not active",
        code: "ENROLLMENT_INACTIVE",
      });
    }

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { lastAccessedAt: new Date() },
    });

    const isCompleted = lesson.completions.length > 0;
    const completion = lesson.completions[0];
    const navigation = await getLessonNavigation(
      lessonId,
      req.studentProfile.id
    );

    const result = {
      lesson: {
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        order: lesson.order,
        duration: lesson.duration,
        type: lesson.type,
        content: lesson.content,
        videoUrl: lesson.videoUrl,
        videoQuality: lesson.videoQuality,
        captions: lesson.captions,
        transcript: lesson.transcript,
        resources: lesson.resources,
        isFree: lesson.isFree,
        isPreview: lesson.isPreview,
        isCompleted,
        completedAt: completion?.completedAt || null,
        timeSpent: completion?.timeSpent || 0,
        watchTime: completion?.watchTime || 0,
        attachments: lesson.attachments.map((att) => ({
          id: att.id,
          name: att.name,
          fileUrl: att.fileUrl,
          fileSize: att.fileSize,
          fileType: att.fileType,
          isDownloadable: att.isDownloadable,
        })),
        notes: lesson.notes.map((note) => ({
          id: note.id,
          content: note.content,
          timestamp: note.timestamp,
          isPrivate: note.isPrivate,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        })),
        bookmarks: lesson.bookmarks.map((bookmark) => ({
          id: bookmark.id,
          title: bookmark.title,
          note: bookmark.note,
          timestamp: bookmark.timestamp,
          createdAt: bookmark.createdAt,
        })),
        postLessonQuiz: lesson.postLessonQuiz
          ? {
              id: lesson.postLessonQuiz.id,
              title: lesson.postLessonQuiz.title,
              description: lesson.postLessonQuiz.description,
              duration: lesson.postLessonQuiz.duration,
              passingScore: lesson.postLessonQuiz.passingScore,
              maxAttempts: lesson.postLessonQuiz.maxAttempts,
              questionsCount: lesson.postLessonQuiz._count.questions,
              hasAttempt: lesson.postLessonQuiz.attempts.length > 0,
              lastAttempt: lesson.postLessonQuiz.attempts[0] || null,
            }
          : null,
      },
      course: {
        id: lesson.section.course.id,
        title: lesson.section.course.title,
        instructor: {
          id: lesson.section.course.instructor.id,
          name: `${lesson.section.course.instructor.user.firstName} ${lesson.section.course.instructor.user.lastName}`,
          profileImage: lesson.section.course.instructor.user.profileImage,
        },
      },
      section: {
        id: lesson.section.id,
        title: lesson.section.title,
        order: lesson.section.order,
      },
      navigation,
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Lesson accessed successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    };

    await redisService.setCache(cacheKey, response, 900);

    res.status(200).json(response);
  } catch (error) {
    console.error(`ACCESS_LESSON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      lessonId: req.params.lessonId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to access lesson",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const completeLesson = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { lessonId } = req.params;

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        section: {
          include: {
            course: {
              include: {
                enrollments: {
                  where: { studentId: req.studentProfile.id },
                },
              },
            },
          },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found",
        code: "LESSON_NOT_FOUND",
      });
    }

    const enrollment = lesson.section.course.enrollments[0];
    if (!enrollment || enrollment.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "You are not enrolled in this course or enrollment is not active",
        code: "NOT_ENROLLED_OR_INACTIVE",
      });
    }

    const lessonStartedAt =
      enrollment.lastAccessedAt || enrollment.createdAt || new Date();
    const timeSpentCalculated = Math.round(
      (Date.now() - new Date(lessonStartedAt).getTime()) / 1000
    );
    const watchTimeCalculated = timeSpentCalculated;

    const existingCompletion = await prisma.lessonCompletion.findUnique({
      where: {
        studentId_lessonId: {
          studentId: req.studentProfile.id,
          lessonId: lessonId,
        },
      },
    });

    let completion;
    if (existingCompletion) {
      completion = await prisma.lessonCompletion.update({
        where: { id: existingCompletion.id },
        data: {
          timeSpent: Math.max(
            existingCompletion.timeSpent || 0,
            timeSpentCalculated
          ),
          watchTime: Math.max(
            existingCompletion.watchTime || 0,
            watchTimeCalculated
          ),
        },
      });
    } else {
      completion = await prisma.lessonCompletion.create({
        data: {
          studentId: req.studentProfile.id,
          lessonId: lessonId,
          timeSpent: timeSpentCalculated,
          watchTime: watchTimeCalculated,
        },
      });

      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          lessonsCompleted: { increment: 1 },
          totalTimeSpent: { increment: timeSpentCalculated },
          lastAccessedAt: new Date(),
        },
      });
    }

    await updateCourseProgress(req.studentProfile.id, lesson.section.course.id);

    const progressData = await getCourseProgressData(
      req.studentProfile.id,
      lesson.section.course.id
    );

    if (socketManager && socketManager.sendToUser) {
      socketManager.sendToUser(req.userAuthId, "lesson_completed", {
        lessonId: lessonId,
        lessonTitle: lesson.title,
        courseId: lesson.section.course.id,
        courseTitle: lesson.section.course.title,
        progress: progressData.progressPercentage,
        completedAt: completion.completedAt,
      });
    }

    await checkAndAwardCertificate(
      req.studentProfile.id,
      lesson.section.course.id,
      progressData
    );

    await invalidateUserCache(req.userAuthId, [
      `lesson:*lessonId=${lessonId}*`,
      `course_content:*courseId=${lesson.section.course.id}*`,
    ]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Lesson completed successfully",
      data: {
        completion: {
          id: completion.id,
          completedAt: completion.completedAt,
          timeSpent: completion.timeSpent,
          watchTime: completion.watchTime,
        },
        progress: progressData,
        isFirstCompletion: !existingCompletion,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`COMPLETE_LESSON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      lessonId: req.params.lessonId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to complete lesson",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const accessQuiz = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;

    const cacheKey = generateCacheKey("quiz", {
      userId: req.userAuthId,
      quizId,
    });

    const cached = await redisService.getCache(cacheKey);
    if (cached) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        ...cached,
        meta: {
          ...cached.meta,
          requestId,
          executionTime: Math.round(executionTime),
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        section: {
          include: {
            course: {
              include: {
                enrollments: {
                  where: { studentId: req.studentProfile.id },
                },
              },
            },
          },
        },
        questions: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            content: true,
            type: true,
            points: true,
            order: true,
            options: true,
            hints: true,
            difficulty: true,
          },
        },
        attempts: {
          where: { studentId: req.studentProfile.id },
          orderBy: { attemptNumber: "desc" },
          include: {
            answers: {
              include: {
                question: {
                  select: {
                    id: true,
                    content: true,
                    type: true,
                    correctAnswer: true,
                    explanation: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
        code: "QUIZ_NOT_FOUND",
      });
    }

    const enrollment = quiz.section.course.enrollments[0];
    if (!enrollment || enrollment.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "You are not enrolled in this course or enrollment is not active",
        code: "NOT_ENROLLED_OR_INACTIVE",
      });
    }

    const completedAttempts = quiz.attempts.filter(
      (a) => a.status === "GRADED"
    ).length;
    const canAttempt = completedAttempts < quiz.maxAttempts;
    const hasInProgressAttempt = quiz.attempts.some(
      (a) => a.status === "IN_PROGRESS"
    );

    const result = {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        instructions: quiz.instructions,
        duration: quiz.duration,
        passingScore: quiz.passingScore,
        maxAttempts: quiz.maxAttempts,
        isRequired: quiz.isRequired,
        isRandomized: quiz.isRandomized,
        showResults: quiz.showResults,
        allowReview: quiz.allowReview,
        totalQuestions: quiz.questions.length,
        totalPoints: quiz.questions.reduce((sum, q) => sum + q.points, 0),
      },
      attempts: {
        total: quiz.attempts.length,
        completed: completedAttempts,
        remaining: quiz.maxAttempts - completedAttempts,
        canAttempt,
        hasInProgressAttempt,
        bestScore:
          completedAttempts > 0
            ? Math.max(
                ...quiz.attempts
                  .filter((a) => a.score !== null)
                  .map((a) => a.score)
              )
            : null,
        lastAttempt: quiz.attempts[0] || null,
      },
      questions: canAttempt || hasInProgressAttempt ? quiz.questions : [],
      course: {
        id: quiz.section.course.id,
        title: quiz.section.course.title,
      },
      section: {
        id: quiz.section.id,
        title: quiz.section.title,
      },
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Quiz accessed successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    };

    await redisService.setCache(cacheKey, response, 1800);

    res.status(200).json(response);
  } catch (error) {
    console.error(`ACCESS_QUIZ_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      quizId: req.params.quizId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to access quiz",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const startQuizAttempt = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        section: {
          include: {
            course: {
              include: {
                enrollments: {
                  where: { studentId: req.studentProfile.id },
                },
              },
            },
          },
        },
        questions: {
          orderBy: { order: "asc" },
        },
        attempts: {
          where: { studentId: req.studentProfile.id },
        },
      },
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
        code: "QUIZ_NOT_FOUND",
      });
    }

    const enrollment = quiz.section.course.enrollments[0];
    if (!enrollment || enrollment.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "You are not enrolled in this course or enrollment is not active",
        code: "NOT_ENROLLED_OR_INACTIVE",
      });
    }

    const completedAttempts = quiz.attempts.filter(
      (a) => a.status === "GRADED"
    ).length;
    if (completedAttempts >= quiz.maxAttempts) {
      return res.status(400).json({
        success: false,
        message: "Maximum attempts reached for this quiz",
        code: "MAX_ATTEMPTS_REACHED",
      });
    }

    const hasInProgressAttempt = quiz.attempts.some(
      (a) => a.status === "IN_PROGRESS"
    );
    if (hasInProgressAttempt) {
      return res.status(400).json({
        success: false,
        message: "You already have an in-progress attempt for this quiz",
        code: "ATTEMPT_IN_PROGRESS",
      });
    }

    const attemptNumber = quiz.attempts.length + 1;
    const questions = quiz.isRandomized
      ? quiz.questions.sort(() => Math.random() - 0.5)
      : quiz.questions;

    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId: quizId,
        studentId: req.studentProfile.id,
        attemptNumber,
        attemptsRemaining: quiz.maxAttempts - attemptNumber,
        totalQuestions: questions.length,
        status: "IN_PROGRESS",
      },
    });

    await redisService.invalidateCache(
      `quiz:*userId=${req.userAuthId}*quizId=${quizId}*`
    );

    const result = {
      attempt: {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt,
        attemptsRemaining: attempt.attemptsRemaining,
        totalQuestions: attempt.totalQuestions,
        timeLimit: quiz.duration,
      },
      questions: questions.map((q) => ({
        id: q.id,
        content: q.content,
        type: q.type,
        points: q.points,
        order: q.order,
        options: q.options,
        hints: q.hints,
        difficulty: q.difficulty,
      })),
    };

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Quiz attempt started successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`START_QUIZ_ATTEMPT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      quizId: req.params.quizId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to start quiz attempt",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const submitQuizAttempt = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { attemptId } = req.params;
    const { answers } = req.body;

    if (!Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "Answers must be an array",
        code: "INVALID_ANSWERS_FORMAT",
      });
    }

    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          include: {
            questions: true,
            section: {
              include: {
                course: {
                  include: {
                    enrollments: {
                      where: {
                        studentId: req.studentProfile.id,
                        status: "ACTIVE",
                      },
                    },
                  },
                },
              },
            },
          },
        },
        student: true,
      },
    });

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Quiz attempt not found",
        code: "ATTEMPT_NOT_FOUND",
      });
    }

    if (attempt.studentId !== req.studentProfile.id) {
      return res.status(403).json({
        success: false,
        message: "This attempt does not belong to you",
        code: "ATTEMPT_UNAUTHORIZED",
      });
    }

    if (attempt.status !== "IN_PROGRESS") {
      return res.status(400).json({
        success: false,
        message: "This attempt has already been submitted",
        code: "ATTEMPT_ALREADY_SUBMITTED",
      });
    }

    const enrollment = attempt.quiz.section.course.enrollments[0];
    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this course",
        code: "NOT_ENROLLED",
      });
    }

    let totalScore = 0;
    let correctAnswers = 0;
    const answerRecords = [];

    for (const answerData of answers) {
      const question = attempt.quiz.questions.find(
        (q) => q.id === answerData.questionId
      );
      if (!question) continue;

      const isCorrect = checkAnswer(question, answerData.answer);
      const points = isCorrect ? question.points : 0;

      totalScore += points;
      if (isCorrect) correctAnswers++;

      const answerRecord = await prisma.answer.create({
        data: {
          questionId: question.id,
          attemptId: attempt.id,
          content: JSON.stringify(answerData.answer),
          isCorrect,
          points,
          timeSpent: 0,
        },
      });

      answerRecords.push(answerRecord);
    }

    const totalPoints = attempt.quiz.questions.reduce(
      (sum, q) => sum + q.points,
      0
    );
    const percentage = totalPoints > 0 ? (totalScore / totalPoints) * 100 : 0;
    const isPassed = percentage >= attempt.quiz.passingScore;

    const timeSpentCalculated = Math.round(
      (Date.now() - new Date(attempt.createdAt).getTime()) / 1000
    );

    const updatedAttempt = await prisma.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        submittedAt: new Date(),
        score: totalScore,
        percentage,
        isPassed,
        completedQuestions: answers.length,
        timeSpent: timeSpentCalculated,
        status: "SUBMITTED",
        gradedAt: new Date(),
      },
    });

    if (isPassed) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          quizzesCompleted: { increment: 1 },
          totalTimeSpent: { increment: timeSpentCalculated },
          lastAccessedAt: new Date(),
        },
      });

      await updateCourseProgress(
        req.studentProfile.id,
        attempt.quiz.section.course.id
      );
    }

    const progressData = await getCourseProgressData(
      req.studentProfile.id,
      attempt.quiz.section.course.id
    );

    if (socketManager && socketManager.sendToUser) {
      socketManager.sendToUser(req.userAuthId, "quiz_completed", {
        quizId: attempt.quiz.id,
        quizTitle: attempt.quiz.title,
        courseId: attempt.quiz.section.course.id,
        courseTitle: attempt.quiz.section.course.title,
        score: totalScore,
        percentage,
        isPassed,
        progress: progressData.progressPercentage,
      });
    }

    await checkAndAwardCertificate(
      req.studentProfile.id,
      attempt.quiz.section.course.id,
      progressData
    );

    await invalidateUserCache(req.userAuthId, [
      `quiz:*quizId=${attempt.quiz.id}*`,
      `course_content:*courseId=${attempt.quiz.section.course.id}*`,
    ]);

    const result = {
      attempt: {
        id: updatedAttempt.id,
        score: updatedAttempt.score,
        percentage: updatedAttempt.percentage,
        isPassed: updatedAttempt.isPassed,
        submittedAt: updatedAttempt.submittedAt,
        timeSpent: updatedAttempt.timeSpent,
        correctAnswers,
        totalQuestions: attempt.quiz.questions.length,
      },
      progress: progressData,
      showResults: attempt.quiz.showResults,
    };

    if (attempt.quiz.showResults && attempt.quiz.allowReview) {
      result.detailedResults = answerRecords.map((answer) => {
        const question = attempt.quiz.questions.find(
          (q) => q.id === answer.questionId
        );
        return {
          questionId: answer.questionId,
          questionContent: question.content,
          studentAnswer: JSON.parse(answer.content),
          correctAnswer: question.correctAnswer,
          isCorrect: answer.isCorrect,
          points: answer.points,
          explanation: question.explanation,
        };
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Quiz attempt submitted successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SUBMIT_QUIZ_ATTEMPT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      attemptId: req.params.attemptId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to submit quiz attempt",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createNote = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { lessonId } = req.params;
    const { content, timestamp, isPrivate = true } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Note content is required",
        code: "CONTENT_REQUIRED",
      });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        section: {
          include: {
            course: {
              include: {
                enrollments: {
                  where: {
                    studentId: req.userAuthId,
                    status: "ACTIVE",
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found",
        code: "LESSON_NOT_FOUND",
      });
    }

    const enrollment = lesson.section.course.enrollments[0];
    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this course",
        code: "NOT_ENROLLED",
      });
    }

    const note = await prisma.note.create({
      data: {
        userId: req.userAuthId,
        lessonId: lessonId,
        content: content.trim(),
        timestamp: timestamp || null,
        isPrivate,
      },
    });

    await redisService.invalidateCache(
      `lesson:*userId=${req.userAuthId}*lessonId=${lessonId}*`
    );

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Note created successfully",
      data: {
        note: {
          id: note.id,
          content: note.content,
          timestamp: note.timestamp,
          isPrivate: note.isPrivate,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CREATE_NOTE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      lessonId: req.params.lessonId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to create note",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createBookmark = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { lessonId } = req.params;
    const { title, note, timestamp } = req.body;

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        section: {
          include: {
            course: {
              include: {
                enrollments: {
                  where: {
                    studentId: req.userAuthId,
                    status: "ACTIVE",
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found",
        code: "LESSON_NOT_FOUND",
      });
    }

    const enrollment = lesson.section.course.enrollments[0];
    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this course",
        code: "NOT_ENROLLED",
      });
    }

    const bookmark = await prisma.bookmark.create({
      data: {
        userId: req.userAuthId,
        courseId: lesson.section.course.id,
        lessonId: lessonId,
        title:
          title ||
          `Bookmark at ${
            timestamp
              ? `${Math.floor(timestamp / 60)}:${(timestamp % 60)
                  .toString()
                  .padStart(2, "0")}`
              : "beginning"
          }`,
        note: note || null,
        timestamp: timestamp || null,
      },
    });

    await redisService.invalidateCache(
      `lesson:*userId=${req.userAuthId}*lessonId=${lessonId}*`
    );

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Bookmark created successfully",
      data: {
        bookmark: {
          id: bookmark.id,
          title: bookmark.title,
          note: bookmark.note,
          timestamp: bookmark.timestamp,
          createdAt: bookmark.createdAt,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CREATE_BOOKMARK_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      lessonId: req.params.lessonId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to create bookmark",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCertificate = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    const cacheKey = generateCacheKey("certificate", {
      userId: req.userAuthId,
      courseId,
    });

    const cached = await redisService.getCache(cacheKey);
    if (cached) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        ...cached,
        meta: {
          ...cached.meta,
          requestId,
          executionTime: Math.round(executionTime),
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const certificate = await prisma.certificate.findFirst({
      where: {
        studentId: req.userAuthId,
        courseId: courseId,
      },
      include: {
        course: {
          include: {
            instructor: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
        student: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!certificate) {
      return res.status(404).json({
        success: false,
        message: "Certificate not found",
        code: "CERTIFICATE_NOT_FOUND",
      });
    }

    const result = {
      certificate: {
        id: certificate.id,
        url: certificate.url,
        certificateId: certificate.certificateId,
        issueDate: certificate.issueDate,
        isVerified: certificate.isVerified,
        templateId: certificate.templateId,
      },
      course: {
        id: certificate.course.id,
        title: certificate.course.title,
        duration: certificate.course.duration,
        level: certificate.course.level,
        instructor: {
          name: `${certificate.course.instructor.user.firstName} ${certificate.course.instructor.user.lastName}`,
        },
      },
      student: {
        name: `${certificate.student.user.firstName} ${certificate.student.user.lastName}`,
      },
      verificationUrl: `${process.env.FRONTEND_URL}/certificates/verify/${certificate.certificateId}`,
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Certificate retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    };

    await redisService.setCache(cacheKey, response, 3600);

    res.status(200).json(response);
  } catch (error) {
    console.error(`GET_CERTIFICATE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve certificate",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getLearningAnalytics = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { timeRange = "30" } = req.query;

    const cacheKey = generateCacheKey("analytics", {
      userId: req.userAuthId,
      timeRange,
    });

    const cached = await redisService.getCache(cacheKey);
    if (cached) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        ...cached,
        meta: {
          ...cached.meta,
          requestId,
          executionTime: Math.round(executionTime),
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const days = parseInt(timeRange);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    const [
      enrollments,
      completions,
      quizAttempts,
      totalTimeSpent,
      recentActivity,
      achievements,
    ] = await Promise.all([
      prisma.enrollment.findMany({
        where: { studentId: req.userAuthId },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              thumbnail: true,
              level: true,
            },
          },
          certificate: true,
        },
      }),
      prisma.lessonCompletion.count({
        where: {
          studentId: req.userAuthId,
          completedAt: { gte: fromDate },
        },
      }),
      prisma.quizAttempt.findMany({
        where: {
          studentId: req.userAuthId,
          createdAt: { gte: fromDate },
        },
        include: {
          quiz: {
            select: {
              title: true,
              section: {
                select: {
                  course: {
                    select: {
                      title: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.enrollment.aggregate({
        where: { studentId: req.userAuthId },
        _sum: { totalTimeSpent: true },
      }),
      prisma.lessonCompletion.findMany({
        where: {
          studentId: req.userAuthId,
          completedAt: { gte: fromDate },
        },
        include: {
          lesson: {
            select: {
              title: true,
              section: {
                select: {
                  course: {
                    select: {
                      title: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { completedAt: "desc" },
        take: 10,
      }),
      prisma.achievement.findMany({
        where: {
          studentId: req.userAuthId,
          isUnlocked: true,
          unlockedAt: { gte: fromDate },
        },
        orderBy: { unlockedAt: "desc" },
      }),
    ]);

    const courseProgress = enrollments.map((enrollment) => ({
      courseId: enrollment.course.id,
      courseTitle: enrollment.course.title,
      thumbnail: enrollment.course.thumbnail,
      level: enrollment.course.level,
      progress: enrollment.progress,
      lessonsCompleted: enrollment.lessonsCompleted,
      quizzesCompleted: enrollment.quizzesCompleted,
      timeSpent: enrollment.totalTimeSpent,
      hasCertificate: !!enrollment.certificate,
      lastAccessed: enrollment.lastAccessedAt,
    }));

    const learningStreak = await calculateLearningStreak(req.userAuthId);
    const weeklyProgress = await getWeeklyProgress(req.userAuthId, 4);

    const result = {
      overview: {
        totalCourses: enrollments.length,
        activeCourses: enrollments.filter((e) => e.status === "ACTIVE").length,
        completedCourses: enrollments.filter((e) => e.status === "COMPLETED")
          .length,
        totalTimeSpent: totalTimeSpent._sum.totalTimeSpent || 0,
        totalCertificates: enrollments.filter((e) => e.certificate).length,
        averageProgress:
          enrollments.length > 0
            ? enrollments.reduce((sum, e) => sum + e.progress, 0) /
              enrollments.length
            : 0,
        currentStreak: learningStreak.current,
        longestStreak: learningStreak.longest,
      },
      recentActivity: {
        lessonsCompleted: completions,
        quizAttempts: quizAttempts.length,
        passedQuizzes: quizAttempts.filter((q) => q.isPassed).length,
        achievements: achievements.length,
        recentLessons: recentActivity.map((activity) => ({
          lessonTitle: activity.lesson.title,
          courseTitle: activity.lesson.section.course.title,
          completedAt: activity.completedAt,
          timeSpent: activity.timeSpent,
        })),
        recentAchievements: achievements.map((achievement) => ({
          title: achievement.title,
          description: achievement.description,
          icon: achievement.icon,
          points: achievement.points,
          unlockedAt: achievement.unlockedAt,
        })),
      },
      courseProgress,
      weeklyProgress,
      goals: {
        weeklyTimeGoal: 600,
        weeklyLessonsGoal: 5,
        currentWeekTime:
          weeklyProgress[weeklyProgress.length - 1]?.timeSpent || 0,
        currentWeekLessons:
          weeklyProgress[weeklyProgress.length - 1]?.lessonsCompleted || 0,
      },
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Learning analytics retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    };

    await redisService.setCache(cacheKey, response, 900);

    res.status(200).json(response);
  } catch (error) {
    console.error(`GET_LEARNING_ANALYTICS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve learning analytics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteNote = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { noteId } = req.params;

    const note = await prisma.note.findUnique({
      where: { id: noteId },
    });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: "Note not found",
        code: "NOTE_NOT_FOUND",
      });
    }

    if (note.userId !== req.userAuthId) {
      return res.status(403).json({
        success: false,
        message: "This note does not belong to you",
        code: "NOTE_UNAUTHORIZED",
      });
    }

    await prisma.note.delete({
      where: { id: noteId },
    });

    await redisService.invalidateCache(
      `lesson:*userId=${req.userAuthId}*lessonId=${note.lessonId}*`
    );

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Note deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_NOTE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      noteId: req.params.noteId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete note",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteBookmark = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { bookmarkId } = req.params;

    const bookmark = await prisma.bookmark.findUnique({
      where: { id: bookmarkId },
    });

    if (!bookmark) {
      return res.status(404).json({
        success: false,
        message: "Bookmark not found",
        code: "BOOKMARK_NOT_FOUND",
      });
    }

    if (bookmark.userId !== req.userAuthId) {
      return res.status(403).json({
        success: false,
        message: "This bookmark does not belong to you",
        code: "BOOKMARK_UNAUTHORIZED",
      });
    }

    await prisma.bookmark.delete({
      where: { id: bookmarkId },
    });

    await redisService.invalidateCache(
      `lesson:*userId=${req.userAuthId}*lessonId=${bookmark.lessonId}*`
    );

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Bookmark deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_BOOKMARK_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      bookmarkId: req.params.bookmarkId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete bookmark",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const updateCourseProgress = async (studentId, courseId) => {
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId,
          courseId,
        },
      },
      include: {
        course: {
          include: {
            sections: {
              include: {
                lessons: true,
                quizzes: true,
                assignments: true,
              },
            },
          },
        },
      },
    });

    if (!enrollment) return;

    const totalLessons = enrollment.course.sections.reduce(
      (sum, section) => sum + section.lessons.length,
      0
    );
    const totalQuizzes = enrollment.course.sections.reduce(
      (sum, section) => sum + section.quizzes.length,
      0
    );
    const totalAssignments = enrollment.course.sections.reduce(
      (sum, section) => sum + section.assignments.length,
      0
    );
    const totalContentItems = totalLessons + totalQuizzes + totalAssignments;

    const [completedLessons, passedQuizzes, gradedAssignments] =
      await Promise.all([
        prisma.lessonCompletion.count({
          where: {
            studentId,
            lesson: {
              section: {
                courseId,
              },
            },
          },
        }),
        prisma.quizAttempt.count({
          where: {
            studentId,
            isPassed: true,
            quiz: {
              section: {
                courseId,
              },
            },
          },
        }),
        prisma.assignmentSubmission.count({
          where: {
            studentId,
            status: "GRADED",
            assignment: {
              section: {
                courseId,
              },
            },
          },
        }),
      ]);

    const completedItems = completedLessons + passedQuizzes + gradedAssignments;
    const progressPercentage =
      totalContentItems > 0 ? (completedItems / totalContentItems) * 100 : 0;

    await prisma.courseProgress.upsert({
      where: {
        enrollmentId: enrollment.id,
      },
      update: {
        totalContentItems,
        completedItems,
        progressPercentage,
        lastActivityAt: new Date(),
      },
      create: {
        enrollmentId: enrollment.id,
        courseId,
        totalContentItems,
        completedItems,
        progressPercentage,
        lastActivityAt: new Date(),
      },
    });

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        progress: progressPercentage,
        lessonsCompleted: completedLessons,
        quizzesCompleted: passedQuizzes,
        assignmentsCompleted: gradedAssignments,
      },
    });

    if (progressPercentage >= 100) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "COMPLETED" },
      });
    }

    return { progressPercentage, completedItems, totalContentItems };
  } catch (error) {
    console.error("Error updating course progress:", error);
    return null;
  }
};

const getCourseProgressData = async (studentId, courseId) => {
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId,
          courseId,
        },
      },
      include: {
        courseProgress: true,
      },
    });

    return enrollment?.courseProgress || { progressPercentage: 0 };
  } catch (error) {
    console.error("Error getting course progress data:", error);
    return { progressPercentage: 0 };
  }
};

const checkAndAwardCertificate = async (studentId, courseId, progressData) => {
  try {
    if (progressData.progressPercentage >= 100) {
      const existingCertificate = await prisma.certificate.findFirst({
        where: {
          studentId,
          courseId,
        },
      });

      if (!existingCertificate) {
        const enrollment = await prisma.enrollment.findUnique({
          where: {
            studentId_courseId: {
              studentId,
              courseId,
            },
          },
          include: {
            course: {
              select: {
                title: true,
                instructor: {
                  select: {
                    user: {
                      select: {
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
              },
            },
            student: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
          },
        });

        if (enrollment) {
          const certificateId = `CERT_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
          const certificateUrl = `${process.env.FRONTEND_URL}/certificates/${certificateId}`;

          const certificate = await prisma.certificate.create({
            data: {
              enrollmentId: enrollment.id,
              studentId,
              courseId,
              certificateId,
              url: certificateUrl,
              issueDate: new Date(),
              isVerified: true,
            },
          });

          if (socketManager && socketManager.sendToUser) {
            socketManager.sendToUser(studentId, "certificate_issued", {
              certificateId: certificate.certificateId,
              courseTitle: enrollment.course.title,
              certificateUrl,
              issuedAt: certificate.issueDate,
            });
          }

          await notificationService.createNotification({
            userId: studentId,
            type: "CERTIFICATE_ISSUED",
            title: "Certificate Ready!",
            message: `Congratulations! Your certificate for "${enrollment.course.title}" is now available.`,
            data: {
              courseId,
              courseName: enrollment.course.title,
              certificateUrl,
              certificateId: certificate.certificateId,
            },
            actionUrl: certificateUrl,
            sendEmail: true,
          });

          await redisService.invalidateCache(
            `certificate:*userId=${studentId}*courseId=${courseId}*`
          );
        }
      }
    }
  } catch (error) {
    console.error("Error checking and awarding certificate:", error);
  }
};

const checkAnswer = (question, studentAnswer) => {
  try {
    switch (question.type) {
      case "MULTIPLE_CHOICE":
      case "SINGLE_CHOICE":
        return (
          JSON.stringify(studentAnswer).toLowerCase() ===
          JSON.stringify(question.correctAnswer).toLowerCase()
        );

      case "TRUE_FALSE":
        return (
          studentAnswer.toString().toLowerCase() ===
          question.correctAnswer.toLowerCase()
        );

      case "SHORT_ANSWER":
      case "FILL_IN_BLANK":
        const correctAnswers = JSON.parse(question.correctAnswer);
        const studentText = studentAnswer.toString().toLowerCase().trim();
        return correctAnswers.some(
          (answer) => answer.toLowerCase().trim() === studentText
        );

      case "ESSAY":
        return null;

      default:
        return false;
    }
  } catch (error) {
    console.error("Error checking answer:", error);
    return false;
  }
};

const calculateLearningStreak = async (studentId) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const completions = await prisma.lessonCompletion.findMany({
      where: {
        studentId,
        completedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { completedAt: "desc" },
    });

    const completionDates = [
      ...new Set(
        completions.map((c) => c.completedAt.toISOString().split("T")[0])
      ),
    ]
      .sort()
      .reverse();

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let expectedDate = new Date().toISOString().split("T")[0];

    for (const date of completionDates) {
      if (date === expectedDate) {
        tempStreak++;
        if (currentStreak === 0) currentStreak = tempStreak;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
        currentStreak = 0;
      }

      const prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - 1);
      expectedDate = prevDate.toISOString().split("T")[0];
    }

    longestStreak = Math.max(longestStreak, tempStreak);

    return { current: currentStreak, longest: longestStreak };
  } catch (error) {
    console.error("Error calculating learning streak:", error);
    return { current: 0, longest: 0 };
  }
};

const getWeeklyProgress = async (studentId, weeks = 4) => {
  try {
    const result = [];
    const now = new Date();

    for (let i = weeks - 1; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - i * 7 - now.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const [lessonsCompleted, timeSpent] = await Promise.all([
        prisma.lessonCompletion.count({
          where: {
            studentId,
            completedAt: {
              gte: weekStart,
              lte: weekEnd,
            },
          },
        }),
        prisma.lessonCompletion.aggregate({
          where: {
            studentId,
            completedAt: {
              gte: weekStart,
              lte: weekEnd,
            },
          },
          _sum: { timeSpent: true },
        }),
      ]);

      result.push({
        week: `Week ${weeks - i}`,
        startDate: weekStart,
        endDate: weekEnd,
        lessonsCompleted,
        timeSpent: timeSpent._sum.timeSpent || 0,
      });
    }

    return result;
  } catch (error) {
    console.error("Error getting weekly progress:", error);
    return [];
  }
};

const getLessonNavigation = async (lessonId, studentId) => {
  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        section: {
          include: {
            course: {
              include: {
                sections: {
                  orderBy: { order: "asc" },
                  include: {
                    lessons: {
                      orderBy: { order: "asc" },
                      select: {
                        id: true,
                        title: true,
                        order: true,
                        isFree: true,
                        isPreview: true,
                      },
                    },
                  },
                },
                enrollments: {
                  where: { studentId },
                },
              },
            },
          },
        },
      },
    });

    if (!lesson) return null;

    const allLessons = [];
    lesson.section.course.sections.forEach((section) => {
      section.lessons.forEach((l) => {
        allLessons.push({
          ...l,
          sectionId: section.id,
          sectionTitle: section.title,
        });
      });
    });

    const currentIndex = allLessons.findIndex((l) => l.id === lessonId);
    const canAccess = lesson.section.course.enrollments.length > 0;

    return {
      previous:
        currentIndex > 0
          ? {
              id: allLessons[currentIndex - 1].id,
              title: allLessons[currentIndex - 1].title,
              canAccess:
                allLessons[currentIndex - 1].isFree ||
                allLessons[currentIndex - 1].isPreview ||
                canAccess,
            }
          : null,
      next:
        currentIndex < allLessons.length - 1
          ? {
              id: allLessons[currentIndex + 1].id,
              title: allLessons[currentIndex + 1].title,
              canAccess:
                allLessons[currentIndex + 1].isFree ||
                allLessons[currentIndex + 1].isPreview ||
                canAccess,
            }
          : null,
      current: {
        position: currentIndex + 1,
        total: allLessons.length,
        sectionTitle: lesson.section.title,
      },
    };
  } catch (error) {
    console.error("Error getting lesson navigation:", error);
    return null;
  }
};

const getNextContent = async (sections, currentLessonId) => {
  try {
    const allContent = [];

    sections.forEach((section) => {
      section.lessons.forEach((lesson) => {
        allContent.push({
          type: "lesson",
          id: lesson.id,
          title: lesson.title,
          isCompleted: lesson.isCompleted,
          canAccess: lesson.canAccess,
        });
      });
      section.quizzes.forEach((quiz) => {
        allContent.push({
          type: "quiz",
          id: quiz.id,
          title: quiz.title,
          isCompleted: quiz.hasAttempt && quiz.lastAttempt?.isPassed,
          canAccess: quiz.canAccess,
        });
      });
      section.assignments.forEach((assignment) => {
        allContent.push({
          type: "assignment",
          id: assignment.id,
          title: assignment.title,
          isCompleted:
            assignment.hasSubmission &&
            assignment.lastSubmission?.status === "GRADED",
          canAccess: assignment.canAccess,
        });
      });
    });

    if (currentLessonId) {
      const currentIndex = allContent.findIndex(
        (content) => content.id === currentLessonId && content.type === "lesson"
      );
      if (currentIndex >= 0 && currentIndex < allContent.length - 1) {
        return allContent[currentIndex + 1];
      }
    }

    return (
      allContent.find((content) => !content.isCompleted && content.canAccess) ||
      null
    );
  } catch (error) {
    console.error("Error getting next content:", error);
    return null;
  }
};
