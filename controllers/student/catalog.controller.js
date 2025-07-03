import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";

const prisma = new PrismaClient();

const generateRequestId = () =>
  `catalog_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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

const getCoursePlaceholder = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();

  try {
    const placeholderCourses = [
      {
        id: "placeholder-1",
        title: "Complete Web Development Bootcamp",
        slug: "complete-web-development-bootcamp",
        shortDescription:
          "Learn HTML, CSS, JavaScript, React, Node.js and more in this comprehensive course.",
        thumbnail:
          "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400",
        price: 2999,
        discountPrice: 999,
        level: "BEGINNER",
        duration: 2400,
        totalLessons: 156,
        averageRating: 4.8,
        totalRatings: 12453,
        totalEnrollments: 25632,
        featured: true,
        bestseller: true,
        instructor: {
          name: "John Smith",
          profileImage:
            "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100",
          rating: 4.9,
        },
        category: { name: "Web Development", slug: "web-development" },
      },
      {
        id: "placeholder-2",
        title: "Data Science Masterclass",
        slug: "data-science-masterclass",
        shortDescription:
          "Master Python, Machine Learning, and Data Analysis with real-world projects.",
        thumbnail:
          "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400",
        price: 3999,
        discountPrice: 1299,
        level: "INTERMEDIATE",
        duration: 3600,
        totalLessons: 89,
        averageRating: 4.7,
        totalRatings: 8765,
        totalEnrollments: 15432,
        trending: true,
        instructor: {
          name: "Dr. Sarah Johnson",
          profileImage:
            "https://images.unsplash.com/photo-1494790108755-2616b332033c?w=100",
          rating: 4.8,
        },
        category: { name: "Data Science", slug: "data-science" },
      },
    ];

    res.status(200).json({
      success: true,
      message: "Placeholder courses for development",
      data: {
        courses: placeholderCourses,
        totalCount: placeholderCourses.length,
        isPlaceholder: true,
      },
      meta: {
        requestId,
        executionTime: 1,
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_COURSE_PLACEHOLDER_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      message: "Failed to retrieve placeholder courses",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: 1,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getFreeCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 12,
      category,
      level,
      sortBy = "popularity",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `courses:free:${Buffer.from(
      JSON.stringify({
        page: pageNumber,
        limit: pageSize,
        category,
        level,
        sortBy,
      })
    ).toString("base64")}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Free courses retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const where = {
      status: "PUBLISHED",
      price: 0,
    };

    if (category) {
      where.category = { slug: category };
    }

    if (level) {
      where.level = level.toUpperCase();
    }

    let orderBy = {};
    switch (sortBy) {
      case "newest":
        orderBy = { publishedAt: "desc" };
        break;
      case "rating":
        orderBy = { averageRating: "desc" };
        break;
      case "enrollments":
        orderBy = { totalEnrollments: "desc" };
        break;
      case "duration":
        orderBy = { duration: "desc" };
        break;
      default:
        orderBy = [
          { featured: "desc" },
          { totalEnrollments: "desc" },
          { averageRating: "desc" },
        ];
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
          _count: {
            select: {
              enrollments: true,
              reviews: true,
            },
          },
        },
      }),
      prisma.course.count({ where }),
    ]);

    const result = {
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        price: course.price,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        language: course.language,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        totalReviews: course._count.reviews,
        featured: course.featured,
        keyPoints: course.keyPoints.slice(0, 3),
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
          isVerified: course.instructor.isVerified,
        },
        category: course.category,
        publishedAt: course.publishedAt,
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
        category,
        level,
        sortBy,
        totalResults: total,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Free courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_FREE_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      query: req.query,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve free courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getCatalogStats = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const cacheKey = "catalog:stats";

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Catalog statistics retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const [
      totalCourses,
      totalInstructors,
      totalStudents,
      totalEnrollments,
      averageRating,
      coursesByLevel,
      coursesByCategory,
      topRatedCourses,
      recentCourses,
    ] = await Promise.all([
      prisma.course.count({ where: { status: "PUBLISHED" } }),
      prisma.instructor.count(),
      prisma.student.count(),
      prisma.enrollment.count(),
      prisma.course.aggregate({
        where: { status: "PUBLISHED" },
        _avg: { averageRating: true },
      }),
      prisma.course.groupBy({
        by: ["level"],
        where: { status: "PUBLISHED" },
        _count: { level: true },
      }),
      prisma.course.groupBy({
        by: ["categoryId"],
        where: { status: "PUBLISHED" },
        _count: { categoryId: true },
        orderBy: {
          _count: {
            categoryId: "desc",
          },
        },
        take: 5,
      }),
      prisma.course.findMany({
        where: {
          status: "PUBLISHED",
          averageRating: { gte: 4.5 },
        },
        orderBy: { averageRating: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          slug: true,
          averageRating: true,
          totalRatings: true,
        },
      }),
      prisma.course.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          slug: true,
          publishedAt: true,
        },
      }),
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

    const result = {
      overview: {
        totalCourses,
        totalInstructors,
        totalStudents,
        totalEnrollments,
        averageRating:
          Math.round((averageRating._avg.averageRating || 0) * 10) / 10,
      },
      distributions: {
        byLevel: coursesByLevel.map((level) => ({
          level: level.level,
          count: level._count.level,
          percentage: Math.round((level._count.level / totalCourses) * 100),
        })),
        byCategory: coursesByCategory.map((cat) => {
          const details = categoryDetails.find((d) => d.id === cat.categoryId);
          return {
            categoryId: cat.categoryId,
            name: details?.name || "Unknown",
            slug: details?.slug || "",
            count: cat._count.categoryId,
            percentage: Math.round(
              (cat._count.categoryId / totalCourses) * 100
            ),
          };
        }),
      },
      highlights: {
        topRatedCourses,
        recentCourses,
      },
      lastUpdated: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, result, { ex: 3600 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Catalog statistics retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_CATALOG_STATS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve catalog statistics. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getCoursesByCategory = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { categorySlug } = req.params;
    const {
      page = 1,
      limit = 12,
      subcategory,
      level,
      priceMin,
      priceMax,
      sortBy = "popularity",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `courses:category:${categorySlug}:${Buffer.from(
      JSON.stringify({
        page: pageNumber,
        limit: pageSize,
        subcategory,
        level,
        priceMin,
        priceMax,
        sortBy,
      })
    ).toString("base64")}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Category courses retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const category = await prisma.category.findUnique({
      where: { slug: categorySlug },
      include: {
        subcategories: {
          where: { isActive: true },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        code: "CATEGORY_NOT_FOUND",
      });
    }

    const where = {
      status: "PUBLISHED",
      categoryId: category.id,
    };

    if (subcategory) {
      const subcategoryRecord = await prisma.category.findFirst({
        where: { slug: subcategory, parentId: category.id },
      });
      if (subcategoryRecord) {
        where.subcategoryId = subcategoryRecord.id;
      }
    }

    if (level) {
      where.level = level.toUpperCase();
    }

    if (priceMin || priceMax) {
      where.price = {};
      if (priceMin) where.price.gte = parseFloat(priceMin);
      if (priceMax) where.price.lte = parseFloat(priceMax);
    }

    let orderBy = {};
    switch (sortBy) {
      case "newest":
        orderBy = { publishedAt: "desc" };
        break;
      case "price_low":
        orderBy = { price: "asc" };
        break;
      case "price_high":
        orderBy = { price: "desc" };
        break;
      case "rating":
        orderBy = { averageRating: "desc" };
        break;
      default:
        orderBy = [
          { featured: "desc" },
          { bestseller: "desc" },
          { totalEnrollments: "desc" },
          { averageRating: "desc" },
        ];
    }

    const [courses, total, topInstructors] = await Promise.all([
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
                  profileImage: true,
                },
              },
            },
          },
          subcategory: {
            select: {
              name: true,
              slug: true,
            },
          },
          _count: {
            select: {
              enrollments: true,
              reviews: true,
            },
          },
        },
      }),
      prisma.course.count({ where }),
      prisma.instructor.findMany({
        where: {
          courses: {
            some: {
              categoryId: category.id,
              status: "PUBLISHED",
            },
          },
        },
        orderBy: {
          totalStudents: "desc",
        },
        take: 5,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
        },
      }),
    ]);

    const result = {
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        image: category.image,
        subcategories: category.subcategories,
      },
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        featured: course.featured,
        bestseller: course.bestseller,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
        },
        subcategory: course.subcategory,
        publishedAt: course.publishedAt,
      })),
      topInstructors: topInstructors.map((instructor) => ({
        id: instructor.id,
        name: `${instructor.user.firstName} ${instructor.user.lastName}`,
        profileImage: instructor.user.profileImage,
        rating: instructor.rating,
        totalStudents: instructor.totalStudents,
        totalCourses: instructor.totalCourses,
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Category courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_COURSES_BY_CATEGORY_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      categorySlug: req.params.categorySlug,
      query: req.query,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve category courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getFilterOptions = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const cacheKey = "courses:filter-options";

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Filter options retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const [
      levels,
      languages,
      priceRanges,
      durations,
      ratings,
      topCategories,
      topInstructors,
    ] = await Promise.all([
      prisma.course.groupBy({
        by: ["level"],
        where: { status: "PUBLISHED" },
        _count: { level: true },
      }),
      prisma.course.groupBy({
        by: ["language"],
        where: { status: "PUBLISHED" },
        _count: { language: true },
      }),
      prisma.course.aggregate({
        where: { status: "PUBLISHED" },
        _min: { price: true },
        _max: { price: true },
        _avg: { price: true },
      }),
      prisma.course.aggregate({
        where: { status: "PUBLISHED" },
        _min: { duration: true },
        _max: { duration: true },
        _avg: { duration: true },
      }),
      prisma.course.groupBy({
        by: ["averageRating"],
        where: {
          status: "PUBLISHED",
          averageRating: { gt: 0 },
        },
        _count: { averageRating: true },
      }),
      prisma.category.findMany({
        where: {
          isActive: true,
          parentId: null,
          courses: {
            some: {
              status: "PUBLISHED",
            },
          },
        },
        orderBy: {
          courses: {
            _count: "desc",
          },
        },
        take: 10,
        include: {
          _count: {
            select: {
              courses: {
                where: { status: "PUBLISHED" },
              },
            },
          },
        },
      }),
      prisma.instructor.findMany({
        where: {
          courses: {
            some: {
              status: "PUBLISHED",
            },
          },
        },
        orderBy: {
          totalStudents: "desc",
        },
        take: 20,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          _count: {
            select: {
              courses: {
                where: { status: "PUBLISHED" },
              },
            },
          },
        },
      }),
    ]);

    const result = {
      levels: levels.map((level) => ({
        value: level.level,
        label: level.level.charAt(0) + level.level.slice(1).toLowerCase(),
        count: level._count.level,
      })),
      languages: languages.map((lang) => ({
        value: lang.language,
        label: lang.language,
        count: lang._count.language,
      })),
      priceRanges: [
        { label: "Free", min: 0, max: 0 },
        { label: "Under ₹500", min: 0, max: 500 },
        { label: "₹500 - ₹2000", min: 500, max: 2000 },
        { label: "₹2000 - ₹5000", min: 2000, max: 5000 },
        { label: "Above ₹5000", min: 5000, max: null },
      ],
      priceStats: {
        min: priceRanges._min.price,
        max: priceRanges._max.price,
        average: Math.round(priceRanges._avg.price),
      },
      durations: [
        { label: "Under 2 hours", min: 0, max: 120 },
        { label: "2-6 hours", min: 120, max: 360 },
        { label: "6-17 hours", min: 360, max: 1020 },
        { label: "17+ hours", min: 1020, max: null },
      ],
      durationStats: {
        min: durations._min.duration,
        max: durations._max.duration,
        average: Math.round(durations._avg.duration),
      },
      ratings: [
        { label: "4.5 & up", value: 4.5 },
        { label: "4.0 & up", value: 4.0 },
        { label: "3.5 & up", value: 3.5 },
        { label: "3.0 & up", value: 3.0 },
      ],
      categories: topCategories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        courseCount: category._count.courses,
      })),
      topInstructors: topInstructors
        .filter((instructor) => instructor.user)
        .map((instructor) => ({
          id: instructor.id,
          name: `${instructor.user.firstName} ${instructor.user.lastName}`,
          totalStudents: instructor.totalStudents,
          courseCount: instructor._count.courses,
        })),
      sortOptions: [
        { value: "popularity", label: "Most Popular" },
        { value: "newest", label: "Newest" },
        { value: "rating", label: "Highest Rated" },
        { value: "price", label: "Price: Low to High" },
        { value: "enrollments", label: "Most Enrolled" },
        { value: "title", label: "Alphabetical" },
      ],
    };

    await redisService.setJSON(cacheKey, result, { ex: 1800 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Filter options retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_FILTER_OPTIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve filter options. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getFeaturedCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { limit = 8 } = req.query;
    const limitNumber = Math.min(parseInt(limit), 20);

    const cacheKey = `courses:featured:${limitNumber}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Featured courses retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const courses = await prisma.course.findMany({
      where: {
        status: "PUBLISHED",
        featured: true,
      },
      orderBy: [
        { averageRating: "desc" },
        { totalEnrollments: "desc" },
        { publishedAt: "desc" },
      ],
      take: limitNumber,
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
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
            reviews: true,
          },
        },
      },
    });

    const result = {
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        price: course.price,
        discountPrice: course.discountPrice,
        originalPrice: course.originalPrice,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        language: course.language,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        totalReviews: course._count.reviews,
        featured: course.featured,
        bestseller: course.bestseller,
        trending: course.trending,
        keyPoints: course.keyPoints.slice(0, 3),
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
          isVerified: course.instructor.isVerified,
        },
        category: course.category,
        publishedAt: course.publishedAt,
      })),
      totalCount: courses.length,
    };

    await redisService.setJSON(cacheKey, result, { ex: 900 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Featured courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_FEATURED_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve featured courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getTrendingCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { limit = 8 } = req.query;
    const limitNumber = Math.min(parseInt(limit), 20);

    const cacheKey = `courses:trending:${limitNumber}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Trending courses retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const courses = await prisma.course.findMany({
      where: {
        status: "PUBLISHED",
        trending: true,
        publishedAt: {
          gte: thirtyDaysAgo,
        },
      },
      orderBy: [
        { totalEnrollments: "desc" },
        { averageRating: "desc" },
        { publishedAt: "desc" },
      ],
      take: limitNumber,
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
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
            reviews: true,
          },
        },
      },
    });

    const result = {
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        trending: course.trending,
        trendingRank: courses.indexOf(course) + 1,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
        },
        category: course.category,
        publishedAt: course.publishedAt,
      })),
      totalCount: courses.length,
      periodDays: 30,
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Trending courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_TRENDING_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve trending courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getBestsellerCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { limit = 8 } = req.query;
    const limitNumber = Math.min(parseInt(limit), 20);

    const cacheKey = `courses:bestseller:${limitNumber}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Bestseller courses retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const courses = await prisma.course.findMany({
      where: {
        status: "PUBLISHED",
        bestseller: true,
      },
      orderBy: [
        { totalEnrollments: "desc" },
        { totalRevenue: "desc" },
        { averageRating: "desc" },
      ],
      take: limitNumber,
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
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
            reviews: true,
          },
        },
      },
    });

    const result = {
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        totalRevenue: course.totalRevenue,
        bestseller: course.bestseller,
        bestsellerRank: courses.indexOf(course) + 1,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
        },
        category: course.category,
        publishedAt: course.publishedAt,
      })),
      totalCount: courses.length,
    };

    await redisService.setJSON(cacheKey, result, { ex: 900 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Bestseller courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_BESTSELLER_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve bestseller courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getCategories = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { includeSubcategories = "true", includeStats = "false" } = req.query;

    const cacheKey = `categories:${includeSubcategories}:${includeStats}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Categories retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const includeSubcats = includeSubcategories === "true";
    const includeStatistics = includeStats === "true";

    const categories = await prisma.category.findMany({
      where: {
        isActive: true,
        parentId: null,
      },
      orderBy: { order: "asc" },
      include: {
        subcategories: includeSubcats
          ? {
              where: { isActive: true },
              orderBy: { order: "asc" },
              include: includeStatistics
                ? {
                    _count: {
                      select: {
                        courses: {
                          where: { status: "PUBLISHED" },
                        },
                      },
                    },
                  }
                : false,
            }
          : false,
        _count: includeStatistics
          ? {
              select: {
                courses: {
                  where: { status: "PUBLISHED" },
                },
              },
            }
          : false,
      },
    });

    const result = {
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        image: category.image,
        icon: category.icon,
        color: category.color,
        order: category.order,
        courseCount: includeStatistics
          ? category._count?.courses || 0
          : undefined,
        subcategories: includeSubcats
          ? category.subcategories.map((subcat) => ({
              id: subcat.id,
              name: subcat.name,
              slug: subcat.slug,
              description: subcat.description,
              image: subcat.image,
              icon: subcat.icon,
              color: subcat.color,
              order: subcat.order,
              courseCount: includeStatistics
                ? subcat._count?.courses || 0
                : undefined,
            }))
          : undefined,
      })),
      totalCategories: categories.length,
      totalSubcategories: includeSubcats
        ? categories.reduce(
            (sum, cat) => sum + (cat.subcategories?.length || 0),
            0
          )
        : undefined,
    };

    await redisService.setJSON(cacheKey, result, { ex: 1800 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Categories retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_CATEGORIES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve categories. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getCategoryDetails = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { categorySlug } = req.params;

    const cacheKey = `category:details:${categorySlug}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Category details retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const category = await prisma.category.findUnique({
      where: { slug: categorySlug },
      include: {
        subcategories: {
          where: { isActive: true },
          orderBy: { order: "asc" },
          include: {
            _count: {
              select: {
                courses: {
                  where: { status: "PUBLISHED" },
                },
              },
            },
          },
        },
        _count: {
          select: {
            courses: {
              where: { status: "PUBLISHED" },
            },
          },
        },
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        code: "CATEGORY_NOT_FOUND",
      });
    }

    const [featuredCourses, popularCourses, topInstructors, courseLevels] =
      await Promise.all([
        prisma.course.findMany({
          where: {
            categoryId: category.id,
            status: "PUBLISHED",
            featured: true,
          },
          orderBy: { averageRating: "desc" },
          take: 6,
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
            _count: {
              select: {
                enrollments: true,
              },
            },
          },
        }),
        prisma.course.findMany({
          where: {
            categoryId: category.id,
            status: "PUBLISHED",
          },
          orderBy: { totalEnrollments: "desc" },
          take: 6,
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
            _count: {
              select: {
                enrollments: true,
              },
            },
          },
        }),
        prisma.instructor.findMany({
          where: {
            courses: {
              some: {
                categoryId: category.id,
                status: "PUBLISHED",
              },
            },
          },
          orderBy: { totalStudents: "desc" },
          take: 8,
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                profileImage: true,
              },
            },
          },
        }),
        prisma.course.groupBy({
          by: ["level"],
          where: {
            categoryId: category.id,
            status: "PUBLISHED",
          },
          _count: { level: true },
        }),
      ]);

    const result = {
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        image: category.image,
        icon: category.icon,
        color: category.color,
        order: category.order,
        totalCourses: category._count.courses,
        subcategories: category.subcategories.map((subcat) => ({
          id: subcat.id,
          name: subcat.name,
          slug: subcat.slug,
          description: subcat.description,
          image: subcat.image,
          icon: subcat.icon,
          color: subcat.color,
          order: subcat.order,
          courseCount: subcat._count.courses,
        })),
      },
      featuredCourses: featuredCourses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        duration: course.duration,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
        },
      })),
      popularCourses: popularCourses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        duration: course.duration,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
        },
      })),
      topInstructors: topInstructors.map((instructor) => ({
        id: instructor.id,
        name: `${instructor.user.firstName} ${instructor.user.lastName}`,
        profileImage: instructor.user.profileImage,
        rating: instructor.rating,
        totalStudents: instructor.totalStudents,
        totalCourses: instructor.totalCourses,
        isVerified: instructor.isVerified,
      })),
      stats: {
        totalCourses: category._count.courses,
        courseLevels: courseLevels.map((level) => ({
          level: level.level,
          count: level._count.level,
          percentage: Math.round(
            (level._count.level / category._count.courses) * 100
          ),
        })),
        totalSubcategories: category.subcategories.length,
        totalInstructors: topInstructors.length,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 1200 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Category details retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_CATEGORY_DETAILS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      categorySlug: req.params.categorySlug,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve category details. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getCourseDetails = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseSlug } = req.params;
    const userId = req.userAuthId;

    const cacheKey = `course:details:${courseSlug}:${userId || "anonymous"}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Course details retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const course = await prisma.course.findUnique({
      where: { slug: courseSlug },
      include: {
        instructor: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profileImage: true,
                bio: true,
                linkedinProfile: true,
                twitterProfile: true,
                website: true,
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
        subcategory: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        sections: {
          where: { isPublished: true },
          orderBy: { order: "asc" },
          include: {
            lessons: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                title: true,
                duration: true,
                order: true,
                isFree: true,
                isPreview: true,
                type: true,
              },
            },
            quizzes: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                title: true,
                duration: true,
                order: true,
                passingScore: true,
                maxAttempts: true,
              },
            },
            assignments: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                title: true,
                totalPoints: true,
                dueDate: true,
                order: true,
              },
            },
          },
        },
        faqs: {
          where: { isActive: true },
          orderBy: { order: "asc" },
        },
        _count: {
          select: {
            enrollments: true,
            reviews: true,
            wishlistItems: true,
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
      return res.status(403).json({
        success: false,
        message: "Course is not available",
        code: "COURSE_NOT_AVAILABLE",
      });
    }

    let isEnrolled = false;
    let isInWishlist = false;
    let isInCart = false;
    let userProgress = null;

    if (userId) {
      const [enrollment, wishlistItem, cartItem] = await Promise.all([
        prisma.enrollment.findUnique({
          where: {
            studentId_courseId: {
              studentId: userId,
              courseId: course.id,
            },
          },
          include: {
            courseProgress: true,
          },
        }),
        prisma.wishlistItem.findUnique({
          where: {
            studentId_courseId: {
              studentId: userId,
              courseId: course.id,
            },
          },
        }),
        prisma.cartItem.findUnique({
          where: {
            studentId_courseId: {
              studentId: userId,
              courseId: course.id,
            },
          },
        }),
      ]);

      isEnrolled = !!enrollment;
      isInWishlist = !!wishlistItem;
      isInCart = !!cartItem;

      if (enrollment?.courseProgress) {
        userProgress = {
          progressPercentage: enrollment.courseProgress.progressPercentage,
          completedItems: enrollment.courseProgress.completedItems,
          totalContentItems: enrollment.courseProgress.totalContentItems,
          lastActivityAt: enrollment.courseProgress.lastActivityAt,
          currentSectionId: enrollment.courseProgress.currentSectionId,
          currentLessonId: enrollment.courseProgress.currentLessonId,
          estimatedTimeLeft: enrollment.courseProgress.estimatedTimeLeft,
        };
      }
    }

    const recentReviews = await prisma.review.findMany({
      where: {
        courseId: course.id,
        isFlagged: false,
      },
      orderBy: [{ isVerified: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: {
        author: {
          select: {
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
        replies: {
          where: { isFlagged: false },
          orderBy: { createdAt: "desc" },
          take: 2,
          include: {
            author: {
              select: {
                firstName: true,
                lastName: true,
                profileImage: true,
                role: true,
              },
            },
          },
        },
      },
    });

    const ratingDistribution = await prisma.review.groupBy({
      by: ["rating"],
      where: {
        courseId: course.id,
        isFlagged: false,
      },
      _count: { rating: true },
    });

    const distributionMap = {};
    for (let i = 1; i <= 5; i++) {
      distributionMap[i] = 0;
    }
    ratingDistribution.forEach((item) => {
      distributionMap[item.rating] = item._count.rating;
    });

    const totalReviews = Object.values(distributionMap).reduce(
      (sum, count) => sum + count,
      0
    );

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
        price: course.price,
        discountPrice: course.discountPrice,
        originalPrice: course.originalPrice,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        totalQuizzes: course.totalQuizzes,
        totalAssignments: course.totalAssignments,
        language: course.language,
        subtitles: course.subtitles,
        requirements: course.requirements,
        tags: course.tags,
        keyPoints: course.keyPoints,
        learningOutcomes: course.learningOutcomes,
        targetAudience: course.targetAudience,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        totalReviews: course._count.reviews,
        totalWishlisted: course._count.wishlistItems,
        featured: course.featured,
        bestseller: course.bestseller,
        trending: course.trending,
        publishedAt: course.publishedAt,
        lastUpdated: course.lastUpdated,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          bio: course.instructor.user.bio,
          title: course.instructor.title,
          expertise: course.instructor.expertise,
          rating: course.instructor.rating,
          totalStudents: course.instructor.totalStudents,
          totalCourses: course.instructor.totalCourses,
          yearsExperience: course.instructor.yearsExperience,
          education: course.instructor.education,
          certifications: course.instructor.certifications,
          isVerified: course.instructor.isVerified,
          verificationBadge: course.instructor.verificationBadge,
          socialLinks: {
            linkedin: course.instructor.user.linkedinProfile,
            twitter: course.instructor.user.twitterProfile,
            website: course.instructor.user.website,
          },
        },
        category: course.category,
        subcategory: course.subcategory,
        curriculum: course.sections.map((section) => ({
          id: section.id,
          title: section.title,
          description: section.description,
          order: section.order,
          estimatedTime: section.estimatedTime,
          isFree: section.isFree,
          lessons: section.lessons,
          quizzes: section.quizzes,
          assignments: section.assignments,
          totalItems:
            section.lessons.length +
            section.quizzes.length +
            section.assignments.length,
        })),
        faqs: course.faqs,
        userInteraction: {
          isEnrolled,
          isInWishlist,
          isInCart,
          userProgress,
        },
        ratingDistribution: {
          5: distributionMap[5],
          4: distributionMap[4],
          3: distributionMap[3],
          2: distributionMap[2],
          1: distributionMap[1],
          total: totalReviews,
          percentages: {
            5:
              totalReviews > 0
                ? Math.round((distributionMap[5] / totalReviews) * 100)
                : 0,
            4:
              totalReviews > 0
                ? Math.round((distributionMap[4] / totalReviews) * 100)
                : 0,
            3:
              totalReviews > 0
                ? Math.round((distributionMap[3] / totalReviews) * 100)
                : 0,
            2:
              totalReviews > 0
                ? Math.round((distributionMap[2] / totalReviews) * 100)
                : 0,
            1:
              totalReviews > 0
                ? Math.round((distributionMap[1] / totalReviews) * 100)
                : 0,
          },
        },
        recentReviews: recentReviews.map((review) => ({
          id: review.id,
          title: review.title,
          content: review.content,
          rating: review.rating,
          pros: review.pros,
          cons: review.cons,
          isVerified: review.isVerified,
          helpfulCount: review.helpfulCount,
          author: {
            name: `${review.author.firstName} ${review.author.lastName}`,
            profileImage: review.author.profileImage,
          },
          replies: review.replies.map((reply) => ({
            id: reply.id,
            content: reply.content,
            author: {
              name: `${reply.author.firstName} ${reply.author.lastName}`,
              profileImage: reply.author.profileImage,
              isInstructor: reply.author.role === "INSTRUCTOR",
            },
            createdAt: reply.createdAt,
          })),
          createdAt: review.createdAt,
        })),
      },
    };

    const cacheTime = isEnrolled ? 300 : 900;
    await redisService.setJSON(cacheKey, result, { ex: cacheTime });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course details retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_COURSE_DETAILS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseSlug: req.params.courseSlug,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course details. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getRelatedCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseSlug } = req.params;
    const { limit = 6 } = req.query;
    const limitNumber = Math.min(parseInt(limit), 12);

    const cacheKey = `course:related:${courseSlug}:${limitNumber}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Related courses retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const currentCourse = await prisma.course.findUnique({
      where: { slug: courseSlug },
      select: {
        id: true,
        categoryId: true,
        subcategoryId: true,
        level: true,
        tags: true,
        instructorId: true,
      },
    });

    if (!currentCourse) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    const relatedCourses = await prisma.course.findMany({
      where: {
        AND: [
          { id: { not: currentCourse.id } },
          { status: "PUBLISHED" },
          {
            OR: [
              { categoryId: currentCourse.categoryId },
              { subcategoryId: currentCourse.subcategoryId },
              { instructorId: currentCourse.instructorId },
              { level: currentCourse.level },
              {
                tags: {
                  hasSome: currentCourse.tags || [],
                },
              },
            ],
          },
        ],
      },
      orderBy: [
        { averageRating: "desc" },
        { totalEnrollments: "desc" },
        { featured: "desc" },
      ],
      take: limitNumber * 2,
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
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
    });

    const scoredCourses = relatedCourses.map((course) => {
      let score = 0;

      if (course.categoryId === currentCourse.categoryId) score += 5;
      if (course.subcategoryId === currentCourse.subcategoryId) score += 3;
      if (course.instructorId === currentCourse.instructorId) score += 4;
      if (course.level === currentCourse.level) score += 2;

      const sharedTags = course.tags.filter((tag) =>
        currentCourse.tags?.includes(tag)
      ).length;
      score += sharedTags * 1;

      score += course.averageRating * 0.5;
      score += Math.min(course.totalEnrollments / 1000, 2);

      return { ...course, relevanceScore: score };
    });

    const sortedRelatedCourses = scoredCourses
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limitNumber);

    const result = {
      courses: sortedRelatedCourses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        featured: course.featured,
        bestseller: course.bestseller,
        relevanceScore: course.relevanceScore,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
        },
        category: course.category,
        publishedAt: course.publishedAt,
      })),
      totalCount: sortedRelatedCourses.length,
      baseCourse: {
        id: currentCourse.id,
        slug: courseSlug,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 1200 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Related courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_RELATED_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseSlug: req.params.courseSlug,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve related courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getCourseReviews = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseSlug } = req.params;
    const {
      page = 1,
      limit = 10,
      rating,
      sortBy = "newest",
      verified = false,
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `course:reviews:${courseSlug}:${Buffer.from(
      JSON.stringify({
        page: pageNumber,
        limit: pageSize,
        rating,
        sortBy,
        verified,
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

    const course = await prisma.course.findUnique({
      where: { slug: courseSlug },
      select: { id: true, title: true },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    const where = {
      courseId: course.id,
      isFlagged: false,
    };

    if (rating) {
      where.rating = parseInt(rating);
    }

    if (verified === "true") {
      where.isVerified = true;
    }

    let orderBy = {};
    switch (sortBy) {
      case "oldest":
        orderBy = { createdAt: "asc" };
        break;
      case "highest":
        orderBy = { rating: "desc" };
        break;
      case "lowest":
        orderBy = { rating: "asc" };
        break;
      case "helpful":
        orderBy = { helpfulCount: "desc" };
        break;
      default:
        orderBy = [{ isVerified: "desc" }, { createdAt: "desc" }];
    }

    const [reviews, total] = await Promise.all([
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
          replies: {
            where: { isFlagged: false },
            orderBy: { createdAt: "desc" },
            include: {
              author: {
                select: {
                  firstName: true,
                  lastName: true,
                  profileImage: true,
                  role: true,
                },
              },
            },
          },
        },
      }),
      prisma.review.count({ where }),
    ]);

    const result = {
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
        author: {
          name: `${review.author.firstName} ${review.author.lastName}`,
          profileImage: review.author.profileImage,
        },
        replies: review.replies.map((reply) => ({
          id: reply.id,
          content: reply.content,
          likes: reply.likes,
          author: {
            name: `${reply.author.firstName} ${reply.author.lastName}`,
            profileImage: reply.author.profileImage,
            isInstructor: reply.author.role === "INSTRUCTOR",
          },
          createdAt: reply.createdAt,
        })),
        createdAt: review.createdAt,
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
        rating,
        sortBy,
        verified: verified === "true",
      },
      course: {
        id: course.id,
        title: course.title,
        slug: courseSlug,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

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
    console.error(`GET_COURSE_REVIEWS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseSlug: req.params.courseSlug,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course reviews. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getRecommendedCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = req.userAuthId;
    const { limit = 8 } = req.query;
    const limitNumber = Math.min(parseInt(limit), 20);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required for personalized recommendations",
        code: "AUTH_REQUIRED",
      });
    }

    const cacheKey = `recommendations:user:${userId}:${limitNumber}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Recommended courses retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const userProfile = await prisma.student.findUnique({
      where: { userId },
      include: {
        enrollments: {
          include: {
            course: {
              select: {
                id: true,
                categoryId: true,
                subcategoryId: true,
                level: true,
                tags: true,
              },
            },
          },
        },
        wishlist: {
          include: {
            course: {
              select: {
                id: true,
                categoryId: true,
                subcategoryId: true,
                level: true,
                tags: true,
              },
            },
          },
        },
      },
    });

    if (!userProfile) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    const enrolledCourseIds = userProfile.enrollments.map((e) => e.course.id);
    const wishlistedCourseIds = userProfile.wishlist.map((w) => w.course.id);
    const excludedCourseIds = [...enrolledCourseIds, ...wishlistedCourseIds];

    const userCategories = [
      ...userProfile.enrollments.map((e) => e.course.categoryId),
      ...userProfile.wishlist.map((w) => w.course.categoryId),
    ];
    const categoryFrequency = {};
    userCategories.forEach((catId) => {
      categoryFrequency[catId] = (categoryFrequency[catId] || 0) + 1;
    });

    const userTags = [
      ...userProfile.enrollments.flatMap((e) => e.course.tags || []),
      ...userProfile.wishlist.flatMap((w) => w.course.tags || []),
    ];
    const tagFrequency = {};
    userTags.forEach((tag) => {
      tagFrequency[tag] = (tagFrequency[tag] || 0) + 1;
    });

    const userLevels = [
      ...userProfile.enrollments.map((e) => e.course.level),
      ...userProfile.wishlist.map((w) => w.course.level),
    ];
    const levelFrequency = {};
    userLevels.forEach((level) => {
      levelFrequency[level] = (levelFrequency[level] || 0) + 1;
    });

    const topCategories = Object.entries(categoryFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([catId]) => catId);

    const topTags = Object.entries(tagFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag]) => tag);

    const preferredLevel = Object.entries(levelFrequency).sort(
      ([, a], [, b]) => b - a
    )[0]?.[0];

    const recommendations = await prisma.course.findMany({
      where: {
        AND: [
          { status: "PUBLISHED" },
          { id: { notIn: excludedCourseIds } },
          {
            OR: [
              { categoryId: { in: topCategories } },
              { tags: { hasSome: topTags } },
              { level: preferredLevel },
              { featured: true },
            ],
          },
        ],
      },
      orderBy: [
        { averageRating: "desc" },
        { totalEnrollments: "desc" },
        { featured: "desc" },
      ],
      take: limitNumber * 2,
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
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
    });

    const scoredRecommendations = recommendations.map((course) => {
      let score = 0;

      if (topCategories.includes(course.categoryId)) {
        const categoryRank = topCategories.indexOf(course.categoryId);
        score += (3 - categoryRank) * 10;
      }

      const sharedTags = course.tags.filter((tag) =>
        topTags.includes(tag)
      ).length;
      score += sharedTags * 5;

      if (course.level === preferredLevel) score += 8;

      if (course.featured) score += 5;
      if (course.bestseller) score += 3;
      if (course.trending) score += 2;

      score += course.averageRating * 2;
      score += Math.min(course.totalEnrollments / 1000, 5);

      return { ...course, recommendationScore: score };
    });

    const finalRecommendations = scoredRecommendations
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .slice(0, limitNumber);

    const result = {
      courses: finalRecommendations.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        featured: course.featured,
        bestseller: course.bestseller,
        recommendationScore: course.recommendationScore,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
        },
        category: course.category,
        publishedAt: course.publishedAt,
      })),
      totalCount: finalRecommendations.length,
      recommendationBasis: {
        topCategories,
        topTags: topTags.slice(0, 3),
        preferredLevel,
        enrolledCourses: enrolledCourseIds.length,
        wishlistedCourses: wishlistedCourseIds.length,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 1800 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Recommended courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_RECOMMENDED_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve recommended courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getPopularCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { limit = 8, period = "all_time", category, level } = req.query;
    const limitNumber = Math.min(parseInt(limit), 20);

    const cacheKey = `courses:popular:${period}:${category || "all"}:${
      level || "all"
    }:${limitNumber}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Popular courses retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const where = {
      status: "PUBLISHED",
    };

    if (category) {
      where.category = { slug: category };
    }

    if (level) {
      where.level = level.toUpperCase();
    }

    if (period !== "all_time") {
      const periodDays = {
        "7_days": 7,
        "30_days": 30,
        "90_days": 90,
        "6_months": 180,
        "1_year": 365,
      };

      if (periodDays[period]) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - periodDays[period]);
        where.publishedAt = { gte: startDate };
      }
    }

    const courses = await prisma.course.findMany({
      where,
      orderBy: [
        { totalEnrollments: "desc" },
        { averageRating: "desc" },
        { totalRatings: "desc" },
        { featured: "desc" },
      ],
      take: limitNumber,
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
        _count: {
          select: {
            enrollments: true,
            reviews: true,
          },
        },
      },
    });

    const result = {
      courses: courses.map((course, index) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        language: course.language,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        totalReviews: course._count.reviews,
        featured: course.featured,
        bestseller: course.bestseller,
        trending: course.trending,
        popularityRank: index + 1,
        keyPoints: course.keyPoints.slice(0, 3),
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
          isVerified: course.instructor.isVerified,
        },
        category: course.category,
        subcategory: course.subcategory,
        publishedAt: course.publishedAt,
      })),
      totalCount: courses.length,
      period: period,
      filters: {
        category,
        level,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 1200 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Popular courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_POPULAR_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      query: req.query,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve popular courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getInstructorCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { instructorId } = req.params;
    const {
      page = 1,
      limit = 8,
      sortBy = "newest",
      includeStats = "false",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 20);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `instructor:courses:${instructorId}:${Buffer.from(
      JSON.stringify({
        page: pageNumber,
        limit: pageSize,
        sortBy,
        includeStats,
      })
    ).toString("base64")}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Instructor courses retrieved successfully",
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
      where: { id: instructorId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            profileImage: true,
            bio: true,
          },
        },
      },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    let orderBy = {};
    switch (sortBy) {
      case "oldest":
        orderBy = { publishedAt: "asc" };
        break;
      case "rating":
        orderBy = { averageRating: "desc" };
        break;
      case "enrollments":
        orderBy = { totalEnrollments: "desc" };
        break;
      case "price_low":
        orderBy = { price: "asc" };
        break;
      case "price_high":
        orderBy = { price: "desc" };
        break;
      default:
        orderBy = { publishedAt: "desc" };
    }

    const where = {
      instructorId: instructorId,
      status: "PUBLISHED",
    };

    const [courses, total, stats] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
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
          _count: {
            select: {
              enrollments: true,
              reviews: true,
            },
          },
        },
      }),
      prisma.course.count({ where }),
      includeStats === "true"
        ? Promise.all([
            prisma.course.aggregate({
              where,
              _avg: { averageRating: true },
              _sum: { totalEnrollments: true, totalRevenue: true },
            }),
            prisma.course.groupBy({
              by: ["level"],
              where,
              _count: { level: true },
            }),
            prisma.course.groupBy({
              by: ["categoryId"],
              where,
              _count: { categoryId: true },
            }),
          ])
        : [null, null, null],
    ]);

    const result = {
      instructor: {
        id: instructor.id,
        name: `${instructor.user.firstName} ${instructor.user.lastName}`,
        profileImage: instructor.user.profileImage,
        bio: instructor.user.bio,
        title: instructor.title,
        expertise: instructor.expertise,
        rating: instructor.rating,
        totalStudents: instructor.totalStudents,
        totalCourses: instructor.totalCourses,
        totalRevenue: instructor.totalRevenue,
        yearsExperience: instructor.yearsExperience,
        education: instructor.education,
        certifications: instructor.certifications,
        isVerified: instructor.isVerified,
        verificationBadge: instructor.verificationBadge,
      },
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        previewVideo: course.previewVideo,
        price: course.price,
        discountPrice: course.discountPrice,
        originalPrice: course.originalPrice,
        level: course.level,
        duration: course.duration,
        totalLessons: course.totalLessons,
        language: course.language,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course._count.enrollments,
        totalReviews: course._count.reviews, // ✅ Fixed
        featured: course.featured,
        bestseller: course.bestseller,
        trending: course.trending,
        tags: course.tags,
        keyPoints: course.keyPoints.slice(0, 3),
        category: course.category,
        subcategory: course.subcategory,
        publishedAt: course.publishedAt,
        lastUpdated: course.lastUpdated,
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      stats:
        includeStats === "true" && stats[0]
          ? {
              averageRating: stats[0]._avg.averageRating || 0,
              totalEnrollments: stats[0]._sum.totalEnrollments || 0,
              totalRevenue: stats[0]._sum.totalRevenue || 0,
              levelDistribution: stats[1].map((level) => ({
                level: level.level,
                count: level._count.level,
                percentage: Math.round((level._count.level / total) * 100),
              })),
              categoryDistribution: stats[2].map((cat) => ({
                categoryId: cat.categoryId,
                count: cat._count.categoryId,
                percentage: Math.round((cat._count.categoryId / total) * 100),
              })),
            }
          : null,
      sortBy,
    };

    await redisService.setJSON(cacheKey, result, { ex: 900 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Instructor courses retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_INSTRUCTOR_COURSES_ERROR [${requestId}]:`, {
      // ✅ Fixed
      error: error.message,
      stack: error.stack,
      instructorId: req.params.instructorId,
      query: req.query,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve instructor courses. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export {
  getCoursesByCategory,
  getFilterOptions,
  getFeaturedCourses,
  getTrendingCourses,
  getBestsellerCourses,
  getCategories,
  getCategoryDetails,
  getCourseDetails,
  getRelatedCourses,
  getCourseReviews,
  getRecommendedCourses,
  getPopularCourses,
  getInstructorCourses,
  getCoursePlaceholder,
  getFreeCourses,
  getCatalogStats,
};
