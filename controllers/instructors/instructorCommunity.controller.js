import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../utils/redis.js";
import emailService from "../utils/emailService.js";
import notificationService from "../utils/notificationservice.js";

const prisma = new PrismaClient();

const generateRequestId = () =>
  `instr_comm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const getQnAQuestions = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const {
      page = 1,
      limit = 20,
      status = "all",
      courseId,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      isResolved,
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `instructor:${instructorId}:qna:${Buffer.from(
      JSON.stringify({
        page: pageNumber,
        limit: pageSize,
        status,
        courseId,
        sortBy,
        sortOrder,
        search,
        isResolved,
      })
    ).toString("base64")}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Q&A questions retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const where = {
      course: {
        instructorId: instructor.id,
      },
    };

    if (courseId) {
      where.courseId = courseId;
    }

    if (isResolved !== undefined) {
      where.isResolved = isResolved === "true";
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
        {
          student: {
            user: {
              OR: [
                { firstName: { contains: search, mode: "insensitive" } },
                { lastName: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        },
      ];
    }

    let orderBy = {};
    if (sortBy === "createdAt") {
      orderBy.createdAt = sortOrder;
    } else if (sortBy === "views") {
      orderBy.views = sortOrder;
    } else if (sortBy === "student") {
      orderBy.student = {
        user: {
          firstName: sortOrder,
        },
      };
    }

    const [questions, total, coursesList] = await Promise.all([
      prisma.qnAQuestion.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
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
              thumbnail: true,
            },
          },
          lesson: {
            select: {
              id: true,
              title: true,
            },
          },
          answers: {
            where: {
              instructorId: instructor.id,
            },
            select: {
              id: true,
              content: true,
              isAccepted: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              answers: true,
            },
          },
        },
      }),
      prisma.qnAQuestion.count({ where }),
      prisma.course.findMany({
        where: {
          instructorId: instructor.id,
          status: "PUBLISHED",
        },
        select: {
          id: true,
          title: true,
          thumbnail: true,
          _count: {
            select: {
              qnaQuestions: true,
            },
          },
        },
      }),
    ]);

    const questionStats = await prisma.qnAQuestion.aggregate({
      where: {
        course: {
          instructorId: instructor.id,
        },
      },
      _count: {
        id: true,
      },
      _avg: {
        views: true,
      },
    });

    const answeredCount = await prisma.qnAQuestion.count({
      where: {
        course: {
          instructorId: instructor.id,
        },
        answers: {
          some: {
            instructorId: instructor.id,
          },
        },
      },
    });

    const result = {
      questions: questions.map((question) => ({
        id: question.id,
        title: question.title,
        content: question.content,
        isResolved: question.isResolved,
        views: question.views,
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
        student: {
          name: `${question.student.user.firstName} ${question.student.user.lastName}`,
          profileImage: question.student.user.profileImage,
        },
        course: question.course,
        lesson: question.lesson,
        myAnswer: question.answers[0] || null,
        totalAnswers: question._count.answers,
        hasMyAnswer: question.answers.length > 0,
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      stats: {
        totalQuestions: questionStats._count.id || 0,
        answeredQuestions: answeredCount,
        unansweredQuestions: (questionStats._count.id || 0) - answeredCount,
        responseRate: questionStats._count.id
          ? Math.round((answeredCount / questionStats._count.id) * 100)
          : 0,
        averageViews: Math.round(questionStats._avg.views || 0),
      },
      courses: coursesList.map((course) => ({
        id: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        questionCount: course._count.qnaQuestions,
      })),
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Q&A questions retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`QNA_QUESTIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve Q&A questions",
      code: "QNA_RETRIEVAL_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const answerQuestion = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const { questionId } = req.params;
    const { content, markAsAccepted = false } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Answer content is required",
        code: "CONTENT_REQUIRED",
      });
    }

    if (content.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Answer must be at least 10 characters long",
        code: "CONTENT_TOO_SHORT",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: {
        id: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const question = await prisma.qnAQuestion.findUnique({
      where: { id: questionId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            instructorId: true,
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
        lesson: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        code: "QUESTION_NOT_FOUND",
      });
    }

    if (question.course.instructorId !== instructor.id) {
      return res.status(403).json({
        success: false,
        message: "You can only answer questions for your courses",
        code: "UNAUTHORIZED_COURSE_ACCESS",
      });
    }

    const existingAnswer = await prisma.qnAAnswer.findFirst({
      where: {
        questionId,
        instructorId: instructor.id,
      },
    });

    if (existingAnswer) {
      return res.status(409).json({
        success: false,
        message: "You have already answered this question",
        code: "ANSWER_ALREADY_EXISTS",
      });
    }

    const answer = await prisma.qnAAnswer.create({
      data: {
        content: content.trim(),
        isAccepted: markAsAccepted,
        instructorId: instructor.id,
        questionId,
      },
    });

    await prisma.qnAQuestion.update({
      where: { id: questionId },
      data: {
        isResolved: markAsAccepted,
      },
    });

    await notificationService.createNotification({
      userId: question.student.user.id,
      type: "QNA_ANSWER",
      title: "Question Answered",
      message: `Your question "${question.title.substring(
        0,
        50
      )}..." has been answered by the instructor`,
      data: {
        questionId,
        questionTitle: question.title,
        answerId: answer.id,
        courseName: question.course.title,
        instructorName: `${instructor.user.firstName} ${instructor.user.lastName}`,
        isAccepted: markAsAccepted,
      },
      actionUrl: `/courses/${question.course.id}/qna/${questionId}`,
      sendEmail: true,
    });

    await emailService.sendQuestionAnswered({
      email: question.student.user.email,
      firstName: question.student.user.firstName,
      courseName: question.course.title,
      questionTitle: question.title,
      answerPreview: content.substring(0, 200),
      instructorName: `${instructor.user.firstName} ${instructor.user.lastName}`,
      questionUrl: `${process.env.FRONTEND_URL}/courses/${question.course.id}/qna/${questionId}`,
    });

    await redisService.delPattern(`instructor:${instructorId}:qna:*`);
    await redisService.delPattern(`course:${question.course.id}:qna:*`);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Question answered successfully",
      data: {
        answer: {
          id: answer.id,
          content: answer.content,
          isAccepted: answer.isAccepted,
          createdAt: answer.createdAt,
          instructor: {
            name: `${instructor.user.firstName} ${instructor.user.lastName}`,
          },
        },
        questionUpdated: markAsAccepted,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`ANSWER_QUESTION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
      questionId: req.params.questionId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to answer question",
      code: "ANSWER_CREATION_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateAnswer = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const { answerId } = req.params;
    const { content, markAsAccepted } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Answer content is required",
        code: "CONTENT_REQUIRED",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const answer = await prisma.qnAAnswer.findUnique({
      where: { id: answerId },
      include: {
        question: {
          include: {
            course: {
              select: {
                id: true,
                instructorId: true,
              },
            },
          },
        },
      },
    });

    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        code: "ANSWER_NOT_FOUND",
      });
    }

    if (answer.instructorId !== instructor.id) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own answers",
        code: "UNAUTHORIZED_ANSWER_ACCESS",
      });
    }

    const updatedAnswer = await prisma.qnAAnswer.update({
      where: { id: answerId },
      data: {
        content: content.trim(),
        ...(markAsAccepted !== undefined && { isAccepted: markAsAccepted }),
      },
    });

    if (markAsAccepted !== undefined) {
      await prisma.qnAQuestion.update({
        where: { id: answer.questionId },
        data: {
          isResolved: markAsAccepted,
        },
      });
    }

    await redisService.delPattern(`instructor:${instructorId}:qna:*`);
    await redisService.delPattern(`course:${answer.question.course.id}:qna:*`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Answer updated successfully",
      data: {
        answer: {
          id: updatedAnswer.id,
          content: updatedAnswer.content,
          isAccepted: updatedAnswer.isAccepted,
          updatedAt: updatedAnswer.updatedAt,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_ANSWER_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
      answerId: req.params.answerId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update answer",
      code: "ANSWER_UPDATE_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteAnswer = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const { answerId } = req.params;

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const answer = await prisma.qnAAnswer.findUnique({
      where: { id: answerId },
      include: {
        question: {
          include: {
            course: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        code: "ANSWER_NOT_FOUND",
      });
    }

    if (answer.instructorId !== instructor.id) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own answers",
        code: "UNAUTHORIZED_ANSWER_ACCESS",
      });
    }

    await prisma.qnAAnswer.delete({
      where: { id: answerId },
    });

    const remainingAnswers = await prisma.qnAAnswer.count({
      where: {
        questionId: answer.questionId,
        instructorId: instructor.id,
      },
    });

    if (remainingAnswers === 0) {
      await prisma.qnAQuestion.update({
        where: { id: answer.questionId },
        data: {
          isResolved: false,
        },
      });
    }

    await redisService.delPattern(`instructor:${instructorId}:qna:*`);
    await redisService.delPattern(`course:${answer.question.course.id}:qna:*`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Answer deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_ANSWER_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
      answerId: req.params.answerId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete answer",
      code: "ANSWER_DELETE_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCourseReviews = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const {
      page = 1,
      limit = 20,
      courseId,
      rating,
      hasReply,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `instructor:${instructorId}:reviews:${Buffer.from(
      JSON.stringify({
        page: pageNumber,
        limit: pageSize,
        courseId,
        rating,
        hasReply,
        sortBy,
        sortOrder,
        search,
      })
    ).toString("base64")}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Course reviews retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const where = {
      course: {
        instructorId: instructor.id,
      },
    };

    if (courseId) {
      where.courseId = courseId;
    }

    if (rating) {
      where.rating = parseInt(rating);
    }

    if (hasReply !== undefined) {
      if (hasReply === "true") {
        where.replies = {
          some: {
            author: {
              instructorProfile: {
                id: instructor.id,
              },
            },
          },
        };
      } else {
        where.replies = {
          none: {
            author: {
              instructorProfile: {
                id: instructor.id,
              },
            },
          },
        };
      }
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
        {
          author: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    let orderBy = {};
    if (sortBy === "createdAt") {
      orderBy.createdAt = sortOrder;
    } else if (sortBy === "rating") {
      orderBy.rating = sortOrder;
    } else if (sortBy === "helpful") {
      orderBy.helpfulCount = sortOrder;
    }

    const [reviews, total, reviewStats] = await Promise.all([
      prisma.review.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          author: {
            select: {
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
          course: {
            select: {
              id: true,
              title: true,
              thumbnail: true,
            },
          },
          replies: {
            where: {
              author: {
                instructorProfile: {
                  id: instructor.id,
                },
              },
            },
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
          _count: {
            select: {
              replies: true,
            },
          },
        },
      }),
      prisma.review.count({ where }),
      prisma.review.groupBy({
        by: ["rating"],
        where: {
          course: {
            instructorId: instructor.id,
          },
        },
        _count: {
          rating: true,
        },
      }),
    ]);

    const coursesList = await prisma.course.findMany({
      where: {
        instructorId: instructor.id,
        status: "PUBLISHED",
      },
      select: {
        id: true,
        title: true,
        thumbnail: true,
        averageRating: true,
        totalRatings: true,
        _count: {
          select: {
            reviews: true,
          },
        },
      },
    });

    const repliedCount = await prisma.review.count({
      where: {
        course: {
          instructorId: instructor.id,
        },
        replies: {
          some: {
            author: {
              instructorProfile: {
                id: instructor.id,
              },
            },
          },
        },
      },
    });

    const totalReviews = await prisma.review.count({
      where: {
        course: {
          instructorId: instructor.id,
        },
      },
    });

    const result = {
      reviews: reviews.map((review) => ({
        id: review.id,
        title: review.title,
        content: review.content,
        rating: review.rating,
        pros: review.pros,
        cons: review.cons,
        isVerified: review.isVerified,
        helpfulCount: review.helpfulCount,
        isFlagged: review.isFlagged,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        author: {
          name: `${review.author.firstName} ${review.author.lastName}`,
          profileImage: review.author.profileImage,
        },
        course: review.course,
        myReply: review.replies[0] || null,
        totalReplies: review._count.replies,
        hasMyReply: review.replies.length > 0,
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      stats: {
        totalReviews,
        repliedReviews: repliedCount,
        unrepliedReviews: totalReviews - repliedCount,
        replyRate: totalReviews
          ? Math.round((repliedCount / totalReviews) * 100)
          : 0,
        ratingDistribution: reviewStats.reduce((acc, stat) => {
          acc[stat.rating] = stat._count.rating;
          return acc;
        }, {}),
      },
      courses: coursesList.map((course) => ({
        id: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        reviewCount: course._count.reviews,
      })),
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course reviews retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`COURSE_REVIEWS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course reviews",
      code: "REVIEWS_RETRIEVAL_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const replyToReview = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const { reviewId } = req.params;
    const { content } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Reply content is required",
        code: "CONTENT_REQUIRED",
      });
    }

    if (content.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Reply must be at least 10 characters long",
        code: "CONTENT_TOO_SHORT",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: {
        id: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            instructorId: true,
          },
        },
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
        code: "REVIEW_NOT_FOUND",
      });
    }

    if (review.course.instructorId !== instructor.id) {
      return res.status(403).json({
        success: false,
        message: "You can only reply to reviews for your courses",
        code: "UNAUTHORIZED_COURSE_ACCESS",
      });
    }

    const existingReply = await prisma.reviewReply.findFirst({
      where: {
        reviewId,
        authorId: instructor.user.id,
      },
    });

    if (existingReply) {
      return res.status(409).json({
        success: false,
        message: "You have already replied to this review",
        code: "REPLY_ALREADY_EXISTS",
      });
    }

    const reply = await prisma.reviewReply.create({
      data: {
        content: content.trim(),
        reviewId,
        authorId: instructor.user.id,
      },
    });

    await notificationService.createNotification({
      userId: review.author.id,
      type: "REVIEW_REPLY",
      title: "Review Reply",
      message: `The instructor has replied to your review for "${review.course.title}"`,
      data: {
        reviewId,
        replyId: reply.id,
        courseName: review.course.title,
        instructorName: `${instructor.user.firstName} ${instructor.user.lastName}`,
      },
      actionUrl: `/courses/${review.course.id}/reviews`,
      sendEmail: true,
    });

    await emailService.sendReviewReply({
      email: review.author.email,
      firstName: review.author.firstName,
      courseName: review.course.title,
      replyContent: content.substring(0, 200),
      instructorName: `${instructor.user.firstName} ${instructor.user.lastName}`,
      reviewUrl: `${process.env.FRONTEND_URL}/courses/${review.course.id}/reviews`,
    });

    await redisService.delPattern(`instructor:${instructorId}:reviews:*`);
    await redisService.delPattern(`course:${review.course.id}:reviews:*`);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Review reply added successfully",
      data: {
        reply: {
          id: reply.id,
          content: reply.content,
          createdAt: reply.createdAt,
          author: {
            name: `${instructor.user.firstName} ${instructor.user.lastName}`,
          },
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REPLY_TO_REVIEW_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
      reviewId: req.params.reviewId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to reply to review",
      code: "REPLY_CREATION_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateReply = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const { replyId } = req.params;
    const { content } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Reply content is required",
        code: "CONTENT_REQUIRED",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: {
        id: true,
        user: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const reply = await prisma.reviewReply.findUnique({
      where: { id: replyId },
      include: {
        review: {
          include: {
            course: {
              select: {
                id: true,
                instructorId: true,
              },
            },
          },
        },
      },
    });

    if (!reply) {
      return res.status(404).json({
        success: false,
        message: "Reply not found",
        code: "REPLY_NOT_FOUND",
      });
    }

    if (reply.authorId !== instructor.user.id) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own replies",
        code: "UNAUTHORIZED_REPLY_ACCESS",
      });
    }

    const updatedReply = await prisma.reviewReply.update({
      where: { id: replyId },
      data: {
        content: content.trim(),
      },
    });

    await redisService.delPattern(`instructor:${instructorId}:reviews:*`);
    await redisService.delPattern(`course:${reply.review.course.id}:reviews:*`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Reply updated successfully",
      data: {
        reply: {
          id: updatedReply.id,
          content: updatedReply.content,
          updatedAt: updatedReply.updatedAt,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_REPLY_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
      replyId: req.params.replyId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update reply",
      code: "REPLY_UPDATE_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteReply = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const { replyId } = req.params;

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: {
        id: true,
        user: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const reply = await prisma.reviewReply.findUnique({
      where: { id: replyId },
      include: {
        review: {
          include: {
            course: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!reply) {
      return res.status(404).json({
        success: false,
        message: "Reply not found",
        code: "REPLY_NOT_FOUND",
      });
    }

    if (reply.authorId !== instructor.user.id) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own replies",
        code: "UNAUTHORIZED_REPLY_ACCESS",
      });
    }

    await prisma.reviewReply.delete({
      where: { id: replyId },
    });

    await redisService.delPattern(`instructor:${instructorId}:reviews:*`);
    await redisService.delPattern(`course:${reply.review.course.id}:reviews:*`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Reply deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_REPLY_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
      replyId: req.params.replyId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete reply",
      code: "REPLY_DELETE_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getEngagementMetrics = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const { period = "30", courseId, timezone = "UTC" } = req.query;

    const cacheKey = `instructor:${instructorId}:engagement:${period}:${
      courseId || "all"
    }`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Engagement metrics retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const daysAgo = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    const courseFilter = {
      instructorId: instructor.id,
      ...(courseId && { id: courseId }),
    };

    const [
      qnaStats,
      reviewStats,
      engagementTrends,
      activeStudents,
      responseTimeStats,
    ] = await Promise.all([
      prisma.qnAQuestion.aggregate({
        where: {
          course: courseFilter,
          createdAt: { gte: startDate },
        },
        _count: { id: true },
        _avg: { views: true },
      }),
      prisma.review.aggregate({
        where: {
          course: courseFilter,
          createdAt: { gte: startDate },
        },
        _count: { id: true },
        _avg: { rating: true },
      }),
      prisma.qnAQuestion.findMany({
        where: {
          course: courseFilter,
          createdAt: { gte: startDate },
        },
        select: {
          createdAt: true,
          answers: {
            where: {
              instructorId: instructor.id,
            },
            select: {
              createdAt: true,
            },
          },
        },
      }),
      prisma.enrollment.count({
        where: {
          course: courseFilter,
          lastAccessedAt: { gte: startDate },
        },
      }),
      prisma.qnAAnswer.findMany({
        where: {
          instructorId: instructor.id,
          createdAt: { gte: startDate },
        },
        select: {
          createdAt: true,
          question: {
            select: {
              createdAt: true,
            },
          },
        },
      }),
    ]);

    const answeredQuestions = await prisma.qnAQuestion.count({
      where: {
        course: courseFilter,
        createdAt: { gte: startDate },
        answers: {
          some: {
            instructorId: instructor.id,
          },
        },
      },
    });

    const repliedReviews = await prisma.review.count({
      where: {
        course: courseFilter,
        createdAt: { gte: startDate },
        replies: {
          some: {
            author: {
              instructorProfile: {
                id: instructor.id,
              },
            },
          },
        },
      },
    });

    const avgResponseTime =
      responseTimeStats.reduce((acc, answer) => {
        const questionTime = new Date(answer.question.createdAt).getTime();
        const answerTime = new Date(answer.createdAt).getTime();
        return acc + (answerTime - questionTime);
      }, 0) / (responseTimeStats.length || 1);

    const dailyEngagement = Array.from({ length: daysAgo }, (_, i) => {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dayStart = new Date(date.setHours(0, 0, 0, 0));
      const dayEnd = new Date(date.setHours(23, 59, 59, 999));

      const dayQuestions = engagementTrends.filter(
        (q) => q.createdAt >= dayStart && q.createdAt <= dayEnd
      ).length;

      return {
        date: dayStart.toISOString().split("T")[0],
        questions: dayQuestions,
        answers: engagementTrends.filter(
          (q) =>
            q.answers.length > 0 &&
            q.answers[0].createdAt >= dayStart &&
            q.answers[0].createdAt <= dayEnd
        ).length,
      };
    });

    const result = {
      summary: {
        totalQuestions: qnaStats._count.id || 0,
        answeredQuestions,
        unansweredQuestions: (qnaStats._count.id || 0) - answeredQuestions,
        responseRate: qnaStats._count.id
          ? Math.round((answeredQuestions / qnaStats._count.id) * 100)
          : 0,
        totalReviews: reviewStats._count.id || 0,
        repliedReviews,
        replyRate: reviewStats._count.id
          ? Math.round((repliedReviews / reviewStats._count.id) * 100)
          : 0,
        averageRating: Math.round((reviewStats._avg.rating || 0) * 10) / 10,
        averageQuestionViews: Math.round(qnaStats._avg.views || 0),
        activeStudents,
        averageResponseTime: Math.round(avgResponseTime / (1000 * 60 * 60)), // hours
      },
      trends: {
        daily: dailyEngagement,
        period: `${daysAgo} days`,
        timezone,
      },
      recommendations: [
        ...(answeredQuestions / (qnaStats._count.id || 1) < 0.8
          ? ["Improve Q&A response rate - aim for 80%+ response rate"]
          : []),
        ...(avgResponseTime > 24 * 60 * 60 * 1000
          ? ["Reduce response time - try to answer within 24 hours"]
          : []),
        ...(repliedReviews / (reviewStats._count.id || 1) < 0.5
          ? ["Engage more with reviews - especially negative ones"]
          : []),
        ...(reviewStats._avg.rating < 4.0
          ? ["Focus on course quality improvements"]
          : []),
      ],
    };

    await redisService.setJSON(cacheKey, result, { ex: 1800 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Engagement metrics retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`ENGAGEMENT_METRICS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve engagement metrics",
      code: "ENGAGEMENT_METRICS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCommunityOverview = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;

    const cacheKey = `instructor:${instructorId}:community:overview`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Community overview retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [pendingQuestions, recentReviews, communityStats, topCourses] =
      await Promise.all([
        prisma.qnAQuestion.findMany({
          where: {
            course: {
              instructorId: instructor.id,
            },
            answers: {
              none: {
                instructorId: instructor.id,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
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
        }),
        prisma.review.findMany({
          where: {
            course: {
              instructorId: instructor.id,
            },
            replies: {
              none: {
                author: {
                  instructorProfile: {
                    id: instructor.id,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
          include: {
            author: {
              select: {
                firstName: true,
                lastName: true,
                profileImage: true,
              },
            },
            course: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        }),
        Promise.all([
          prisma.qnAQuestion.count({
            where: {
              course: {
                instructorId: instructor.id,
              },
            },
          }),
          prisma.qnAQuestion.count({
            where: {
              course: {
                instructorId: instructor.id,
              },
              createdAt: { gte: thirtyDaysAgo },
            },
          }),
          prisma.review.count({
            where: {
              course: {
                instructorId: instructor.id,
              },
            },
          }),
          prisma.review.count({
            where: {
              course: {
                instructorId: instructor.id,
              },
              createdAt: { gte: thirtyDaysAgo },
            },
          }),
        ]),
        prisma.course.findMany({
          where: {
            instructorId: instructor.id,
            status: "PUBLISHED",
          },
          select: {
            id: true,
            title: true,
            thumbnail: true,
            _count: {
              select: {
                qnaQuestions: true,
                reviews: true,
                enrollments: true,
              },
            },
          },
          orderBy: [
            {
              qnaQuestions: {
                _count: "desc",
              },
            },
            {
              reviews: {
                _count: "desc",
              },
            },
          ],
          take: 5,
        }),
      ]);

    const [totalQuestions, recentQuestions, totalReviews, recentReviewsCount] =
      communityStats;

    const result = {
      quickStats: {
        pendingQuestions: pendingQuestions.length,
        unrepliedReviews: recentReviews.length,
        totalQuestions,
        totalReviews,
        recentActivity: {
          questionsLast30Days: recentQuestions,
          reviewsLast30Days: recentReviewsCount,
        },
      },
      pendingActions: {
        questions: pendingQuestions.map((question) => ({
          id: question.id,
          title: question.title,
          content: question.content.substring(0, 150),
          views: question.views,
          createdAt: question.createdAt,
          student: {
            name: `${question.student.user.firstName} ${question.student.user.lastName}`,
            profileImage: question.student.user.profileImage,
          },
          course: question.course,
          urgent:
            question.views > 10 ||
            new Date() - new Date(question.createdAt) > 2 * 24 * 60 * 60 * 1000,
        })),
        reviews: recentReviews.map((review) => ({
          id: review.id,
          title: review.title,
          content: review.content.substring(0, 150),
          rating: review.rating,
          createdAt: review.createdAt,
          author: {
            name: `${review.author.firstName} ${review.author.lastName}`,
            profileImage: review.author.profileImage,
          },
          course: review.course,
          needsAttention: review.rating <= 3,
        })),
      },
      topCourses: topCourses.map((course) => ({
        id: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        engagement: {
          questions: course._count.qnaQuestions,
          reviews: course._count.reviews,
          enrollments: course._count.enrollments,
          score: course._count.qnaQuestions + course._count.reviews * 2,
        },
      })),
      tips: [
        "Respond to questions within 24 hours for better student satisfaction",
        "Reply to negative reviews professionally to show you care",
        "Use Q&A insights to identify course improvement opportunities",
        "Thank students for positive reviews to encourage engagement",
        "Pin important Q&A answers for future students",
      ],
    };

    await redisService.setJSON(cacheKey, result, { ex: 900 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Community overview retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`COMMUNITY_OVERVIEW_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve community overview",
      code: "COMMUNITY_OVERVIEW_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const bulkAnswerQuestions = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const { answers } = req.body;

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Answers array is required",
        code: "ANSWERS_REQUIRED",
      });
    }

    if (answers.length > 10) {
      return res.status(400).json({
        success: false,
        message: "Cannot answer more than 10 questions at once",
        code: "TOO_MANY_ANSWERS",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: {
        id: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const questionIds = answers.map((a) => a.questionId);
    const questions = await prisma.qnAQuestion.findMany({
      where: {
        id: { in: questionIds },
        course: {
          instructorId: instructor.id,
        },
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            instructorId: true,
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

    if (questions.length !== questionIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some questions not found or not accessible",
        code: "INVALID_QUESTIONS",
      });
    }

    const existingAnswers = await prisma.qnAAnswer.findMany({
      where: {
        questionId: { in: questionIds },
        instructorId: instructor.id,
      },
    });

    if (existingAnswers.length > 0) {
      return res.status(409).json({
        success: false,
        message: "You have already answered some of these questions",
        code: "ANSWERS_ALREADY_EXIST",
      });
    }

    const validAnswers = answers.filter(
      (answer) =>
        answer.content &&
        answer.content.trim().length >= 10 &&
        questions.some((q) => q.id === answer.questionId)
    );

    if (validAnswers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid answers provided",
        code: "NO_VALID_ANSWERS",
      });
    }

    const createdAnswers = await Promise.all(
      validAnswers.map(async (answerData) => {
        const answer = await prisma.qnAAnswer.create({
          data: {
            content: answerData.content.trim(),
            isAccepted: answerData.markAsAccepted || false,
            instructorId: instructor.id,
            questionId: answerData.questionId,
          },
        });

        if (answerData.markAsAccepted) {
          await prisma.qnAQuestion.update({
            where: { id: answerData.questionId },
            data: { isResolved: true },
          });
        }

        const question = questions.find((q) => q.id === answerData.questionId);

        await notificationService.createNotification({
          userId: question.student.user.id,
          type: "QNA_ANSWER",
          title: "Question Answered",
          message: `Your question "${question.title.substring(
            0,
            50
          )}..." has been answered`,
          data: {
            questionId: question.id,
            answerId: answer.id,
            courseName: question.course.title,
            instructorName: `${instructor.user.firstName} ${instructor.user.lastName}`,
          },
          actionUrl: `/courses/${question.course.id}/qna/${question.id}`,
        });

        return {
          questionId: answerData.questionId,
          answerId: answer.id,
          success: true,
        };
      })
    );

    await Promise.all(
      questions.map((question) =>
        redisService.delPattern(`course:${question.course.id}:qna:*`)
      )
    );
    await redisService.delPattern(`instructor:${instructorId}:qna:*`);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: `Successfully answered ${createdAnswers.length} questions`,
      data: {
        answers: createdAnswers,
        processed: validAnswers.length,
        total: answers.length,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`BULK_ANSWER_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to answer questions",
      code: "BULK_ANSWER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const exportCommunityData = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const {
      format = "json",
      startDate,
      endDate,
      includeQnA = true,
      includeReviews = true,
      courseId,
    } = req.query;

    if (!["json", "csv"].includes(format)) {
      return res.status(400).json({
        success: false,
        message: "Invalid format. Use 'json' or 'csv'",
        code: "INVALID_FORMAT",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const dateFilter = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate);
    }

    const courseFilter = {
      instructorId: instructor.id,
      ...(courseId && { id: courseId }),
    };

    const exportData = {};

    if (includeQnA === "true") {
      const questions = await prisma.qnAQuestion.findMany({
        where: {
          course: courseFilter,
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
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
              id: true,
              title: true,
            },
          },
          lesson: {
            select: {
              id: true,
              title: true,
            },
          },
          answers: {
            where: {
              instructorId: instructor.id,
            },
            select: {
              id: true,
              content: true,
              isAccepted: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      exportData.qnaQuestions = questions.map((q) => ({
        id: q.id,
        title: q.title,
        content: q.content,
        views: q.views,
        isResolved: q.isResolved,
        createdAt: q.createdAt,
        student: {
          name: `${q.student.user.firstName} ${q.student.user.lastName}`,
          email: q.student.user.email,
        },
        course: q.course,
        lesson: q.lesson,
        myAnswer: q.answers[0] || null,
      }));
    }

    if (includeReviews === "true") {
      const reviews = await prisma.review.findMany({
        where: {
          course: courseFilter,
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
        },
        include: {
          author: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          course: {
            select: {
              id: true,
              title: true,
            },
          },
          replies: {
            where: {
              author: {
                instructorProfile: {
                  id: instructor.id,
                },
              },
            },
            select: {
              id: true,
              content: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      exportData.reviews = reviews.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        rating: r.rating,
        pros: r.pros,
        cons: r.cons,
        helpfulCount: r.helpfulCount,
        createdAt: r.createdAt,
        author: {
          name: `${r.author.firstName} ${r.author.lastName}`,
          email: r.author.email,
        },
        course: r.course,
        myReply: r.replies[0] || null,
      }));
    }

    if (format === "csv") {
      let csvContent = "";

      if (includeQnA === "true" && exportData.qnaQuestions) {
        csvContent += "=== Q&A QUESTIONS ===\n";
        csvContent +=
          "ID,Title,Content,Views,Resolved,Created,Student Name,Student Email,Course,Lesson,Answer Content,Answer Date\n";

        exportData.qnaQuestions.forEach((q) => {
          csvContent +=
            [
              q.id,
              `"${q.title}"`,
              `"${q.content.replace(/"/g, '""')}"`,
              q.views,
              q.isResolved,
              q.createdAt,
              `"${q.student.name}"`,
              q.student.email,
              `"${q.course.title}"`,
              q.lesson ? `"${q.lesson.title}"` : "",
              q.myAnswer ? `"${q.myAnswer.content.replace(/"/g, '""')}"` : "",
              q.myAnswer ? q.myAnswer.createdAt : "",
            ].join(",") + "\n";
        });
      }

      if (includeReviews === "true" && exportData.reviews) {
        csvContent += "\n=== REVIEWS ===\n";
        csvContent +=
          "ID,Title,Content,Rating,Helpful Count,Created,Author Name,Author Email,Course,Reply Content,Reply Date\n";

        exportData.reviews.forEach((r) => {
          csvContent +=
            [
              r.id,
              `"${r.title || ""}"`,
              `"${r.content.replace(/"/g, '""')}"`,
              r.rating,
              r.helpfulCount,
              r.createdAt,
              `"${r.author.name}"`,
              r.author.email,
              `"${r.course.title}"`,
              r.myReply ? `"${r.myReply.content.replace(/"/g, '""')}"` : "",
              r.myReply ? r.myReply.createdAt : "",
            ].join(",") + "\n";
        });
      }

      const executionTime = performance.now() - startTime;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="community-data-${Date.now()}.csv"`
      );

      return res.status(200).send(csvContent);
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Community data exported successfully",
      data: {
        ...exportData,
        exportInfo: {
          format,
          includeQnA: includeQnA === "true",
          includeReviews: includeReviews === "true",
          dateRange: {
            startDate: startDate || null,
            endDate: endDate || null,
          },
          courseId: courseId || null,
          exportedAt: new Date().toISOString(),
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`EXPORT_COMMUNITY_DATA_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to export community data",
      code: "EXPORT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const markQuestionAsResolved = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const { questionId } = req.params;
    const { isResolved = true } = req.body;

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const question = await prisma.qnAQuestion.findUnique({
      where: { id: questionId },
      include: {
        course: {
          select: {
            id: true,
            instructorId: true,
          },
        },
      },
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        code: "QUESTION_NOT_FOUND",
      });
    }

    if (question.course.instructorId !== instructor.id) {
      return res.status(403).json({
        success: false,
        message: "You can only modify questions for your courses",
        code: "UNAUTHORIZED_COURSE_ACCESS",
      });
    }

    await prisma.qnAQuestion.update({
      where: { id: questionId },
      data: { isResolved: isResolved },
    });

    await redisService.delPattern(`instructor:${instructorId}:qna:*`);
    await redisService.delPattern(`course:${question.course.id}:qna:*`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: `Question marked as ${isResolved ? "resolved" : "unresolved"}`,
      data: {
        questionId,
        isResolved,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`MARK_QUESTION_RESOLVED_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      instructorId: req.userAuthId,
      questionId: req.params.questionId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update question status",
      code: "QUESTION_UPDATE_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
