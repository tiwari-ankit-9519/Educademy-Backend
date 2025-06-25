import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";
import emailService from "../../utils/emailService.js";
import socketManager from "../../utils/socket-io.js";

const prisma = new PrismaClient();

export const getEnrolledStudents = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const {
    page = 1,
    limit = 20,
    courseId,
    status,
    search,
    sortBy = "enrolledAt",
    sortOrder = "desc",
  } = req.query;

  const pageSize = Math.min(parseInt(limit), 100);
  const pageNumber = Math.max(parseInt(page), 1);
  const skip = (pageNumber - 1) * pageSize;

  try {
    const cacheKey = `instructor:${instructorId}:students:${Buffer.from(
      JSON.stringify({
        page: pageNumber,
        limit: pageSize,
        courseId,
        status,
        search,
        sortBy,
        sortOrder,
      })
    ).toString("base64")}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Students retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const courseWhere = {
      instructorId,
      status: "PUBLISHED",
    };

    if (courseId) {
      courseWhere.id = courseId;
    }

    const enrollmentWhere = {
      course: courseWhere,
    };

    if (status) {
      enrollmentWhere.status = status;
    }

    if (search) {
      enrollmentWhere.student = {
        user: {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        },
      };
    }

    let orderBy = {};
    if (sortBy === "enrolledAt") {
      orderBy = { createdAt: sortOrder };
    } else if (sortBy === "progress") {
      orderBy = { progress: sortOrder };
    } else if (sortBy === "lastAccess") {
      orderBy = { lastAccessedAt: sortOrder };
    } else if (sortBy === "name") {
      orderBy = { student: { user: { firstName: sortOrder } } };
    }

    const [enrollments, total, courses] = await Promise.all([
      prisma.enrollment.findMany({
        where: enrollmentWhere,
        include: {
          student: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  profileImage: true,
                  country: true,
                  timezone: true,
                },
              },
            },
          },
          course: {
            select: {
              id: true,
              title: true,
              thumbnail: true,
              price: true,
              level: true,
            },
          },
          courseProgress: {
            select: {
              progressPercentage: true,
              lastActivityAt: true,
              currentSectionId: true,
              currentLessonId: true,
              estimatedTimeLeft: true,
            },
          },
        },
        orderBy,
        skip,
        take: pageSize,
      }),
      prisma.enrollment.count({ where: enrollmentWhere }),
      prisma.course.findMany({
        where: { instructorId, status: "PUBLISHED" },
        select: {
          id: true,
          title: true,
          _count: {
            select: { enrollments: true },
          },
        },
      }),
    ]);

    const studentsWithStats = await Promise.all(
      enrollments.map(async (enrollment) => {
        const studentStats = await Promise.all([
          prisma.lessonCompletion.count({
            where: {
              studentId: enrollment.student.id,
              lesson: {
                section: {
                  courseId: enrollment.courseId,
                },
              },
            },
          }),
          prisma.quizAttempt.count({
            where: {
              studentId: enrollment.student.id,
              quiz: {
                section: {
                  courseId: enrollment.courseId,
                },
              },
              status: "GRADED",
              isPassed: true,
            },
          }),
          prisma.assignmentSubmission.count({
            where: {
              studentId: enrollment.student.id,
              assignment: {
                section: {
                  courseId: enrollment.courseId,
                },
              },
              status: "GRADED",
            },
          }),
        ]);

        return {
          id: enrollment.id,
          enrolledAt: enrollment.createdAt,
          status: enrollment.status,
          progress: enrollment.progress,
          lastAccessedAt: enrollment.lastAccessedAt,
          totalTimeSpent: enrollment.totalTimeSpent,
          student: {
            id: enrollment.student.id,
            name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
            email: enrollment.student.user.email,
            profileImage: enrollment.student.user.profileImage,
            country: enrollment.student.user.country,
            timezone: enrollment.student.user.timezone,
          },
          course: enrollment.course,
          courseProgress: enrollment.courseProgress,
          stats: {
            lessonsCompleted: studentStats[0],
            quizzesPassed: studentStats[1],
            assignmentsSubmitted: studentStats[2],
          },
        };
      })
    );

    const result = {
      students: studentsWithStats,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      summary: {
        totalStudents: total,
        courses: courses.map((course) => ({
          id: course.id,
          title: course.title,
          enrollments: course._count.enrollments,
        })),
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    res.status(200).json({
      success: true,
      message: "Students retrieved successfully",
      data: result,
      meta: {
        cached: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get enrolled students error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve students",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const getStudentDetails = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { studentId, courseId } = req.params;

  try {
    const cacheKey = `instructor:${instructorId}:student:${studentId}:course:${courseId}:details`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Student details retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
        course: {
          instructorId,
        },
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                profileImage: true,
                country: true,
                timezone: true,
                dateOfBirth: true,
                phoneNumber: true,
                linkedinProfile: true,
                bio: true,
                createdAt: true,
                lastLogin: true,
              },
            },
          },
        },
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
        courseProgress: true,
        certificate: true,
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Student enrollment not found",
      });
    }

    const [
      lessonCompletions,
      quizAttempts,
      assignmentSubmissions,
      reviews,
      qnaQuestions,
      totalTimeSpent,
    ] = await Promise.all([
      prisma.lessonCompletion.findMany({
        where: {
          studentId,
          lesson: {
            section: {
              courseId,
            },
          },
        },
        include: {
          lesson: {
            select: {
              id: true,
              title: true,
              order: true,
              section: {
                select: {
                  id: true,
                  title: true,
                  order: true,
                },
              },
            },
          },
        },
        orderBy: { completedAt: "desc" },
      }),
      prisma.quizAttempt.findMany({
        where: {
          studentId,
          quiz: {
            section: {
              courseId,
            },
          },
        },
        include: {
          quiz: {
            select: {
              id: true,
              title: true,
              passingScore: true,
              duration: true,
            },
          },
        },
        orderBy: { startedAt: "desc" },
      }),
      prisma.assignmentSubmission.findMany({
        where: {
          studentId,
          assignment: {
            section: {
              courseId,
            },
          },
        },
        include: {
          assignment: {
            select: {
              id: true,
              title: true,
              totalPoints: true,
              dueDate: true,
            },
          },
        },
        orderBy: { submittedAt: "desc" },
      }),
      prisma.review.findMany({
        where: {
          authorId: enrollment.student.user.id,
          courseId,
        },
        include: {
          replies: {
            include: {
              author: {
                select: {
                  firstName: true,
                  lastName: true,
                  profileImage: true,
                },
              },
            },
          },
        },
      }),
      prisma.qnAQuestion.findMany({
        where: {
          studentId,
          courseId,
        },
        include: {
          answers: {
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
            },
          },
          lesson: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.enrollment.aggregate({
        where: {
          studentId,
          course: {
            instructorId,
          },
        },
        _sum: {
          totalTimeSpent: true,
        },
      }),
    ]);

    const progressBySection = enrollment.course.sections.map((section) => {
      const sectionLessons = section.lessons.length;
      const completedLessons = lessonCompletions.filter(
        (completion) => completion.lesson.section.id === section.id
      ).length;

      const sectionQuizzes = section.quizzes.length;
      const passedQuizzes = quizAttempts.filter(
        (attempt) =>
          attempt.quiz.id &&
          section.quizzes.some((quiz) => quiz.id === attempt.quiz.id) &&
          attempt.isPassed
      ).length;

      const sectionAssignments = section.assignments.length;
      const submittedAssignments = assignmentSubmissions.filter((submission) =>
        section.assignments.some(
          (assignment) => assignment.id === submission.assignment.id
        )
      ).length;

      const totalItems = sectionLessons + sectionQuizzes + sectionAssignments;
      const completedItems =
        completedLessons + passedQuizzes + submittedAssignments;

      return {
        sectionId: section.id,
        sectionTitle: section.title,
        order: section.order,
        progress: totalItems > 0 ? (completedItems / totalItems) * 100 : 0,
        totalItems,
        completedItems,
        lessons: {
          total: sectionLessons,
          completed: completedLessons,
        },
        quizzes: {
          total: sectionQuizzes,
          passed: passedQuizzes,
        },
        assignments: {
          total: sectionAssignments,
          submitted: submittedAssignments,
        },
      };
    });

    const result = {
      enrollment: {
        id: enrollment.id,
        enrolledAt: enrollment.createdAt,
        status: enrollment.status,
        progress: enrollment.progress,
        lastAccessedAt: enrollment.lastAccessedAt,
        totalTimeSpent: enrollment.totalTimeSpent,
        discountApplied: enrollment.discountApplied,
      },
      student: {
        id: enrollment.student.id,
        user: enrollment.student.user,
        learningGoals: enrollment.student.learningGoals,
        interests: enrollment.student.interests,
        skillLevel: enrollment.student.skillLevel,
        totalLearningTime: enrollment.student.totalLearningTime,
      },
      course: {
        id: enrollment.course.id,
        title: enrollment.course.title,
        level: enrollment.course.level,
        totalLessons: enrollment.course.totalLessons,
        totalQuizzes: enrollment.course.totalQuizzes,
        totalAssignments: enrollment.course.totalAssignments,
      },
      courseProgress: enrollment.courseProgress,
      certificate: enrollment.certificate,
      progressBySection,
      activity: {
        lessonCompletions: lessonCompletions.slice(0, 10),
        quizAttempts: quizAttempts.slice(0, 10),
        assignmentSubmissions: assignmentSubmissions.slice(0, 10),
      },
      engagement: {
        reviews,
        qnaQuestions: qnaQuestions.slice(0, 10),
        totalTimeAcrossAllCourses: totalTimeSpent._sum.totalTimeSpent || 0,
      },
      stats: {
        totalLessonsCompleted: lessonCompletions.length,
        totalQuizAttempts: quizAttempts.length,
        averageQuizScore:
          quizAttempts.length > 0
            ? quizAttempts.reduce(
                (acc, curr) => acc + (curr.percentage || 0),
                0
              ) / quizAttempts.length
            : 0,
        totalAssignmentSubmissions: assignmentSubmissions.length,
        averageAssignmentGrade:
          assignmentSubmissions.filter((sub) => sub.grade).length > 0
            ? assignmentSubmissions
                .filter((sub) => sub.grade)
                .reduce((acc, curr) => acc + curr.grade, 0) /
              assignmentSubmissions.filter((sub) => sub.grade).length
            : 0,
        questionsAsked: qnaQuestions.length,
        reviewsWritten: reviews.length,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

    res.status(200).json({
      success: true,
      message: "Student details retrieved successfully",
      data: result,
      meta: {
        cached: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get student details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve student details",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const gradeAssignment = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { submissionId } = req.params;
  const { grade, feedback, status = "GRADED" } = req.body;

  try {
    const submission = await prisma.assignmentSubmission.findFirst({
      where: {
        id: submissionId,
        assignment: {
          section: {
            course: {
              instructorId,
            },
          },
        },
      },
      include: {
        assignment: {
          select: {
            id: true,
            title: true,
            totalPoints: true,
            section: {
              select: {
                course: {
                  select: {
                    id: true,
                    title: true,
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
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Assignment submission not found",
      });
    }

    if (grade && (grade < 0 || grade > submission.assignment.totalPoints)) {
      return res.status(400).json({
        success: false,
        message: `Grade must be between 0 and ${submission.assignment.totalPoints}`,
      });
    }

    const updatedSubmission = await prisma.assignmentSubmission.update({
      where: { id: submissionId },
      data: {
        grade: grade || submission.grade,
        feedback: feedback || submission.feedback,
        status,
        gradedAt: new Date(),
        gradedBy: req.userAuthId,
      },
      include: {
        assignment: {
          select: {
            title: true,
            totalPoints: true,
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

    const percentage = grade
      ? (grade / submission.assignment.totalPoints) * 100
      : null;
    const passed = percentage ? percentage >= 70 : null;

    if (socketManager && grade) {
      socketManager.sendToUser(
        submission.student.user.id,
        "assignment_graded",
        {
          submissionId,
          assignmentTitle: submission.assignment.title,
          grade,
          totalPoints: submission.assignment.totalPoints,
          percentage: percentage?.toFixed(1),
          passed,
          feedback,
          gradedAt: updatedSubmission.gradedAt,
          instructorName: `${req.userProfile.user?.firstName} ${req.userProfile.user?.lastName}`,
        }
      );
    }

    if (grade && emailService) {
      await emailService.sendAssignmentGraded({
        email: submission.student.user.email,
        firstName: submission.student.user.firstName,
        courseName: submission.assignment.section.course.title,
        assignmentTitle: submission.assignment.title,
        grade: `${grade}/${submission.assignment.totalPoints}`,
        feedback,
        instructorName: `${req.userProfile.user?.firstName} ${req.userProfile.user?.lastName}`,
      });
    }

    await redisService.delPattern(`instructor:${instructorId}:students:*`);
    await redisService.delPattern(
      `instructor:${instructorId}:student:${submission.student.id}:*`
    );

    res.status(200).json({
      success: true,
      message: "Assignment graded successfully",
      data: {
        submissionId: updatedSubmission.id,
        grade: updatedSubmission.grade,
        feedback: updatedSubmission.feedback,
        status: updatedSubmission.status,
        percentage: percentage?.toFixed(1),
        passed,
        gradedAt: updatedSubmission.gradedAt,
      },
    });
  } catch (error) {
    console.error("Grade assignment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to grade assignment",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const gradeQuiz = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { attemptId } = req.params;
  const { answers, feedback, overrideGrade } = req.body;

  try {
    const attempt = await prisma.quizAttempt.findFirst({
      where: {
        id: attemptId,
        quiz: {
          section: {
            course: {
              instructorId,
            },
          },
        },
      },
      include: {
        quiz: {
          include: {
            questions: {
              include: {
                answers: {
                  where: {
                    attemptId,
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
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Quiz attempt not found",
      });
    }

    if (attempt.status === "GRADED") {
      return res.status(400).json({
        success: false,
        message: "Quiz attempt has already been graded",
      });
    }

    let totalScore = 0;
    let maxScore = 0;

    for (const question of attempt.quiz.questions) {
      maxScore += question.points;
      const studentAnswer = question.answers[0];

      if (studentAnswer) {
        if (answers && answers[question.id]) {
          const instructorGrade = answers[question.id];
          await prisma.answer.update({
            where: { id: studentAnswer.id },
            data: {
              points: instructorGrade.points,
              feedback: instructorGrade.feedback,
              isCorrect: instructorGrade.points > 0,
            },
          });
          totalScore += instructorGrade.points;
        } else if (
          question.type === "MULTIPLE_CHOICE" ||
          question.type === "SINGLE_CHOICE" ||
          question.type === "TRUE_FALSE"
        ) {
          const correctAnswer = JSON.parse(question.correctAnswer || "{}");
          const studentAnswerContent = JSON.parse(
            studentAnswer.content || "{}"
          );

          const isCorrect =
            JSON.stringify(correctAnswer) ===
            JSON.stringify(studentAnswerContent);
          const points = isCorrect ? question.points : 0;

          await prisma.answer.update({
            where: { id: studentAnswer.id },
            data: {
              points,
              isCorrect,
            },
          });
          totalScore += points;
        }
      }
    }

    const finalScore = overrideGrade !== undefined ? overrideGrade : totalScore;
    const percentage = (finalScore / maxScore) * 100;
    const isPassed = percentage >= attempt.quiz.passingScore;

    const updatedAttempt = await prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        score: finalScore,
        percentage,
        isPassed,
        status: "GRADED",
        gradedAt: new Date(),
        gradedBy: req.userAuthId,
        feedback,
      },
    });

    if (socketManager) {
      socketManager.sendToUser(attempt.student.user.id, "quiz_graded", {
        attemptId,
        quizTitle: attempt.quiz.title,
        score: finalScore,
        maxScore,
        percentage: percentage.toFixed(1),
        passed: isPassed,
        feedback,
        gradedAt: updatedAttempt.gradedAt,
      });
    }

    await redisService.delPattern(`instructor:${instructorId}:students:*`);
    await redisService.delPattern(
      `instructor:${instructorId}:student:${attempt.student.id}:*`
    );

    res.status(200).json({
      success: true,
      message: "Quiz graded successfully",
      data: {
        attemptId: updatedAttempt.id,
        score: finalScore,
        maxScore,
        percentage: percentage.toFixed(1),
        passed: isPassed,
        feedback,
        gradedAt: updatedAttempt.gradedAt,
      },
    });
  } catch (error) {
    console.error("Grade quiz error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to grade quiz",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const bulkGradeAssignments = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { assignments } = req.body;

  try {
    if (
      !assignments ||
      !Array.isArray(assignments) ||
      assignments.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Assignments array is required",
      });
    }

    const submissionIds = assignments.map((a) => a.submissionId);

    const submissions = await prisma.assignmentSubmission.findMany({
      where: {
        id: { in: submissionIds },
        assignment: {
          section: {
            course: {
              instructorId,
            },
          },
        },
      },
      include: {
        assignment: {
          select: {
            title: true,
            totalPoints: true,
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
        student: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (submissions.length !== assignments.length) {
      return res.status(400).json({
        success: false,
        message: "Some assignment submissions not found or not accessible",
      });
    }

    const results = [];
    const notifications = [];

    for (const assignment of assignments) {
      const submission = submissions.find(
        (s) => s.id === assignment.submissionId
      );

      if (!submission) continue;

      if (
        assignment.grade &&
        (assignment.grade < 0 ||
          assignment.grade > submission.assignment.totalPoints)
      ) {
        results.push({
          submissionId: assignment.submissionId,
          success: false,
          error: `Grade must be between 0 and ${submission.assignment.totalPoints}`,
        });
        continue;
      }

      try {
        const updatedSubmission = await prisma.assignmentSubmission.update({
          where: { id: assignment.submissionId },
          data: {
            grade: assignment.grade,
            feedback: assignment.feedback,
            status: "GRADED",
            gradedAt: new Date(),
            gradedBy: req.userAuthId,
          },
        });

        const percentage = assignment.grade
          ? (assignment.grade / submission.assignment.totalPoints) * 100
          : null;

        results.push({
          submissionId: assignment.submissionId,
          success: true,
          grade: assignment.grade,
          percentage: percentage?.toFixed(1),
          passed: percentage ? percentage >= 70 : null,
        });

        if (assignment.grade) {
          notifications.push({
            studentId: submission.student.user.id,
            studentEmail: submission.student.user.email,
            studentName: `${submission.student.user.firstName} ${submission.student.user.lastName}`,
            assignmentTitle: submission.assignment.title,
            courseTitle: submission.assignment.section.course.title,
            grade: assignment.grade,
            totalPoints: submission.assignment.totalPoints,
            percentage: percentage?.toFixed(1),
            passed: percentage ? percentage >= 70 : null,
            feedback: assignment.feedback,
          });
        }
      } catch (error) {
        results.push({
          submissionId: assignment.submissionId,
          success: false,
          error: error.message,
        });
      }
    }

    if (socketManager && notifications.length > 0) {
      notifications.forEach((notification) => {
        socketManager.sendToUser(notification.studentId, "assignment_graded", {
          assignmentTitle: notification.assignmentTitle,
          grade: notification.grade,
          totalPoints: notification.totalPoints,
          percentage: notification.percentage,
          passed: notification.passed,
          feedback: notification.feedback,
          gradedAt: new Date(),
          instructorName: `${req.userProfile.user?.firstName} ${req.userProfile.user?.lastName}`,
        });
      });
    }

    if (emailService && notifications.length > 0) {
      const emailPromises = notifications.map((notification) =>
        emailService.sendAssignmentGraded({
          email: notification.studentEmail,
          firstName: notification.studentName.split(" ")[0],
          courseName: notification.courseTitle,
          assignmentTitle: notification.assignmentTitle,
          grade: `${notification.grade}/${notification.totalPoints}`,
          feedback: notification.feedback,
          instructorName: `${req.userProfile.user?.firstName} ${req.userProfile.user?.lastName}`,
        })
      );

      await Promise.allSettled(emailPromises);
    }

    await redisService.delPattern(`instructor:${instructorId}:students:*`);

    res.status(200).json({
      success: true,
      message: "Bulk grading completed",
      data: {
        results,
        summary: {
          totalProcessed: assignments.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
          notificationsSent: notifications.length,
        },
      },
    });
  } catch (error) {
    console.error("Bulk grade assignments error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process bulk grading",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const getPendingGrading = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const {
    courseId,
    type = "all",
    sortBy = "submittedAt",
    sortOrder = "asc",
  } = req.query;

  try {
    const cacheKey = `instructor:${instructorId}:pending:${
      courseId || "all"
    }:${type}:${sortBy}:${sortOrder}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Pending grading items retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const courseWhere = {
      instructorId,
      ...(courseId && { id: courseId }),
    };

    let pendingAssignments = [];
    let pendingQuizzes = [];

    if (type === "all" || type === "assignments") {
      pendingAssignments = await prisma.assignmentSubmission.findMany({
        where: {
          status: "SUBMITTED",
          assignment: {
            section: {
              course: courseWhere,
            },
          },
        },
        include: {
          assignment: {
            include: {
              section: {
                include: {
                  course: {
                    select: {
                      id: true,
                      title: true,
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
                  profileImage: true,
                },
              },
            },
          },
        },
        orderBy: {
          [sortBy === "submittedAt" ? "submittedAt" : "createdAt"]: sortOrder,
        },
      });
    }

    if (type === "all" || type === "quizzes") {
      pendingQuizzes = await prisma.quizAttempt.findMany({
        where: {
          status: "SUBMITTED",
          quiz: {
            section: {
              course: courseWhere,
            },
          },
        },
        include: {
          quiz: {
            include: {
              section: {
                include: {
                  course: {
                    select: {
                      id: true,
                      title: true,
                    },
                  },
                },
              },
              questions: {
                where: {
                  type: {
                    in: ["SHORT_ANSWER", "ESSAY"],
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
                  profileImage: true,
                },
              },
            },
          },
        },
        orderBy: {
          [sortBy === "submittedAt" ? "submittedAt" : "startedAt"]: sortOrder,
        },
      });
    }

    const result = {
      assignments: pendingAssignments.map((submission) => ({
        id: submission.id,
        type: "assignment",
        title: submission.assignment.title,
        studentName: `${submission.student.user.firstName} ${submission.student.user.lastName}`,
        studentImage: submission.student.user.profileImage,
        courseName: submission.assignment.section.course.title,
        sectionName: submission.assignment.section.title,
        submittedAt: submission.submittedAt,
        isLate: submission.isLate,
        dueDate: submission.assignment.dueDate,
        totalPoints: submission.assignment.totalPoints,
        attempts: submission.attempts,
        priority: submission.isLate ? "high" : "normal",
      })),
      quizzes: pendingQuizzes
        .filter((attempt) => attempt.quiz.questions.length > 0)
        .map((attempt) => ({
          id: attempt.id,
          type: "quiz",
          title: attempt.quiz.title,
          studentName: `${attempt.student.user.firstName} ${attempt.student.user.lastName}`,
          studentImage: attempt.student.user.profileImage,
          courseName: attempt.quiz.section.course.title,
          sectionName: attempt.quiz.section.title,
          submittedAt: attempt.submittedAt,
          startedAt: attempt.startedAt,
          timeSpent: attempt.timeSpent,
          manualQuestions: attempt.quiz.questions.length,
          priority: "normal",
        })),
      summary: {
        totalPendingAssignments: pendingAssignments.length,
        totalPendingQuizzes: pendingQuizzes.filter(
          (attempt) => attempt.quiz.questions.length > 0
        ).length,
        urgentItems: pendingAssignments.filter((sub) => sub.isLate).length,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    res.status(200).json({
      success: true,
      message: "Pending grading items retrieved successfully",
      data: result,
      meta: {
        cached: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get pending grading error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve pending grading items",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const getStudentProgress = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { studentId, courseId } = req.params;
  const { timeframe = "all" } = req.query;

  try {
    const cacheKey = `instructor:${instructorId}:student:${studentId}:progress:${courseId}:${timeframe}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Student progress retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
        course: {
          instructorId,
        },
      },
      include: {
        courseProgress: true,
        course: {
          include: {
            sections: {
              include: {
                lessons: true,
                quizzes: true,
                assignments: true,
              },
              orderBy: { order: "asc" },
            },
          },
        },
        student: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                profileImage: true,
                timezone: true,
              },
            },
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Student enrollment not found",
      });
    }

    let dateFilter = {};
    const now = new Date();

    if (timeframe === "week") {
      dateFilter.gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeframe === "month") {
      dateFilter.gte = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeframe === "quarter") {
      dateFilter.gte = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    const whereClause = {
      studentId,
      ...(Object.keys(dateFilter).length > 0 && { completedAt: dateFilter }),
    };

    const [lessonCompletions, quizAttempts, assignmentSubmissions, studyTime] =
      await Promise.all([
        prisma.lessonCompletion.findMany({
          where: {
            ...whereClause,
            lesson: {
              section: {
                courseId,
              },
            },
          },
          include: {
            lesson: {
              select: {
                id: true,
                title: true,
                duration: true,
                order: true,
                section: {
                  select: {
                    id: true,
                    title: true,
                    order: true,
                  },
                },
              },
            },
          },
          orderBy: { completedAt: "asc" },
        }),
        prisma.quizAttempt.findMany({
          where: {
            studentId,
            status: "GRADED",
            ...(Object.keys(dateFilter).length > 0 && { gradedAt: dateFilter }),
            quiz: {
              section: {
                courseId,
              },
            },
          },
          include: {
            quiz: {
              select: {
                id: true,
                title: true,
                passingScore: true,
                maxAttempts: true,
              },
            },
          },
          orderBy: { startedAt: "asc" },
        }),
        prisma.assignmentSubmission.findMany({
          where: {
            studentId,
            status: "GRADED",
            ...(Object.keys(dateFilter).length > 0 && { gradedAt: dateFilter }),
            assignment: {
              section: {
                courseId,
              },
            },
          },
          include: {
            assignment: {
              select: {
                id: true,
                title: true,
                totalPoints: true,
                dueDate: true,
              },
            },
          },
          orderBy: { submittedAt: "asc" },
        }),
        prisma.enrollment.findFirst({
          where: { studentId, courseId },
          select: { totalTimeSpent: true },
        }),
      ]);

    const progressTimeline = [];
    const activityDates = new Set();

    lessonCompletions.forEach((completion) => {
      const date = completion.completedAt.toISOString().split("T")[0];
      activityDates.add(date);
      progressTimeline.push({
        date: completion.completedAt,
        type: "lesson_completed",
        item: {
          id: completion.lesson.id,
          title: completion.lesson.title,
          section: completion.lesson.section.title,
          timeSpent: completion.timeSpent,
        },
      });
    });

    quizAttempts.forEach((attempt) => {
      const date = attempt.startedAt.toISOString().split("T")[0];
      activityDates.add(date);
      progressTimeline.push({
        date: attempt.startedAt,
        type: "quiz_attempted",
        item: {
          id: attempt.quiz.id,
          title: attempt.quiz.title,
          score: attempt.score,
          percentage: attempt.percentage,
          passed: attempt.isPassed,
        },
      });
    });

    assignmentSubmissions.forEach((submission) => {
      const date = submission.submittedAt.toISOString().split("T")[0];
      activityDates.add(date);
      progressTimeline.push({
        date: submission.submittedAt,
        type: "assignment_submitted",
        item: {
          id: submission.assignment.id,
          title: submission.assignment.title,
          grade: submission.grade,
          totalPoints: submission.assignment.totalPoints,
          percentage: submission.grade
            ? (submission.grade / submission.assignment.totalPoints) * 100
            : null,
        },
      });
    });

    progressTimeline.sort((a, b) => new Date(a.date) - new Date(b.date));

    const sectionProgress = enrollment.course.sections.map((section) => {
      const sectionLessons = section.lessons;
      const sectionQuizzes = section.quizzes;
      const sectionAssignments = section.assignments;

      const completedLessons = lessonCompletions.filter(
        (completion) => completion.lesson.section.id === section.id
      );

      const completedQuizzes = quizAttempts.filter(
        (attempt) =>
          sectionQuizzes.some((quiz) => quiz.id === attempt.quiz.id) &&
          attempt.isPassed
      );

      const completedAssignments = assignmentSubmissions.filter((submission) =>
        sectionAssignments.some(
          (assignment) => assignment.id === submission.assignment.id
        )
      );

      const totalItems =
        sectionLessons.length +
        sectionQuizzes.length +
        sectionAssignments.length;
      const completedItems =
        completedLessons.length +
        completedQuizzes.length +
        completedAssignments.length;

      return {
        sectionId: section.id,
        title: section.title,
        order: section.order,
        totalItems,
        completedItems,
        progressPercentage:
          totalItems > 0 ? (completedItems / totalItems) * 100 : 0,
        lessons: {
          total: sectionLessons.length,
          completed: completedLessons.length,
          completions: completedLessons.map((c) => ({
            lessonId: c.lesson.id,
            title: c.lesson.title,
            completedAt: c.completedAt,
            timeSpent: c.timeSpent,
          })),
        },
        quizzes: {
          total: sectionQuizzes.length,
          completed: completedQuizzes.length,
          attempts: completedQuizzes.map((a) => ({
            quizId: a.quiz.id,
            title: a.quiz.title,
            score: a.score,
            percentage: a.percentage,
            passed: a.isPassed,
            attemptedAt: a.startedAt,
          })),
        },
        assignments: {
          total: sectionAssignments.length,
          completed: completedAssignments.length,
          submissions: completedAssignments.map((s) => ({
            assignmentId: s.assignment.id,
            title: s.assignment.title,
            grade: s.grade,
            totalPoints: s.assignment.totalPoints,
            submittedAt: s.submittedAt,
          })),
        },
      };
    });

    const stats = {
      overallProgress: enrollment.progress,
      lessonsCompleted: lessonCompletions.length,
      quizzesAttempted: quizAttempts.length,
      quizzesPassed: quizAttempts.filter((a) => a.isPassed).length,
      averageQuizScore:
        quizAttempts.length > 0
          ? quizAttempts.reduce(
              (acc, curr) => acc + (curr.percentage || 0),
              0
            ) / quizAttempts.length
          : 0,
      assignmentsSubmitted: assignmentSubmissions.length,
      averageAssignmentGrade:
        assignmentSubmissions.filter((s) => s.grade).length > 0
          ? assignmentSubmissions
              .filter((s) => s.grade)
              .reduce((acc, curr) => acc + curr.grade, 0) /
            assignmentSubmissions.filter((s) => s.grade).length
          : 0,
      totalTimeSpent: studyTime?.totalTimeSpent || 0,
      activeDays: activityDates.size,
      currentStreak: 0,
    };

    const result = {
      student: {
        id: enrollment.student.id,
        name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        profileImage: enrollment.student.user.profileImage,
        timezone: enrollment.student.user.timezone,
      },
      course: {
        id: enrollment.course.id,
        title: enrollment.course.title,
      },
      enrollment: {
        enrolledAt: enrollment.createdAt,
        lastAccessedAt: enrollment.lastAccessedAt,
        status: enrollment.status,
      },
      courseProgress: enrollment.courseProgress,
      sectionProgress,
      progressTimeline: progressTimeline.slice(-50),
      stats,
      timeframe,
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    res.status(200).json({
      success: true,
      message: "Student progress retrieved successfully",
      data: result,
      meta: {
        cached: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get student progress error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve student progress",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const getStudentAnalytics = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { courseId, timeframe = "month", metrics = "all" } = req.query;

  try {
    const cacheKey = `instructor:${instructorId}:analytics:${
      courseId || "all"
    }:${timeframe}:${metrics}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Student analytics retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const now = new Date();
    let dateFilter = {};

    if (timeframe === "week") {
      dateFilter.gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeframe === "month") {
      dateFilter.gte = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeframe === "quarter") {
      dateFilter.gte = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (timeframe === "year") {
      dateFilter.gte = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    const courseWhere = {
      instructorId,
      status: "PUBLISHED",
      ...(courseId && { id: courseId }),
    };

    const [
      enrollmentStats,
      completionStats,
      engagementStats,
      performanceStats,
      progressDistribution,
      topPerformers,
      strugglingStudents,
    ] = await Promise.all([
      prisma.enrollment.groupBy({
        by: ["status"],
        where: {
          course: courseWhere,
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        _count: {
          id: true,
        },
      }),

      prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_students,
          COUNT(CASE WHEN progress >= 100 THEN 1 END) as completed_students,
          AVG(progress) as average_progress,
          COUNT(CASE WHEN progress >= 50 THEN 1 END) as halfway_students
        FROM "Enrollment" e
        JOIN "Course" c ON e."courseId" = c.id
        WHERE c."instructorId" = ${instructorId}
        AND c.status = 'PUBLISHED'
        ${courseId ? `AND c.id = '${courseId}'` : ""}
        ${
          Object.keys(dateFilter).length > 0
            ? `AND e."createdAt" >= '${dateFilter.gte.toISOString()}'`
            : ""
        }
      `,

      prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT lc."studentId") as active_learners,
          COUNT(lc.id) as total_lesson_completions,
          AVG(lc."timeSpent") as avg_lesson_time,
          COUNT(DISTINCT qa.id) as quiz_attempts,
          COUNT(DISTINCT asub.id) as assignment_submissions
        FROM "Enrollment" e
        JOIN "Course" c ON e."courseId" = c.id
        LEFT JOIN "LessonCompletion" lc ON lc."studentId" = e."studentId" 
        LEFT JOIN "QuizAttempt" qa ON qa."studentId" = e."studentId"
        LEFT JOIN "AssignmentSubmission" asub ON asub."studentId" = e."studentId"
        WHERE c."instructorId" = ${instructorId}
        AND c.status = 'PUBLISHED'
        ${courseId ? `AND c.id = '${courseId}'` : ""}
        ${
          Object.keys(dateFilter).length > 0
            ? `AND lc."completedAt" >= '${dateFilter.gte.toISOString()}'`
            : ""
        }
      `,

      prisma.$queryRaw`
        SELECT 
          AVG(qa.percentage) as avg_quiz_score,
          COUNT(CASE WHEN qa."isPassed" = true THEN 1 END) as passed_quizzes,
          COUNT(qa.id) as total_quiz_attempts,
          AVG(CASE WHEN asub.grade IS NOT NULL THEN asub.grade::float / asub.assignment."totalPoints" * 100 END) as avg_assignment_score
        FROM "Enrollment" e
        JOIN "Course" c ON e."courseId" = c.id
        LEFT JOIN "QuizAttempt" qa ON qa."studentId" = e."studentId" AND qa.status = 'GRADED'
        LEFT JOIN "AssignmentSubmission" asub ON asub."studentId" = e."studentId" AND asub.status = 'GRADED'
        WHERE c."instructorId" = ${instructorId}
        AND c.status = 'PUBLISHED'
        ${courseId ? `AND c.id = '${courseId}'` : ""}
      `,

      prisma.$queryRaw`
        SELECT 
          CASE 
            WHEN progress = 100 THEN 'Completed'
            WHEN progress >= 75 THEN '75-99%'
            WHEN progress >= 50 THEN '50-74%'
            WHEN progress >= 25 THEN '25-49%'
            WHEN progress > 0 THEN '1-24%'
            ELSE 'Not Started'
          END as progress_range,
          COUNT(*) as student_count
        FROM "Enrollment" e
        JOIN "Course" c ON e."courseId" = c.id
        WHERE c."instructorId" = ${instructorId}
        AND c.status = 'PUBLISHED'
        ${courseId ? `AND c.id = '${courseId}'` : ""}
        GROUP BY progress_range
        ORDER BY MIN(progress) DESC
      `,

      prisma.enrollment.findMany({
        where: {
          course: courseWhere,
        },
        include: {
          student: {
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
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: [{ progress: "desc" }, { totalTimeSpent: "desc" }],
        take: 10,
      }),

      prisma.enrollment.findMany({
        where: {
          course: courseWhere,
          progress: {
            lt: 25,
          },
          OR: [
            { lastAccessedAt: null },
            {
              lastAccessedAt: {
                lt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
              },
            },
          ],
        },
        include: {
          student: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  profileImage: true,
                  email: true,
                },
              },
            },
          },
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: [{ lastAccessedAt: "asc" }, { progress: "asc" }],
        take: 10,
      }),
    ]);

    const dailyActivity = await prisma.$queryRaw`
      SELECT 
        DATE(lc."completedAt") as activity_date,
        COUNT(DISTINCT lc."studentId") as active_students,
        COUNT(lc.id) as lesson_completions
      FROM "LessonCompletion" lc
      JOIN "Lesson" l ON lc."lessonId" = l.id
      JOIN "Section" s ON l."sectionId" = s.id
      JOIN "Course" c ON s."courseId" = c.id
      WHERE c."instructorId" = ${instructorId}
      AND c.status = 'PUBLISHED'
      ${courseId ? `AND c.id = '${courseId}'` : ""}
      AND lc."completedAt" >= ${
        dateFilter.gte || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      }
      GROUP BY DATE(lc."completedAt")
      ORDER BY activity_date DESC
      LIMIT 30
    `;

    const result = {
      overview: {
        totalEnrollments: enrollmentStats.reduce(
          (acc, curr) => acc + curr._count.id,
          0
        ),
        activeStudents: engagementStats[0]?.active_learners || 0,
        completionRate:
          completionStats[0]?.completed_students &&
          completionStats[0]?.total_students
            ? (
                (Number(completionStats[0].completed_students) /
                  Number(completionStats[0].total_students)) *
                100
              ).toFixed(1)
            : "0",
        averageProgress: completionStats[0]?.average_progress
          ? Number(completionStats[0].average_progress).toFixed(1)
          : "0",
      },
      enrollmentBreakdown: enrollmentStats.map((stat) => ({
        status: stat.status,
        count: stat._count.id,
      })),
      completion: {
        totalStudents: Number(completionStats[0]?.total_students || 0),
        completedStudents: Number(completionStats[0]?.completed_students || 0),
        halfwayStudents: Number(completionStats[0]?.halfway_students || 0),
        averageProgress: Number(
          completionStats[0]?.average_progress || 0
        ).toFixed(1),
      },
      engagement: {
        activeLearners: Number(engagementStats[0]?.active_learners || 0),
        totalLessonCompletions: Number(
          engagementStats[0]?.total_lesson_completions || 0
        ),
        averageLessonTime: Number(
          engagementStats[0]?.avg_lesson_time || 0
        ).toFixed(0),
        quizAttempts: Number(engagementStats[0]?.quiz_attempts || 0),
        assignmentSubmissions: Number(
          engagementStats[0]?.assignment_submissions || 0
        ),
      },
      performance: {
        averageQuizScore: Number(
          performanceStats[0]?.avg_quiz_score || 0
        ).toFixed(1),
        quizPassRate: performanceStats[0]?.total_quiz_attempts
          ? (
              (Number(performanceStats[0].passed_quizzes) /
                Number(performanceStats[0].total_quiz_attempts)) *
              100
            ).toFixed(1)
          : "0",
        averageAssignmentScore: Number(
          performanceStats[0]?.avg_assignment_score || 0
        ).toFixed(1),
      },
      progressDistribution: progressDistribution.map((dist) => ({
        range: dist.progress_range,
        count: Number(dist.student_count),
      })),
      topPerformers: topPerformers.map((enrollment) => ({
        studentId: enrollment.student.id,
        name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        profileImage: enrollment.student.user.profileImage,
        courseTitle: enrollment.course.title,
        progress: enrollment.progress,
        totalTimeSpent: enrollment.totalTimeSpent,
        lastAccessed: enrollment.lastAccessedAt,
      })),
      strugglingStudents: strugglingStudents.map((enrollment) => ({
        studentId: enrollment.student.id,
        name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        email: enrollment.student.user.email,
        profileImage: enrollment.student.user.profileImage,
        courseTitle: enrollment.course.title,
        progress: enrollment.progress,
        lastAccessed: enrollment.lastAccessedAt,
        daysSinceLastAccess: enrollment.lastAccessedAt
          ? Math.floor(
              (now - enrollment.lastAccessedAt) / (1000 * 60 * 60 * 24)
            )
          : null,
      })),
      dailyActivity: dailyActivity.map((activity) => ({
        date: activity.activity_date,
        activeStudents: Number(activity.active_students),
        lessonCompletions: Number(activity.lesson_completions),
      })),
      timeframe,
      generatedAt: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, result, { ex: 1800 });

    res.status(200).json({
      success: true,
      message: "Student analytics retrieved successfully",
      data: result,
      meta: {
        cached: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get student analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve student analytics",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const sendMessageToStudent = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { studentId } = req.params;
  const { subject, content, courseId, priority = "NORMAL" } = req.body;

  try {
    if (!subject || !content) {
      return res.status(400).json({
        success: false,
        message: "Subject and content are required",
      });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        ...(courseId && { courseId }),
        course: {
          instructorId,
        },
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        course: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Student not found in your courses",
      });
    }

    const message = await prisma.message.create({
      data: {
        subject,
        content,
        messageType: "DIRECT",
        priority,
        senderId: req.userAuthId,
        receiverId: enrollment.student.user.id,
      },
    });

    if (socketManager) {
      socketManager.sendToUser(enrollment.student.user.id, "new_message", {
        messageId: message.id,
        senderId: req.userAuthId,
        senderName: `${req.userProfile.user?.firstName} ${req.userProfile.user?.lastName}`,
        subject,
        content: content.substring(0, 200),
        messageType: "DIRECT",
        priority,
        courseTitle: enrollment.course.title,
        sentAt: message.createdAt,
      });
    }

    if (emailService) {
      await emailService.send({
        to: enrollment.student.user.email,
        subject: `Message from Instructor: ${subject}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Message from Your Instructor</h2>
            <p><strong>Course:</strong> ${enrollment.course.title}</p>
            <p><strong>From:</strong> ${req.userProfile.user?.firstName} ${
          req.userProfile.user?.lastName
        }</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
              ${content.replace(/\n/g, "<br>")}
            </div>
            <p>You can reply to this message through your course dashboard.</p>
          </div>
        `,
      });
    }

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: {
        messageId: message.id,
        recipientName: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        subject,
        sentAt: message.createdAt,
      },
    });
  } catch (error) {
    console.error("Send message to student error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send message",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const announceToStudents = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const {
    subject,
    content,
    courseIds,
    targetGroups = ["all"],
    priority = "NORMAL",
    sendEmail = false,
  } = req.body;

  try {
    if (!subject || !content) {
      return res.status(400).json({
        success: false,
        message: "Subject and content are required",
      });
    }

    const courseWhere = {
      instructorId,
      status: "PUBLISHED",
      ...(courseIds && courseIds.length > 0 && { id: { in: courseIds } }),
    };

    let enrollmentWhere = {
      course: courseWhere,
    };

    if (targetGroups.includes("struggling")) {
      enrollmentWhere.progress = { lt: 25 };
    } else if (targetGroups.includes("advanced")) {
      enrollmentWhere.progress = { gte: 75 };
    } else if (targetGroups.includes("inactive")) {
      enrollmentWhere.lastAccessedAt = {
        lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      };
    }

    const enrollments = await prisma.enrollment.findMany({
      where: enrollmentWhere,
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        course: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (enrollments.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No students found matching the criteria",
      });
    }

    const messages = await Promise.all(
      enrollments.map((enrollment) =>
        prisma.message.create({
          data: {
            subject,
            content,
            messageType: "ANNOUNCEMENT",
            priority,
            senderId: req.userAuthId,
            receiverId: enrollment.student.user.id,
          },
        })
      )
    );

    const uniqueStudents = Array.from(
      new Map(
        enrollments.map((e) => [e.student.user.id, e.student.user])
      ).values()
    );

    if (socketManager) {
      const notification = {
        type: "course_announcement",
        title: subject,
        message: content.substring(0, 200),
        priority,
        instructorName: `${req.userProfile.user?.firstName} ${req.userProfile.user?.lastName}`,
        announcedAt: new Date(),
      };

      uniqueStudents.forEach((student) => {
        socketManager.sendToUser(student.id, "announcement", notification);
      });
    }

    if (sendEmail && emailService) {
      const emailPromises = uniqueStudents.map((student) =>
        emailService.send({
          to: student.email,
          subject: `Course Announcement: ${subject}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Course Announcement</h2>
              <p><strong>From:</strong> ${req.userProfile.user?.firstName} ${
            req.userProfile.user?.lastName
          }</p>
              <p><strong>Subject:</strong> ${subject}</p>
              <div style="background-color: #f0f9ff; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #0ea5e9;">
                ${content.replace(/\n/g, "<br>")}
              </div>
              <p style="color: #6b7280; font-size: 14px;">
                This announcement was sent to students in your enrolled courses.
              </p>
            </div>
          `,
        })
      );

      await Promise.allSettled(emailPromises);
    }

    await redisService.delPattern(`instructor:${instructorId}:students:*`);

    res.status(201).json({
      success: true,
      message: "Announcement sent successfully",
      data: {
        totalRecipients: uniqueStudents.length,
        messagesSent: messages.length,
        targetGroups,
        courseIds: courseIds || "all",
        emailSent: sendEmail,
        sentAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Announce to students error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send announcement",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const updateStudentStatus = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { studentId, courseId } = req.params;
  const { status, reason } = req.body;

  try {
    const validStatuses = ["ACTIVE", "SUSPENDED", "REFUNDED"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be one of: " + validStatuses.join(", "),
      });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
        course: {
          instructorId,
        },
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        course: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Student enrollment not found",
      });
    }

    const updatedEnrollment = await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status,
        updatedAt: new Date(),
      },
    });

    if (socketManager) {
      let notificationMessage = "";
      let notificationType = "enrollment_status_changed";

      switch (status) {
        case "SUSPENDED":
          notificationMessage = `Your access to "${enrollment.course.title}" has been temporarily suspended.`;
          notificationType = "enrollment_suspended";
          break;
        case "ACTIVE":
          notificationMessage = `Your access to "${enrollment.course.title}" has been restored.`;
          notificationType = "enrollment_restored";
          break;
        case "REFUNDED":
          notificationMessage = `Your enrollment in "${enrollment.course.title}" has been refunded.`;
          notificationType = "enrollment_refunded";
          break;
      }

      socketManager.sendToUser(enrollment.student.user.id, notificationType, {
        courseTitle: enrollment.course.title,
        newStatus: status,
        reason,
        message: notificationMessage,
        changedAt: new Date(),
      });
    }

    if (emailService) {
      await emailService.send({
        to: enrollment.student.user.email,
        subject: `Course Enrollment Status Update - ${enrollment.course.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Enrollment Status Update</h2>
            <p>Dear ${enrollment.student.user.firstName},</p>
            <p>Your enrollment status for <strong>"${
              enrollment.course.title
            }"</strong> has been updated.</p>
            <div style="background-color: ${
              status === "ACTIVE"
                ? "#dcfce7"
                : status === "SUSPENDED"
                ? "#fef3c7"
                : "#fecaca"
            }; 
                        padding: 20px; border-radius: 5px; margin: 20px 0;">
              <p><strong>New Status:</strong> ${status}</p>
              ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
            </div>
            ${
              status === "SUSPENDED"
                ? "<p>Please contact your instructor if you have any questions about this change.</p>"
                : status === "ACTIVE"
                ? "<p>You can now access your course content as usual.</p>"
                : "<p>If you have any questions about this refund, please contact support.</p>"
            }
          </div>
        `,
      });
    }

    await redisService.delPattern(
      `instructor:${instructorId}:student:${studentId}:*`
    );

    res.status(200).json({
      success: true,
      message: "Student status updated successfully",
      data: {
        enrollmentId: updatedEnrollment.id,
        previousStatus: enrollment.status,
        newStatus: status,
        studentName: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        courseName: enrollment.course.title,
        reason,
        updatedAt: updatedEnrollment.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update student status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update student status",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const issueCertificate = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { studentId, courseId } = req.params;
  const { certificateUrl, templateId } = req.body;

  try {
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
        course: {
          instructorId,
        },
        progress: {
          gte: 100,
        },
        status: "COMPLETED",
      },
      include: {
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
        course: {
          select: {
            title: true,
          },
        },
        certificate: true,
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Student has not completed the course or enrollment not found",
      });
    }

    if (enrollment.certificate) {
      return res.status(400).json({
        success: false,
        message: "Certificate has already been issued for this student",
        data: {
          certificateId: enrollment.certificate.certificateId,
          issuedAt: enrollment.certificate.issueDate,
        },
      });
    }

    const certificateId = `CERT-${courseId.slice(0, 8)}-${studentId.slice(
      0,
      8
    )}-${Date.now()}`;

    const certificate = await prisma.certificate.create({
      data: {
        certificateId,
        url:
          certificateUrl ||
          `${process.env.FRONTEND_URL}/certificates/${certificateId}`,
        templateId,
        enrollmentId: enrollment.id,
        studentId,
        courseId,
      },
    });

    if (socketManager) {
      socketManager.sendToUser(
        enrollment.student.user.id,
        "certificate_issued",
        {
          courseName: enrollment.course.title,
          certificateId: certificate.certificateId,
          downloadUrl: certificate.url,
          issuedAt: certificate.issueDate,
        }
      );
    }

    if (emailService) {
      await emailService.sendCertificateIssued({
        email: enrollment.student.user.email,
        firstName: enrollment.student.user.firstName,
        courseName: enrollment.course.title,
        certificateUrl: certificate.url,
        completionDate: certificate.issueDate,
      });
    }

    await redisService.delPattern(
      `instructor:${instructorId}:student:${studentId}:*`
    );

    res.status(201).json({
      success: true,
      message: "Certificate issued successfully",
      data: {
        certificateId: certificate.certificateId,
        certificateUrl: certificate.url,
        studentName: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        courseName: enrollment.course.title,
        issuedAt: certificate.issueDate,
      },
    });
  } catch (error) {
    console.error("Issue certificate error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to issue certificate",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const exportStudentData = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { courseId, format = "csv", includeDetails = false } = req.query;

  try {
    const courseWhere = {
      instructorId,
      status: "PUBLISHED",
      ...(courseId && { id: courseId }),
    };

    const enrollments = await prisma.enrollment.findMany({
      where: {
        course: courseWhere,
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                country: true,
                timezone: true,
                createdAt: true,
              },
            },
          },
        },
        course: {
          select: {
            id: true,
            title: true,
          },
        },
        courseProgress: true,
        certificate: {
          select: {
            certificateId: true,
            issueDate: true,
            url: true,
          },
        },
      },
    });

    let studentData = enrollments.map((enrollment) => ({
      student_id: enrollment.student.id,
      student_name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
      email: enrollment.student.user.email,
      country: enrollment.student.user.country || "",
      course_title: enrollment.course.title,
      enrolled_date: enrollment.createdAt.toISOString().split("T")[0],
      enrollment_status: enrollment.status,
      progress_percentage: enrollment.progress,
      last_accessed: enrollment.lastAccessedAt
        ? enrollment.lastAccessedAt.toISOString().split("T")[0]
        : "",
      total_time_spent_minutes: enrollment.totalTimeSpent || 0,
      lessons_completed: enrollment.lessonsCompleted,
      quizzes_completed: enrollment.quizzesCompleted,
      assignments_completed: enrollment.assignmentsCompleted,
      certificate_issued: enrollment.certificate ? "Yes" : "No",
      certificate_date: enrollment.certificate?.issueDate
        ? enrollment.certificate.issueDate.toISOString().split("T")[0]
        : "",
    }));

    if (includeDetails === "true") {
      const detailedData = await Promise.all(
        enrollments.map(async (enrollment) => {
          const [lessonCompletions, quizAttempts, assignmentSubmissions] =
            await Promise.all([
              prisma.lessonCompletion.count({
                where: {
                  studentId: enrollment.student.id,
                  lesson: {
                    section: {
                      courseId: enrollment.courseId,
                    },
                  },
                },
              }),
              prisma.quizAttempt.findMany({
                where: {
                  studentId: enrollment.student.id,
                  quiz: {
                    section: {
                      courseId: enrollment.courseId,
                    },
                  },
                  status: "GRADED",
                },
                select: {
                  percentage: true,
                  isPassed: true,
                },
              }),
              prisma.assignmentSubmission.findMany({
                where: {
                  studentId: enrollment.student.id,
                  assignment: {
                    section: {
                      courseId: enrollment.courseId,
                    },
                  },
                  status: "GRADED",
                },
                select: {
                  grade: true,
                  assignment: {
                    select: {
                      totalPoints: true,
                    },
                  },
                },
              }),
            ]);

          const avgQuizScore =
            quizAttempts.length > 0
              ? quizAttempts.reduce(
                  (acc, curr) => acc + (curr.percentage || 0),
                  0
                ) / quizAttempts.length
              : 0;

          const avgAssignmentScore =
            assignmentSubmissions.filter((s) => s.grade).length > 0
              ? assignmentSubmissions
                  .filter((s) => s.grade)
                  .reduce(
                    (acc, curr) =>
                      acc + (curr.grade / curr.assignment.totalPoints) * 100,
                    0
                  ) / assignmentSubmissions.filter((s) => s.grade).length
              : 0;

          return {
            ...studentData.find(
              (sd) => sd.student_id === enrollment.student.id
            ),
            total_lesson_completions: lessonCompletions,
            quiz_attempts: quizAttempts.length,
            average_quiz_score: avgQuizScore.toFixed(1),
            quizzes_passed: quizAttempts.filter((q) => q.isPassed).length,
            assignment_submissions: assignmentSubmissions.length,
            average_assignment_score: avgAssignmentScore.toFixed(1),
          };
        })
      );
      studentData = detailedData;
    }

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="students-${Date.now()}.json"`
      );
      return res.status(200).json({
        success: true,
        data: studentData,
        exported_at: new Date().toISOString(),
        total_records: studentData.length,
      });
    }

    if (studentData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No student data found to export",
      });
    }

    const headers = Object.keys(studentData[0]);
    const csvContent = [
      headers.join(","),
      ...studentData.map((row) =>
        headers
          .map((header) => {
            const value = row[header];
            if (
              typeof value === "string" &&
              (value.includes(",") || value.includes('"'))
            ) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(",")
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="students-${Date.now()}.csv"`
    );
    res.status(200).send(csvContent);
  } catch (error) {
    console.error("Export student data error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export student data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const getStudentEngagement = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { courseId, timeframe = "month" } = req.query;

  try {
    const cacheKey = `instructor:${instructorId}:engagement:${
      courseId || "all"
    }:${timeframe}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Student engagement data retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const now = new Date();
    let dateFilter = {};

    if (timeframe === "week") {
      dateFilter.gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeframe === "month") {
      dateFilter.gte = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeframe === "quarter") {
      dateFilter.gte = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    const courseWhere = {
      instructorId,
      status: "PUBLISHED",
      ...(courseId && { id: courseId }),
    };

    const [
      overallEngagement,
      contentEngagement,
      communityEngagement,
      timeBasedEngagement,
    ] = await Promise.all([
      prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT e."studentId") as total_enrolled,
          COUNT(DISTINCT CASE WHEN e."lastAccessedAt" >= ${
            dateFilter.gte || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          } THEN e."studentId" END) as active_students,
          AVG(e.progress) as avg_progress,
          COUNT(DISTINCT CASE WHEN e.progress = 100 THEN e."studentId" END) as completed_students,
          AVG(e."totalTimeSpent") as avg_time_spent
        FROM "Enrollment" e
        JOIN "Course" c ON e."courseId" = c.id
        WHERE c."instructorId" = ${instructorId}
        AND c.status = 'PUBLISHED'
        ${courseId ? `AND c.id = '${courseId}'` : ""}
      `,

      prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT lc.id) as lesson_completions,
          COUNT(DISTINCT qa.id) as quiz_attempts,
          COUNT(DISTINCT asub.id) as assignment_submissions,
          AVG(lc."timeSpent") as avg_lesson_time,
          COUNT(DISTINCT lc."studentId") as students_completing_lessons,
          COUNT(DISTINCT qa."studentId") as students_taking_quizzes,
          COUNT(DISTINCT asub."studentId") as students_submitting_assignments
        FROM "Course" c
        LEFT JOIN "Section" s ON s."courseId" = c.id
        LEFT JOIN "Lesson" l ON l."sectionId" = s.id
        LEFT JOIN "LessonCompletion" lc ON lc."lessonId" = l.id 
          ${
            Object.keys(dateFilter).length > 0
              ? `AND lc."completedAt" >= '${dateFilter.gte.toISOString()}'`
              : ""
          }
        LEFT JOIN "Quiz" q ON q."sectionId" = s.id
        LEFT JOIN "QuizAttempt" qa ON qa."quizId" = q.id
          ${
            Object.keys(dateFilter).length > 0
              ? `AND qa."startedAt" >= '${dateFilter.gte.toISOString()}'`
              : ""
          }
        LEFT JOIN "Assignment" a ON a."sectionId" = s.id
        LEFT JOIN "AssignmentSubmission" asub ON asub."assignmentId" = a.id
          ${
            Object.keys(dateFilter).length > 0
              ? `AND asub."submittedAt" >= '${dateFilter.gte.toISOString()}'`
              : ""
          }
        WHERE c."instructorId" = ${instructorId}
        AND c.status = 'PUBLISHED'
        ${courseId ? `AND c.id = '${courseId}'` : ""}
      `,

      prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT r.id) as reviews_written,
          COUNT(DISTINCT q.id) as questions_asked,
          COUNT(DISTINCT rr.id) as review_replies,
          AVG(r.rating) as avg_rating
        FROM "Course" c
        LEFT JOIN "Review" r ON r."courseId" = c.id 
          ${
            Object.keys(dateFilter).length > 0
              ? `AND r."createdAt" >= '${dateFilter.gte.toISOString()}'`
              : ""
          }
        LEFT JOIN "QnAQuestion" q ON q."courseId" = c.id
          ${
            Object.keys(dateFilter).length > 0
              ? `AND q."createdAt" >= '${dateFilter.gte.toISOString()}'`
              : ""
          }
        LEFT JOIN "ReviewReply" rr ON rr."reviewId" = r.id
          ${
            Object.keys(dateFilter).length > 0
              ? `AND rr."createdAt" >= '${dateFilter.gte.toISOString()}'`
              : ""
          }
        WHERE c."instructorId" = ${instructorId}
        AND c.status = 'PUBLISHED'
        ${courseId ? `AND c.id = '${courseId}'` : ""}
      `,

      prisma.$queryRaw`
        SELECT 
          DATE(lc."completedAt") as activity_date,
          COUNT(DISTINCT lc."studentId") as unique_active_students,
          COUNT(lc.id) as lesson_completions,
          COUNT(DISTINCT qa.id) as quiz_attempts,
          COUNT(DISTINCT asub.id) as assignment_submissions
        FROM "LessonCompletion" lc
        JOIN "Lesson" l ON lc."lessonId" = l.id
        JOIN "Section" s ON l."sectionId" = s.id
        JOIN "Course" c ON s."courseId" = c.id
        LEFT JOIN "QuizAttempt" qa ON qa."studentId" = lc."studentId" 
          AND DATE(qa."startedAt") = DATE(lc."completedAt")
        LEFT JOIN "AssignmentSubmission" asub ON asub."studentId" = lc."studentId"
          AND DATE(asub."submittedAt") = DATE(lc."completedAt")
        WHERE c."instructorId" = ${instructorId}
        AND c.status = 'PUBLISHED'
        ${courseId ? `AND c.id = '${courseId}'` : ""}
        AND lc."completedAt" >= ${
          dateFilter.gte || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        }
        GROUP BY DATE(lc."completedAt")
        ORDER BY activity_date DESC
        LIMIT 30
      `,
    ]);

    const result = {
      summary: {
        totalEnrolled: Number(overallEngagement[0]?.total_enrolled || 0),
        activeStudents: Number(overallEngagement[0]?.active_students || 0),
        averageProgress: Number(
          overallEngagement[0]?.avg_progress || 0
        ).toFixed(1),
        completedStudents: Number(
          overallEngagement[0]?.completed_students || 0
        ),
        averageTimeSpent: Number(
          overallEngagement[0]?.avg_time_spent || 0
        ).toFixed(0),
        engagementRate:
          overallEngagement[0]?.total_enrolled > 0
            ? (
                (Number(overallEngagement[0].active_students) /
                  Number(overallEngagement[0].total_enrolled)) *
                100
              ).toFixed(1)
            : "0",
      },
      contentEngagement: {
        lessonCompletions: Number(
          contentEngagement[0]?.lesson_completions || 0
        ),
        quizAttempts: Number(contentEngagement[0]?.quiz_attempts || 0),
        assignmentSubmissions: Number(
          contentEngagement[0]?.assignment_submissions || 0
        ),
        averageLessonTime: Number(
          contentEngagement[0]?.avg_lesson_time || 0
        ).toFixed(0),
        studentsCompletingLessons: Number(
          contentEngagement[0]?.students_completing_lessons || 0
        ),
        studentsTakingQuizzes: Number(
          contentEngagement[0]?.students_taking_quizzes || 0
        ),
        studentsSubmittingAssignments: Number(
          contentEngagement[0]?.students_submitting_assignments || 0
        ),
      },
      communityEngagement: {
        reviewsWritten: Number(communityEngagement[0]?.reviews_written || 0),
        questionsAsked: Number(communityEngagement[0]?.questions_asked || 0),
        reviewReplies: Number(communityEngagement[0]?.review_replies || 0),
        averageRating: Number(communityEngagement[0]?.avg_rating || 0).toFixed(
          1
        ),
      },
      dailyActivity: timeBasedEngagement.map((day) => ({
        date: day.activity_date,
        uniqueActiveStudents: Number(day.unique_active_students),
        lessonCompletions: Number(day.lesson_completions),
        quizAttempts: Number(day.quiz_attempts),
        assignmentSubmissions: Number(day.assignment_submissions),
      })),
      timeframe,
      generatedAt: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, result, { ex: 1800 });

    res.status(200).json({
      success: true,
      message: "Student engagement data retrieved successfully",
      data: result,
      meta: {
        cached: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get student engagement error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve student engagement data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const getStudentPerformance = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { courseId, studentId } = req.params;

  try {
    const cacheKey = `instructor:${instructorId}:performance:${studentId}:${courseId}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Student performance report retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
        course: {
          instructorId,
        },
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                profileImage: true,
                email: true,
              },
            },
          },
        },
        course: {
          include: {
            sections: {
              include: {
                lessons: true,
                quizzes: true,
                assignments: true,
              },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Student enrollment not found",
      });
    }

    const [
      lessonCompletions,
      quizAttempts,
      assignmentSubmissions,
      strengths,
      improvements,
    ] = await Promise.all([
      prisma.lessonCompletion.findMany({
        where: {
          studentId,
          lesson: {
            section: {
              courseId,
            },
          },
        },
        include: {
          lesson: {
            include: {
              section: {
                select: {
                  title: true,
                  order: true,
                },
              },
            },
          },
        },
        orderBy: { completedAt: "asc" },
      }),

      prisma.quizAttempt.findMany({
        where: {
          studentId,
          quiz: {
            section: {
              courseId,
            },
          },
          status: "GRADED",
        },
        include: {
          quiz: {
            include: {
              section: {
                select: {
                  title: true,
                  order: true,
                },
              },
            },
          },
          answers: {
            include: {
              question: {
                select: {
                  content: true,
                  type: true,
                  points: true,
                  tags: true,
                },
              },
            },
          },
        },
        orderBy: { startedAt: "asc" },
      }),

      prisma.assignmentSubmission.findMany({
        where: {
          studentId,
          assignment: {
            section: {
              courseId,
            },
          },
          status: "GRADED",
        },
        include: {
          assignment: {
            include: {
              section: {
                select: {
                  title: true,
                  order: true,
                },
              },
            },
          },
        },
        orderBy: { submittedAt: "asc" },
      }),

      prisma.$queryRaw`
        SELECT 
          UNNEST(q.tags) as topic,
          AVG(a.points::float / q.points * 100) as avg_score,
          COUNT(*) as attempts
        FROM "Answer" a
        JOIN "Question" q ON a."questionId" = q.id
        JOIN "QuizAttempt" qa ON a."attemptId" = qa.id
        JOIN "Quiz" quiz ON qa."quizId" = quiz.id
        JOIN "Section" s ON quiz."sectionId" = s.id
        WHERE qa."studentId" = ${studentId}
        AND s."courseId" = ${courseId}
        AND qa.status = 'GRADED'
        AND array_length(q.tags, 1) > 0
        GROUP BY topic
        HAVING COUNT(*) >= 2
        ORDER BY avg_score DESC
        LIMIT 5
      `,

      prisma.$queryRaw`
        SELECT 
          UNNEST(q.tags) as topic,
          AVG(a.points::float / q.points * 100) as avg_score,
          COUNT(*) as attempts
        FROM "Answer" a
        JOIN "Question" q ON a."questionId" = q.id
        JOIN "QuizAttempt" qa ON a."attemptId" = qa.id
        JOIN "Quiz" quiz ON qa."quizId" = quiz.id
        JOIN "Section" s ON quiz."sectionId" = s.id
        WHERE qa."studentId" = ${studentId}
        AND s."courseId" = ${courseId}
        AND qa.status = 'GRADED'
        AND array_length(q.tags, 1) > 0
        GROUP BY topic
        HAVING COUNT(*) >= 2
        ORDER BY avg_score ASC
        LIMIT 5
      `,
    ]);

    const totalQuizScore = quizAttempts.reduce(
      (acc, curr) => acc + (curr.percentage || 0),
      0
    );
    const averageQuizScore =
      quizAttempts.length > 0 ? totalQuizScore / quizAttempts.length : 0;

    const gradedAssignments = assignmentSubmissions.filter(
      (sub) => sub.grade !== null
    );
    const totalAssignmentScore = gradedAssignments.reduce(
      (acc, curr) => acc + (curr.grade / curr.assignment.totalPoints) * 100,
      0
    );
    const averageAssignmentScore =
      gradedAssignments.length > 0
        ? totalAssignmentScore / gradedAssignments.length
        : 0;

    const performanceTrend = quizAttempts.map((attempt, index) => ({
      attempt: index + 1,
      date: attempt.startedAt,
      score: attempt.percentage || 0,
      quizTitle: attempt.quiz.title,
      sectionTitle: attempt.quiz.section.title,
    }));

    const sectionPerformance = enrollment.course.sections.map((section) => {
      const sectionQuizzes = quizAttempts.filter(
        (attempt) =>
          attempt.quiz.section &&
          section.quizzes.some((quiz) => quiz.id === attempt.quiz.id)
      );

      const sectionAssignments = assignmentSubmissions.filter((submission) =>
        section.assignments.some(
          (assignment) => assignment.id === submission.assignment.id
        )
      );

      const sectionLessons = lessonCompletions.filter(
        (completion) =>
          completion.lesson.section &&
          completion.lesson.section.title === section.title
      );

      const avgQuizScore =
        sectionQuizzes.length > 0
          ? sectionQuizzes.reduce(
              (acc, curr) => acc + (curr.percentage || 0),
              0
            ) / sectionQuizzes.length
          : 0;

      const avgAssignmentScore =
        sectionAssignments.filter((s) => s.grade).length > 0
          ? sectionAssignments
              .filter((s) => s.grade)
              .reduce(
                (acc, curr) =>
                  acc + (curr.grade / curr.assignment.totalPoints) * 100,
                0
              ) / sectionAssignments.filter((s) => s.grade).length
          : 0;

      return {
        sectionId: section.id,
        title: section.title,
        order: section.order,
        lessonsCompleted: sectionLessons.length,
        totalLessons: section.lessons.length,
        completionRate:
          section.lessons.length > 0
            ? (sectionLessons.length / section.lessons.length) * 100
            : 0,
        averageQuizScore: avgQuizScore.toFixed(1),
        averageAssignmentScore: avgAssignmentScore.toFixed(1),
        totalTimeSpent: sectionLessons.reduce(
          (acc, curr) => acc + (curr.timeSpent || 0),
          0
        ),
      };
    });

    const studyHours = lessonCompletions.reduce((acc, completion) => {
      const hour = completion.completedAt.getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {});

    const studyDays = lessonCompletions.reduce((acc, completion) => {
      const day = completion.completedAt.getDay();
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});

    function generateRecommendations(
      quizScore,
      assignmentScore,
      progress,
      improvements
    ) {
      const recommendations = [];

      if (progress < 25) {
        recommendations.push({
          type: "engagement",
          priority: "high",
          message:
            "Student shows low engagement. Consider reaching out to offer support and motivation.",
          action: "Send personalized message or schedule a check-in call",
        });
      }

      if (quizScore < 60) {
        recommendations.push({
          type: "quiz_performance",
          priority: "medium",
          message:
            "Quiz performance below expectations. Review fundamental concepts.",
          action: "Provide additional study materials or practice quizzes",
        });
      }

      if (assignmentScore < 70) {
        recommendations.push({
          type: "assignment_performance",
          priority: "medium",
          message:
            "Assignment scores indicate need for practical application support.",
          action: "Offer detailed feedback and examples for improvement",
        });
      }

      if (improvements.length > 0) {
        const weakestTopic = improvements[0];
        recommendations.push({
          type: "topic_weakness",
          priority: "medium",
          message: `Student struggling with ${weakestTopic.topic}. Focus additional support here.`,
          action: `Provide supplementary materials and practice exercises for ${weakestTopic.topic}`,
        });
      }

      if (progress > 75 && quizScore > 85) {
        recommendations.push({
          type: "excellence",
          priority: "low",
          message:
            "Excellent performance! Consider advanced or bonus materials.",
          action: "Offer additional challenges or advanced topics",
        });
      }

      return recommendations;
    }

    const result = {
      student: {
        id: enrollment.student.id,
        name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        email: enrollment.student.user.email,
        profileImage: enrollment.student.user.profileImage,
      },
      course: {
        id: enrollment.course.id,
        title: enrollment.course.title,
      },
      enrollment: {
        enrolledAt: enrollment.createdAt,
        progress: enrollment.progress,
        status: enrollment.status,
        totalTimeSpent: enrollment.totalTimeSpent,
      },
      overallPerformance: {
        averageQuizScore: averageQuizScore.toFixed(1),
        averageAssignmentScore: averageAssignmentScore.toFixed(1),
        completionRate: enrollment.progress,
        totalActivities:
          lessonCompletions.length +
          quizAttempts.length +
          assignmentSubmissions.length,
      },
      sectionPerformance,
      performanceTrend,
      strengths: strengths.map((s) => ({
        topic: s.topic,
        averageScore: Number(s.avg_score).toFixed(1),
        attempts: Number(s.attempts),
      })),
      areasForImprovement: improvements.map((i) => ({
        topic: i.topic,
        averageScore: Number(i.avg_score).toFixed(1),
        attempts: Number(i.attempts),
      })),
      learningPatterns: {
        preferredStudyHours: Object.entries(studyHours)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([hour, count]) => ({ hour: parseInt(hour), sessions: count })),
        preferredStudyDays: Object.entries(studyDays)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3)
          .map(([day, count]) => ({
            day: [
              "Sunday",
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
            ][parseInt(day)],
            sessions: count,
          })),
      },
      recommendations: generateRecommendations(
        averageQuizScore,
        averageAssignmentScore,
        enrollment.progress,
        improvements
      ),
      generatedAt: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, result, { ex: 3600 });

    res.status(200).json({
      success: true,
      message: "Student performance report retrieved successfully",
      data: result,
      meta: {
        cached: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get student performance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve student performance report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const getStudentCommunication = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { studentId, courseId } = req.params;
  const { page = 1, limit = 20, type = "all" } = req.query;

  try {
    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
        course: {
          instructorId,
        },
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profileImage: true,
              },
            },
          },
        },
        course: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Student enrollment not found",
      });
    }

    let communications = [];

    if (type === "all" || type === "messages") {
      const messages = await prisma.message.findMany({
        where: {
          OR: [
            {
              senderId: req.userAuthId,
              receiverId: enrollment.student.user.id,
            },
            {
              senderId: enrollment.student.user.id,
              receiverId: req.userAuthId,
            },
          ],
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      });

      communications.push(
        ...messages.map((msg) => ({
          id: msg.id,
          type: "message",
          subject: msg.subject,
          content: msg.content,
          isFromStudent: msg.senderId === enrollment.student.user.id,
          createdAt: msg.createdAt,
          isRead: msg.isRead,
          priority: msg.priority,
        }))
      );
    }

    if (type === "all" || type === "questions") {
      const questions = await prisma.qnAQuestion.findMany({
        where: {
          studentId,
          courseId,
        },
        include: {
          answers: {
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
          lesson: {
            select: {
              title: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      });

      communications.push(
        ...questions.map((q) => ({
          id: q.id,
          type: "question",
          title: q.title,
          content: q.content,
          isResolved: q.isResolved,
          lessonTitle: q.lesson?.title,
          answersCount: q.answers.length,
          createdAt: q.createdAt,
          answers: q.answers.map((a) => ({
            id: a.id,
            content: a.content,
            isAccepted: a.isAccepted,
            instructorName: `${a.instructor.user.firstName} ${a.instructor.user.lastName}`,
            createdAt: a.createdAt,
          })),
        }))
      );
    }

    if (type === "all" || type === "reviews") {
      const reviews = await prisma.review.findMany({
        where: {
          authorId: enrollment.student.user.id,
          courseId,
        },
        include: {
          replies: {
            include: {
              author: {
                select: {
                  firstName: true,
                  lastName: true,
                  role: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      });

      communications.push(
        ...reviews.map((r) => ({
          id: r.id,
          type: "review",
          title: r.title,
          content: r.content,
          rating: r.rating,
          pros: r.pros,
          cons: r.cons,
          isVerified: r.isVerified,
          helpfulCount: r.helpfulCount,
          createdAt: r.createdAt,
          replies: r.replies.map((reply) => ({
            id: reply.id,
            content: reply.content,
            authorName: `${reply.author.firstName} ${reply.author.lastName}`,
            isInstructor: reply.author.role === "INSTRUCTOR",
            createdAt: reply.createdAt,
          })),
        }))
      );
    }

    communications.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    const result = {
      student: {
        id: enrollment.student.id,
        name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        profileImage: enrollment.student.user.profileImage,
      },
      course: {
        id: courseId,
        title: enrollment.course.title,
      },
      communications: communications.slice(0, pageSize),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total: communications.length,
        totalPages: Math.ceil(communications.length / pageSize),
      },
      summary: {
        totalMessages: communications.filter((c) => c.type === "message")
          .length,
        totalQuestions: communications.filter((c) => c.type === "question")
          .length,
        totalReviews: communications.filter((c) => c.type === "review").length,
        unreadMessages: communications.filter(
          (c) => c.type === "message" && !c.isRead && !c.isFromStudent
        ).length,
        openQuestions: communications.filter(
          (c) => c.type === "question" && !c.isResolved
        ).length,
      },
    };

    res.status(200).json({
      success: true,
      message: "Student communication history retrieved successfully",
      data: result,
    });
  } catch (error) {
    console.error("Get student communication error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve student communication",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const generateProgressReport = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { courseId, format = "pdf", includeCharts = false } = req.query;

  try {
    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId,
      },
      include: {
        enrollments: {
          include: {
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
        },
        sections: {
          include: {
            lessons: true,
            quizzes: true,
            assignments: true,
          },
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    const reportData = {
      course: {
        id: course.id,
        title: course.title,
        totalLessons: course.totalLessons,
        totalQuizzes: course.totalQuizzes,
        totalAssignments: course.totalAssignments,
      },
      summary: {
        totalEnrollments: course.enrollments.length,
        activeStudents: course.enrollments.filter((e) => e.status === "ACTIVE")
          .length,
        completedStudents: course.enrollments.filter((e) => e.progress >= 100)
          .length,
        averageProgress:
          course.enrollments.length > 0
            ? course.enrollments.reduce((acc, curr) => acc + curr.progress, 0) /
              course.enrollments.length
            : 0,
      },
      students: course.enrollments.map((enrollment) => ({
        name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
        email: enrollment.student.user.email,
        enrolledAt: enrollment.createdAt,
        progress: enrollment.progress,
        status: enrollment.status,
        lastAccessed: enrollment.lastAccessedAt,
        totalTimeSpent: enrollment.totalTimeSpent || 0,
        lessonsCompleted: enrollment.lessonsCompleted,
        quizzesCompleted: enrollment.quizzesCompleted,
        assignmentsCompleted: enrollment.assignmentsCompleted,
      })),
      generatedAt: new Date().toISOString(),
      generatedBy: `${req.userProfile.user?.firstName} ${req.userProfile.user?.lastName}`,
    };

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="progress-report-${courseId}-${Date.now()}.json"`
      );
      return res.status(200).json({
        success: true,
        data: reportData,
      });
    }

    res.status(200).json({
      success: true,
      message: "Progress report generated successfully",
      data: {
        reportData,
        downloadUrl: `${process.env.FRONTEND_URL}/api/reports/download/${courseId}?format=${format}`,
        format,
      },
    });
  } catch (error) {
    console.error("Generate progress report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate progress report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export const clearStudentCache = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { studentId, courseId } = req.query;

  try {
    let patterns = [`instructor:${instructorId}:students:*`];

    if (studentId) {
      patterns.push(`instructor:${instructorId}:student:${studentId}:*`);
    }

    if (courseId) {
      patterns.push(`instructor:${instructorId}:*:${courseId}:*`);
    }

    const deletePromises = patterns.map((pattern) =>
      redisService.delPattern(pattern)
    );
    await Promise.all(deletePromises);

    res.status(200).json({
      success: true,
      message: "Student cache cleared successfully",
      data: {
        patternsCleared: patterns,
        clearedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Clear student cache error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear student cache",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});
