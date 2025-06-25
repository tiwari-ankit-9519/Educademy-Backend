import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../utils/redis.js";
import emailService from "../utils/emailService.js";
import notificationService from "../utils/notificationservice.js";

const prisma = new PrismaClient();

const generateReviewId = () => {
  return `course_review_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;
};

export const getPendingCourses = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 20,
      category,
      level,
      priority = "all",
      sortBy = "reviewSubmittedAt",
      sortOrder = "asc",
      search,
      instructor,
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `admin_pending_courses:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      category,
      level,
      priority,
      sortBy,
      sortOrder,
      search,
      instructor,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Pending courses retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const where = {
      status: "UNDER_REVIEW",
    };

    if (category) {
      where.categoryId = category;
    }

    if (level) {
      where.level = level;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        {
          instructor: {
            user: { firstName: { contains: search, mode: "insensitive" } },
          },
        },
        {
          instructor: {
            user: { lastName: { contains: search, mode: "insensitive" } },
          },
        },
      ];
    }

    if (instructor) {
      where.instructorId = instructor;
    }

    const orderBy = {};
    if (sortBy === "reviewSubmittedAt") {
      orderBy.reviewSubmittedAt = sortOrder;
    } else if (sortBy === "createdAt") {
      orderBy.createdAt = sortOrder;
    } else if (sortBy === "title") {
      orderBy.title = sortOrder;
    } else if (sortBy === "price") {
      orderBy.price = sortOrder;
    } else {
      orderBy.reviewSubmittedAt = "asc";
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          instructor: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  profileImage: true,
                },
              },
            },
          },
          category: {
            select: {
              name: true,
              slug: true,
            },
          },
          subcategory: {
            select: {
              name: true,
              slug: true,
            },
          },
          sections: {
            select: {
              id: true,
              title: true,
              isPublished: true,
              lessons: {
                select: {
                  id: true,
                  title: true,
                  duration: true,
                },
              },
              quizzes: {
                select: {
                  id: true,
                  title: true,
                },
              },
              assignments: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
        },
      }),
      prisma.course.count({ where }),
    ]);

    const reviewPriorityScore = (course) => {
      let score = 0;
      const daysSinceSubmission = Math.floor(
        (Date.now() - new Date(course.reviewSubmittedAt).getTime()) /
          (1000 * 60 * 60 * 24)
      );

      if (daysSinceSubmission > 7) score += 3;
      else if (daysSinceSubmission > 3) score += 2;
      else score += 1;

      if (course.price > 5000) score += 2;
      if (course.level === "ADVANCED") score += 1;
      if (course.instructor.totalCourses === 0) score += 2;

      return score;
    };

    const coursesWithPriority = courses.map((course) => {
      const priorityScore = reviewPriorityScore(course);
      let priorityLevel = "LOW";
      if (priorityScore >= 6) priorityLevel = "HIGH";
      else if (priorityScore >= 4) priorityLevel = "MEDIUM";

      const totalContent = course.sections.reduce((acc, section) => {
        return (
          acc +
          section.lessons.length +
          section.quizzes.length +
          section.assignments.length
        );
      }, 0);

      const publishedSections = course.sections.filter(
        (s) => s.isPublished
      ).length;
      const completionScore =
        course.sections.length > 0
          ? ((publishedSections / course.sections.length) * 100).toFixed(1)
          : 0;

      return {
        id: course.id,
        title: course.title,
        slug: course.slug,
        description: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        language: course.language,
        duration: course.duration,
        totalLessons: course.totalLessons,
        totalQuizzes: course.totalQuizzes,
        totalAssignments: course.totalAssignments,
        status: course.status,
        reviewSubmittedAt: course.reviewSubmittedAt,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        lastUpdated: course.lastUpdated,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          email: course.instructor.user.email,
          profileImage: course.instructor.user.profileImage,
          totalCourses: course.instructor.totalCourses,
          rating: course.instructor.rating,
          isVerified: course.instructor.isVerified,
        },
        category: course.category,
        subcategory: course.subcategory,
        metrics: {
          totalSections: course.sections.length,
          publishedSections,
          totalContent,
          completionScore: parseFloat(completionScore),
          priorityScore,
          priorityLevel,
          daysSinceSubmission: Math.floor(
            (Date.now() - new Date(course.reviewSubmittedAt).getTime()) /
              (1000 * 60 * 60 * 24)
          ),
        },
      };
    });

    let filteredCourses = coursesWithPriority;
    if (priority !== "all") {
      filteredCourses = coursesWithPriority.filter(
        (course) => course.metrics.priorityLevel === priority.toUpperCase()
      );
    }

    const result = {
      courses: filteredCourses,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      filters: {
        category,
        level,
        priority,
        search,
        instructor,
      },
      sort: {
        sortBy,
        sortOrder,
      },
      summary: {
        totalPending: total,
        highPriority: coursesWithPriority.filter(
          (c) => c.metrics.priorityLevel === "HIGH"
        ).length,
        mediumPriority: coursesWithPriority.filter(
          (c) => c.metrics.priorityLevel === "MEDIUM"
        ).length,
        lowPriority: coursesWithPriority.filter(
          (c) => c.metrics.priorityLevel === "LOW"
        ).length,
        overdue: coursesWithPriority.filter(
          (c) => c.metrics.daysSinceSubmission > 7
        ).length,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Pending courses retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get pending courses error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve pending courses",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCourseReviewDetails = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "COURSE_ID_REQUIRED",
      });
    }

    const cacheKey = `admin_course_review:${courseId}`;
    let cachedCourse = await redisService.getJSON(cacheKey);

    if (cachedCourse) {
      return res.status(200).json({
        success: true,
        message: "Course review details retrieved successfully",
        data: cachedCourse,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        instructor: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                profileImage: true,
                createdAt: true,
              },
            },
          },
        },
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
        subcategory: {
          select: {
            name: true,
            slug: true,
          },
        },
        sections: {
          include: {
            lessons: {
              select: {
                id: true,
                title: true,
                description: true,
                duration: true,
                type: true,
                isFree: true,
                isPreview: true,
                videoUrl: true,
                content: true,
                order: true,
              },
            },
            quizzes: {
              select: {
                id: true,
                title: true,
                description: true,
                duration: true,
                passingScore: true,
                maxAttempts: true,
                order: true,
                questions: {
                  select: {
                    id: true,
                    content: true,
                    type: true,
                    points: true,
                    difficulty: true,
                  },
                },
              },
            },
            assignments: {
              select: {
                id: true,
                title: true,
                description: true,
                totalPoints: true,
                dueDate: true,
                order: true,
              },
            },
          },
        },
        reviews: {
          take: 5,
          orderBy: { createdAt: "desc" },
          include: {
            author: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    const qualityChecks = {
      hasDescription: {
        passed: course.description && course.description.length >= 100,
        message:
          course.description && course.description.length >= 100
            ? "Description is comprehensive"
            : "Description should be at least 100 characters",
      },
      hasPreviewContent: {
        passed:
          course.previewVideo ||
          course.sections.some((s) =>
            s.lessons.some((l) => l.isPreview || l.isFree)
          ),
        message:
          course.previewVideo ||
          course.sections.some((s) =>
            s.lessons.some((l) => l.isPreview || l.isFree)
          )
            ? "Preview content available"
            : "No preview content found",
      },
      hasThumbnail: {
        passed: !!course.thumbnail,
        message: course.thumbnail
          ? "Thumbnail image provided"
          : "Thumbnail image missing",
      },
      hasMinimumContent: {
        passed: course.sections.length >= 3 && course.totalLessons >= 10,
        message:
          course.sections.length >= 3 && course.totalLessons >= 10
            ? "Sufficient content volume"
            : "Minimum 3 sections and 10 lessons required",
      },
      hasLearningOutcomes: {
        passed: course.learningOutcomes && course.learningOutcomes.length >= 3,
        message:
          course.learningOutcomes && course.learningOutcomes.length >= 3
            ? "Learning outcomes defined"
            : "At least 3 learning outcomes required",
      },
      hasRequirements: {
        passed: course.requirements && course.requirements.length > 0,
        message:
          course.requirements && course.requirements.length > 0
            ? "Prerequisites specified"
            : "Course requirements should be specified",
      },
      hasTargetAudience: {
        passed: course.targetAudience && course.targetAudience.length > 0,
        message:
          course.targetAudience && course.targetAudience.length > 0
            ? "Target audience defined"
            : "Target audience should be defined",
      },
      sectionsPublished: {
        passed: course.sections.every((s) => s.isPublished),
        message: course.sections.every((s) => s.isPublished)
          ? "All sections published"
          : "Some sections are not published",
      },
    };

    const passedChecks = Object.values(qualityChecks).filter(
      (check) => check.passed
    ).length;
    const totalChecks = Object.keys(qualityChecks).length;
    const qualityScore = Math.round((passedChecks / totalChecks) * 100);

    const contentAnalysis = {
      totalDuration: course.duration,
      averageLessonDuration:
        course.totalLessons > 0
          ? Math.round(course.duration / course.totalLessons)
          : 0,
      videoLessons: course.sections.reduce(
        (acc, s) => acc + s.lessons.filter((l) => l.type === "VIDEO").length,
        0
      ),
      textLessons: course.sections.reduce(
        (acc, s) => acc + s.lessons.filter((l) => l.type === "TEXT").length,
        0
      ),
      quizzesCount: course.totalQuizzes,
      assignmentsCount: course.totalAssignments,
      freeContent: course.sections.reduce(
        (acc, s) => acc + s.lessons.filter((l) => l.isFree).length,
        0
      ),
      previewContent: course.sections.reduce(
        (acc, s) => acc + s.lessons.filter((l) => l.isPreview).length,
        0
      ),
    };

    const instructorHistory = await prisma.course.count({
      where: {
        instructorId: course.instructorId,
        status: { in: ["PUBLISHED", "REJECTED"] },
      },
    });

    const result = {
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug,
        description: course.description,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        language: course.language,
        subtitles: course.subtitles,
        duration: course.duration,
        totalLessons: course.totalLessons,
        totalQuizzes: course.totalQuizzes,
        totalAssignments: course.totalAssignments,
        status: course.status,
        requirements: course.requirements,
        learningOutcomes: course.learningOutcomes,
        targetAudience: course.targetAudience,
        keyPoints: course.keyPoints,
        tags: course.tags,
        reviewSubmittedAt: course.reviewSubmittedAt,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        lastUpdated: course.lastUpdated,
      },
      instructor: {
        id: course.instructor.id,
        name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
        email: course.instructor.user.email,
        profileImage: course.instructor.user.profileImage,
        totalCourses: course.instructor.totalCourses,
        totalStudents: course.instructor.totalStudents,
        rating: course.instructor.rating,
        isVerified: course.instructor.isVerified,
        verificationBadge: course.instructor.verificationBadge,
        yearsExperience: course.instructor.yearsExperience,
        expertise: course.instructor.expertise,
        joinedAt: course.instructor.user.createdAt,
        coursesHistory: instructorHistory,
      },
      category: course.category,
      subcategory: course.subcategory,
      sections: course.sections.map((section) => ({
        id: section.id,
        title: section.title,
        description: section.description,
        order: section.order,
        isPublished: section.isPublished,
        estimatedTime: section.estimatedTime,
        lessonsCount: section.lessons.length,
        quizzesCount: section.quizzes.length,
        assignmentsCount: section.assignments.length,
        lessons: section.lessons,
        quizzes: section.quizzes,
        assignments: section.assignments,
      })),
      qualityChecks,
      qualityScore,
      contentAnalysis,
      recentReviews: course.reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        content: review.content.substring(0, 150),
        authorName: `${review.author.firstName} ${review.author.lastName}`,
        createdAt: review.createdAt,
      })),
    };

    await redisService.setJSON(cacheKey, result, { ex: 1800 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Course review details retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get course review details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve course review details",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const reviewCourse = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { action, feedback, qualityNotes, suggestions, priorityFeedback } =
      req.body;
    const reviewerId = req.userAuthId;

    if (!["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be APPROVE or REJECT",
        code: "INVALID_ACTION",
      });
    }

    if (action === "REJECT" && !feedback) {
      return res.status(400).json({
        success: false,
        message: "Feedback is required when rejecting a course",
        code: "FEEDBACK_REQUIRED",
      });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        instructor: {
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

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    if (course.status !== "UNDER_REVIEW") {
      return res.status(400).json({
        success: false,
        message: `Cannot review course with status: ${course.status}`,
        code: "INVALID_COURSE_STATUS",
      });
    }

    const reviewer = await prisma.user.findUnique({
      where: { id: reviewerId },
      select: { firstName: true, lastName: true, email: true },
    });

    const reviewId = generateReviewId();
    const reviewData = {
      reviewId,
      courseId,
      courseName: course.title,
      instructorId: course.instructor.id,
      instructorName: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
      instructorEmail: course.instructor.user.email,
      reviewerId,
      reviewerName: `${reviewer.firstName} ${reviewer.lastName}`,
      action,
      feedback: feedback || "",
      qualityNotes: qualityNotes || "",
      suggestions: suggestions || [],
      priorityFeedback: priorityFeedback || "",
      reviewedAt: new Date().toISOString(),
    };

    const newStatus = action === "APPROVE" ? "PUBLISHED" : "REJECTED";
    const publishedAt = action === "APPROVE" ? new Date() : null;

    await prisma.course.update({
      where: { id: courseId },
      data: {
        status: newStatus,
        publishedAt,
        reviewerId,
        reviewerFeedback: feedback,
        rejectionReason: action === "REJECT" ? feedback : null,
      },
    });

    if (action === "APPROVE") {
      await prisma.instructor.update({
        where: { id: course.instructorId },
        data: {
          totalCourses: {
            increment: 1,
          },
        },
      });
    }

    const reviewHistoryKey = `course_review_history:${courseId}`;
    const existingHistory =
      (await redisService.getJSON(reviewHistoryKey)) || [];
    existingHistory.push(reviewData);
    await redisService.setJSON(reviewHistoryKey, existingHistory, {
      ex: 30 * 24 * 60 * 60,
    });

    const statsKey = "admin_course_review_stats";
    await redisService.hincrby(statsKey, "total_reviews", 1);
    await redisService.hincrby(
      statsKey,
      action === "APPROVE" ? "approved_courses" : "rejected_courses",
      1
    );

    try {
      if (action === "APPROVE") {
        await emailService.sendCourseApprovalEmail({
          email: course.instructor.user.email,
          firstName: course.instructor.user.firstName,
          courseTitle: course.title,
          courseId: course.id,
          feedback:
            feedback ||
            "Your course meets our quality standards and has been approved for publication.",
          courseUrl: `${process.env.FRONTEND_URL}/courses/${course.slug}`,
        });

        await notificationService.createNotification({
          userId: course.instructor.user.id,
          type: "course_approved",
          title: "Course Approved! 🎉",
          message: `Your course "${course.title}" has been approved and is now live.`,
          priority: "HIGH",
          data: {
            courseId: course.id,
            courseName: course.title,
            courseUrl: `${process.env.FRONTEND_URL}/courses/${course.slug}`,
            feedback,
          },
          actionUrl: `/instructor/courses/${course.id}`,
        });
      } else {
        await emailService.sendCourseRejectionEmail({
          email: course.instructor.user.email,
          firstName: course.instructor.user.firstName,
          courseTitle: course.title,
          courseId: course.id,
          rejectionReason: feedback,
          feedback: qualityNotes,
        });

        await notificationService.createNotification({
          userId: course.instructor.user.id,
          type: "course_rejected",
          title: "Course Review Required",
          message: `Your course "${course.title}" needs updates before publication.`,
          priority: "NORMAL",
          data: {
            courseId: course.id,
            courseName: course.title,
            feedback,
            suggestions: suggestions || [],
            rejectionReason: feedback,
          },
          actionUrl: `/instructor/courses/${course.id}/edit`,
        });
      }
    } catch (emailError) {
      console.error("Failed to send course review email:", emailError);
    }

    await redisService.delPattern("admin_pending_courses:*");
    await redisService.del(`admin_course_review:${courseId}`);
    await redisService.del(`course_details:${courseId}`);
    await redisService.del(`instructor_courses:${course.instructorId}`);

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `Course ${action.toLowerCase()}d successfully`,
      data: {
        reviewId,
        courseId,
        courseName: course.title,
        action,
        newStatus,
        reviewedAt: reviewData.reviewedAt,
        publishedAt,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Review course error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to review course",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateCourseStatus = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { status, reason } = req.body;
    const adminId = req.userAuthId;

    const validStatuses = [
      "PUBLISHED",
      "SUSPENDED",
      "ARCHIVED",
      "UNDER_REVIEW",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be one of: " + validStatuses.join(", "),
        code: "INVALID_STATUS",
      });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        instructor: {
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

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    const updateData = {
      status,
      reviewerId: adminId,
    };

    if (status === "PUBLISHED" && course.status !== "PUBLISHED") {
      updateData.publishedAt = new Date();
    } else if (status === "ARCHIVED") {
      updateData.archivedAt = new Date();
    }

    if (reason) {
      updateData.reviewerFeedback = reason;
    }

    await prisma.course.update({
      where: { id: courseId },
      data: updateData,
    });

    const statusChangeKey = `course_status_changes:${courseId}`;
    const statusHistory = (await redisService.getJSON(statusChangeKey)) || [];
    statusHistory.push({
      previousStatus: course.status,
      newStatus: status,
      reason: reason || "",
      changedBy: adminId,
      changedAt: new Date().toISOString(),
    });
    await redisService.setJSON(statusChangeKey, statusHistory, {
      ex: 30 * 24 * 60 * 60,
    });

    try {
      let notificationTitle = "";
      let notificationMessage = "";
      let emailSubject = "";

      switch (status) {
        case "SUSPENDED":
          notificationTitle = "Course Suspended";
          notificationMessage = `Your course "${course.title}" has been temporarily suspended.`;
          emailSubject = "Course Suspended - Action Required";
          break;
        case "ARCHIVED":
          notificationTitle = "Course Archived";
          notificationMessage = `Your course "${course.title}" has been archived.`;
          emailSubject = "Course Archived - Educademy";
          break;
        case "PUBLISHED":
          notificationTitle = "Course Published";
          notificationMessage = `Your course "${course.title}" is now published and available to students.`;
          emailSubject = "Course Published - Congratulations!";
          break;
        case "UNDER_REVIEW":
          notificationTitle = "Course Under Review";
          notificationMessage = `Your course "${course.title}" is being reviewed by our team.`;
          emailSubject = "Course Under Review - Educademy";
          break;
      }

      await notificationService.createNotification({
        userId: course.instructor.user.id,
        type: "course_status_update",
        title: notificationTitle,
        message: notificationMessage,
        priority: status === "SUSPENDED" ? "HIGH" : "NORMAL",
        data: {
          courseId: course.id,
          courseName: course.title,
          previousStatus: course.status,
          newStatus: status,
          reason,
        },
        actionUrl: `/instructor/courses/${course.id}`,
      });

      await emailService.send({
        to: course.instructor.user.email,
        subject: emailSubject,
        template: "course",
        templateData: {
          userName: course.instructor.user.firstName,
          title: notificationTitle,
          subtitle: `Your course status has been updated to ${status.toLowerCase()}`,
          message: notificationMessage + (reason ? ` Reason: ${reason}` : ""),
          courseType: status.toLowerCase(),
          courseName: course.title,
          actionButton: "View Course",
          actionUrl: `${process.env.FRONTEND_URL}/instructor/courses/${course.id}`,
        },
      });
    } catch (notificationError) {
      console.error(
        "Failed to send status update notification:",
        notificationError
      );
    }

    await redisService.delPattern("admin_pending_courses:*");
    await redisService.del(`admin_course_review:${courseId}`);
    await redisService.del(`course_details:${courseId}`);
    await redisService.del(`instructor_courses:${course.instructorId}`);

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Course status updated successfully",
      data: {
        courseId,
        courseName: course.title,
        previousStatus: course.status,
        newStatus: status,
        reason,
        updatedAt: new Date().toISOString(),
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Update course status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update course status",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCourseStats = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "30d" } = req.query;

    const cacheKey = `admin_course_stats:${period}`;
    let cachedStats = await redisService.getJSON(cacheKey);

    if (cachedStats) {
      return res.status(200).json({
        success: true,
        message: "Course statistics retrieved successfully",
        data: cachedStats,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    let dateFilter = {};
    const now = new Date();

    switch (period) {
      case "7d":
        dateFilter = { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
        break;
      case "30d":
        dateFilter = {
          gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        };
        break;
      case "90d":
        dateFilter = {
          gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
        };
        break;
      default:
        dateFilter = {};
    }

    const [
      totalCourses,
      publishedCourses,
      pendingCourses,
      rejectedCourses,
      suspendedCourses,
      coursesByCategory,
      coursesByLevel,
      recentSubmissions,
      reviewStats,
    ] = await Promise.all([
      prisma.course.count(),
      prisma.course.count({ where: { status: "PUBLISHED" } }),
      prisma.course.count({ where: { status: "UNDER_REVIEW" } }),
      prisma.course.count({ where: { status: "REJECTED" } }),
      prisma.course.count({ where: { status: "SUSPENDED" } }),
      prisma.course.groupBy({
        by: ["categoryId"],
        _count: { categoryId: true },
        orderBy: { _count: { categoryId: "desc" } },
        take: 10,
      }),
      prisma.course.groupBy({
        by: ["level"],
        _count: { level: true },
      }),
      prisma.course.count({
        where: {
          reviewSubmittedAt: dateFilter,
        },
      }),
      redisService.hgetall("admin_course_review_stats"),
    ]);

    const categoryDetails = await prisma.category.findMany({
      where: {
        id: { in: coursesByCategory.map((c) => c.categoryId) },
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    const avgReviewTime = await prisma.course.findMany({
      where: {
        status: { in: ["PUBLISHED", "REJECTED"] },
        reviewSubmittedAt: { not: null },
        updatedAt: { not: null },
      },
      select: {
        reviewSubmittedAt: true,
        updatedAt: true,
      },
      take: 100,
    });

    const reviewTimes = avgReviewTime.map((course) => {
      const submitted = new Date(course.reviewSubmittedAt);
      const reviewed = new Date(course.updatedAt);
      return (reviewed.getTime() - submitted.getTime()) / (1000 * 60 * 60 * 24);
    });

    const averageReviewDays =
      reviewTimes.length > 0
        ? (reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length).toFixed(
            1
          )
        : 0;

    const qualityScore = await prisma.course.findMany({
      where: { status: "PUBLISHED" },
      select: {
        averageRating: true,
        totalRatings: true,
      },
    });

    const avgQualityScore =
      qualityScore.length > 0
        ? (
            qualityScore.reduce(
              (acc, course) => acc + (course.averageRating || 0),
              0
            ) / qualityScore.length
          ).toFixed(1)
        : 0;

    const stats = {
      overview: {
        totalCourses,
        publishedCourses,
        pendingCourses,
        rejectedCourses,
        suspendedCourses,
        archivedCourses:
          totalCourses -
          publishedCourses -
          pendingCourses -
          rejectedCourses -
          suspendedCourses,
        approvalRate:
          totalCourses > 0
            ? ((publishedCourses / totalCourses) * 100).toFixed(1)
            : 0,
        rejectionRate:
          totalCourses > 0
            ? ((rejectedCourses / totalCourses) * 100).toFixed(1)
            : 0,
      },
      byCategory: coursesByCategory.map((cat) => {
        const details = categoryDetails.find((d) => d.id === cat.categoryId);
        return {
          categoryId: cat.categoryId,
          categoryName: details?.name || "Unknown",
          categorySlug: details?.slug || "",
          count: cat._count.categoryId,
        };
      }),
      byLevel: coursesByLevel.map((level) => ({
        level: level.level,
        count: level._count.level,
      })),
      reviewMetrics: {
        totalReviews: parseInt(reviewStats?.total_reviews || 0),
        approvedReviews: parseInt(reviewStats?.approved_courses || 0),
        rejectedReviews: parseInt(reviewStats?.rejected_courses || 0),
        averageReviewTime: `${averageReviewDays} days`,
        pendingReviews: pendingCourses,
        recentSubmissions,
      },
      qualityMetrics: {
        averageQualityScore: parseFloat(avgQualityScore),
        totalRatedCourses: qualityScore.filter((c) => c.totalRatings > 0)
          .length,
        highQualityCourses: qualityScore.filter((c) => c.averageRating >= 4.5)
          .length,
        lowQualityCourses: qualityScore.filter(
          (c) => c.averageRating < 3.0 && c.totalRatings >= 5
        ).length,
      },
      timeline: {
        period,
        recentSubmissions,
        dateRange: dateFilter.gte
          ? {
              from: dateFilter.gte.toISOString(),
              to: now.toISOString(),
            }
          : null,
      },
    };

    await redisService.setJSON(cacheKey, stats, { ex: 1800 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Course statistics retrieved successfully",
      data: stats,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get course stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve course statistics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const bulkCourseActions = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { courseIds, action, reason } = req.body;
    const adminId = req.userAuthId;

    if (!Array.isArray(courseIds) || courseIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Course IDs array is required",
        code: "COURSE_IDS_REQUIRED",
      });
    }

    if (courseIds.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Maximum 50 courses can be processed at once",
        code: "TOO_MANY_COURSES",
      });
    }

    const validActions = ["APPROVE", "REJECT", "SUSPEND", "ARCHIVE"];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be one of: " + validActions.join(", "),
        code: "INVALID_ACTION",
      });
    }

    const courses = await prisma.course.findMany({
      where: {
        id: { in: courseIds },
      },
      include: {
        instructor: {
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

    if (courses.length !== courseIds.length) {
      return res.status(404).json({
        success: false,
        message: "Some courses were not found",
        code: "COURSES_NOT_FOUND",
      });
    }

    const statusMap = {
      APPROVE: "PUBLISHED",
      REJECT: "REJECTED",
      SUSPEND: "SUSPENDED",
      ARCHIVE: "ARCHIVED",
    };

    const newStatus = statusMap[action];
    const results = [];
    const errors = [];

    for (const course of courses) {
      try {
        if (action === "APPROVE" && course.status !== "UNDER_REVIEW") {
          errors.push({
            courseId: course.id,
            courseName: course.title,
            error: "Course is not under review",
          });
          continue;
        }

        const updateData = {
          status: newStatus,
          reviewerId: adminId,
        };

        if (action === "APPROVE") {
          updateData.publishedAt = new Date();
        } else if (action === "ARCHIVE") {
          updateData.archivedAt = new Date();
        }

        if (reason) {
          updateData.reviewerFeedback = reason;
          if (action === "REJECT") {
            updateData.rejectionReason = reason;
          }
        }

        await prisma.course.update({
          where: { id: course.id },
          data: updateData,
        });

        if (action === "APPROVE") {
          await prisma.instructor.update({
            where: { id: course.instructorId },
            data: {
              totalCourses: { increment: 1 },
            },
          });
        }

        results.push({
          courseId: course.id,
          courseName: course.title,
          previousStatus: course.status,
          newStatus,
          success: true,
        });

        try {
          let notificationTitle = "";
          let notificationMessage = "";

          switch (action) {
            case "APPROVE":
              notificationTitle = "Course Approved! 🎉";
              notificationMessage = `Your course "${course.title}" has been approved and is now live.`;
              break;
            case "REJECT":
              notificationTitle = "Course Review Required";
              notificationMessage = `Your course "${course.title}" needs updates before publication.`;
              break;
            case "SUSPEND":
              notificationTitle = "Course Suspended";
              notificationMessage = `Your course "${course.title}" has been temporarily suspended.`;
              break;
            case "ARCHIVE":
              notificationTitle = "Course Archived";
              notificationMessage = `Your course "${course.title}" has been archived.`;
              break;
          }

          await notificationService.createNotification({
            userId: course.instructor.user.id,
            type:
              action === "APPROVE" ? "course_approved" : "course_status_update",
            title: notificationTitle,
            message: notificationMessage,
            priority: action === "SUSPEND" ? "HIGH" : "NORMAL",
            data: {
              courseId: course.id,
              courseName: course.title,
              action,
              reason,
            },
            actionUrl: `/instructor/courses/${course.id}`,
          });
        } catch (notificationError) {
          console.error(
            `Failed to send notification for course ${course.id}:`,
            notificationError
          );
        }
      } catch (courseError) {
        console.error(`Failed to update course ${course.id}:`, courseError);
        errors.push({
          courseId: course.id,
          courseName: course.title,
          error: courseError.message,
        });
      }
    }

    const bulkActionKey = `bulk_course_action:${Date.now()}`;
    await redisService.setJSON(
      bulkActionKey,
      {
        action,
        reason,
        adminId,
        results,
        errors,
        executedAt: new Date().toISOString(),
      },
      { ex: 24 * 60 * 60 }
    );

    const statsKey = "admin_course_review_stats";
    await redisService.hincrby(statsKey, "total_reviews", results.length);
    if (action === "APPROVE") {
      await redisService.hincrby(statsKey, "approved_courses", results.length);
    } else if (action === "REJECT") {
      await redisService.hincrby(statsKey, "rejected_courses", results.length);
    }

    await redisService.delPattern("admin_pending_courses:*");
    await redisService.delPattern("admin_course_stats:*");

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `Bulk ${action.toLowerCase()} operation completed`,
      data: {
        action,
        totalCourses: courseIds.length,
        successfulOperations: results.length,
        failedOperations: errors.length,
        results,
        errors,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Bulk course actions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute bulk course actions",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCourseReviewHistory = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    const cacheKey = `course_review_history:${courseId}`;
    let reviewHistory = await redisService.getJSON(cacheKey);

    if (!reviewHistory) {
      return res.status(404).json({
        success: false,
        message: "No review history found for this course",
        code: "HISTORY_NOT_FOUND",
      });
    }

    const statusChanges =
      (await redisService.getJSON(`course_status_changes:${courseId}`)) || [];

    const result = {
      courseId,
      reviewHistory,
      statusChanges,
      totalReviews: reviewHistory.length,
      totalStatusChanges: statusChanges.length,
    };

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Course review history retrieved successfully",
      data: result,
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get course review history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve course review history",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
