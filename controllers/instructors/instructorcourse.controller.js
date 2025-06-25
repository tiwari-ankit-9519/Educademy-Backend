import { PrismaClient } from "@prisma/client";
import redisService from "../../utils/redis.js";
import emailService from "../../utils/emailService.js";
import notificationService from "../../utils/notificationService.js";
import asyncHandler from "express-async-handler";

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
      language = "English",
      requirements = [],
      learningOutcomes = [],
      targetAudience = [],
      tags = [],
    } = req.body;

    if (
      !title ||
      !description ||
      !shortDescription ||
      !categoryId ||
      !level ||
      !price
    ) {
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

    if (parseFloat(price) < 0) {
      return res.status(400).json({
        success: false,
        message: "Price cannot be negative",
        code: "INVALID_PRICE",
      });
    }

    if (discountPrice && parseFloat(discountPrice) >= parseFloat(price)) {
      return res.status(400).json({
        success: false,
        message: "Discount price must be less than original price",
        code: "INVALID_DISCOUNT",
      });
    }

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, name: true },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        code: "CATEGORY_NOT_FOUND",
      });
    }

    if (subcategoryId) {
      const subcategory = await prisma.category.findUnique({
        where: { id: subcategoryId, parentId: categoryId },
        select: { id: true, name: true },
      });

      if (!subcategory) {
        return res.status(404).json({
          success: false,
          message:
            "Subcategory not found or doesn't belong to selected category",
          code: "SUBCATEGORY_NOT_FOUND",
        });
      }
    }

    const baseSlug = generateCourseSlug(title);
    let slug = baseSlug;
    let counter = 1;

    while (await prisma.course.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: req.userAuthId },
      select: { id: true, totalCourses: true },
    });

    const course = await prisma.course.create({
      data: {
        title,
        slug,
        description,
        shortDescription,
        categoryId,
        subcategoryId,
        level,
        price: parseFloat(price),
        discountPrice: discountPrice ? parseFloat(discountPrice) : null,
        originalPrice: parseFloat(price),
        language,
        requirements,
        learningOutcomes,
        targetAudience,
        tags,
        duration: 0,
        status: "DRAFT",
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
      },
    });

    await prisma.instructor.update({
      where: { id: instructor.id },
      data: { totalCourses: instructor.totalCourses + 1 },
    });

    const cacheKey = `instructor_courses:${req.userAuthId}`;
    await redisService.del(cacheKey);
    await redisService.delPattern(`course:${course.id}*`);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Course created successfully",
      data: {
        course: {
          id: course.id,
          title: course.title,
          slug: course.slug,
          description: course.description,
          shortDescription: course.shortDescription,
          price: course.price,
          discountPrice: course.discountPrice,
          level: course.level,
          status: course.status,
          language: course.language,
          requirements: course.requirements,
          learningOutcomes: course.learningOutcomes,
          targetAudience: course.targetAudience,
          tags: course.tags,
          category: course.category,
          subcategory: course.subcategory,
          instructor: {
            id: course.instructor.id,
            name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
            profileImage: course.instructor.user.profileImage,
          },
          createdAt: course.createdAt,
          updatedAt: course.updatedAt,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
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
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `instructor_courses:${req.userAuthId}:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      status,
      level,
      categoryId,
      search,
      sortBy,
      sortOrder,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Courses retrieved successfully",
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

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const where = {
      instructorId: instructor.id,
    };

    if (status) {
      where.status = status;
    }

    if (level) {
      where.level = level;
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { shortDescription: { contains: search, mode: "insensitive" } },
        { tags: { has: search } },
      ];
    }

    const validSortFields = [
      "title",
      "createdAt",
      "updatedAt",
      "publishedAt",
      "price",
      "averageRating",
      "totalEnrollments",
      "status",
    ];

    const orderBy = {};
    if (validSortFields.includes(sortBy)) {
      orderBy[sortBy] = sortOrder === "asc" ? "asc" : "desc";
    } else {
      orderBy.updatedAt = "desc";
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
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
          sections: {
            select: {
              id: true,
              title: true,
              order: true,
              isPublished: true,
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
        price: course.price,
        discountPrice: course.discountPrice,
        level: course.level,
        status: course.status,
        language: course.language,
        duration: course.duration,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course.totalEnrollments,
        totalRevenue: course.totalRevenue,
        featured: course.featured,
        bestseller: course.bestseller,
        trending: course.trending,
        category: course.category,
        subcategory: course.subcategory,
        sectionsCount: course._count.sections,
        enrollmentsCount: course._count.enrollments,
        reviewsCount: course._count.reviews,
        publishedSections: course.sections.filter((s) => s.isPublished).length,
        lastUpdated: course.lastUpdated,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        publishedAt: course.publishedAt,
        reviewSubmittedAt: course.reviewSubmittedAt,
        rejectionReason: course.rejectionReason,
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
        totalCourses: total,
        draftCourses: courses.filter((c) => c.status === "DRAFT").length,
        underReviewCourses: courses.filter((c) => c.status === "UNDER_REVIEW")
          .length,
        publishedCourses: courses.filter((c) => c.status === "PUBLISHED")
          .length,
        rejectedCourses: courses.filter((c) => c.status === "REJECTED").length,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

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
      },
    });

    if (!existingCourse) {
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
      return res.status(403).json({
        success: false,
        message:
          "Published courses cannot be edited. Please create a new version.",
        code: "COURSE_PUBLISHED",
      });
    }

    if (existingCourse.status === "UNDER_REVIEW") {
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
      "thumbnail",
      "previewVideo",
      "introVideo",
      "price",
      "discountPrice",
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
    Object.keys(updateData).forEach((key) => {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        filteredData[key] = updateData[key];
      }
    });

    if (Object.keys(filteredData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
        code: "NO_UPDATE_DATA",
      });
    }

    if (filteredData.price && parseFloat(filteredData.price) < 0) {
      return res.status(400).json({
        success: false,
        message: "Price cannot be negative",
        code: "INVALID_PRICE",
      });
    }

    if (
      filteredData.discountPrice &&
      filteredData.price &&
      parseFloat(filteredData.discountPrice) >= parseFloat(filteredData.price)
    ) {
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

    if (filteredData.discountPrice) {
      filteredData.discountPrice = parseFloat(filteredData.discountPrice);
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
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      sections: {
        include: {
          lessons: {
            select: {
              id: true,
              title: true,
              duration: true,
              type: true,
              content: true,
              videoUrl: true,
            },
          },
          quizzes: {
            include: {
              questions: {
                select: {
                  id: true,
                  content: true,
                  type: true,
                  correctAnswer: true,
                },
              },
            },
          },
          assignments: {
            select: {
              id: true,
              title: true,
              description: true,
              instructions: true,
            },
          },
        },
      },
    },
  });

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

  if (course.sections.length === 0) {
    validationErrors.push("Course must have at least one section");
  }

  const publishedSections = course.sections.filter((s) => s.isPublished);
  if (publishedSections.length === 0) {
    validationErrors.push("Course must have at least one published section");
  }

  let totalDuration = 0;
  let totalLessons = 0;
  let hasVideoContent = false;

  publishedSections.forEach((section) => {
    if (
      section.lessons.length === 0 &&
      section.quizzes.length === 0 &&
      section.assignments.length === 0
    ) {
      validationErrors.push(
        `Section "${section.title}" must have at least one piece of content`
      );
    }

    section.lessons.forEach((lesson) => {
      totalLessons++;
      totalDuration += lesson.duration || 0;

      if (lesson.type === "VIDEO" && lesson.videoUrl) {
        hasVideoContent = true;
      }

      if (!lesson.content && !lesson.videoUrl) {
        validationErrors.push(
          `Lesson "${lesson.title}" must have content or video`
        );
      }
    });

    section.quizzes.forEach((quiz) => {
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

    section.assignments.forEach((assignment) => {
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

  return {
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
};

const submitForReview = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { submitMessage } = req.body;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
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
          },
        },
      },
    });

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId: instructor.id,
      },
      select: {
        id: true,
        title: true,
        status: true,
        slug: true,
      },
    });

    if (!course) {
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
      include: {
        category: {
          select: {
            name: true,
          },
        },
      },
    });

    try {
      await emailService.sendCourseSubmittedForReview({
        email: instructor.user.email,
        firstName: instructor.user.firstName,
        courseTitle: course.title,
        submissionDate: new Date(),
      });
    } catch (emailError) {
      console.error("Failed to send submission email:", emailError);
    }

    try {
      await notificationService.createNotification({
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
      });
    } catch (notificationError) {
      console.error("Failed to create notification:", notificationError);
    }

    await redisService.delPattern(`course:${courseId}*`);
    await redisService.delPattern(`instructor_courses:${req.userAuthId}*`);

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
          category: updatedCourse.category.name,
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

    const instructor = await prisma.instructor.findUnique({
      where: { userId: req.userAuthId },
      select: { id: true },
    });

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId: instructor.id,
      },
      select: {
        id: true,
        title: true,
        status: true,
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found or you don't have permission to validate it",
        code: "COURSE_NOT_FOUND",
      });
    }

    const validation = await validateCourseForSubmission(courseId);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course validation completed",
      data: {
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
      },
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

const publishCourse = asyncHandler(async (req, res) => {
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

    const instructor = await prisma.instructor.findUnique({
      where: { userId: req.userAuthId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId: instructor.id,
      },
      select: {
        id: true,
        title: true,
        status: true,
        slug: true,
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found or you don't have permission to publish it",
        code: "COURSE_NOT_FOUND",
      });
    }

    const canDirectPublish =
      instructor.user.role === "ADMIN" ||
      process.env.NODE_ENV === "development";

    if (!canDirectPublish && course.status !== "UNDER_REVIEW") {
      return res.status(403).json({
        success: false,
        message: "Course must be submitted for review before publishing",
        code: "REVIEW_REQUIRED",
      });
    }

    if (course.status === "PUBLISHED") {
      return res.status(400).json({
        success: false,
        message: "Course is already published",
        code: "ALREADY_PUBLISHED",
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

    const publishedCourse = await prisma.course.update({
      where: { id: courseId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        duration: validation.stats.totalDuration,
        totalLessons: validation.stats.totalLessons,
        lastUpdated: new Date(),
      },
      include: {
        category: {
          select: {
            name: true,
          },
        },
      },
    });

    try {
      await emailService.sendCourseApprovalEmail({
        email: instructor.user.email,
        firstName: instructor.user.firstName,
        courseTitle: course.title,
        courseId: course.id,
        courseUrl: `${process.env.FRONTEND_URL}/courses/${course.slug}`,
        feedback:
          "Course has been successfully published and is now available to students!",
      });
    } catch (emailError) {
      console.error("Failed to send approval email:", emailError);
    }

    try {
      await notificationService.createNotification({
        userId: req.userAuthId,
        type: "COURSE_PUBLISHED",
        title: "Course Published Successfully",
        message: `Congratulations! Your course "${course.title}" is now live and available to students.`,
        priority: "HIGH",
        data: {
          courseId: course.id,
          courseTitle: course.title,
          courseUrl: `${process.env.FRONTEND_URL}/courses/${course.slug}`,
          publishedAt: new Date(),
        },
        actionUrl: `/courses/${course.slug}`,
        sendEmail: false,
        sendSocket: true,
      });
    } catch (notificationError) {
      console.error("Failed to create notification:", notificationError);
    }

    await redisService.delPattern(`course:${courseId}*`);
    await redisService.delPattern(`instructor_courses:${req.userAuthId}*`);
    await redisService.delPattern(`courses:*`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course published successfully",
      data: {
        course: {
          id: publishedCourse.id,
          title: publishedCourse.title,
          slug: publishedCourse.slug,
          status: publishedCourse.status,
          publishedAt: publishedCourse.publishedAt,
          duration: publishedCourse.duration,
          totalLessons: publishedCourse.totalLessons,
          category: publishedCourse.category.name,
          courseUrl: `${process.env.FRONTEND_URL}/courses/${course.slug}`,
        },
        nextSteps: [
          "Your course is now live and visible to students",
          "Start promoting your course to reach more learners",
          "Monitor your course analytics for enrollment insights",
          "Engage with students through Q&A and discussions",
        ],
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`PUBLISH_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to publish course. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const archiveCourse = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { reason } = req.body;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
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
          },
        },
      },
    });

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId: instructor.id,
      },
      select: {
        id: true,
        title: true,
        status: true,
        totalEnrollments: true,
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found or you don't have permission to archive it",
        code: "COURSE_NOT_FOUND",
      });
    }

    if (course.status === "ARCHIVED") {
      return res.status(400).json({
        success: false,
        message: "Course is already archived",
        code: "ALREADY_ARCHIVED",
      });
    }

    if (course.status !== "PUBLISHED") {
      return res.status(400).json({
        success: false,
        message: "Only published courses can be archived",
        code: "INVALID_STATUS",
      });
    }

    const archivedCourse = await prisma.course.update({
      where: { id: courseId },
      data: {
        status: "ARCHIVED",
        archivedAt: new Date(),
        lastUpdated: new Date(),
      },
    });

    if (course.totalEnrollments > 0) {
      try {
        await notificationService.createNotification({
          userId: req.userAuthId,
          type: "COURSE_UPDATED",
          title: "Course Archived",
          message: `Your course "${course.title}" has been archived. ${course.totalEnrollments} enrolled students will retain access to course materials.`,
          priority: "NORMAL",
          data: {
            courseId: course.id,
            courseTitle: course.title,
            archivedAt: new Date(),
            reason: reason || "Course archived by instructor",
            enrolledStudents: course.totalEnrollments,
          },
          actionUrl: `/instructor/courses/${course.id}`,
          sendEmail: false,
          sendSocket: true,
        });
      } catch (notificationError) {
        console.error("Failed to create notification:", notificationError);
      }
    }

    await redisService.delPattern(`course:${courseId}*`);
    await redisService.delPattern(`instructor_courses:${req.userAuthId}*`);
    await redisService.delPattern(`courses:*`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course archived successfully",
      data: {
        course: {
          id: archivedCourse.id,
          title: archivedCourse.title,
          status: archivedCourse.status,
          archivedAt: archivedCourse.archivedAt,
          enrolledStudents: course.totalEnrollments,
        },
        impact: {
          enrolledStudents: course.totalEnrollments,
          studentAccess:
            "Enrolled students will retain access to course materials",
          visibility: "Course is no longer visible to new students",
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`ARCHIVE_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to archive course. Please try again.",
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

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    if (!confirmDelete) {
      return res.status(400).json({
        success: false,
        message: "Please confirm course deletion",
        code: "CONFIRMATION_REQUIRED",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: req.userAuthId },
      select: { id: true, totalCourses: true },
    });

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId: instructor.id,
      },
      include: {
        enrollments: {
          select: { id: true },
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
        message: "Course not found or you don't have permission to delete it",
        code: "COURSE_NOT_FOUND",
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

    await prisma.$transaction(async (tx) => {
      await tx.answer.deleteMany({
        where: {
          attempt: {
            quiz: {
              section: {
                courseId: courseId,
              },
            },
          },
        },
      });

      await tx.quizAttempt.deleteMany({
        where: {
          quiz: {
            section: {
              courseId: courseId,
            },
          },
        },
      });

      await tx.assignmentSubmission.deleteMany({
        where: {
          assignment: {
            section: {
              courseId: courseId,
            },
          },
        },
      });

      await tx.lessonCompletion.deleteMany({
        where: {
          lesson: {
            section: {
              courseId: courseId,
            },
          },
        },
      });

      await tx.contentCompletion.deleteMany({
        where: {
          contentItem: {
            section: {
              courseId: courseId,
            },
          },
        },
      });

      await tx.question.deleteMany({
        where: {
          quiz: {
            section: {
              courseId: courseId,
            },
          },
        },
      });

      await tx.attachment.deleteMany({
        where: {
          lesson: {
            section: {
              courseId: courseId,
            },
          },
        },
      });

      await tx.assignment.deleteMany({
        where: {
          section: {
            courseId: courseId,
          },
        },
      });

      await tx.quiz.deleteMany({
        where: {
          section: {
            courseId: courseId,
          },
        },
      });

      await tx.lesson.deleteMany({
        where: {
          section: {
            courseId: courseId,
          },
        },
      });

      await tx.contentItem.deleteMany({
        where: {
          section: {
            courseId: courseId,
          },
        },
      });

      await tx.section.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.qnAAnswer.deleteMany({
        where: {
          question: {
            courseId: courseId,
          },
        },
      });

      await tx.qnAQuestion.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.note.deleteMany({
        where: {
          lesson: {
            section: {
              courseId: courseId,
            },
          },
        },
      });

      await tx.bookmark.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.certificate.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.courseProgress.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.reviewReply.deleteMany({
        where: {
          review: {
            courseId: courseId,
          },
        },
      });

      await tx.review.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.cartItem.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.wishlistItem.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.fAQ.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.courseSettings.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.enrollment.deleteMany({
        where: {
          courseId: courseId,
        },
      });

      await tx.course.delete({
        where: {
          id: courseId,
        },
      });

      await tx.instructor.update({
        where: { id: instructor.id },
        data: {
          totalCourses: Math.max(0, instructor.totalCourses - 1),
        },
      });
    });

    await redisService.delPattern(`course:${courseId}*`);
    await redisService.delPattern(`instructor_courses:${req.userAuthId}*`);
    await redisService.delPattern(`courses:*`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course deleted successfully",
      data: {
        deletedCourse: {
          id: course.id,
          title: course.title,
          status: course.status,
          deletedAt: new Date(),
        },
        impact: {
          sectionsDeleted: course._count.sections,
          enrollmentsAffected: course._count.enrollments,
          reviewsDeleted: course._count.reviews,
        },
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

const duplicateCourse = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { newTitle, newSlug } = req.body;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: req.userAuthId },
      select: { id: true, totalCourses: true },
    });

    const originalCourse = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId: instructor.id,
      },
      include: {
        sections: {
          include: {
            lessons: {
              include: {
                attachments: true,
              },
            },
            quizzes: {
              include: {
                questions: true,
              },
            },
            assignments: true,
            contentItems: true,
          },
        },
        courseSettings: true,
        faqs: true,
      },
    });

    if (!originalCourse) {
      return res.status(404).json({
        success: false,
        message:
          "Course not found or you don't have permission to duplicate it",
        code: "COURSE_NOT_FOUND",
      });
    }

    let duplicateTitle = newTitle || `${originalCourse.title} (Copy)`;
    let duplicateSlug = newSlug || generateCourseSlug(duplicateTitle);

    let counter = 1;
    let baseSlug = duplicateSlug;
    while (await prisma.course.findUnique({ where: { slug: duplicateSlug } })) {
      duplicateSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    const duplicatedCourse = await prisma.$transaction(async (tx) => {
      const newCourse = await tx.course.create({
        data: {
          title: duplicateTitle,
          slug: duplicateSlug,
          description: originalCourse.description,
          shortDescription: originalCourse.shortDescription,
          thumbnail: originalCourse.thumbnail,
          previewVideo: originalCourse.previewVideo,
          introVideo: originalCourse.introVideo,
          price: originalCourse.price,
          discountPrice: originalCourse.discountPrice,
          originalPrice: originalCourse.originalPrice,
          level: originalCourse.level,
          language: originalCourse.language,
          subtitles: originalCourse.subtitles,
          requirements: originalCourse.requirements,
          learningOutcomes: originalCourse.learningOutcomes,
          targetAudience: originalCourse.targetAudience,
          tags: originalCourse.tags,
          keyPoints: originalCourse.keyPoints,
          duration: 0,
          status: "DRAFT",
          instructorId: instructor.id,
          categoryId: originalCourse.categoryId,
          subcategoryId: originalCourse.subcategoryId,
        },
      });

      if (originalCourse.courseSettings) {
        await tx.courseSettings.create({
          data: {
            courseId: newCourse.id,
            allowDiscussions: originalCourse.courseSettings.allowDiscussions,
            allowReviews: originalCourse.courseSettings.allowReviews,
            requireApproval: originalCourse.courseSettings.requireApproval,
            certificateEnabled:
              originalCourse.courseSettings.certificateEnabled,
            downloadable: originalCourse.courseSettings.downloadable,
            allowPreview: originalCourse.courseSettings.allowPreview,
            autoEnrollmentEmail:
              originalCourse.courseSettings.autoEnrollmentEmail,
            sequentialProgress:
              originalCourse.courseSettings.sequentialProgress,
            passingGrade: originalCourse.courseSettings.passingGrade,
            certificateTemplate:
              originalCourse.courseSettings.certificateTemplate,
            drip: originalCourse.courseSettings.drip,
            dripSchedule: originalCourse.courseSettings.dripSchedule,
          },
        });
      }

      for (const faq of originalCourse.faqs) {
        await tx.fAQ.create({
          data: {
            courseId: newCourse.id,
            question: faq.question,
            answer: faq.answer,
            order: faq.order,
            isActive: faq.isActive,
          },
        });
      }

      for (const section of originalCourse.sections) {
        const newSection = await tx.section.create({
          data: {
            courseId: newCourse.id,
            title: section.title,
            description: section.description,
            order: section.order,
            isPublished: false,
            isRequired: section.isRequired,
            isFree: section.isFree,
            estimatedTime: section.estimatedTime,
          },
        });

        for (const contentItem of section.contentItems) {
          await tx.contentItem.create({
            data: {
              sectionId: newSection.id,
              title: contentItem.title,
              description: contentItem.description,
              order: contentItem.order,
              itemType: contentItem.itemType,
              isRequired: contentItem.isRequired,
              isFree: contentItem.isFree,
              isLocked: contentItem.isLocked,
              duration: contentItem.duration,
            },
          });
        }

        for (const lesson of section.lessons) {
          const newLesson = await tx.lesson.create({
            data: {
              sectionId: newSection.id,
              title: lesson.title,
              description: lesson.description,
              order: lesson.order,
              duration: lesson.duration,
              isFree: lesson.isFree,
              isPreview: lesson.isPreview,
              type: lesson.type,
              content: lesson.content,
              videoUrl: lesson.videoUrl,
              videoQuality: lesson.videoQuality,
              captions: lesson.captions,
              transcript: lesson.transcript,
              resources: lesson.resources,
            },
          });

          for (const attachment of lesson.attachments) {
            await tx.attachment.create({
              data: {
                lessonId: newLesson.id,
                name: attachment.name,
                fileUrl: attachment.fileUrl,
                fileSize: attachment.fileSize,
                fileType: attachment.fileType,
                isDownloadable: attachment.isDownloadable,
              },
            });
          }
        }

        for (const quiz of section.quizzes) {
          const newQuiz = await tx.quiz.create({
            data: {
              sectionId: newSection.id,
              title: quiz.title,
              description: quiz.description,
              instructions: quiz.instructions,
              duration: quiz.duration,
              passingScore: quiz.passingScore,
              maxAttempts: quiz.maxAttempts,
              order: quiz.order,
              isRequired: quiz.isRequired,
              isRandomized: quiz.isRandomized,
              showResults: quiz.showResults,
              allowReview: quiz.allowReview,
            },
          });

          for (const question of quiz.questions) {
            await tx.question.create({
              data: {
                quizId: newQuiz.id,
                content: question.content,
                type: question.type,
                points: question.points,
                order: question.order,
                options: question.options,
                correctAnswer: question.correctAnswer,
                explanation: question.explanation,
                hints: question.hints,
                difficulty: question.difficulty,
                tags: question.tags,
              },
            });
          }
        }

        for (const assignment of section.assignments) {
          await tx.assignment.create({
            data: {
              sectionId: newSection.id,
              title: assignment.title,
              description: assignment.description,
              totalPoints: assignment.totalPoints,
              order: assignment.order,
              instructions: assignment.instructions,
              resources: assignment.resources,
              rubric: assignment.rubric,
              allowLateSubmission: assignment.allowLateSubmission,
              latePenalty: assignment.latePenalty,
              dueDate: assignment.dueDate,
            },
          });
        }
      }

      await tx.instructor.update({
        where: { id: instructor.id },
        data: { totalCourses: instructor.totalCourses + 1 },
      });

      return newCourse;
    });

    await redisService.delPattern(`instructor_courses:${req.userAuthId}*`);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Course duplicated successfully",
      data: {
        originalCourse: {
          id: originalCourse.id,
          title: originalCourse.title,
          slug: originalCourse.slug,
        },
        duplicatedCourse: {
          id: duplicatedCourse.id,
          title: duplicatedCourse.title,
          slug: duplicatedCourse.slug,
          status: duplicatedCourse.status,
          createdAt: duplicatedCourse.createdAt,
        },
        duplicationStats: {
          sectionsCount: originalCourse.sections.length,
          lessonsCount: originalCourse.sections.reduce(
            (sum, s) => sum + s.lessons.length,
            0
          ),
          quizzesCount: originalCourse.sections.reduce(
            (sum, s) => sum + s.quizzes.length,
            0
          ),
          assignmentsCount: originalCourse.sections.reduce(
            (sum, s) => sum + s.assignments.length,
            0
          ),
          faqsCount: originalCourse.faqs.length,
        },
        nextSteps: [
          "Review and update the duplicated course content",
          "Modify sections, lessons, and assessments as needed",
          "Update course information and pricing",
          "Submit for review when ready to publish",
        ],
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DUPLICATE_COURSE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to duplicate course. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

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
  publishCourse,
  archiveCourse,
  deleteCourse,
  duplicateCourse,
  getCourseStats,
  getInstructorDashboard,
};
