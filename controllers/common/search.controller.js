import { config } from "dotenv";
config();

import asyncHandler from "express-async-handler";
import { PrismaClient } from "@prisma/client";
import redisService from "../../utils/redis.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const validateSearchQuery = (query) => {
  const errors = [];

  if (!query || typeof query !== "string") {
    errors.push("Search query is required and must be a string");
  } else if (query.trim().length < 2) {
    errors.push("Search query must be at least 2 characters long");
  } else if (query.trim().length > 100) {
    errors.push("Search query must be less than 100 characters");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const validateSearchFilters = (filters) => {
  const errors = [];
  const {
    page,
    limit,
    sortBy,
    sortOrder,
    minPrice,
    maxPrice,
    rating,
    level,
    duration,
    category,
    instructor,
  } = filters;

  if (page && (isNaN(page) || parseInt(page) < 1)) {
    errors.push("Page must be a positive number");
  }

  if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
    errors.push("Limit must be between 1 and 100");
  }

  const validSortFields = [
    "relevance",
    "title",
    "price",
    "rating",
    "createdAt",
    "enrollments",
  ];
  if (sortBy && !validSortFields.includes(sortBy)) {
    errors.push("Invalid sort field");
  }

  if (sortOrder && !["asc", "desc"].includes(sortOrder.toLowerCase())) {
    errors.push("Sort order must be 'asc' or 'desc'");
  }

  if (minPrice && (isNaN(minPrice) || parseFloat(minPrice) < 0)) {
    errors.push("Minimum price must be a non-negative number");
  }

  if (maxPrice && (isNaN(maxPrice) || parseFloat(maxPrice) < 0)) {
    errors.push("Maximum price must be a non-negative number");
  }

  if (minPrice && maxPrice && parseFloat(minPrice) > parseFloat(maxPrice)) {
    errors.push("Minimum price cannot be greater than maximum price");
  }

  if (
    rating &&
    (isNaN(rating) || parseFloat(rating) < 0 || parseFloat(rating) > 5)
  ) {
    errors.push("Rating must be between 0 and 5");
  }

  const validLevels = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "ALL_LEVELS"];
  if (level && !validLevels.includes(level.toUpperCase())) {
    errors.push("Invalid course level");
  }

  if (duration && (isNaN(duration) || parseInt(duration) < 0)) {
    errors.push("Duration must be a non-negative number");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const buildSearchFilters = (query) => {
  const filters = {
    page: parseInt(query.page) || 1,
    limit: Math.min(parseInt(query.limit) || 20, 100),
    sortBy: query.sortBy || "relevance",
    sortOrder: (query.sortOrder || "desc").toLowerCase(),
  };

  if (query.minPrice) filters.minPrice = parseFloat(query.minPrice);
  if (query.maxPrice) filters.maxPrice = parseFloat(query.maxPrice);
  if (query.rating) filters.rating = parseFloat(query.rating);
  if (query.level) filters.level = query.level.toUpperCase();
  if (query.duration) filters.duration = parseInt(query.duration);
  if (query.category) filters.category = query.category;
  if (query.instructor) filters.instructor = query.instructor;
  if (query.language) filters.language = query.language;
  if (query.isFree !== undefined) filters.isFree = query.isFree === "true";
  if (query.featured !== undefined)
    filters.featured = query.featured === "true";
  if (query.bestseller !== undefined)
    filters.bestseller = query.bestseller === "true";

  return filters;
};

const buildCourseSearchWhere = (searchTerm, filters) => {
  const where = {
    status: "PUBLISHED",
    AND: [],
  };

  if (searchTerm) {
    where.AND.push({
      OR: [
        { title: { contains: searchTerm, mode: "insensitive" } },
        { description: { contains: searchTerm, mode: "insensitive" } },
        { shortDescription: { contains: searchTerm, mode: "insensitive" } },
        { tags: { hasSome: [searchTerm] } },
        { keyPoints: { hasSome: [searchTerm] } },
        { learningOutcomes: { hasSome: [searchTerm] } },
        {
          instructor: {
            OR: [
              {
                user: {
                  firstName: { contains: searchTerm, mode: "insensitive" },
                },
              },
              {
                user: {
                  lastName: { contains: searchTerm, mode: "insensitive" },
                },
              },
            ],
          },
        },
        { category: { name: { contains: searchTerm, mode: "insensitive" } } },
      ],
    });
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const priceFilter = {};
    if (filters.minPrice !== undefined) priceFilter.gte = filters.minPrice;
    if (filters.maxPrice !== undefined) priceFilter.lte = filters.maxPrice;
    where.AND.push({ price: priceFilter });
  }

  if (filters.rating !== undefined) {
    where.AND.push({ averageRating: { gte: filters.rating } });
  }

  if (filters.level) {
    where.AND.push({ level: filters.level });
  }

  if (filters.duration !== undefined) {
    where.AND.push({ duration: { lte: filters.duration } });
  }

  if (filters.category) {
    where.AND.push({
      OR: [
        { category: { slug: filters.category } },
        {
          category: {
            name: { contains: filters.category, mode: "insensitive" },
          },
        },
      ],
    });
  }

  if (filters.instructor) {
    where.AND.push({
      instructor: {
        OR: [
          {
            user: {
              firstName: { contains: filters.instructor, mode: "insensitive" },
            },
          },
          {
            user: {
              lastName: { contains: filters.instructor, mode: "insensitive" },
            },
          },
          {
            user: {
              email: { contains: filters.instructor, mode: "insensitive" },
            },
          },
        ],
      },
    });
  }

  if (filters.language) {
    where.AND.push({ language: filters.language });
  }

  if (filters.isFree === true) {
    where.AND.push({ price: { lte: 0 } });
  } else if (filters.isFree === false) {
    where.AND.push({ price: { gt: 0 } });
  }

  if (filters.featured === true) {
    where.AND.push({ featured: true });
  }

  if (filters.bestseller === true) {
    where.AND.push({ bestseller: true });
  }

  if (where.AND.length === 0) {
    delete where.AND;
  }

  return where;
};

const buildSortOrder = (sortBy, sortOrder) => {
  const orderBy = [];

  switch (sortBy) {
    case "relevance":
      orderBy.push({ featured: "desc" });
      orderBy.push({ averageRating: "desc" });
      orderBy.push({ totalEnrollments: "desc" });
      break;
    case "title":
      orderBy.push({ title: sortOrder });
      break;
    case "price":
      orderBy.push({ price: sortOrder });
      break;
    case "rating":
      orderBy.push({ averageRating: sortOrder });
      break;
    case "createdAt":
      orderBy.push({ createdAt: sortOrder });
      break;
    case "enrollments":
      orderBy.push({ totalEnrollments: sortOrder });
      break;
    default:
      orderBy.push({ createdAt: "desc" });
  }

  return orderBy;
};

const saveSearchHistory = async (
  userId,
  searchTerm,
  searchType = "course",
  filters = {}
) => {
  try {
    if (!userId || !searchTerm) return;

    const searchData = {
      userId,
      searchTerm: searchTerm.trim(),
      searchType,
      filters: JSON.stringify(filters),
      timestamp: new Date(),
    };

    await prisma.searchHistory.create({ data: searchData });

    const historyKey = `search_history:${userId}`;
    const history = await redisService.lrange(historyKey, 0, -1);

    const existingIndex = history.findIndex((item) => {
      const parsed = JSON.parse(item);
      return (
        parsed.searchTerm === searchTerm && parsed.searchType === searchType
      );
    });

    if (existingIndex !== -1) {
      await redisService.lrem(historyKey, 1, history[existingIndex]);
    }

    await redisService.lpush(historyKey, JSON.stringify(searchData));
    await redisService.ltrim(historyKey, 0, 49);
    await redisService.expire(historyKey, 30 * 24 * 60 * 60);
  } catch (error) {
    console.warn("Failed to save search history:", error);
  }
};

const incrementSearchCount = async (searchTerm) => {
  try {
    const key = `search_count:${searchTerm.toLowerCase()}`;
    await redisService.incr(key);
    await redisService.expire(key, 7 * 24 * 60 * 60);
  } catch (error) {
    console.warn("Failed to increment search count:", error);
  }
};

export const searchCourses = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { q: searchTerm } = req.query;

    const queryValidation = validateSearchQuery(searchTerm);
    if (!queryValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid search query",
        errors: queryValidation.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const filterValidation = validateSearchFilters(req.query);
    if (!filterValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid search filters",
        errors: filterValidation.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `search_courses:${req.ip}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many search requests. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const filters = buildSearchFilters(req.query);
    const cleanSearchTerm = searchTerm.trim();

    const cacheKey = `search:courses:${Buffer.from(
      JSON.stringify({
        term: cleanSearchTerm,
        filters,
      })
    ).toString("base64")}`;

    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult && filters.page === 1) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Course search completed successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const where = buildCourseSearchWhere(cleanSearchTerm, filters);
    const orderBy = buildSortOrder(filters.sortBy, filters.sortOrder);
    const skip = (filters.page - 1) * filters.limit;

    const [courses, total, categories, instructors] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy,
        skip,
        take: filters.limit,
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
        },
      }),
      prisma.course.count({ where }),
      // Fixed: Added explicit orderBy for groupBy operations
      prisma.course.groupBy({
        by: ["categoryId"],
        where,
        _count: { categoryId: true },
        orderBy: {
          _count: {
            categoryId: "desc",
          },
        },
        take: 10,
      }),
      prisma.course.groupBy({
        by: ["instructorId"],
        where,
        _count: { instructorId: true },
        orderBy: {
          _count: {
            instructorId: "desc",
          },
        },
        take: 10,
      }),
    ]);

    const categoryDetails = await prisma.category.findMany({
      where: {
        id: { in: categories.map((c) => c.categoryId) },
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    const instructorDetails = await prisma.instructor.findMany({
      where: {
        id: { in: instructors.map((i) => i.instructorId) },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            profileImage: true,
          },
        },
      },
    });

    const facets = {
      categories: categories.map((cat) => {
        const details = categoryDetails.find((d) => d.id === cat.categoryId);
        return {
          id: cat.categoryId,
          name: details?.name || "Unknown",
          slug: details?.slug || "",
          count: cat._count.categoryId,
        };
      }),
      instructors: instructors.map((inst) => {
        const details = instructorDetails.find(
          (d) => d.id === inst.instructorId
        );
        return {
          id: inst.instructorId,
          name: details
            ? `${details.user.firstName} ${details.user.lastName}`
            : "Unknown",
          profileImage: details?.user.profileImage,
          count: inst._count.instructorId,
        };
      }),
      priceRanges: [
        { label: "Free", min: 0, max: 0 },
        { label: "Under ₹500", min: 0, max: 500 },
        { label: "₹500 - ₹2000", min: 500, max: 2000 },
        { label: "₹2000 - ₹5000", min: 2000, max: 5000 },
        { label: "Above ₹5000", min: 5000, max: null },
      ],
      levels: ["BEGINNER", "INTERMEDIATE", "ADVANCED", "ALL_LEVELS"],
      durations: [
        { label: "Under 2 hours", max: 120 },
        { label: "2-6 hours", min: 120, max: 360 },
        { label: "6-17 hours", min: 360, max: 1020 },
        { label: "17+ hours", min: 1020 },
      ],
    };

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
        duration: course.duration,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        totalEnrollments: course.totalEnrollments,
        featured: course.featured,
        bestseller: course.bestseller,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
        },
        category: course.category,
        subcategory: course.subcategory,
        updatedAt: course.updatedAt,
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
        hasNext: skip + filters.limit < total,
        hasPrev: filters.page > 1,
      },
      facets,
      searchInfo: {
        query: cleanSearchTerm,
        totalResults: total,
        searchTime: Math.round(performance.now() - startTime),
        filters: filters,
      },
    };

    if (filters.page === 1 && total > 0) {
      await redisService.setJSON(cacheKey, result, { ex: 600 });
    }

    if (req.userAuthId) {
      await saveSearchHistory(
        req.userAuthId,
        cleanSearchTerm,
        "course",
        filters
      );
    }

    await incrementSearchCount(cleanSearchTerm);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course search completed successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`SEARCH_COURSES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      searchTerm: req.query.q,
      filters: req.query,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Search failed. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const searchInstructors = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { q: searchTerm } = req.query;

    const queryValidation = validateSearchQuery(searchTerm);
    if (!queryValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid search query",
        errors: queryValidation.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `search_instructors:${req.ip}`,
      50,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many search requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const { page = 1, limit = 20, sortBy = "rating" } = req.query;
    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cleanSearchTerm = searchTerm.trim();

    const where = {
      isVerified: true,
      user: {
        isActive: true,
        OR: [
          { firstName: { contains: cleanSearchTerm, mode: "insensitive" } },
          { lastName: { contains: cleanSearchTerm, mode: "insensitive" } },
          { email: { contains: cleanSearchTerm, mode: "insensitive" } },
        ],
      },
    };

    let orderBy = { rating: "desc" };
    if (sortBy === "students") {
      orderBy = { totalStudents: "desc" };
    } else if (sortBy === "courses") {
      orderBy = { totalCourses: "desc" };
    } else if (sortBy === "name") {
      orderBy = { user: { firstName: "asc" } };
    }

    const [instructors, total] = await Promise.all([
      prisma.instructor.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              profileImage: true,
              bio: true,
            },
          },
          courses: {
            where: { status: "PUBLISHED" },
            select: {
              id: true,
              title: true,
              thumbnail: true,
              averageRating: true,
              totalEnrollments: true,
            },
            take: 3,
          },
        },
      }),
      prisma.instructor.count({ where }),
    ]);

    const result = {
      instructors: instructors.map((instructor) => ({
        id: instructor.id,
        name: `${instructor.user.firstName} ${instructor.user.lastName}`,
        profileImage: instructor.user.profileImage,
        bio: instructor.user.bio,
        rating: instructor.rating,
        totalStudents: instructor.totalStudents,
        totalCourses: instructor.totalCourses,
        expertise: instructor.expertise,
        isVerified: instructor.isVerified,
        verificationBadge: instructor.verificationBadge,
        popularCourses: instructor.courses,
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      searchInfo: {
        query: cleanSearchTerm,
        totalResults: total,
        searchTime: Math.round(performance.now() - startTime),
      },
    };

    if (req.userAuthId) {
      await saveSearchHistory(req.userAuthId, cleanSearchTerm, "instructor");
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Instructor search completed successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SEARCH_INSTRUCTORS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      searchTerm: req.query.q,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Instructor search failed. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const searchContent = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { q: searchTerm, courseId } = req.query;

    const queryValidation = validateSearchQuery(searchTerm);
    if (!queryValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid search query",
        errors: queryValidation.errors,
        code: "VALIDATION_ERROR",
      });
    }

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required for content search",
        code: "MISSING_COURSE_ID",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `search_content:${req.userAuthId}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many search requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        status: "PUBLISHED",
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    if (req.userAuthId) {
      const enrollment = await prisma.enrollment.findFirst({
        where: {
          studentId: req.userAuthId,
          courseId: courseId,
          status: "ACTIVE",
        },
      });

      if (!enrollment && course.instructorId !== req.userAuthId) {
        return res.status(403).json({
          success: false,
          message: "You must be enrolled in this course to search its content",
          code: "ACCESS_DENIED",
        });
      }
    }

    const cleanSearchTerm = searchTerm.trim();

    const [lessons, quizzes, assignments] = await Promise.all([
      prisma.lesson.findMany({
        where: {
          section: { courseId },
          OR: [
            { title: { contains: cleanSearchTerm, mode: "insensitive" } },
            { description: { contains: cleanSearchTerm, mode: "insensitive" } },
            { content: { contains: cleanSearchTerm, mode: "insensitive" } },
            { transcript: { contains: cleanSearchTerm, mode: "insensitive" } },
          ],
        },
        include: {
          section: {
            select: {
              title: true,
              order: true,
            },
          },
        },
        orderBy: [{ section: { order: "asc" } }, { order: "asc" }],
      }),
      prisma.quiz.findMany({
        where: {
          section: { courseId },
          OR: [
            { title: { contains: cleanSearchTerm, mode: "insensitive" } },
            { description: { contains: cleanSearchTerm, mode: "insensitive" } },
            {
              instructions: { contains: cleanSearchTerm, mode: "insensitive" },
            },
          ],
        },
        include: {
          section: {
            select: {
              title: true,
              order: true,
            },
          },
        },
      }),
      prisma.assignment.findMany({
        where: {
          section: { courseId },
          OR: [
            { title: { contains: cleanSearchTerm, mode: "insensitive" } },
            { description: { contains: cleanSearchTerm, mode: "insensitive" } },
            {
              instructions: { contains: cleanSearchTerm, mode: "insensitive" },
            },
          ],
        },
        include: {
          section: {
            select: {
              title: true,
              order: true,
            },
          },
        },
      }),
    ]);

    const result = {
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        type: lesson.type,
        duration: lesson.duration,
        section: lesson.section.title,
        sectionOrder: lesson.section.order,
        order: lesson.order,
        contentType: "lesson",
      })),
      quizzes: quizzes.map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        section: quiz.section.title,
        sectionOrder: quiz.section.order,
        contentType: "quiz",
      })),
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        totalPoints: assignment.totalPoints,
        section: assignment.section.title,
        sectionOrder: assignment.section.order,
        contentType: "assignment",
      })),
      searchInfo: {
        query: cleanSearchTerm,
        courseId,
        totalResults: lessons.length + quizzes.length + assignments.length,
        searchTime: Math.round(performance.now() - startTime),
      },
    };

    if (req.userAuthId) {
      await saveSearchHistory(req.userAuthId, cleanSearchTerm, "content", {
        courseId,
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Content search completed successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SEARCH_CONTENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      searchTerm: req.query.q,
      courseId: req.query.courseId,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Content search failed. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSearchSuggestions = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { q: searchTerm, type = "course" } = req.query;

    if (!searchTerm || searchTerm.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search term must be at least 2 characters long",
        code: "INVALID_SEARCH_TERM",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `search_suggestions:${req.ip}`,
      200,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many suggestion requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const cleanSearchTerm = searchTerm.trim();
    const cacheKey = `suggestions:${type}:${cleanSearchTerm.toLowerCase()}`;

    let suggestions = await redisService.getJSON(cacheKey);

    if (!suggestions) {
      if (type === "course") {
        const [courseTitles, categories, instructors, tags] = await Promise.all(
          [
            prisma.course.findMany({
              where: {
                status: "PUBLISHED",
                title: { contains: cleanSearchTerm, mode: "insensitive" },
              },
              select: { title: true },
              take: 5,
            }),
            prisma.category.findMany({
              where: {
                name: { contains: cleanSearchTerm, mode: "insensitive" },
              },
              select: { name: true },
              take: 3,
            }),
            prisma.instructor.findMany({
              where: {
                user: {
                  OR: [
                    {
                      firstName: {
                        contains: cleanSearchTerm,
                        mode: "insensitive",
                      },
                    },
                    {
                      lastName: {
                        contains: cleanSearchTerm,
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
              include: {
                user: {
                  select: { firstName: true, lastName: true },
                },
              },
              take: 3,
            }),
            prisma.course.findMany({
              where: {
                status: "PUBLISHED",
                tags: { hasSome: [cleanSearchTerm] },
              },
              select: { tags: true },
              take: 10,
            }),
          ]
        );

        const tagSuggestions = tags
          .flatMap((course) => course.tags)
          .filter((tag) =>
            tag.toLowerCase().includes(cleanSearchTerm.toLowerCase())
          )
          .slice(0, 5);

        suggestions = {
          courses: courseTitles.map((c) => ({ type: "course", text: c.title })),
          categories: categories.map((c) => ({
            type: "category",
            text: c.name,
          })),
          instructors: instructors.map((i) => ({
            type: "instructor",
            text: `${i.user.firstName} ${i.user.lastName}`,
          })),
          tags: [...new Set(tagSuggestions)].map((tag) => ({
            type: "tag",
            text: tag,
          })),
        };
      } else if (type === "instructor") {
        const instructors = await prisma.instructor.findMany({
          where: {
            user: {
              OR: [
                {
                  firstName: { contains: cleanSearchTerm, mode: "insensitive" },
                },
                {
                  lastName: { contains: cleanSearchTerm, mode: "insensitive" },
                },
              ],
            },
          },
          include: {
            user: {
              select: { firstName: true, lastName: true },
            },
          },
          take: 10,
        });

        suggestions = {
          instructors: instructors.map((i) => ({
            type: "instructor",
            text: `${i.user.firstName} ${i.user.lastName}`,
          })),
        };
      }

      await redisService.setJSON(cacheKey, suggestions, { ex: 3600 });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Search suggestions retrieved successfully",
      data: {
        query: cleanSearchTerm,
        suggestions,
        type,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SEARCH_SUGGESTIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      searchTerm: req.query.q,
      type: req.query.type,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to get search suggestions",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSearchHistory = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const rateLimitResult = await redisService.rateLimitCheck(
      `search_history:${req.userAuthId}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const { limit = 20, type } = req.query;
    const maxLimit = Math.min(parseInt(limit), 50);

    const historyKey = `search_history:${req.userAuthId}`;
    const rawHistory = await redisService.lrange(historyKey, 0, maxLimit - 1);

    let history = rawHistory
      .map((item) => {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (type) {
      history = history.filter((item) => item.searchType === type);
    }

    const result = {
      history: history.map((item) => ({
        searchTerm: item.searchTerm,
        searchType: item.searchType,
        timestamp: item.timestamp,
        filters: item.filters ? JSON.parse(item.filters) : {},
      })),
      totalCount: history.length,
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Search history retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_SEARCH_HISTORY_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve search history",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const clearSearchHistory = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const rateLimitResult = await redisService.rateLimitCheck(
      `clear_search_history:${req.userAuthId}`,
      10,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many clear history requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const historyKey = `search_history:${req.userAuthId}`;
    await redisService.del(historyKey);

    await prisma.searchHistory.deleteMany({
      where: { userId: req.userAuthId },
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Search history cleared successfully",
      data: {
        cleared: true,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CLEAR_SEARCH_HISTORY_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to clear search history",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getPopularSearches = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const rateLimitResult = await redisService.rateLimitCheck(
      `popular_searches:${req.ip}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const { limit = 10 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 50);

    const cacheKey = "popular_searches";
    let popularSearches = await redisService.getJSON(cacheKey);

    if (!popularSearches) {
      const searchCounts = await redisService.keys("search_count:*");
      const countPromises = searchCounts.map(async (key) => {
        const term = key.replace("search_count:", "");
        const count = await redisService.get(key);
        return { term, count: parseInt(count) || 0 };
      });

      const results = await Promise.all(countPromises);
      popularSearches = results
        .sort((a, b) => b.count - a.count)
        .slice(0, maxLimit)
        .map((item) => ({
          searchTerm: item.term,
          searchCount: item.count,
        }));

      await redisService.setJSON(cacheKey, popularSearches, { ex: 3600 });
    }

    const trendingCategories = await prisma.category.findMany({
      where: {
        courses: {
          some: {
            status: "PUBLISHED",
          },
        },
      },
      select: {
        name: true,
        slug: true,
        _count: {
          select: {
            courses: {
              where: {
                status: "PUBLISHED",
              },
            },
          },
        },
      },
      orderBy: {
        courses: {
          _count: "desc",
        },
      },
      take: 5,
    });

    const result = {
      popularSearches: popularSearches.slice(0, maxLimit),
      trendingCategories: trendingCategories.map((cat) => ({
        name: cat.name,
        slug: cat.slug,
        courseCount: cat._count.courses,
      })),
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Popular searches retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_POPULAR_SEARCHES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve popular searches",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSearchFilters = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const rateLimitResult = await redisService.rateLimitCheck(
      `search_filters:${req.ip}`,
      50,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const cacheKey = "search_filters";
    let filters = await redisService.getJSON(cacheKey);

    if (!filters) {
      const [categories, instructors, languages] = await Promise.all([
        prisma.category.findMany({
          where: {
            courses: {
              some: {
                status: "PUBLISHED",
              },
            },
          },
          select: {
            name: true,
            slug: true,
            _count: {
              select: {
                courses: {
                  where: { status: "PUBLISHED" },
                },
              },
            },
          },
          orderBy: { name: "asc" },
        }),
        prisma.instructor.findMany({
          where: {
            isVerified: true,
            courses: {
              some: {
                status: "PUBLISHED",
              },
            },
          },
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
            rating: true,
            totalStudents: true,
          },
          orderBy: { rating: "desc" },
          take: 50,
        }),
        prisma.course.groupBy({
          by: ["language"],
          where: { status: "PUBLISHED" },
          _count: { language: true },
          orderBy: { _count: { language: "desc" } },
        }),
      ]);

      filters = {
        categories: categories.map((cat) => ({
          name: cat.name,
          slug: cat.slug,
          courseCount: cat._count.courses,
        })),
        topInstructors: instructors.map((inst) => ({
          id: inst.id,
          name: `${inst.user.firstName} ${inst.user.lastName}`,
          rating: inst.rating,
          totalStudents: inst.totalStudents,
        })),
        languages: languages.map((lang) => ({
          language: lang.language,
          courseCount: lang._count.language,
        })),
        levels: [
          { value: "BEGINNER", label: "Beginner" },
          { value: "INTERMEDIATE", label: "Intermediate" },
          { value: "ADVANCED", label: "Advanced" },
          { value: "ALL_LEVELS", label: "All Levels" },
        ],
        priceRanges: [
          { label: "Free", min: 0, max: 0 },
          { label: "Under ₹500", min: 0, max: 500 },
          { label: "₹500 - ₹2000", min: 500, max: 2000 },
          { label: "₹2000 - ₹5000", min: 2000, max: 5000 },
          { label: "Above ₹5000", min: 5000, max: null },
        ],
        durations: [
          { label: "Under 2 hours", max: 120 },
          { label: "2-6 hours", min: 120, max: 360 },
          { label: "6-17 hours", min: 360, max: 1020 },
          { label: "17+ hours", min: 1020 },
        ],
        ratings: [
          { label: "4.5 & up", value: 4.5 },
          { label: "4.0 & up", value: 4.0 },
          { label: "3.5 & up", value: 3.5 },
          { label: "3.0 & up", value: 3.0 },
        ],
      };

      await redisService.setJSON(cacheKey, filters, { ex: 7200 });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Search filters retrieved successfully",
      data: filters,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_SEARCH_FILTERS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve search filters",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
