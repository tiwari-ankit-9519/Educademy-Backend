import { PrismaClient } from "@prisma/client";
import redisService from "../../utils/redis.js";
import emailService from "../../utils/emailService.js";
import notificationService from "../../utils/notificationservice.js";
import asyncHandler from "express-async-handler";
import { deleteFromCloudinary } from "../../config/upload.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `course_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const generateCourseSlug = (title) => {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .trim();
};

const createCourse = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const {
      title,
      description,
      shortDescription,
      categoryId,
      subcategoryId,
      level,
      price,
      discountPrice,
      discountPercentage,
      language = "English",
      requirements = "[]",
      learningOutcomes = "[]",
      targetAudience = "[]",
      tags = "[]",
    } = req.body;

    if (
      !title ||
      !description ||
      !shortDescription ||
      !categoryId ||
      !level ||
      !price
    ) {
      if (req.file?.path) {
        setImmediate(() =>
          deleteFromCloudinary(
            req.file.path.split("/").slice(-2).join("/").split(".")[0],
            "image"
          )
        );
      }
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        required: [
          "title",
          "description",
          "shortDescription",
          "categoryId",
          "level",
          "price",
        ],
        code: "VALIDATION_ERROR",
      });
    }

    const parseArrayField = (field) => {
      if (Array.isArray(field)) return field;
      if (typeof field === "string") {
        try {
          const parsed = JSON.parse(field);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    };

    const [
      parsedRequirements,
      parsedLearningOutcomes,
      parsedTargetAudience,
      parsedTags,
    ] = [
      parseArrayField(requirements),
      parseArrayField(learningOutcomes),
      parseArrayField(targetAudience),
      parseArrayField(tags),
    ];

    const priceFloat = parseFloat(price);
    if (priceFloat < 0) {
      if (req.file?.path) {
        setImmediate(() =>
          deleteFromCloudinary(
            req.file.path.split("/").slice(-2).join("/").split(".")[0],
            "image"
          )
        );
      }
      return res.status(400).json({
        success: false,
        message: "Price cannot be negative",
        code: "INVALID_PRICE",
      });
    }

    let finalDiscountPrice = null;
    let finalDiscountPercentage = null;

    if (discountPrice) {
      finalDiscountPrice = parseFloat(discountPrice);
      if (finalDiscountPrice >= priceFloat) {
        if (req.file?.path) {
          setImmediate(() =>
            deleteFromCloudinary(
              req.file.path.split("/").slice(-2).join("/").split(".")[0],
              "image"
            )
          );
        }
        return res.status(400).json({
          success: false,
          message: "Discount price must be less than original price",
          code: "INVALID_DISCOUNT",
        });
      }
    } else if (discountPercentage) {
      const discountPercent = parseFloat(discountPercentage);
      if (discountPercent <= 0 || discountPercent >= 100) {
        if (req.file?.path) {
          setImmediate(() =>
            deleteFromCloudinary(
              req.file.path.split("/").slice(-2).join("/").split(".")[0],
              "image"
            )
          );
        }
        return res.status(400).json({
          success: false,
          message: "Discount percentage must be between 1 and 99",
          code: "INVALID_DISCOUNT_PERCENTAGE",
        });
      }
      finalDiscountPercentage = discountPercent;
      finalDiscountPrice = priceFloat * (1 - finalDiscountPercentage / 100);
    }

    const baseSlug = generateCourseSlug(title);
    const timestamp = Date.now();
    const slug = `${baseSlug}-${timestamp}`;

    const validationQueries = [
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true, totalCourses: true },
      }),
      prisma.category.findUnique({
        where: { id: categoryId },
        select: { id: true, name: true, slug: true },
      }),
    ];

    if (subcategoryId) {
      validationQueries.push(
        prisma.category.findUnique({
          where: { id: subcategoryId, parentId: categoryId },
          select: { id: true, name: true, slug: true },
        })
      );
    }

    const results = await Promise.all(validationQueries);
    const [instructor, category, subcategory] = results;

    if (!instructor) {
      if (req.file?.path) {
        setImmediate(() =>
          deleteFromCloudinary(
            req.file.path.split("/").slice(-2).join("/").split(".")[0],
            "image"
          )
        );
      }
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    if (!category) {
      if (req.file?.path) {
        setImmediate(() =>
          deleteFromCloudinary(
            req.file.path.split("/").slice(-2).join("/").split(".")[0],
            "image"
          )
        );
      }
      return res.status(404).json({
        success: false,
        message: "Category not found",
        code: "CATEGORY_NOT_FOUND",
      });
    }

    if (subcategoryId && !subcategory) {
      if (req.file?.path) {
        setImmediate(() =>
          deleteFromCloudinary(
            req.file.path.split("/").slice(-2).join("/").split(".")[0],
            "image"
          )
        );
      }
      return res.status(404).json({
        success: false,
        message: "Subcategory not found or doesn't belong to selected category",
        code: "SUBCATEGORY_NOT_FOUND",
      });
    }

    const thumbnail = req.file?.path || null;

    const courseData = {
      title,
      slug,
      description,
      shortDescription,
      categoryId,
      subcategoryId,
      level,
      price: priceFloat,
      discountPrice: finalDiscountPrice,
      discountPercentage: finalDiscountPercentage,
      originalPrice: priceFloat,
      language,
      requirements: parsedRequirements,
      learningOutcomes: parsedLearningOutcomes,
      targetAudience: parsedTargetAudience,
      tags: parsedTags,
      thumbnail,
      duration: 0,
      status: "DRAFT",
      instructorId: instructor.id,
      sectionsCount: 0,
      publishedSectionsCount: 0,
      enrollmentsCount: 0,
      reviewsCount: 0,
    };

    const course = await prisma.course.create({
      data: courseData,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        shortDescription: true,
        thumbnail: true,
        price: true,
        discountPrice: true,
        discountPercentage: true,
        level: true,
        status: true,
        language: true,
        requirements: true,
        learningOutcomes: true,
        targetAudience: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const instructorData = await prisma.instructor.findUnique({
      where: { id: instructor.id },
      select: {
        id: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
      },
    });

    setImmediate(async () => {
      try {
        await Promise.all([
          prisma.instructor.update({
            where: { id: instructor.id },
            data: { totalCourses: instructor.totalCourses + 1 },
          }),
          redisService.del(`courses:${req.userAuthId}`),
          redisService.delPattern(`courses:${req.userAuthId}:*`),
          redisService.del(`instructor:${req.userAuthId}`),
        ]);
      } catch (error) {
        console.warn("Background operations failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Course created successfully",
      data: {
        course: {
          ...course,
          category,
          subcategory,
          instructor: {
            id: instructorData.id,
            name: `${instructorData.user.firstName} ${instructorData.user.lastName}`,
            profileImage: instructorData.user.profileImage,
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
    if (req.file?.path) {
      setImmediate(() =>
        deleteFromCloudinary(
          req.file.path.split("/").slice(-2).join("/").split(".")[0],
          "image"
        )
      );
    }

    console.error(`CREATE_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      body: req.body,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to create course. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 10,
      status,
      level,
      categoryId,
      search,
      sortBy = "updatedAt",
      sortOrder = "desc",
      cursor,
      useCursor = "true",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const shouldUseCursor = useCursor === "true";

    const cacheKey = `courses:${req.userAuthId}:${
      shouldUseCursor ? "cursor" : "offset"
    }:${pageSize}:${status || ""}:${level || ""}:${categoryId || ""}:${
      search || ""
    }:${sortBy}:${sortOrder}:${cursor || page}`;

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
        console.warn("Cache parse error, invalidating cache:", parseError);
        await redisService.del(cacheKey);
      }
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: req.userAuthId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    let whereClause = {
      instructorId: instructor.id,
      status: {
        not: "ARCHIVED",
      },
    };

    if (status) whereClause.status = status;
    if (level) whereClause.level = level;
    if (categoryId) whereClause.categoryId = categoryId;
    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { shortDescription: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
        { id: { equals: search } },
        { id: { contains: search, mode: "insensitive" } },
      ];
    }

    if (shouldUseCursor && cursor) {
      try {
        const cursorData = JSON.parse(Buffer.from(cursor, "base64").toString());

        if (sortBy === "updatedAt") {
          whereClause.updatedAt =
            sortOrder === "desc"
              ? { lt: new Date(cursorData.updatedAt) }
              : { gt: new Date(cursorData.updatedAt) };
        } else if (sortBy === "createdAt") {
          whereClause.createdAt =
            sortOrder === "desc"
              ? { lt: new Date(cursorData.createdAt) }
              : { gt: new Date(cursorData.createdAt) };
        } else if (sortBy === "title") {
          whereClause.title =
            sortOrder === "desc"
              ? { lt: cursorData.title }
              : { gt: cursorData.title };
        } else if (sortBy === "price") {
          whereClause.price =
            sortOrder === "desc"
              ? { lt: cursorData.price }
              : { gt: cursorData.price };
        } else if (sortBy === "averageRating") {
          whereClause.averageRating =
            sortOrder === "desc"
              ? { lt: cursorData.averageRating }
              : { gt: cursorData.averageRating };
        } else if (sortBy === "totalEnrollments") {
          whereClause.totalEnrollments =
            sortOrder === "desc"
              ? { lt: cursorData.totalEnrollments }
              : { gt: cursorData.totalEnrollments };
        }
      } catch (error) {
        console.warn("Invalid cursor, falling back to first page");
      }
    }

    const validSortFields = {
      title: "title",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
      publishedAt: "publishedAt",
      price: "price",
      averageRating: "averageRating",
      totalEnrollments: "totalEnrollments",
    };

    const orderBy = {};
    const sortField = validSortFields[sortBy] || "updatedAt";
    orderBy[sortField] = sortOrder === "asc" ? "asc" : "desc";

    const skip = shouldUseCursor ? 0 : (pageNumber - 1) * pageSize;
    const take = shouldUseCursor ? pageSize + 1 : pageSize;

    const [courses, total, summary] = await Promise.all([
      prisma.course.findMany({
        where: whereClause,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          title: true,
          slug: true,
          shortDescription: true,
          thumbnail: true,
          price: true,
          discountPrice: true,
          level: true,
          status: true,
          language: true,
          duration: true,
          averageRating: true,
          totalRatings: true,
          totalEnrollments: true,
          totalRevenue: true,
          featured: true,
          bestseller: true,
          trending: true,
          lastUpdated: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
          reviewSubmittedAt: true,
          rejectionReason: true,
          sectionsCount: true,
          publishedSectionsCount: true,
          enrollmentsCount: true,
          reviewsCount: true,
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
        },
      }),
      shouldUseCursor
        ? Promise.resolve(null)
        : prisma.course.count({ where: whereClause }),
      prisma.course.groupBy({
        by: ["status"],
        where: {
          instructorId: instructor.id,
          status: {
            not: "ARCHIVED",
          },
        },
        _count: { status: true },
      }),
    ]);

    let hasMore = false;
    let nextCursor = null;

    if (shouldUseCursor) {
      hasMore = courses.length > pageSize;
      if (hasMore) {
        courses.pop();
        const lastCourse = courses[courses.length - 1];
        if (lastCourse) {
          const cursorData = {
            id: lastCourse.id,
            [sortField]: lastCourse[sortField],
          };
          nextCursor = Buffer.from(JSON.stringify(cursorData)).toString(
            "base64"
          );
        }
      }
    }

    const summaryMap = summary.reduce((acc, item) => {
      const statusKey = item.status.toLowerCase().replace("_", "") + "Courses";
      acc[statusKey] = item._count.status;
      return acc;
    }, {});

    const result = {
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        price: parseFloat(course.price) || 0,
        discountPrice: course.discountPrice
          ? parseFloat(course.discountPrice)
          : null,
        level: course.level,
        status: course.status,
        language: course.language,
        duration: course.duration,
        averageRating: parseFloat(course.averageRating) || 0,
        totalRatings: course.totalRatings,
        totalEnrollments: course.totalEnrollments,
        totalRevenue: parseFloat(course.totalRevenue) || 0,
        featured: course.featured,
        bestseller: course.bestseller,
        trending: course.trending,
        category: course.category,
        subcategory: course.subcategory,
        sectionsCount: course.sectionsCount || 0,
        enrollmentsCount: course.enrollmentsCount || 0,
        reviewsCount: course.reviewsCount || 0,
        publishedSections: course.publishedSectionsCount || 0,
        lastUpdated: course.lastUpdated,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        publishedAt: course.publishedAt,
        reviewSubmittedAt: course.reviewSubmittedAt,
        rejectionReason: course.rejectionReason,
      })),
      pagination: shouldUseCursor
        ? {
            limit: pageSize,
            hasMore,
            nextCursor,
            useCursor: true,
          }
        : {
            page: pageNumber,
            limit: pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
            hasNext: skip + pageSize < total,
            hasPrev: pageNumber > 1,
            useCursor: false,
          },
      summary: {
        totalCourses: shouldUseCursor ? null : total,
        draftCourses: summaryMap.draftcourses || 0,
        underReviewCourses: summaryMap.underreviewcourses || 0,
        publishedCourses: summaryMap.publishedcourses || 0,
        rejectedCourses: summaryMap.rejectedcourses || 0,
      },
    };

    try {
      await redisService.setex(cacheKey, 120, JSON.stringify(result));
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
    console.error(`GET_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
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

const getCourse = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const cacheKey = `course:${courseId}:instructor:${req.userAuthId}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Course retrieved successfully",
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
      where: { userId: req.userAuthId },
      select: { id: true },
    });

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId: instructor.id,
      },
      include: {
        instructor: {
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
          include: {
            lessons: {
              select: {
                id: true,
                title: true,
                duration: true,
                type: true,
                order: true,
                isFree: true,
                isPreview: true,
              },
              orderBy: { order: "asc" },
            },
            quizzes: {
              select: {
                id: true,
                title: true,
                duration: true,
                order: true,
              },
              orderBy: { order: "asc" },
            },
            assignments: {
              select: {
                id: true,
                title: true,
                totalPoints: true,
                order: true,
                dueDate: true,
              },
              orderBy: { order: "asc" },
            },
          },
          orderBy: { order: "asc" },
        },
        _count: {
          select: {
            enrollments: true,
            reviews: true,
            sections: true,
          },
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found or you don't have permission to access it",
        code: "COURSE_NOT_FOUND",
      });
    }

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
        status: course.status,
        language: course.language,
        subtitles: course.subtitles,
        requirements: course.requirements,
        learningOutcomes: course.learningOutcomes,
        targetAudience: course.targetAudience,
        tags: course.tags,
        keyPoints: course.keyPoints,
        duration: course.duration,
        totalLessons: course.totalLessons,
        totalQuizzes: course.totalQuizzes,
        totalAssignments: course.totalAssignments,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        ratingDistribution: course.ratingDistribution,
        totalEnrollments: course.totalEnrollments,
        totalRevenue: course.totalRevenue,
        completionRate: course.completionRate,
        featured: course.featured,
        bestseller: course.bestseller,
        trending: course.trending,
        category: course.category,
        subcategory: course.subcategory,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          email: course.instructor.user.email,
          profileImage: course.instructor.user.profileImage,
        },
        sections: course.sections.map((section) => ({
          id: section.id,
          title: section.title,
          description: section.description,
          order: section.order,
          isPublished: section.isPublished,
          isRequired: section.isRequired,
          isFree: section.isFree,
          estimatedTime: section.estimatedTime,
          lessons: section.lessons,
          quizzes: section.quizzes,
          assignments: section.assignments,
          contentCount:
            section.lessons.length +
            section.quizzes.length +
            section.assignments.length,
        })),
        enrollmentsCount: course._count.enrollments,
        reviewsCount: course._count.reviews,
        sectionsCount: course._count.sections,
        publishedSections: course.sections.filter((s) => s.isPublished).length,
        lastUpdated: course.lastUpdated,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        publishedAt: course.publishedAt,
        reviewSubmittedAt: course.reviewSubmittedAt,
        reviewerId: course.reviewerId,
        reviewerFeedback: course.reviewerFeedback,
        rejectionReason: course.rejectionReason,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

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
      userId: req.userAuthId,
      courseId: req.params.courseId,
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

const updateCourse = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const updateData = req.body;

    if (!courseId) {
      if (req.file && req.file.path) {
        try {
          const publicId = req.file.path
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error("Error deleting uploaded thumbnail:", deleteError);
        }
      }

      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: req.userAuthId },
      select: { id: true },
    });

    const existingCourse = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId: instructor.id,
      },
      select: {
        id: true,
        status: true,
        title: true,
        slug: true,
        thumbnail: true,
        price: true,
      },
    });

    if (!existingCourse) {
      if (req.file && req.file.path) {
        try {
          const publicId = req.file.path
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error("Error deleting uploaded thumbnail:", deleteError);
        }
      }

      return res.status(404).json({
        success: false,
        message: "Course not found or you don't have permission to update it",
        code: "COURSE_NOT_FOUND",
      });
    }

    if (
      existingCourse.status === "PUBLISHED" &&
      updateData.status !== "ARCHIVED"
    ) {
      if (req.file && req.file.path) {
        try {
          const publicId = req.file.path
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error("Error deleting uploaded thumbnail:", deleteError);
        }
      }

      return res.status(403).json({
        success: false,
        message:
          "Published courses cannot be edited. Please create a new version.",
        code: "COURSE_PUBLISHED",
      });
    }

    if (existingCourse.status === "UNDER_REVIEW") {
      if (req.file && req.file.path) {
        try {
          const publicId = req.file.path
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error("Error deleting uploaded thumbnail:", deleteError);
        }
      }

      return res.status(403).json({
        success: false,
        message: "Course is currently under review and cannot be edited",
        code: "COURSE_UNDER_REVIEW",
      });
    }

    const allowedFields = [
      "title",
      "description",
      "shortDescription",
      "previewVideo",
      "introVideo",
      "price",
      "discountPrice",
      "discountPercentage",
      "level",
      "language",
      "subtitles",
      "requirements",
      "learningOutcomes",
      "targetAudience",
      "tags",
      "keyPoints",
      "categoryId",
      "subcategoryId",
    ];

    const filteredData = {};

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key) && value !== undefined) {
        // Parse JSON strings for array fields
        if (
          [
            "requirements",
            "learningOutcomes",
            "targetAudience",
            "tags",
            "keyPoints",
            "subtitles",
          ].includes(key)
        ) {
          try {
            filteredData[key] = Array.isArray(value)
              ? value
              : JSON.parse(value || "[]");
          } catch (parseError) {
            if (req.file && req.file.path) {
              try {
                const publicId = req.file.path
                  .split("/")
                  .slice(-2)
                  .join("/")
                  .split(".")[0];
                await deleteFromCloudinary(publicId, "image");
              } catch (deleteError) {
                console.error(
                  "Error deleting uploaded thumbnail:",
                  deleteError
                );
              }
            }

            return res.status(400).json({
              success: false,
              message: `Invalid JSON format in field: ${key}`,
              code: "INVALID_JSON_FORMAT",
            });
          }
        } else {
          filteredData[key] = value;
        }
      }
    }

    if (req.file) {
      filteredData.thumbnail = req.file.path;

      if (existingCourse.thumbnail) {
        try {
          const publicId = existingCourse.thumbnail
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error("Error deleting old thumbnail:", deleteError);
        }
      }
    }

    if (Object.keys(filteredData).length === 0) {
      if (req.file && req.file.path) {
        try {
          const publicId = req.file.path
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error("Error deleting uploaded thumbnail:", deleteError);
        }
      }

      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
        code: "NO_UPDATE_DATA",
      });
    }

    if (filteredData.price && parseFloat(filteredData.price) < 0) {
      if (req.file && req.file.path) {
        try {
          const publicId = req.file.path
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error("Error deleting uploaded thumbnail:", deleteError);
        }
      }

      return res.status(400).json({
        success: false,
        message: "Price cannot be negative",
        code: "INVALID_PRICE",
      });
    }

    const coursePrice = filteredData.price
      ? parseFloat(filteredData.price)
      : existingCourse.price;
    let finalDiscountPrice = null;
    let finalDiscountPercentage = null;

    if (filteredData.discountPrice !== undefined) {
      if (filteredData.discountPrice) {
        finalDiscountPrice = parseFloat(filteredData.discountPrice);
        filteredData.discountPercentage = null;
      } else {
        filteredData.discountPrice = null;
        filteredData.discountPercentage = null;
      }
    } else if (filteredData.discountPercentage !== undefined) {
      if (filteredData.discountPercentage) {
        if (
          filteredData.discountPercentage <= 0 ||
          filteredData.discountPercentage >= 100
        ) {
          if (req.file && req.file.path) {
            try {
              const publicId = req.file.path
                .split("/")
                .slice(-2)
                .join("/")
                .split(".")[0];
              await deleteFromCloudinary(publicId, "image");
            } catch (deleteError) {
              console.error("Error deleting uploaded thumbnail:", deleteError);
            }
          }

          return res.status(400).json({
            success: false,
            message: "Discount percentage must be between 1 and 99",
            code: "INVALID_DISCOUNT_PERCENTAGE",
          });
        }
        finalDiscountPercentage = parseFloat(filteredData.discountPercentage);
        finalDiscountPrice = coursePrice * (1 - finalDiscountPercentage / 100);
        filteredData.discountPrice = finalDiscountPrice;
      } else {
        filteredData.discountPrice = null;
        filteredData.discountPercentage = null;
      }
    }

    if (finalDiscountPrice && finalDiscountPrice >= coursePrice) {
      if (req.file && req.file.path) {
        try {
          const publicId = req.file.path
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error("Error deleting uploaded thumbnail:", deleteError);
        }
      }

      return res.status(400).json({
        success: false,
        message: "Discount price must be less than original price",
        code: "INVALID_DISCOUNT",
      });
    }

    if (filteredData.title && filteredData.title !== existingCourse.title) {
      const baseSlug = generateCourseSlug(filteredData.title);
      let slug = baseSlug;
      let counter = 1;

      while (
        await prisma.course.findFirst({
          where: { slug, id: { not: courseId } },
        })
      ) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      filteredData.slug = slug;
    }

    if (filteredData.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: filteredData.categoryId },
        select: { id: true },
      });

      if (!category) {
        if (req.file && req.file.path) {
          try {
            const publicId = req.file.path
              .split("/")
              .slice(-2)
              .join("/")
              .split(".")[0];
            await deleteFromCloudinary(publicId, "image");
          } catch (deleteError) {
            console.error("Error deleting uploaded thumbnail:", deleteError);
          }
        }

        return res.status(404).json({
          success: false,
          message: "Category not found",
          code: "CATEGORY_NOT_FOUND",
        });
      }
    }

    if (filteredData.subcategoryId) {
      const subcategory = await prisma.category.findUnique({
        where: {
          id: filteredData.subcategoryId,
          parentId: filteredData.categoryId || undefined,
        },
        select: { id: true },
      });

      if (!subcategory) {
        if (req.file && req.file.path) {
          try {
            const publicId = req.file.path
              .split("/")
              .slice(-2)
              .join("/")
              .split(".")[0];
            await deleteFromCloudinary(publicId, "image");
          } catch (deleteError) {
            console.error("Error deleting uploaded thumbnail:", deleteError);
          }
        }

        return res.status(404).json({
          success: false,
          message:
            "Subcategory not found or doesn't belong to selected category",
          code: "SUBCATEGORY_NOT_FOUND",
        });
      }
    }

    if (filteredData.price) {
      filteredData.price = parseFloat(filteredData.price);
    }

    filteredData.lastUpdated = new Date();

    const updatedCourse = await prisma.course.update({
      where: { id: courseId },
      data: filteredData,
      include: {
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
    });

    await redisService.delPattern(`course:${courseId}*`);
    await redisService.del(`instructor_courses:${req.userAuthId}`);
    await redisService.delPattern(`instructor_courses:${req.userAuthId}:*`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course updated successfully",
      data: {
        course: {
          id: updatedCourse.id,
          title: updatedCourse.title,
          slug: updatedCourse.slug,
          description: updatedCourse.description,
          shortDescription: updatedCourse.shortDescription,
          thumbnail: updatedCourse.thumbnail,
          previewVideo: updatedCourse.previewVideo,
          introVideo: updatedCourse.introVideo,
          price: updatedCourse.price,
          discountPrice: updatedCourse.discountPrice,
          discountPercentage: updatedCourse.discountPercentage,
          level: updatedCourse.level,
          status: updatedCourse.status,
          language: updatedCourse.language,
          subtitles: updatedCourse.subtitles,
          requirements: updatedCourse.requirements,
          learningOutcomes: updatedCourse.learningOutcomes,
          targetAudience: updatedCourse.targetAudience,
          tags: updatedCourse.tags,
          keyPoints: updatedCourse.keyPoints,
          category: updatedCourse.category,
          subcategory: updatedCourse.subcategory,
          instructor: {
            id: updatedCourse.instructor.id,
            name: `${updatedCourse.instructor.user.firstName} ${updatedCourse.instructor.user.lastName}`,
            profileImage: updatedCourse.instructor.user.profileImage,
          },
          lastUpdated: updatedCourse.lastUpdated,
          updatedAt: updatedCourse.updatedAt,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (req.file && req.file.path) {
      try {
        const publicId = req.file.path
          .split("/")
          .slice(-2)
          .join("/")
          .split(".")[0];
        await deleteFromCloudinary(publicId, "image");
      } catch (deleteError) {
        console.error("Error deleting uploaded thumbnail:", deleteError);
      }
    }

    console.error(`UPDATE_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
      body: req.body,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update course. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const validateCourseForSubmission = async (courseId) => {
  const cacheKey = `course_submission_validation:${courseId}`;

  try {
    const cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const [course, sections, lessons, quizzes, questions, assignments] =
      await Promise.all([
        prisma.course.findUnique({
          where: { id: courseId },
          select: {
            id: true,
            title: true,
            description: true,
            shortDescription: true,
            thumbnail: true,
            previewVideo: true,
            introVideo: true,
            learningOutcomes: true,
            requirements: true,
            targetAudience: true,
          },
        }),
        prisma.section.findMany({
          where: { courseId },
          select: {
            id: true,
            title: true,
            isPublished: true,
          },
        }),
        prisma.lesson.findMany({
          where: { section: { courseId } },
          select: {
            id: true,
            title: true,
            duration: true,
            type: true,
            content: true,
            videoUrl: true,
            sectionId: true,
          },
        }),
        prisma.quiz.findMany({
          where: { section: { courseId } },
          select: {
            id: true,
            title: true,
            sectionId: true,
          },
        }),
        prisma.question.findMany({
          where: { quiz: { section: { courseId } } },
          select: {
            id: true,
            content: true,
            type: true,
            correctAnswer: true,
            quizId: true,
          },
        }),
        prisma.assignment.findMany({
          where: { section: { courseId } },
          select: {
            id: true,
            title: true,
            description: true,
            instructions: true,
            sectionId: true,
          },
        }),
      ]);

    if (!course) {
      return {
        isValid: false,
        errors: ["Course not found"],
        warnings: [],
        stats: {},
      };
    }

    const validationErrors = [];
    const warnings = [];

    if (!course.title || course.title.length < 10) {
      validationErrors.push("Course title must be at least 10 characters long");
    }

    if (!course.description || course.description.length < 200) {
      validationErrors.push(
        "Course description must be at least 200 characters long"
      );
    }

    if (!course.shortDescription || course.shortDescription.length < 50) {
      validationErrors.push(
        "Short description must be at least 50 characters long"
      );
    }

    if (!course.thumbnail) {
      validationErrors.push("Course thumbnail is required");
    }

    if (!course.previewVideo && !course.introVideo) {
      warnings.push(
        "Consider adding a preview or intro video to attract more students"
      );
    }

    if (!course.learningOutcomes || course.learningOutcomes.length < 3) {
      validationErrors.push("At least 3 learning outcomes are required");
    }

    if (!course.requirements || course.requirements.length === 0) {
      warnings.push("Consider adding course requirements to set expectations");
    }

    if (!course.targetAudience || course.targetAudience.length === 0) {
      warnings.push(
        "Target audience helps students understand if the course is right for them"
      );
    }

    if (sections.length === 0) {
      validationErrors.push("Course must have at least one section");
    }

    const publishedSections = sections.filter((s) => s.isPublished);
    if (publishedSections.length === 0) {
      validationErrors.push("Course must have at least one published section");
    }

    const publishedSectionIds = new Set(publishedSections.map((s) => s.id));
    const sectionMap = new Map(sections.map((s) => [s.id, s]));

    const publishedLessons = lessons.filter((lesson) =>
      publishedSectionIds.has(lesson.sectionId)
    );
    const publishedQuizzes = quizzes.filter((quiz) =>
      publishedSectionIds.has(quiz.sectionId)
    );
    const publishedAssignments = assignments.filter((assignment) =>
      publishedSectionIds.has(assignment.sectionId)
    );

    const quizMap = new Map(publishedQuizzes.map((q) => [q.id, q]));
    const publishedQuestions = questions.filter((question) =>
      quizMap.has(question.quizId)
    );

    let totalDuration = 0;
    let totalLessons = publishedLessons.length;
    let hasVideoContent = false;

    const contentBySectionId = new Map();
    publishedSections.forEach((section) => {
      contentBySectionId.set(section.id, {
        lessons: [],
        quizzes: [],
        assignments: [],
      });
    });

    publishedLessons.forEach((lesson) => {
      const sectionContent = contentBySectionId.get(lesson.sectionId);
      if (sectionContent) {
        sectionContent.lessons.push(lesson);
        totalDuration += lesson.duration || 0;

        if (lesson.type === "VIDEO" && lesson.videoUrl) {
          hasVideoContent = true;
        }

        if (!lesson.content && !lesson.videoUrl) {
          const section = sectionMap.get(lesson.sectionId);
          validationErrors.push(
            `Lesson "${lesson.title}" in section "${section?.title}" must have content or video`
          );
        }
      }
    });

    publishedQuizzes.forEach((quiz) => {
      const sectionContent = contentBySectionId.get(quiz.sectionId);
      if (sectionContent) {
        sectionContent.quizzes.push({
          ...quiz,
          questions: publishedQuestions.filter((q) => q.quizId === quiz.id),
        });
      }
    });

    publishedAssignments.forEach((assignment) => {
      const sectionContent = contentBySectionId.get(assignment.sectionId);
      if (sectionContent) {
        sectionContent.assignments.push(assignment);
      }
    });

    contentBySectionId.forEach((content, sectionId) => {
      const section = sectionMap.get(sectionId);
      if (!section) return;

      if (
        content.lessons.length === 0 &&
        content.quizzes.length === 0 &&
        content.assignments.length === 0
      ) {
        validationErrors.push(
          `Section "${section.title}" must have at least one piece of content`
        );
      }

      content.quizzes.forEach((quiz) => {
        if (quiz.questions.length === 0) {
          validationErrors.push(
            `Quiz "${quiz.title}" must have at least one question`
          );
        }

        quiz.questions.forEach((question) => {
          if (!question.content) {
            validationErrors.push(
              `Quiz question in "${quiz.title}" is missing content`
            );
          }

          if (question.type !== "ESSAY" && !question.correctAnswer) {
            validationErrors.push(
              `Quiz question in "${quiz.title}" is missing correct answer`
            );
          }
        });
      });

      content.assignments.forEach((assignment) => {
        if (!assignment.instructions || assignment.instructions.length < 50) {
          validationErrors.push(
            `Assignment "${assignment.title}" needs detailed instructions`
          );
        }
      });
    });

    if (totalDuration < 1800) {
      warnings.push(
        "Course duration is less than 30 minutes. Consider adding more content"
      );
    }

    if (totalLessons < 5) {
      warnings.push(
        "Course has fewer than 5 lessons. Consider breaking content into smaller lessons"
      );
    }

    if (!hasVideoContent) {
      warnings.push(
        "Course has no video content. Video lessons typically engage students better"
      );
    }

    const result = {
      isValid: validationErrors.length === 0,
      errors: validationErrors,
      warnings: warnings,
      stats: {
        totalDuration,
        totalLessons,
        totalSections: publishedSections.length,
        hasVideoContent,
      },
    };

    setImmediate(async () => {
      try {
        await redisService.setJSON(cacheKey, result, { ex: 900 });
      } catch (cacheError) {
        console.warn("Failed to cache validation result:", cacheError);
      }
    });

    return result;
  } catch (error) {
    console.error("Validation error:", error);
    return {
      isValid: false,
      errors: ["Validation failed due to system error"],
      warnings: [],
      stats: {},
    };
  }
};

const invalidateSubmissionValidationCache = async (courseId) => {
  try {
    const patterns = [
      `course_submission_validation:${courseId}`,
      `course_content_validation:${courseId}`,
      `course_validation:${courseId}`,
      `course:${courseId}:*`,
    ];

    await Promise.all(
      patterns.map((pattern) => redisService.delPattern(pattern))
    );
  } catch (error) {
    console.warn("Cache invalidation failed:", error);
  }
};

const submitForReview = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const [instructor, course] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: {
          id: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      prisma.course.findUnique({
        where: { id: courseId },
        select: {
          id: true,
          title: true,
          status: true,
          slug: true,
          instructorId: true,
          category: {
            select: {
              name: true,
            },
          },
        },
      }),
    ]);

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    if (!course || course.instructorId !== instructor.id) {
      return res.status(404).json({
        success: false,
        message: "Course not found or you don't have permission to submit it",
        code: "COURSE_NOT_FOUND",
      });
    }

    if (course.status !== "DRAFT" && course.status !== "REJECTED") {
      return res.status(400).json({
        success: false,
        message: `Cannot submit course with status: ${course.status}`,
        code: "INVALID_STATUS",
      });
    }

    const validation = await validateCourseForSubmission(courseId);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: "Course validation failed",
        errors: validation.errors,
        warnings: validation.warnings,
        code: "VALIDATION_FAILED",
      });
    }

    const updatedCourse = await prisma.course.update({
      where: { id: courseId },
      data: {
        status: "UNDER_REVIEW",
        reviewSubmittedAt: new Date(),
        duration: validation.stats.totalDuration,
        totalLessons: validation.stats.totalLessons,
        lastUpdated: new Date(),
      },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        reviewSubmittedAt: true,
        duration: true,
        totalLessons: true,
      },
    });

    setImmediate(async () => {
      try {
        await Promise.all([
          emailService.sendCourseSubmittedForReview({
            email: instructor.user.email,
            firstName: instructor.user.firstName,
            courseTitle: course.title,
            submissionDate: new Date(),
          }),
          notificationService.createNotification({
            userId: req.userAuthId,
            type: "COURSE_PUBLISHED",
            title: "Course Submitted for Review",
            message: `Your course "${course.title}" has been submitted for review. Our team will evaluate it within 3-5 business days.`,
            priority: "NORMAL",
            data: {
              courseId: course.id,
              courseTitle: course.title,
              submissionDate: new Date(),
              reviewTimeline: "3-5 business days",
            },
            actionUrl: `/instructor/courses/${course.id}`,
            sendEmail: false,
            sendSocket: true,
          }),
          Promise.all([
            redisService.delPattern(`course:${courseId}*`),
            redisService.delPattern(`instructor_courses:${req.userAuthId}*`),
            redisService.delPattern(`courses:${req.userAuthId}*`),
          ]),
        ]);
      } catch (error) {
        console.error("Background operations failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course submitted for review successfully",
      data: {
        course: {
          id: updatedCourse.id,
          title: updatedCourse.title,
          slug: updatedCourse.slug,
          status: updatedCourse.status,
          reviewSubmittedAt: updatedCourse.reviewSubmittedAt,
          duration: updatedCourse.duration,
          totalLessons: updatedCourse.totalLessons,
          category: course.category.name,
        },
        validation: {
          warnings: validation.warnings,
          stats: validation.stats,
        },
        nextSteps: [
          "Our review team will evaluate your course within 3-5 business days",
          "You'll receive an email notification once the review is complete",
          "If approved, your course will be published and available to students",
          "If changes are needed, you'll receive detailed feedback",
        ],
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SUBMIT_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to submit course for review. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const validateCourse = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const cacheKey = `course_validation:${courseId}`;
    const cachedValidation = await redisService.getJSON(cacheKey);

    if (cachedValidation) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Course validation completed",
        data: {
          ...cachedValidation,
          cached: true,
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const [instructor, course] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      }),
      prisma.course.findUnique({
        where: { id: courseId },
        select: {
          id: true,
          title: true,
          status: true,
          instructorId: true,
        },
      }),
    ]);

    if (!instructor || !course || course.instructorId !== instructor.id) {
      return res.status(404).json({
        success: false,
        message: "Course not found or you don't have permission to validate it",
        code: "COURSE_NOT_FOUND",
      });
    }

    const validation = await validateCourseForSubmission(courseId);

    const responseData = {
      courseId: course.id,
      courseTitle: course.title,
      courseStatus: course.status,
      validation: {
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings,
        stats: validation.stats,
      },
      readyForSubmission:
        validation.isValid &&
        (course.status === "DRAFT" || course.status === "REJECTED"),
    };

    setImmediate(async () => {
      try {
        await redisService.setJSON(cacheKey, responseData, { ex: 300 });
      } catch (cacheError) {
        console.warn("Failed to cache validation result:", cacheError);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course validation completed",
      data: responseData,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`VALIDATE_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to validate course. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const deleteCourse = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { confirmDelete } = req.body;

    if (!courseId || !confirmDelete) {
      return res.status(400).json({
        success: false,
        message: !courseId
          ? "Course ID is required"
          : "Please confirm course deletion",
        code: !courseId ? "MISSING_COURSE_ID" : "CONFIRMATION_REQUIRED",
      });
    }

    const [instructor, course] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true, totalCourses: true },
      }),
      prisma.course.findFirst({
        where: { id: courseId },
        select: {
          id: true,
          title: true,
          status: true,
          thumbnail: true,
          instructorId: true,
          _count: {
            select: {
              enrollments: true,
              reviews: true,
              sections: true,
            },
          },
        },
      }),
    ]);

    if (!instructor || !course || course.instructorId !== instructor.id) {
      return res.status(404).json({
        success: false,
        message: !instructor
          ? "Instructor profile not found"
          : "Course not found or you don't have permission to delete it",
        code: !instructor ? "INSTRUCTOR_NOT_FOUND" : "COURSE_NOT_FOUND",
      });
    }

    if (course.status === "PUBLISHED" && course._count.enrollments > 0) {
      return res.status(403).json({
        success: false,
        message:
          "Cannot delete published course with enrollments. Consider archiving instead.",
        code: "HAS_ENROLLMENTS",
        data: {
          enrollmentCount: course._count.enrollments,
          reviewCount: course._count.reviews,
          alternative: "archive",
        },
      });
    }

    if (course.status === "UNDER_REVIEW") {
      return res.status(403).json({
        success: false,
        message:
          "Cannot delete course that is under review. Wait for review completion or contact support.",
        code: "UNDER_REVIEW",
      });
    }

    const deletedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.course.update({
        where: { id: courseId },
        data: {
          status: "ARCHIVED",
          archivedAt: deletedAt,
          title: `${course.title} [DELETED-${Date.now()}]`,
        },
      });

      await tx.instructor.update({
        where: { id: instructor.id },
        data: { totalCourses: Math.max(0, instructor.totalCourses - 1) },
      });
    });

    setImmediate(async () => {
      try {
        await deleteCourseBackground(courseId, course.thumbnail);
      } catch (error) {
        console.error(
          `Background deletion failed for course ${courseId}:`,
          error
        );
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course deletion initiated successfully",
      data: {
        deletedCourse: {
          id: course.id,
          title: course.title,
          status: "DELETED",
          deletedAt,
        },
        impact: {
          sectionsDeleted: course._count.sections,
          enrollmentsAffected: course._count.enrollments,
          reviewsDeleted: course._count.reviews,
        },
        note: "Course data is being cleaned up in the background",
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete course. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const deleteCourseBackground = async (courseId, thumbnail) => {
  try {
    console.log(`Starting background deletion for course: ${courseId}`);

    const deleteOperations = [
      () =>
        prisma.answer.deleteMany({
          where: { attempt: { quiz: { section: { courseId } } } },
        }),
      () =>
        prisma.quizAttempt.deleteMany({
          where: { quiz: { section: { courseId } } },
        }),
      () =>
        prisma.assignmentSubmission.deleteMany({
          where: { assignment: { section: { courseId } } },
        }),
      () =>
        prisma.lessonCompletion.deleteMany({
          where: { lesson: { section: { courseId } } },
        }),
      () =>
        prisma.contentCompletion.deleteMany({
          where: { contentItem: { section: { courseId } } },
        }),
      () =>
        prisma.note.deleteMany({
          where: { lesson: { section: { courseId } } },
        }),
      () =>
        prisma.attachment.deleteMany({
          where: { lesson: { section: { courseId } } },
        }),
      () =>
        prisma.question.deleteMany({
          where: { quiz: { section: { courseId } } },
        }),
      () => prisma.assignment.deleteMany({ where: { section: { courseId } } }),
      () => prisma.quiz.deleteMany({ where: { section: { courseId } } }),
      () => prisma.lesson.deleteMany({ where: { section: { courseId } } }),
      () => prisma.contentItem.deleteMany({ where: { section: { courseId } } }),
      () => prisma.section.deleteMany({ where: { courseId } }),
      () => prisma.qnAAnswer.deleteMany({ where: { question: { courseId } } }),
      () => prisma.qnAQuestion.deleteMany({ where: { courseId } }),
      () => prisma.reviewReply.deleteMany({ where: { review: { courseId } } }),
      () => prisma.review.deleteMany({ where: { courseId } }),
      () => prisma.bookmark.deleteMany({ where: { courseId } }),
      () => prisma.certificate.deleteMany({ where: { courseId } }),
      () => prisma.courseProgress.deleteMany({ where: { courseId } }),
      () => prisma.cartItem.deleteMany({ where: { courseId } }),
      () => prisma.wishlistItem.deleteMany({ where: { courseId } }),
      () => prisma.fAQ.deleteMany({ where: { courseId } }),
      () => prisma.courseSettings.deleteMany({ where: { courseId } }),
      () => prisma.enrollment.deleteMany({ where: { courseId } }),
    ];

    for (const operation of deleteOperations) {
      try {
        await operation();
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Delete operation failed:`, error);
      }
    }

    await prisma.course.delete({ where: { id: courseId } });

    if (thumbnail) {
      try {
        const publicId = thumbnail.split("/").slice(-2).join("/").split(".")[0];
        await deleteFromCloudinary(publicId, "image");
      } catch (cloudinaryError) {
        console.error("Cloudinary cleanup failed:", cloudinaryError);
      }
    }

    await Promise.allSettled([
      redisService.delPattern(`course:${courseId}*`),
      redisService.delPattern(`instructor_courses:*`),
      redisService.delPattern(`courses:*`),
    ]);

    console.log(`Background deletion completed for course: ${courseId}`);
  } catch (error) {
    console.error(`Background deletion failed for course ${courseId}:`, error);
  }
};

const getCourseStats = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const cacheKey = `course_stats:${courseId}:instructor:${req.userAuthId}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Course statistics retrieved successfully",
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
      where: { userId: req.userAuthId },
      select: { id: true },
    });

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId: instructor.id,
      },
      include: {
        enrollments: {
          select: {
            id: true,
            createdAt: true,
            status: true,
            progress: true,
          },
        },
        reviews: {
          select: {
            id: true,
            rating: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
            reviews: true,
            sections: true,
          },
        },
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message:
          "Course not found or you don't have permission to view its statistics",
        code: "COURSE_NOT_FOUND",
      });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const enrollmentStats = {
      total: course.enrollments.length,
      active: course.enrollments.filter((e) => e.status === "ACTIVE").length,
      completed: course.enrollments.filter((e) => e.status === "COMPLETED")
        .length,
      last30Days: course.enrollments.filter((e) => e.createdAt >= thirtyDaysAgo)
        .length,
      last7Days: course.enrollments.filter((e) => e.createdAt >= sevenDaysAgo)
        .length,
    };

    const activeEnrollments = course.enrollments.filter(
      (e) => e.status === "ACTIVE"
    );
    const progressStats = {
      averageProgress:
        activeEnrollments.length > 0
          ? activeEnrollments.reduce((sum, e) => sum + e.progress, 0) /
            activeEnrollments.length
          : 0,
      studentsStarted: activeEnrollments.filter((e) => e.progress > 0).length,
      studentsHalfway: activeEnrollments.filter((e) => e.progress >= 50).length,
      studentsAlmostDone: activeEnrollments.filter((e) => e.progress >= 75)
        .length,
    };

    const ratingStats = {
      total: course.reviews.length,
      average: course.averageRating || 0,
      distribution: {
        5: course.reviews.filter((r) => r.rating === 5).length,
        4: course.reviews.filter((r) => r.rating === 4).length,
        3: course.reviews.filter((r) => r.rating === 3).length,
        2: course.reviews.filter((r) => r.rating === 2).length,
        1: course.reviews.filter((r) => r.rating === 1).length,
      },
      last30Days: course.reviews.filter((r) => r.createdAt >= thirtyDaysAgo)
        .length,
    };

    const earnings = await prisma.earning.findMany({
      where: {
        instructorId: instructor.id,
        payment: {
          enrollments: {
            some: {
              courseId: courseId,
            },
          },
        },
      },
      select: {
        amount: true,
        commission: true,
        status: true,
        createdAt: true,
      },
    });

    const revenueStats = {
      totalGross: earnings.reduce((sum, e) => sum + parseFloat(e.amount), 0),
      totalNet: earnings.reduce((sum, e) => sum + parseFloat(e.commission), 0),
      totalPaid: earnings
        .filter((e) => e.status === "PAID")
        .reduce((sum, e) => sum + parseFloat(e.commission), 0),
      totalPending: earnings
        .filter((e) => e.status === "PENDING")
        .reduce((sum, e) => sum + parseFloat(e.commission), 0),
      last30Days: earnings
        .filter((e) => e.createdAt >= thirtyDaysAgo)
        .reduce((sum, e) => sum + parseFloat(e.commission), 0),
    };

    const qnaQuestions = await prisma.qnAQuestion.count({
      where: { courseId: courseId },
    });

    const qnaAnswers = await prisma.qnAAnswer.count({
      where: {
        question: {
          courseId: courseId,
        },
      },
    });

    const engagementStats = {
      qnaQuestions,
      qnaAnswers,
      questionResponseRate:
        qnaQuestions > 0 ? (qnaAnswers / qnaQuestions) * 100 : 0,
      reviewRate:
        enrollmentStats.total > 0
          ? (ratingStats.total / enrollmentStats.total) * 100
          : 0,
      completionRate:
        enrollmentStats.total > 0
          ? (enrollmentStats.completed / enrollmentStats.total) * 100
          : 0,
    };

    const result = {
      courseInfo: {
        id: course.id,
        title: course.title,
        status: course.status,
        publishedAt: course.publishedAt,
        createdAt: course.createdAt,
        lastUpdated: course.lastUpdated,
      },
      enrollment: enrollmentStats,
      progress: progressStats,
      ratings: ratingStats,
      revenue: revenueStats,
      engagement: engagementStats,
      performance: {
        conversionRate: 0,
        refundRate: 0,
        averageWatchTime: 0,
        dropOffPoints: [],
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 1800 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course statistics retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_COURSE_STATS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course statistics. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getInstructorDashboard = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const cacheKey = `instructor_dashboard:${req.userAuthId}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Instructor dashboard data retrieved successfully",
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
      where: { userId: req.userAuthId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            profileImage: true,
          },
        },
        courses: {
          include: {
            _count: {
              select: {
                enrollments: true,
                reviews: true,
              },
            },
          },
        },
        earnings: {
          select: {
            amount: true,
            commission: true,
            status: true,
            createdAt: true,
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

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const courseStats = {
      total: instructor.courses.length,
      published: instructor.courses.filter((c) => c.status === "PUBLISHED")
        .length,
      draft: instructor.courses.filter((c) => c.status === "DRAFT").length,
      underReview: instructor.courses.filter((c) => c.status === "UNDER_REVIEW")
        .length,
      rejected: instructor.courses.filter((c) => c.status === "REJECTED")
        .length,
      archived: instructor.courses.filter((c) => c.status === "ARCHIVED")
        .length,
    };

    const totalEnrollments = instructor.courses.reduce(
      (sum, c) => sum + c._count.enrollments,
      0
    );
    const totalReviews = instructor.courses.reduce(
      (sum, c) => sum + c._count.reviews,
      0
    );

    const revenueStats = {
      totalEarnings: instructor.earnings.reduce(
        (sum, e) => sum + parseFloat(e.commission),
        0
      ),
      paidEarnings: instructor.earnings
        .filter((e) => e.status === "PAID")
        .reduce((sum, e) => sum + parseFloat(e.commission), 0),
      pendingEarnings: instructor.earnings
        .filter((e) => e.status === "PENDING")
        .reduce((sum, e) => sum + parseFloat(e.commission), 0),
      last30DaysEarnings: instructor.earnings
        .filter((e) => e.createdAt >= thirtyDaysAgo)
        .reduce((sum, e) => sum + parseFloat(e.commission), 0),
    };

    const recentCourses = instructor.courses
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 5)
      .map((course) => ({
        id: course.id,
        title: course.title,
        status: course.status,
        enrollments: course._count.enrollments,
        reviews: course._count.reviews,
        updatedAt: course.updatedAt,
      }));

    const result = {
      instructor: {
        id: instructor.id,
        name: `${instructor.user.firstName} ${instructor.user.lastName}`,
        email: instructor.user.email,
        profileImage: instructor.user.profileImage,
        isVerified: instructor.isVerified,
        rating: instructor.rating,
        totalStudents: totalEnrollments,
        totalCourses: instructor.totalCourses,
        totalRevenue: instructor.totalRevenue,
      },
      overview: {
        courses: courseStats,
        students: {
          total: totalEnrollments,
        },
        reviews: {
          total: totalReviews,
          averageRating: instructor.rating,
        },
        revenue: revenueStats,
      },
      recentActivity: {
        courses: recentCourses,
      },
      quickActions: [
        {
          title: "Create New Course",
          description: "Start building your next course",
          action: "create_course",
          url: "/instructor/courses/create",
        },
        {
          title: "View All Courses",
          description: "Manage your existing courses",
          action: "view_courses",
          url: "/instructor/courses",
        },
        {
          title: "Check Earnings",
          description: "Review your revenue and payouts",
          action: "view_earnings",
          url: "/instructor/earnings",
        },
        {
          title: "Student Q&A",
          description: "Answer student questions",
          action: "view_qna",
          url: "/instructor/qna",
        },
      ],
    };

    await redisService.setJSON(cacheKey, result, { ex: 900 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Instructor dashboard data retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_INSTRUCTOR_DASHBOARD_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve dashboard data. Please try again.",
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
  createCourse,
  getCourses,
  getCourse,
  updateCourse,
  submitForReview,
  validateCourse,
  deleteCourse,
  getCourseStats,
  getInstructorDashboard,
};
