import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `learning_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const getCourseById = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const userId = req.userAuthId;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const cacheKey = `course_details:${courseId}:${userId || "anonymous"}`;

    let cachedResult = await redisService.get(cacheKey);
    if (cachedResult) {
      try {
        const parsedResult =
          typeof cachedResult === "string"
            ? JSON.parse(cachedResult)
            : cachedResult;
        const executionTime = performance.now() - startTime;
        return res.status(200).json({
          success: true,
          message: "Course retrieved successfully",
          data: parsedResult,
          meta: {
            requestId,
            executionTime: Math.round(executionTime),
            timestamp: new Date().toISOString(),
            cacheHit: true,
          },
        });
      } catch (parseError) {
        await redisService.del(cacheKey);
      }
    }

    const queryPromises = [
      prisma.course.findUnique({
        where: {
          id: courseId,
          status: "PUBLISHED",
        },
        include: {
          instructor: {
            select: {
              id: true,
              title: true,
              expertise: true,
              rating: true,
              totalStudents: true,
              totalCourses: true,
              totalRevenue: true,
              yearsExperience: true,
              education: true,
              certifications: true,
              isVerified: true,
              verificationBadge: true,
              biography: true,
              paymentDetails: true,
              commissionRate: true,
              createdAt: true,
              updatedAt: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  profileImage: true,
                  bio: true,
                  timezone: true,
                  language: true,
                  country: true,
                  website: true,
                  linkedinProfile: true,
                  twitterProfile: true,
                  githubProfile: true,
                  createdAt: true,
                },
              },
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              image: true,
              icon: true,
              color: true,
              isActive: true,
              order: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          subcategory: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              image: true,
              icon: true,
              color: true,
              isActive: true,
              order: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          sections: {
            where: { isPublished: true },
            select: {
              id: true,
              title: true,
              description: true,
              order: true,
              isPublished: true,
              isRequired: true,
              isFree: true,
              estimatedTime: true,
              createdAt: true,
              updatedAt: true,
              lessons: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  order: true,
                  duration: true,
                  isFree: true,
                  isPreview: true,
                  type: true,
                  content: true,
                  videoUrl: true,
                  videoQuality: true,
                  captions: true,
                  transcript: true,
                  resources: true,
                  createdAt: true,
                  updatedAt: true,
                  attachments: {
                    select: {
                      id: true,
                      name: true,
                      fileUrl: true,
                      fileSize: true,
                      fileType: true,
                      isDownloadable: true,
                      createdAt: true,
                    },
                  },
                },
                orderBy: { order: "asc" },
              },
              quizzes: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  instructions: true,
                  duration: true,
                  passingScore: true,
                  maxAttempts: true,
                  order: true,
                  isRequired: true,
                  isRandomized: true,
                  showResults: true,
                  allowReview: true,
                  createdAt: true,
                  updatedAt: true,
                  questions: {
                    select: {
                      id: true,
                      content: true,
                      type: true,
                      points: true,
                      order: true,
                      options: true,
                      explanation: true,
                      hints: true,
                      difficulty: true,
                      tags: true,
                      createdAt: true,
                    },
                    orderBy: { order: "asc" },
                  },
                },
                orderBy: { order: "asc" },
              },
              assignments: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  dueDate: true,
                  totalPoints: true,
                  order: true,
                  instructions: true,
                  resources: true,
                  rubric: true,
                  allowLateSubmission: true,
                  latePenalty: true,
                  createdAt: true,
                  updatedAt: true,
                },
                orderBy: { order: "asc" },
              },
            },
            orderBy: { order: "asc" },
          },
          reviews: {
            where: { isFlagged: false },
            select: {
              id: true,
              title: true,
              content: true,
              rating: true,
              pros: true,
              cons: true,
              isVerified: true,
              isHelpful: true,
              helpfulCount: true,
              reportCount: true,
              createdAt: true,
              updatedAt: true,
              author: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  profileImage: true,
                  isVerified: true,
                  createdAt: true,
                },
              },
              replies: {
                select: {
                  id: true,
                  content: true,
                  likes: true,
                  createdAt: true,
                  author: {
                    select: {
                      firstName: true,
                      lastName: true,
                      profileImage: true,
                    },
                  },
                },
                orderBy: { createdAt: "asc" },
                take: 5,
              },
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          },
          faqs: {
            where: { isActive: true },
            select: {
              id: true,
              question: true,
              answer: true,
              order: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { order: "asc" },
          },
          courseSettings: {
            select: {
              id: true,
              allowDiscussions: true,
              allowReviews: true,
              requireApproval: true,
              certificateEnabled: true,
              downloadable: true,
              allowPreview: true,
              autoEnrollmentEmail: true,
              sequentialProgress: true,
              passingGrade: true,
              certificateTemplate: true,
              drip: true,
              dripSchedule: true,
            },
          },
        },
      }),
    ];

    if (userId) {
      queryPromises.push(
        prisma.enrollment.findFirst({
          where: {
            courseId,
            student: { userId },
            status: "ACTIVE",
          },
          select: {
            id: true,
            status: true,
            expiresAt: true,
            progress: true,
            lastAccessedAt: true,
            lessonsCompleted: true,
            quizzesCompleted: true,
            assignmentsCompleted: true,
            totalContentItems: true,
            totalTimeSpent: true,
            enrollmentSource: true,
            discountApplied: true,
            createdAt: true,
            updatedAt: true,
            courseProgress: {
              select: {
                id: true,
                totalContentItems: true,
                completedItems: true,
                progressPercentage: true,
                lastActivityAt: true,
                lessonWeight: true,
                quizWeight: true,
                assignmentWeight: true,
                currentSectionId: true,
                currentLessonId: true,
                estimatedTimeLeft: true,
              },
            },
            certificate: {
              select: {
                id: true,
                url: true,
                certificateId: true,
                issueDate: true,
                isVerified: true,
                templateId: true,
              },
            },
          },
        }),
        prisma.wishlistItem.findFirst({
          where: {
            courseId,
            student: { userId },
          },
          select: {
            id: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.cartItem.findFirst({
          where: {
            courseId,
            student: { userId },
          },
          select: {
            id: true,
            price: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      );
    }

    const results = await Promise.all(queryPromises);
    const course = results[0];
    const enrollment = userId ? results[1] : null;
    const wishlistItem = userId ? results[2] : null;
    const cartItem = userId ? results[3] : null;

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found or not published",
        code: "COURSE_NOT_FOUND",
      });
    }

    const relatedCourses = await prisma.course.findMany({
      where: {
        status: "PUBLISHED",
        categoryId: course.categoryId,
        id: { not: courseId },
      },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        shortDescription: true,
        thumbnail: true,
        previewVideo: true,
        price: true,
        discountPrice: true,
        discountPercentage: true,
        originalPrice: true,
        duration: true,
        totalLessons: true,
        totalQuizzes: true,
        totalAssignments: true,
        level: true,
        language: true,
        averageRating: true,
        totalRatings: true,
        ratingDistribution: true,
        totalEnrollments: true,
        totalRevenue: true,
        completionRate: true,
        difficulty: true,
        featured: true,
        bestseller: true,
        trending: true,
        publishedAt: true,
        lastUpdated: true,
        requirements: true,
        learningOutcomes: true,
        targetAudience: true,
        tags: true,
        keyPoints: true,
        sectionsCount: true,
        publishedSectionsCount: true,
        enrollmentsCount: true,
        reviewsCount: true,
        createdAt: true,
        updatedAt: true,
        instructor: {
          select: {
            id: true,
            isVerified: true,
            verificationBadge: true,
            rating: true,
            totalStudents: true,
            totalCourses: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                profileImage: true,
              },
            },
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { totalEnrollments: "desc" },
      take: 8,
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
        introVideo: course.introVideo,
        price: parseFloat(course.price) || 0,
        discountPrice: course.discountPrice
          ? parseFloat(course.discountPrice)
          : null,
        discountPercentage: course.discountPercentage,
        originalPrice: course.originalPrice
          ? parseFloat(course.originalPrice)
          : null,
        duration: course.duration,
        totalLessons: course.totalLessons,
        totalQuizzes: course.totalQuizzes,
        totalAssignments: course.totalAssignments,
        level: course.level,
        status: course.status,
        featured: course.featured,
        bestseller: course.bestseller,
        trending: course.trending,
        publishedAt: course.publishedAt,
        archivedAt: course.archivedAt,
        language: course.language,
        subtitles: course.subtitles,
        requirements: course.requirements,
        tags: course.tags,
        keyPoints: course.keyPoints,
        learningOutcomes: course.learningOutcomes,
        targetAudience: course.targetAudience,
        lastUpdated: course.lastUpdated,
        reviewSubmittedAt: course.reviewSubmittedAt,
        reviewerId: course.reviewerId,
        reviewerFeedback: course.reviewerFeedback,
        rejectionReason: course.rejectionReason,
        averageRating: parseFloat(course.averageRating) || 0,
        totalRatings: course.totalRatings,
        ratingDistribution: course.ratingDistribution,
        totalEnrollments: course.totalEnrollments,
        totalRevenue: parseFloat(course.totalRevenue) || 0,
        completionRate: course.completionRate,
        difficulty: course.difficulty,
        sectionsCount: course.sectionsCount,
        publishedSectionsCount: course.publishedSectionsCount,
        enrollmentsCount: course.enrollmentsCount,
        reviewsCount: course.reviewsCount,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        category: course.category,
        subcategory: course.subcategory,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          firstName: course.instructor.user.firstName,
          lastName: course.instructor.user.lastName,
          email: course.instructor.user.email,
          title: course.instructor.title,
          expertise: course.instructor.expertise,
          biography: course.instructor.biography,
          bio: course.instructor.user.bio,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
          totalStudents: course.instructor.totalStudents,
          totalCourses: course.instructor.totalCourses,
          totalRevenue: parseFloat(course.instructor.totalRevenue) || 0,
          yearsExperience: course.instructor.yearsExperience,
          education: course.instructor.education,
          certifications: course.instructor.certifications,
          isVerified: course.instructor.isVerified,
          verificationBadge: course.instructor.verificationBadge,
          commissionRate: course.instructor.commissionRate,
          timezone: course.instructor.user.timezone,
          language: course.instructor.user.language,
          country: course.instructor.user.country,
          website: course.instructor.user.website,
          linkedinProfile: course.instructor.user.linkedinProfile,
          twitterProfile: course.instructor.user.twitterProfile,
          githubProfile: course.instructor.user.githubProfile,
          createdAt: course.instructor.createdAt,
          updatedAt: course.instructor.updatedAt,
          userCreatedAt: course.instructor.user.createdAt,
        },
        sections: course.sections.map((section) => ({
          ...section,
          lessons: section.lessons.map((lesson) => ({
            ...lesson,
            videoQuality: lesson.videoQuality,
            captions: lesson.captions,
            resources: lesson.resources,
            attachments: lesson.attachments,
          })),
          quizzes: section.quizzes.map((quiz) => ({
            ...quiz,
            questionsCount: quiz.questions?.length || 0,
            questions: quiz.questions,
          })),
          assignments: section.assignments,
        })),
        reviews: course.reviews.map((review) => ({
          ...review,
          author: {
            id: review.author.id,
            name: `${review.author.firstName} ${review.author.lastName}`,
            firstName: review.author.firstName,
            lastName: review.author.lastName,
            profileImage: review.author.profileImage,
            isVerified: review.author.isVerified,
            memberSince: review.author.createdAt,
          },
          replies: review.replies.map((reply) => ({
            ...reply,
            author: {
              name: `${reply.author.firstName} ${reply.author.lastName}`,
              profileImage: reply.author.profileImage,
            },
          })),
        })),
        faqs: course.faqs,
        courseSettings: course.courseSettings,
      },
      userStatus: userId
        ? {
            isEnrolled: !!enrollment,
            enrollment: enrollment
              ? {
                  ...enrollment,
                  courseProgress: enrollment.courseProgress,
                  certificate: enrollment.certificate,
                }
              : null,
            isInWishlist: !!wishlistItem,
            wishlistItem,
            isInCart: !!cartItem,
            cartItem,
          }
        : null,
      relatedCourses: relatedCourses.map((related) => ({
        ...related,
        price: parseFloat(related.price) || 0,
        discountPrice: related.discountPrice
          ? parseFloat(related.discountPrice)
          : null,
        originalPrice: related.originalPrice
          ? parseFloat(related.originalPrice)
          : null,
        totalRevenue: parseFloat(related.totalRevenue) || 0,
        instructor: {
          id: related.instructor.id,
          name: `${related.instructor.user.firstName} ${related.instructor.user.lastName}`,
          profileImage: related.instructor.user.profileImage,
          isVerified: related.instructor.isVerified,
          verificationBadge: related.instructor.verificationBadge,
          rating: related.instructor.rating,
          totalStudents: related.instructor.totalStudents,
          totalCourses: related.instructor.totalCourses,
        },
        category: related.category,
      })),
    };

    try {
      await redisService.setex(cacheKey, 600, JSON.stringify(result));
    } catch (cacheError) {
      console.warn("Failed to cache result:", cacheError);
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getAllPublicCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 12,
      level,
      categoryId,
      subcategoryId,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      priceMin,
      priceMax,
      rating,
      language,
      featured,
      bestseller,
      trending,
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `public_courses:${pageSize}:${pageNumber}:${level || ""}:${
      categoryId || ""
    }:${subcategoryId || ""}:${search || ""}:${sortBy}:${sortOrder}:${
      priceMin || ""
    }:${priceMax || ""}:${rating || ""}:${language || ""}:${featured || ""}:${
      bestseller || ""
    }:${trending || ""}`;

    let cachedResult = await redisService.get(cacheKey);
    if (cachedResult) {
      try {
        const parsedResult =
          typeof cachedResult === "string"
            ? JSON.parse(cachedResult)
            : cachedResult;
        const executionTime = performance.now() - startTime;
        return res.status(200).json({
          success: true,
          message: "Courses retrieved successfully",
          data: parsedResult,
          meta: {
            requestId,
            executionTime: Math.round(executionTime),
            timestamp: new Date().toISOString(),
            cacheHit: true,
          },
        });
      } catch (parseError) {
        await redisService.del(cacheKey);
      }
    }

    let whereClause = {
      status: "PUBLISHED",
      publishedAt: { not: null },
    };

    if (level) whereClause.level = level;
    if (categoryId) whereClause.categoryId = categoryId;
    if (subcategoryId) whereClause.subcategoryId = subcategoryId;
    if (language) whereClause.language = language;
    if (featured === "true") whereClause.featured = true;
    if (bestseller === "true") whereClause.bestseller = true;
    if (trending === "true") whereClause.trending = true;

    if (priceMin || priceMax) {
      whereClause.price = {};
      if (priceMin) whereClause.price.gte = parseFloat(priceMin);
      if (priceMax) whereClause.price.lte = parseFloat(priceMax);
    }

    if (rating) {
      whereClause.averageRating = { gte: parseFloat(rating) };
    }

    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { shortDescription: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
        { id: { equals: search } },
        { tags: { hasSome: [search] } },
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

    const validSortFields = {
      title: "title",
      createdAt: "createdAt",
      publishedAt: "publishedAt",
      price: "price",
      averageRating: "averageRating",
      totalEnrollments: "totalEnrollments",
      popularity: "totalEnrollments",
    };

    const orderBy = {};
    const sortField = validSortFields[sortBy] || "createdAt";
    orderBy[sortField] = sortOrder === "asc" ? "asc" : "desc";

    const [courses, total, categories] = await Promise.all([
      prisma.course.findMany({
        where: whereClause,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          title: true,
          slug: true,
          shortDescription: true,
          thumbnail: true,
          previewVideo: true,
          price: true,
          discountPrice: true,
          discountPercentage: true,
          originalPrice: true,
          duration: true,
          totalLessons: true,
          totalQuizzes: true,
          totalAssignments: true,
          level: true,
          language: true,
          subtitles: true,
          averageRating: true,
          totalRatings: true,
          ratingDistribution: true,
          totalEnrollments: true,
          totalRevenue: true,
          completionRate: true,
          difficulty: true,
          featured: true,
          bestseller: true,
          trending: true,
          publishedAt: true,
          lastUpdated: true,
          tags: true,
          keyPoints: true,
          learningOutcomes: true,
          targetAudience: true,
          requirements: true,
          sectionsCount: true,
          publishedSectionsCount: true,
          enrollmentsCount: true,
          reviewsCount: true,
          createdAt: true,
          updatedAt: true,
          instructor: {
            select: {
              id: true,
              title: true,
              expertise: true,
              rating: true,
              totalStudents: true,
              totalCourses: true,
              yearsExperience: true,
              isVerified: true,
              verificationBadge: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  profileImage: true,
                  country: true,
                },
              },
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              image: true,
              icon: true,
              color: true,
            },
          },
          subcategory: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              image: true,
              icon: true,
              color: true,
            },
          },
        },
      }),
      prisma.course.count({ where: whereClause }),
      prisma.category.findMany({
        where: { isActive: true, parentId: null },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          image: true,
          icon: true,
          color: true,
          order: true,
          _count: {
            select: {
              courses: {
                where: { status: "PUBLISHED" },
              },
            },
          },
        },
        orderBy: { order: "asc" },
      }),
    ]);

    const result = {
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        price: parseFloat(course.price) || 0,
        discountPrice: course.discountPrice
          ? parseFloat(course.discountPrice)
          : null,
        discountPercentage: course.discountPercentage,
        originalPrice: course.originalPrice
          ? parseFloat(course.originalPrice)
          : null,
        duration: course.duration,
        totalLessons: course.totalLessons,
        totalQuizzes: course.totalQuizzes,
        totalAssignments: course.totalAssignments,
        level: course.level,
        language: course.language,
        subtitles: course.subtitles,
        averageRating: parseFloat(course.averageRating) || 0,
        totalRatings: course.totalRatings,
        ratingDistribution: course.ratingDistribution,
        totalEnrollments: course.totalEnrollments,
        totalRevenue: parseFloat(course.totalRevenue) || 0,
        completionRate: course.completionRate,
        difficulty: course.difficulty,
        featured: course.featured,
        bestseller: course.bestseller,
        trending: course.trending,
        publishedAt: course.publishedAt,
        lastUpdated: course.lastUpdated,
        tags: course.tags,
        keyPoints: course.keyPoints,
        learningOutcomes: course.learningOutcomes,
        targetAudience: course.targetAudience,
        requirements: course.requirements,
        sectionsCount: course.sectionsCount,
        publishedSectionsCount: course.publishedSectionsCount,
        enrollmentsCount: course.enrollmentsCount,
        reviewsCount: course.reviewsCount,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          firstName: course.instructor.user.firstName,
          lastName: course.instructor.user.lastName,
          title: course.instructor.title,
          expertise: course.instructor.expertise,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
          totalStudents: course.instructor.totalStudents,
          totalCourses: course.instructor.totalCourses,
          yearsExperience: course.instructor.yearsExperience,
          country: course.instructor.user.country,
          isVerified: course.instructor.isVerified,
          verificationBadge: course.instructor.verificationBadge,
        },
        category: course.category,
        subcategory: course.subcategory,
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      filters: {
        categories,
        levels: ["BEGINNER", "INTERMEDIATE", "ADVANCED", "ALL_LEVELS"],
        languages: [
          "English",
          "Hindi",
          "Spanish",
          "French",
          "German",
          "Chinese",
          "Japanese",
        ],
        priceRanges: [
          { label: "Free", min: 0, max: 0 },
          { label: "Under ₹500", min: 0, max: 500 },
          { label: "₹500 - ₹2000", min: 500, max: 2000 },
          { label: "₹2000 - ₹5000", min: 2000, max: 5000 },
          { label: "Above ₹5000", min: 5000, max: null },
        ],
        ratings: [
          { label: "4.5 & above", value: 4.5 },
          { label: "4 & above", value: 4 },
          { label: "3.5 & above", value: 3.5 },
          { label: "3 & above", value: 3 },
        ],
      },
    };

    try {
      await redisService.setex(cacheKey, 300, JSON.stringify(result));
    } catch (cacheError) {
      console.warn("Failed to cache result:", cacheError);
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_PUBLIC_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      query: req.query,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
