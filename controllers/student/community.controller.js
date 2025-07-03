import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";
import notificationService from "../../utils/notificationservice.js";
import socketManager from "../../utils/socket-io.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `community_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const generateCacheKey = (prefix, params) => {
  return `${prefix}:${Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(":")}`;
};

const invalidateCommunityCache = async (courseId, patterns = []) => {
  const defaultPatterns = [
    `course_reviews:*courseId=${courseId}*`,
    `course_qna:*courseId=${courseId}*`,
    `course_rating:${courseId}`,
  ];

  for (const pattern of [...defaultPatterns, ...patterns]) {
    await redisService.invalidateCache(pattern);
  }
};

export const getCourseReviews = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const {
      page = 1,
      limit = 10,
      sortBy = "recent",
      rating,
      withReplies = "true",
    } = req.query;

    const cacheKey = generateCacheKey("course_reviews", {
      courseId,
      userId: req.userAuthId || "anonymous",
      page,
      limit,
      sortBy,
      rating: rating || "",
      withReplies,
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

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        status: true,
        averageRating: true,
        totalRatings: true,
        ratingDistribution: true,
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    const where = {
      courseId: courseId,
    };

    if (rating) {
      where.rating = parseInt(rating);
    }

    let orderBy = { createdAt: "desc" };
    if (sortBy === "helpful") {
      orderBy = { helpfulCount: "desc" };
    } else if (sortBy === "rating_high") {
      orderBy = { rating: "desc" };
    } else if (sortBy === "rating_low") {
      orderBy = { rating: "asc" };
    }

    const [reviews, total, ratingStats] = await Promise.all([
      prisma.review.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
          replies:
            withReplies === "true"
              ? {
                  where: { parentReplyId: null },
                  orderBy: { createdAt: "asc" },
                  take: 3,
                  include: {
                    author: {
                      select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        profileImage: true,
                      },
                    },
                    childReplies: {
                      orderBy: { createdAt: "asc" },
                      take: 2,
                      include: {
                        author: {
                          select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            profileImage: true,
                          },
                        },
                      },
                    },
                  },
                }
              : false,
        },
      }),
      prisma.review.count({ where }),
      prisma.review.groupBy({
        by: ["rating"],
        where: { courseId },
        _count: { rating: true },
      }),
    ]);

    let currentUserReview = null;
    if (req.userAuthId) {
      currentUserReview = await prisma.review.findUnique({
        where: {
          authorId_courseId: {
            authorId: req.userAuthId,
            courseId: courseId,
          },
        },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
        },
      });
    }

    const ratingDistribution = [5, 4, 3, 2, 1].map((rating) => {
      const stat = ratingStats.find((s) => s.rating === rating);
      return {
        rating,
        count: stat?._count.rating || 0,
        percentage: total > 0 ? ((stat?._count.rating || 0) / total) * 100 : 0,
      };
    });

    const result = {
      course: {
        id: course.id,
        title: course.title,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
      },
      reviews: reviews.map((review) => ({
        id: review.id,
        title: review.title,
        content: review.content,
        rating: review.rating,
        pros: review.pros,
        cons: review.cons,
        isVerified: review.isVerified,
        isHelpful: review.isHelpful,
        helpfulCount: review.helpfulCount,
        reportCount: review.reportCount,
        isFlagged: review.isFlagged,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        author: {
          id: review.author.id,
          name: `${review.author.firstName} ${review.author.lastName}`,
          profileImage: review.author.profileImage,
          isCurrentUser: req.userAuthId === review.author.id,
        },
        repliesCount: review.replies ? review.replies.length : 0,
        replies: review.replies
          ? review.replies.map((reply) => ({
              id: reply.id,
              content: reply.content,
              likes: reply.likes,
              isFlagged: reply.isFlagged,
              createdAt: reply.createdAt,
              author: {
                id: reply.author.id,
                name: `${reply.author.firstName} ${reply.author.lastName}`,
                profileImage: reply.author.profileImage,
                isCurrentUser: req.userAuthId === reply.author.id,
              },
              childReplies: reply.childReplies.map((child) => ({
                id: child.id,
                content: child.content,
                likes: child.likes,
                createdAt: child.createdAt,
                author: {
                  id: child.author.id,
                  name: `${child.author.firstName} ${child.author.lastName}`,
                  profileImage: child.author.profileImage,
                  isCurrentUser: req.userAuthId === child.author.id,
                },
              })),
            }))
          : [],
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      statistics: {
        averageRating: course.averageRating,
        totalReviews: total,
        ratingDistribution,
        verifiedReviewsCount: reviews.filter((r) => r.isVerified).length,
      },
      currentUserReview,
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Course reviews retrieved successfully",
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
    console.error(`GET_COURSE_REVIEWS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course reviews",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createReview = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { title = null, content, rating, pros = [], cons = [] } = req.body;

    if (!content || !rating) {
      return res.status(400).json({
        success: false,
        message: "Content and rating are required",
        code: "MISSING_REQUIRED_FIELDS",
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
        code: "INVALID_RATING",
      });
    }

    if (content.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Review content must be at least 10 characters long",
        code: "CONTENT_TOO_SHORT",
      });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        status: true,
        instructor: {
          select: {
            userId: true,
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

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    if (course.status !== "PUBLISHED") {
      return res.status(400).json({
        success: false,
        message: "Course is not available for reviews",
        code: "COURSE_NOT_AVAILABLE",
      });
    }

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

    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: studentProfile.id,
          courseId: courseId,
        },
      },
    });

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "You must be enrolled in this course to write a review",
        code: "NOT_ENROLLED",
      });
    }

    const existingReview = await prisma.review.findUnique({
      where: {
        authorId_courseId: {
          authorId: req.userAuthId,
          courseId: courseId,
        },
      },
    });

    if (existingReview) {
      const updatedReview = await prisma.review.update({
        where: {
          authorId_courseId: {
            authorId: req.userAuthId,
            courseId: courseId,
          },
        },
        data: {
          title: title ? title.trim() : null,
          content: content.trim(),
          rating: parseInt(rating),
          pros: Array.isArray(pros)
            ? pros.filter((p) => p.trim().length > 0)
            : [],
          cons: Array.isArray(cons)
            ? cons.filter((c) => c.trim().length > 0)
            : [],
          isVerified: enrollment.status === "COMPLETED",
        },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
        },
      });

      await updateCourseRating(courseId);
      await invalidateCommunityCache(courseId);

      const executionTime = performance.now() - startTime;

      return res.status(200).json({
        success: true,
        message: "Review updated successfully",
        data: {
          review: {
            id: updatedReview.id,
            title: updatedReview.title,
            content: updatedReview.content,
            rating: updatedReview.rating,
            pros: updatedReview.pros,
            cons: updatedReview.cons,
            isVerified: updatedReview.isVerified,
            createdAt: updatedReview.createdAt,
            updatedAt: updatedReview.updatedAt,
            author: {
              id: updatedReview.author.id,
              name: `${updatedReview.author.firstName} ${updatedReview.author.lastName}`,
              profileImage: updatedReview.author.profileImage,
            },
          },
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const review = await prisma.review.create({
      data: {
        authorId: req.userAuthId,
        courseId: courseId,
        title: title ? title.trim() : null,
        content: content.trim(),
        rating: parseInt(rating),
        pros: Array.isArray(pros)
          ? pros.filter((p) => p.trim().length > 0)
          : [],
        cons: Array.isArray(cons)
          ? cons.filter((c) => c.trim().length > 0)
          : [],
        isVerified: enrollment.status === "COMPLETED",
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
      },
    });

    await updateCourseRating(courseId);
    await invalidateCommunityCache(courseId);

    await notificationService.createNotification({
      userId: course.instructor.userId,
      type: "NEW_REVIEW",
      title: "New Course Review",
      message: `${review.author.firstName} ${review.author.lastName} left a ${rating}-star review for "${course.title}"`,
      data: {
        courseId,
        courseName: course.title,
        reviewId: review.id,
        reviewerName: `${review.author.firstName} ${review.author.lastName}`,
        rating,
      },
      actionUrl: `${process.env.FRONTEND_URL}/instructor/courses/${courseId}/reviews`,
      sendEmail: false,
    });

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Review created successfully",
      data: {
        review: {
          id: review.id,
          title: review.title,
          content: review.content,
          rating: review.rating,
          pros: review.pros,
          cons: review.cons,
          isVerified: review.isVerified,
          createdAt: review.createdAt,
          author: {
            id: review.author.id,
            name: `${review.author.firstName} ${review.author.lastName}`,
            profileImage: review.author.profileImage,
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
    console.error(`CREATE_REVIEW_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to create review",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateReview = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { reviewId } = req.params;
    const { title, content, rating, pros = [], cons = [] } = req.body;

    const existingReview = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!existingReview) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
        code: "REVIEW_NOT_FOUND",
      });
    }

    if (existingReview.authorId !== req.userAuthId) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own reviews",
        code: "REVIEW_UNAUTHORIZED",
      });
    }

    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
        code: "INVALID_RATING",
      });
    }

    if (content && content.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Review content must be at least 10 characters long",
        code: "CONTENT_TOO_SHORT",
      });
    }

    const updateData = {};
    if (title) updateData.title = title.trim();
    if (content) updateData.content = content.trim();
    if (rating) updateData.rating = parseInt(rating);
    if (pros)
      updateData.pros = Array.isArray(pros)
        ? pros.filter((p) => p.trim().length > 0)
        : [];
    if (cons)
      updateData.cons = Array.isArray(cons)
        ? cons.filter((c) => c.trim().length > 0)
        : [];
    updateData.updatedAt = new Date();

    const updatedReview = await prisma.review.update({
      where: { id: reviewId },
      data: updateData,
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
      },
    });

    if (rating && rating !== existingReview.rating) {
      await updateCourseRating(existingReview.course.id);
    }

    await invalidateCommunityCache(existingReview.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Review updated successfully",
      data: {
        review: {
          id: updatedReview.id,
          title: updatedReview.title,
          content: updatedReview.content,
          rating: updatedReview.rating,
          pros: updatedReview.pros,
          cons: updatedReview.cons,
          isVerified: updatedReview.isVerified,
          createdAt: updatedReview.createdAt,
          updatedAt: updatedReview.updatedAt,
          author: {
            id: updatedReview.author.id,
            name: `${updatedReview.author.firstName} ${updatedReview.author.lastName}`,
            profileImage: updatedReview.author.profileImage,
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
    console.error(`UPDATE_REVIEW_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      reviewId: req.params.reviewId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update review",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteReview = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { reviewId } = req.params;

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
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

    if (review.authorId !== req.userAuthId) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own reviews",
        code: "REVIEW_UNAUTHORIZED",
      });
    }

    await prisma.review.delete({
      where: { id: reviewId },
    });

    await updateCourseRating(review.course.id);
    await invalidateCommunityCache(review.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Review deleted successfully",
      data: {
        deletedReview: {
          id: reviewId,
          courseTitle: review.course.title,
          deletedAt: new Date(),
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_REVIEW_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      reviewId: req.params.reviewId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete review",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const addReviewReply = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { reviewId } = req.params;
    const { content, parentReplyId } = req.body;

    if (!content || content.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: "Reply content must be at least 5 characters long",
        code: "CONTENT_TOO_SHORT",
      });
    }

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        course: {
          select: {
            id: true,
            title: true,
            instructor: {
              select: {
                userId: true,
              },
            },
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

    if (parentReplyId) {
      const parentReply = await prisma.reviewReply.findUnique({
        where: { id: parentReplyId },
      });

      if (!parentReply || parentReply.reviewId !== reviewId) {
        return res.status(400).json({
          success: false,
          message: "Invalid parent reply",
          code: "INVALID_PARENT_REPLY",
        });
      }
    }

    const reply = await prisma.reviewReply.create({
      data: {
        reviewId: reviewId,
        authorId: req.userAuthId,
        content: content.trim(),
        parentReplyId: parentReplyId || null,
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
      },
    });

    await invalidateCommunityCache(review.course.id);

    if (review.author.id !== req.userAuthId) {
      await notificationService.createNotification({
        userId: review.author.id,
        type: "REVIEW_REPLY",
        title: "New Reply to Your Review",
        message: `${reply.author.firstName} ${reply.author.lastName} replied to your review for "${review.course.title}"`,
        data: {
          courseId: review.course.id,
          courseName: review.course.title,
          reviewId: review.id,
          replyId: reply.id,
          replierName: `${reply.author.firstName} ${reply.author.lastName}`,
        },
        actionUrl: `${process.env.FRONTEND_URL}/courses/${review.course.id}/reviews`,
        sendEmail: false,
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Reply added successfully",
      data: {
        reply: {
          id: reply.id,
          content: reply.content,
          likes: reply.likes,
          isFlagged: reply.isFlagged,
          createdAt: reply.createdAt,
          parentReplyId: reply.parentReplyId,
          author: {
            id: reply.author.id,
            name: `${reply.author.firstName} ${reply.author.lastName}`,
            profileImage: reply.author.profileImage,
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
    console.error(`ADD_REVIEW_REPLY_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      reviewId: req.params.reviewId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to add reply",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCourseQnA = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const {
      page = 1,
      limit = 10,
      sortBy = "recent",
      resolved,
      lessonId,
    } = req.query;

    const cacheKey = generateCacheKey("course_qna", {
      courseId,
      userId: req.userAuthId || "anonymous",
      page,
      limit,
      sortBy,
      resolved: resolved || "",
      lessonId: lessonId || "",
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

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        status: true,
        instructor: {
          select: {
            userId: true,
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
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    const where = {
      courseId: courseId,
    };

    if (resolved !== undefined) {
      where.isResolved = resolved === "true";
    }

    if (lessonId) {
      where.lessonId = lessonId;
    }

    let orderBy = { createdAt: "desc" };
    if (sortBy === "popular") {
      orderBy = { views: "desc" };
    } else if (sortBy === "oldest") {
      orderBy = { createdAt: "asc" };
    }

    const [questions, total] = await Promise.all([
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
                  id: true,
                  firstName: true,
                  lastName: true,
                  profileImage: true,
                },
              },
            },
          },
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
          answers: {
            orderBy: [{ isAccepted: "desc" }, { createdAt: "asc" }],
            include: {
              instructor: {
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
            },
          },
        },
      }),
      prisma.qnAQuestion.count({ where }),
    ]);

    let canAskQuestion = false;
    if (req.userAuthId) {
      const studentProfile = await prisma.student.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      });

      if (studentProfile) {
        const isEnrolled = await prisma.enrollment.findUnique({
          where: {
            studentId_courseId: {
              studentId: studentProfile.id,
              courseId: courseId,
            },
          },
        });
        canAskQuestion = !!isEnrolled;
      }
    }

    const result = {
      course: {
        id: course.id,
        title: course.title,
        instructor: {
          id: course.instructor.userId,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
        },
      },
      questions: questions.map((question) => ({
        id: question.id,
        title: question.title,
        content: question.content,
        isResolved: question.isResolved,
        views: question.views,
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
        student: {
          id: question.student.user.id,
          name: `${question.student.user.firstName} ${question.student.user.lastName}`,
          profileImage: question.student.user.profileImage,
          isCurrentUser: req.userAuthId === question.student.user.id,
        },
        lesson: question.lesson
          ? {
              id: question.lesson.id,
              title: question.lesson.title,
              section: {
                id: question.lesson.section.id,
                title: question.lesson.section.title,
                order: question.lesson.section.order,
              },
            }
          : null,
        answersCount: question.answers.length,
        hasAcceptedAnswer: question.answers.some((a) => a.isAccepted),
        answers: question.answers.map((answer) => ({
          id: answer.id,
          content: answer.content,
          isAccepted: answer.isAccepted,
          createdAt: answer.createdAt,
          instructor: {
            id: answer.instructor.user.id,
            name: `${answer.instructor.user.firstName} ${answer.instructor.user.lastName}`,
            profileImage: answer.instructor.user.profileImage,
            isCurrentUser: req.userAuthId === answer.instructor.user.id,
          },
        })),
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      statistics: {
        totalQuestions: total,
        resolvedCount: questions.filter((q) => q.isResolved).length,
        unresolvedCount: questions.filter((q) => !q.isResolved).length,
      },
      permissions: {
        canAskQuestion,
        canAnswerQuestion: req.userAuthId === course.instructor.userId,
      },
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Course Q&A retrieved successfully",
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
    console.error(`GET_COURSE_QNA_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course Q&A",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const askQuestion = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { title = null, content, lessonId } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: "Content is required",
        code: "MISSING_REQUIRED_FIELDS",
      });
    }

    if (content.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Question content must be at least 10 characters long",
        code: "CONTENT_TOO_SHORT",
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
          select: {
            id: true,
            title: true,
            instructor: {
              select: {
                userId: true,
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
      },
    });

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "You must be enrolled in this course to ask questions",
        code: "NOT_ENROLLED",
      });
    }

    if (lessonId) {
      const lesson = await prisma.lesson.findFirst({
        where: {
          id: lessonId,
          section: {
            courseId: courseId,
          },
        },
      });

      if (!lesson) {
        return res.status(400).json({
          success: false,
          message: "Invalid lesson for this course",
          code: "INVALID_LESSON",
        });
      }
    }

    const questionData = {
      student: {
        connect: { id: req.studentProfile.id },
      },
      course: {
        connect: { id: courseId },
      },
      content: content.trim(),
    };

    if (title && title.trim()) {
      questionData.title = title.trim();
    }

    if (lessonId) {
      questionData.lesson = {
        connect: { id: lessonId },
      };
    }

    const question = await prisma.qnAQuestion.create({
      data: questionData,
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
        lesson: {
          select: {
            id: true,
            title: true,
            section: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
    });

    await invalidateCommunityCache(courseId);

    await notificationService.createNotification({
      userId: enrollment.course.instructor.userId,
      type: "QNA_QUESTION",
      title: "New Q&A Question",
      message: `${question.student.user.firstName} ${question.student.user.lastName} asked a question in "${enrollment.course.title}"`,
      data: {
        courseId,
        courseName: enrollment.course.title,
        questionId: question.id,
        questionTitle: question.title,
        studentName: `${question.student.user.firstName} ${question.student.user.lastName}`,
        lessonId: lessonId,
        lessonTitle: question.lesson?.title,
      },
      actionUrl: `${process.env.FRONTEND_URL}/instructor/courses/${courseId}/qna`,
      sendEmail: false,
    });

    if (socketManager && socketManager.sendToUser) {
      socketManager.sendToUser(
        enrollment.course.instructor.userId,
        "new_question",
        {
          questionId: question.id,
          questionTitle: question.title,
          courseId,
          courseName: enrollment.course.title,
          studentName: `${question.student.user.firstName} ${question.student.user.lastName}`,
          isUrgent: false,
        }
      );
    }

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Question posted successfully",
      data: {
        question: {
          id: question.id,
          title: question.title || "",
          content: question.content,
          isResolved: question.isResolved,
          views: question.views,
          createdAt: question.createdAt,
          student: {
            id: question.student.user.id,
            name: `${question.student.user.firstName} ${question.student.user.lastName}`,
            profileImage: question.student.user.profileImage,
          },
          lesson: question.lesson,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`ASK_QUESTION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to post question",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const incrementQuestionViews = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { questionId } = req.params;

    const question = await prisma.qnAQuestion.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        views: true,
        studentId: true,
        courseId: true,
        student: {
          select: {
            userId: true,
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

    const isAuthor =
      req.userAuthId && question.student.userId === req.userAuthId;
    const shouldIncrementViews = !isAuthor;

    if (shouldIncrementViews) {
      await prisma.qnAQuestion.update({
        where: { id: questionId },
        data: {
          views: { increment: 1 },
        },
      });

      await redisService.invalidateCache(
        `course_qna:*courseId=${question.courseId}*`
      );
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Question views incremented",
      data: {
        views: question.views + (shouldIncrementViews ? 1 : 0),
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`INCREMENT_QUESTION_VIEWS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      questionId: req.params.questionId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to increment views",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const updateCourseRating = async (courseId) => {
  try {
    const [reviewStats, total] = await Promise.all([
      prisma.review.aggregate({
        where: { courseId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      prisma.review.count({
        where: { courseId },
      }),
    ]);

    const ratingCounts = await prisma.review.groupBy({
      by: ["rating"],
      where: { courseId },
      _count: { rating: true },
    });

    const ratingDistribution = {};
    [1, 2, 3, 4, 5].forEach((rating) => {
      const count =
        ratingCounts.find((r) => r.rating === rating)?._count.rating || 0;
      ratingDistribution[rating] = {
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      };
    });

    await prisma.course.update({
      where: { id: courseId },
      data: {
        averageRating: reviewStats._avg.rating || 0,
        totalRatings: total,
        ratingDistribution: ratingDistribution,
      },
    });

    await redisService.set(
      `course_rating:${courseId}`,
      JSON.stringify({
        averageRating: reviewStats._avg.rating || 0,
        totalRatings: total,
        ratingDistribution,
      }),
      { ex: 3600 }
    );
  } catch (error) {
    console.error("Error updating course rating:", error);
  }
};

export const rateCourse = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { rating } = req.body;

    if (!rating) {
      return res.status(400).json({
        success: false,
        message: "Rating is required",
        code: "MISSING_REQUIRED_FIELDS",
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
        code: "INVALID_RATING",
      });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        status: true,
        instructor: {
          select: {
            userId: true,
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

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    if (course.status !== "PUBLISHED") {
      return res.status(400).json({
        success: false,
        message: "Course is not available for rating",
        code: "COURSE_NOT_AVAILABLE",
      });
    }

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

    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: studentProfile.id,
          courseId: courseId,
        },
      },
    });

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "You must be enrolled in this course to rate it",
        code: "NOT_ENROLLED",
      });
    }

    const existingReview = await prisma.review.findUnique({
      where: {
        authorId_courseId: {
          authorId: req.userAuthId,
          courseId: courseId,
        },
      },
    });

    if (existingReview) {
      const updatedReview = await prisma.review.update({
        where: {
          authorId_courseId: {
            authorId: req.userAuthId,
            courseId: courseId,
          },
        },
        data: {
          rating: parseInt(rating),
        },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
        },
      });

      await updateCourseRating(courseId);
      await invalidateCommunityCache(courseId);

      const executionTime = performance.now() - startTime;

      return res.status(200).json({
        success: true,
        message: "Rating updated successfully",
        data: {
          rating: {
            id: updatedReview.id,
            rating: updatedReview.rating,
            createdAt: updatedReview.createdAt,
            updatedAt: updatedReview.updatedAt,
            author: {
              id: updatedReview.author.id,
              name: `${updatedReview.author.firstName} ${updatedReview.author.lastName}`,
              profileImage: updatedReview.author.profileImage,
            },
          },
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const review = await prisma.review.create({
      data: {
        authorId: req.userAuthId,
        courseId: courseId,
        title: null,
        content: `Rated ${rating} stars`,
        rating: parseInt(rating),
        pros: [],
        cons: [],
        isVerified: enrollment.status === "COMPLETED",
      },
      include: {
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
      },
    });

    await updateCourseRating(courseId);
    await invalidateCommunityCache(courseId);

    await notificationService.createNotification({
      userId: course.instructor.userId,
      type: "NEW_REVIEW",
      title: "New Course Rating",
      message: `${review.author.firstName} ${review.author.lastName} rated "${course.title}" with ${rating} stars`,
      data: {
        courseId,
        courseName: course.title,
        reviewId: review.id,
        reviewerName: `${review.author.firstName} ${review.author.lastName}`,
        rating,
      },
      actionUrl: `${process.env.FRONTEND_URL}/instructor/courses/${courseId}/reviews`,
      sendEmail: false,
    });

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Course rated successfully",
      data: {
        rating: {
          id: review.id,
          rating: review.rating,
          createdAt: review.createdAt,
          author: {
            id: review.author.id,
            name: `${review.author.firstName} ${review.author.lastName}`,
            profileImage: review.author.profileImage,
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
    console.error(`RATE_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to rate course",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
