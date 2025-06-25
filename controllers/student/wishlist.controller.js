import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `wishlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const generateCacheKey = (prefix, params) => {
  return `${prefix}:${Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(":")}`;
};

const invalidateWishlistCache = async (userId) => {
  const patterns = [
    `wishlist:*userId=${userId}*`,
    `wishlist_recommendations:*userId=${userId}*`,
    `wishlist_status:*userId=${userId}*`,
  ];

  for (const pattern of patterns) {
    await redisService.invalidateCache(pattern);
  }
};

export const getWishlist = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 12,
      sortBy = "recent",
      category,
      search,
      priceRange,
      level,
    } = req.query;

    const cacheKey = generateCacheKey("wishlist", {
      userId: req.userAuthId,
      page,
      limit,
      sortBy,
      category: category || "",
      search: search || "",
      priceRange: priceRange || "",
      level: level || "",
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

    const where = {
      studentId: req.userAuthId,
    };

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

    if (level) {
      where.course = {
        ...where.course,
        level: level,
      };
    }

    if (priceRange) {
      const [min, max] = priceRange.split("-").map(Number);
      where.course = {
        ...where.course,
        price: {
          gte: min,
          ...(max && { lte: max }),
        },
      };
    }

    let orderBy = { createdAt: "desc" };
    if (sortBy === "alphabetical") {
      orderBy = { course: { title: "asc" } };
    } else if (sortBy === "price_low") {
      orderBy = { course: { price: "asc" } };
    } else if (sortBy === "price_high") {
      orderBy = { course: { price: "desc" } };
    } else if (sortBy === "rating") {
      orderBy = { course: { averageRating: "desc" } };
    }

    const [wishlistItems, total] = await Promise.all([
      prisma.wishlistItem.findMany({
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
              subcategory: true,
              _count: {
                select: {
                  reviews: true,
                  enrollments: true,
                },
              },
            },
          },
        },
      }),
      prisma.wishlistItem.count({ where }),
    ]);

    const studentId = req.userAuthId;
    const courseIds = wishlistItems.map((item) => item.course.id);

    const [enrollments, cartItems] = await Promise.all([
      prisma.enrollment.findMany({
        where: {
          studentId,
          courseId: { in: courseIds },
        },
        select: { courseId: true },
      }),
      prisma.cartItem.findMany({
        where: {
          studentId,
          courseId: { in: courseIds },
        },
        select: { courseId: true },
      }),
    ]);

    const enrolledCourseIds = new Set(enrollments.map((e) => e.courseId));
    const cartCourseIds = new Set(cartItems.map((c) => c.courseId));

    const result = {
      wishlistItems: wishlistItems.map((item) => ({
        id: item.id,
        addedAt: item.createdAt,
        course: {
          id: item.course.id,
          title: item.course.title,
          slug: item.course.slug,
          shortDescription: item.course.shortDescription,
          thumbnail: item.course.thumbnail,
          previewVideo: item.course.previewVideo,
          price: item.course.price,
          discountPrice: item.course.discountPrice,
          originalPrice: item.course.originalPrice,
          duration: item.course.duration,
          level: item.course.level,
          language: item.course.language,
          totalLessons: item.course.totalLessons,
          averageRating: item.course.averageRating,
          totalRatings: item.course.totalRatings,
          featured: item.course.featured,
          bestseller: item.course.bestseller,
          trending: item.course.trending,
          status: item.course.status,
          publishedAt: item.course.publishedAt,
          lastUpdated: item.course.lastUpdated,
          instructor: {
            id: item.course.instructor.id,
            name: `${item.course.instructor.user.firstName} ${item.course.instructor.user.lastName}`,
            profileImage: item.course.instructor.user.profileImage,
            title: item.course.instructor.title,
            rating: item.course.instructor.rating,
            isVerified: item.course.instructor.isVerified,
          },
          category: item.course.category,
          subcategory: item.course.subcategory,
          reviewsCount: item.course._count.reviews,
          enrollmentsCount: item.course._count.enrollments,
          isEnrolled: enrolledCourseIds.has(item.course.id),
          isInCart: cartCourseIds.has(item.course.id),
        },
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
        totalItems: total,
        totalValue: wishlistItems.reduce((sum, item) => {
          const price = item.course.discountPrice || item.course.price;
          return sum + parseFloat(price);
        }, 0),
        averagePrice:
          total > 0
            ? wishlistItems.reduce((sum, item) => {
                const price = item.course.discountPrice || item.course.price;
                return sum + parseFloat(price);
              }, 0) / total
            : 0,
        categories: [
          ...new Set(wishlistItems.map((item) => item.course.category.name)),
        ],
        levels: [...new Set(wishlistItems.map((item) => item.course.level))],
      },
      filters: {
        availableCategories: await getAvailableCategories(req.userAuthId),
        availableLevels: ["BEGINNER", "INTERMEDIATE", "ADVANCED", "ALL_LEVELS"],
        priceRanges: [
          { label: "Free", min: 0, max: 0 },
          { label: "Under ₹500", min: 0, max: 500 },
          { label: "₹500 - ₹2000", min: 500, max: 2000 },
          { label: "₹2000 - ₹5000", min: 2000, max: 5000 },
          { label: "Above ₹5000", min: 5000, max: null },
        ],
      },
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Wishlist retrieved successfully",
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
    console.error(`GET_WISHLIST_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve wishlist",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const addToWishlist = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        status: true,
        price: true,
        discountPrice: true,
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
        message: "Course is not available for wishlist",
        code: "COURSE_NOT_AVAILABLE",
      });
    }

    const isEnrolled = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: req.userAuthId,
          courseId: courseId,
        },
      },
    });

    if (isEnrolled) {
      return res.status(400).json({
        success: false,
        message: "You are already enrolled in this course",
        code: "ALREADY_ENROLLED",
      });
    }

    const existingWishlistItem = await prisma.wishlistItem.findUnique({
      where: {
        studentId_courseId: {
          studentId: req.userAuthId,
          courseId: courseId,
        },
      },
    });

    if (existingWishlistItem) {
      return res.status(400).json({
        success: false,
        message: "Course is already in your wishlist",
        code: "ALREADY_IN_WISHLIST",
      });
    }

    const wishlistItem = await prisma.wishlistItem.create({
      data: {
        studentId: req.userAuthId,
        courseId: courseId,
      },
      include: {
        course: {
          select: {
            title: true,
            thumbnail: true,
            price: true,
            discountPrice: true,
          },
        },
      },
    });

    await Promise.all([
      updateWishlistCache(req.userAuthId),
      invalidateWishlistCache(req.userAuthId),
    ]);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Course added to wishlist successfully",
      data: {
        wishlistItem: {
          id: wishlistItem.id,
          courseId: wishlistItem.courseId,
          addedAt: wishlistItem.createdAt,
          course: {
            title: wishlistItem.course.title,
            thumbnail: wishlistItem.course.thumbnail,
            price: wishlistItem.course.price,
            discountPrice: wishlistItem.course.discountPrice,
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
    console.error(`ADD_TO_WISHLIST_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to add course to wishlist",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const removeFromWishlist = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    const wishlistItem = await prisma.wishlistItem.findUnique({
      where: {
        studentId_courseId: {
          studentId: req.userAuthId,
          courseId: courseId,
        },
      },
      include: {
        course: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!wishlistItem) {
      return res.status(404).json({
        success: false,
        message: "Course not found in wishlist",
        code: "NOT_IN_WISHLIST",
      });
    }

    await prisma.wishlistItem.delete({
      where: {
        studentId_courseId: {
          studentId: req.userAuthId,
          courseId: courseId,
        },
      },
    });

    await Promise.all([
      updateWishlistCache(req.userAuthId),
      invalidateWishlistCache(req.userAuthId),
    ]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course removed from wishlist successfully",
      data: {
        removedCourse: {
          id: courseId,
          title: wishlistItem.course.title,
          removedAt: new Date(),
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REMOVE_FROM_WISHLIST_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to remove course from wishlist",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const moveToCart = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;

    const wishlistItem = await prisma.wishlistItem.findUnique({
      where: {
        studentId_courseId: {
          studentId: req.userAuthId,
          courseId: courseId,
        },
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            price: true,
            discountPrice: true,
            status: true,
          },
        },
      },
    });

    if (!wishlistItem) {
      return res.status(404).json({
        success: false,
        message: "Course not found in wishlist",
        code: "NOT_IN_WISHLIST",
      });
    }

    if (wishlistItem.course.status !== "PUBLISHED") {
      return res.status(400).json({
        success: false,
        message: "Course is not available for purchase",
        code: "COURSE_NOT_AVAILABLE",
      });
    }

    const isEnrolled = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: req.userAuthId,
          courseId: courseId,
        },
      },
    });

    if (isEnrolled) {
      return res.status(400).json({
        success: false,
        message: "You are already enrolled in this course",
        code: "ALREADY_ENROLLED",
      });
    }

    const existingCartItem = await prisma.cartItem.findUnique({
      where: {
        studentId_courseId: {
          studentId: req.userAuthId,
          courseId: courseId,
        },
      },
    });

    if (existingCartItem) {
      await prisma.wishlistItem.delete({
        where: {
          studentId_courseId: {
            studentId: req.userAuthId,
            courseId: courseId,
          },
        },
      });

      await Promise.all([
        updateWishlistCache(req.userAuthId),
        invalidateWishlistCache(req.userAuthId),
      ]);

      return res.status(200).json({
        success: true,
        message: "Course is already in your cart. Removed from wishlist.",
        data: {
          action: "removed_from_wishlist",
          course: {
            id: courseId,
            title: wishlistItem.course.title,
          },
        },
      });
    }

    const price =
      wishlistItem.course.discountPrice || wishlistItem.course.price;

    await prisma.$transaction(async (tx) => {
      await tx.cartItem.create({
        data: {
          studentId: req.userAuthId,
          courseId: courseId,
          price: price,
        },
      });

      await tx.wishlistItem.delete({
        where: {
          studentId_courseId: {
            studentId: req.userAuthId,
            courseId: courseId,
          },
        },
      });
    });

    await Promise.all([
      updateWishlistCache(req.userAuthId),
      updateCartCache(req.userAuthId),
      invalidateWishlistCache(req.userAuthId),
      redisService.invalidateCache(`cart:*userId=${req.userAuthId}*`),
    ]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course moved to cart successfully",
      data: {
        action: "moved_to_cart",
        course: {
          id: courseId,
          title: wishlistItem.course.title,
          price: price,
        },
        movedAt: new Date(),
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`MOVE_TO_CART_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to move course to cart",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const moveAllToCart = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const wishlistItems = await prisma.wishlistItem.findMany({
      where: {
        studentId: req.userAuthId,
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            price: true,
            discountPrice: true,
            status: true,
          },
        },
      },
    });

    if (wishlistItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Your wishlist is empty",
        code: "WISHLIST_EMPTY",
      });
    }

    const availableCourses = wishlistItems.filter(
      (item) => item.course.status === "PUBLISHED"
    );

    if (availableCourses.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No courses in your wishlist are available for purchase",
        code: "NO_AVAILABLE_COURSES",
      });
    }

    const courseIds = availableCourses.map((item) => item.course.id);

    const [enrollments, existingCartItems] = await Promise.all([
      prisma.enrollment.findMany({
        where: {
          studentId: req.userAuthId,
          courseId: { in: courseIds },
        },
        select: { courseId: true },
      }),
      prisma.cartItem.findMany({
        where: {
          studentId: req.userAuthId,
          courseId: { in: courseIds },
        },
        select: { courseId: true },
      }),
    ]);

    const enrolledCourseIds = new Set(enrollments.map((e) => e.courseId));
    const cartCourseIds = new Set(existingCartItems.map((c) => c.courseId));

    const coursesToMove = availableCourses.filter(
      (item) =>
        !enrolledCourseIds.has(item.course.id) &&
        !cartCourseIds.has(item.course.id)
    );

    if (coursesToMove.length === 0) {
      return res.status(400).json({
        success: false,
        message: "All courses are either already enrolled or in cart",
        code: "NO_COURSES_TO_MOVE",
      });
    }

    const movedCourses = [];
    const skippedCourses = [];

    await prisma.$transaction(async (tx) => {
      for (const item of coursesToMove) {
        const price = item.course.discountPrice || item.course.price;

        await tx.cartItem.create({
          data: {
            studentId: req.userAuthId,
            courseId: item.course.id,
            price: price,
          },
        });

        await tx.wishlistItem.delete({
          where: {
            studentId_courseId: {
              studentId: req.userAuthId,
              courseId: item.course.id,
            },
          },
        });

        movedCourses.push({
          id: item.course.id,
          title: item.course.title,
          price: price,
        });
      }

      for (const item of availableCourses) {
        if (enrolledCourseIds.has(item.course.id)) {
          skippedCourses.push({
            id: item.course.id,
            title: item.course.title,
            reason: "already_enrolled",
          });
        } else if (cartCourseIds.has(item.course.id)) {
          await tx.wishlistItem.delete({
            where: {
              studentId_courseId: {
                studentId: req.userAuthId,
                courseId: item.course.id,
              },
            },
          });

          skippedCourses.push({
            id: item.course.id,
            title: item.course.title,
            reason: "already_in_cart",
          });
        }
      }
    });

    await Promise.all([
      updateWishlistCache(req.userAuthId),
      updateCartCache(req.userAuthId),
      invalidateWishlistCache(req.userAuthId),
      redisService.invalidateCache(`cart:*userId=${req.userAuthId}*`),
    ]);

    const totalValue = movedCourses.reduce(
      (sum, course) => sum + parseFloat(course.price),
      0
    );

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: `Successfully moved ${movedCourses.length} courses to cart`,
      data: {
        summary: {
          totalAttempted: availableCourses.length,
          successfullyMoved: movedCourses.length,
          skipped: skippedCourses.length,
          totalValue: totalValue,
        },
        movedCourses,
        skippedCourses,
        movedAt: new Date(),
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`MOVE_ALL_TO_CART_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to move courses to cart",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const clearWishlist = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const wishlistCount = await prisma.wishlistItem.count({
      where: {
        studentId: req.userAuthId,
      },
    });

    if (wishlistCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Your wishlist is already empty",
        code: "WISHLIST_ALREADY_EMPTY",
      });
    }

    const deletedItems = await prisma.wishlistItem.deleteMany({
      where: {
        studentId: req.userAuthId,
      },
    });

    await Promise.all([
      updateWishlistCache(req.userAuthId),
      invalidateWishlistCache(req.userAuthId),
    ]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Wishlist cleared successfully",
      data: {
        deletedItemsCount: deletedItems.count,
        clearedAt: new Date(),
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CLEAR_WISHLIST_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to clear wishlist",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const checkWishlistStatus = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseIds } = req.body;

    if (!Array.isArray(courseIds) || courseIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Course IDs array is required",
        code: "INVALID_INPUT",
      });
    }

    if (courseIds.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Maximum 50 courses can be checked at once",
        code: "TOO_MANY_COURSES",
      });
    }

    const cacheKey = generateCacheKey("wishlist_status", {
      userId: req.userAuthId,
      courseIds: courseIds.sort().join(","),
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

    const wishlistItems = await prisma.wishlistItem.findMany({
      where: {
        studentId: req.userAuthId,
        courseId: { in: courseIds },
      },
      select: {
        courseId: true,
        createdAt: true,
      },
    });

    const wishlistMap = new Map(
      wishlistItems.map((item) => [item.courseId, item.createdAt])
    );

    const result = courseIds.map((courseId) => ({
      courseId,
      isInWishlist: wishlistMap.has(courseId),
      addedAt: wishlistMap.get(courseId) || null,
    }));

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Wishlist status checked successfully",
      data: {
        courses: result,
        summary: {
          totalChecked: courseIds.length,
          inWishlist: wishlistItems.length,
          notInWishlist: courseIds.length - wishlistItems.length,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    };

    await redisService.setCache(cacheKey, response, 600);

    res.status(200).json(response);
  } catch (error) {
    console.error(`CHECK_WISHLIST_STATUS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to check wishlist status",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getWishlistRecommendations = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { limit = 10 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 20);

    const cacheKey = generateCacheKey("wishlist_recommendations", {
      userId: req.userAuthId,
      limit: maxLimit,
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

    const wishlistItems = await prisma.wishlistItem.findMany({
      where: {
        studentId: req.userAuthId,
      },
      include: {
        course: {
          select: {
            categoryId: true,
            subcategoryId: true,
            level: true,
            tags: true,
            instructor: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (wishlistItems.length === 0) {
      const response = {
        success: true,
        message: "No wishlist items found to generate recommendations",
        data: {
          recommendations: [],
          reasoning: "empty_wishlist",
        },
        meta: {
          requestId,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      };

      await redisService.setCache(cacheKey, response, 300);
      return res.status(200).json(response);
    }

    const categoryIds = [
      ...new Set(wishlistItems.map((item) => item.course.categoryId)),
    ];
    const subcategoryIds = [
      ...new Set(
        wishlistItems.map((item) => item.course.subcategoryId).filter(Boolean)
      ),
    ];
    const levels = [...new Set(wishlistItems.map((item) => item.course.level))];
    const instructorIds = [
      ...new Set(wishlistItems.map((item) => item.course.instructor.id)),
    ];
    const allTags = wishlistItems.flatMap((item) => item.course.tags);
    const popularTags = [...new Set(allTags)].slice(0, 10);

    const excludeCourseIds = wishlistItems.map((item) => item.courseId);

    const [enrollments, cartItems] = await Promise.all([
      prisma.enrollment.findMany({
        where: { studentId: req.userAuthId },
        select: { courseId: true },
      }),
      prisma.cartItem.findMany({
        where: { studentId: req.userAuthId },
        select: { courseId: true },
      }),
    ]);

    excludeCourseIds.push(...enrollments.map((e) => e.courseId));
    excludeCourseIds.push(...cartItems.map((c) => c.courseId));

    const recommendations = await prisma.course.findMany({
      where: {
        id: { notIn: excludeCourseIds },
        status: "PUBLISHED",
        OR: [
          { categoryId: { in: categoryIds } },
          { subcategoryId: { in: subcategoryIds } },
          { level: { in: levels } },
          { instructorId: { in: instructorIds } },
          { tags: { hasSome: popularTags } },
        ],
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
        category: true,
        _count: {
          select: {
            reviews: true,
            enrollments: true,
          },
        },
      },
      orderBy: [
        { featured: "desc" },
        { averageRating: "desc" },
        { totalEnrollments: "desc" },
      ],
      take: maxLimit,
    });

    const enhancedRecommendations = recommendations.map((course) => {
      let matchReasons = [];

      if (categoryIds.includes(course.categoryId)) {
        matchReasons.push("same_category");
      }
      if (subcategoryIds.includes(course.subcategoryId)) {
        matchReasons.push("same_subcategory");
      }
      if (levels.includes(course.level)) {
        matchReasons.push("same_level");
      }
      if (instructorIds.includes(course.instructorId)) {
        matchReasons.push("same_instructor");
      }
      if (course.tags.some((tag) => popularTags.includes(tag))) {
        matchReasons.push("similar_topics");
      }

      return {
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        thumbnail: course.thumbnail,
        price: course.price,
        discountPrice: course.discountPrice,
        duration: course.duration,
        level: course.level,
        averageRating: course.averageRating,
        totalRatings: course.totalRatings,
        featured: course.featured,
        bestseller: course.bestseller,
        instructor: {
          id: course.instructor.id,
          name: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
          profileImage: course.instructor.user.profileImage,
          rating: course.instructor.rating,
        },
        category: course.category,
        reviewsCount: course._count.reviews,
        enrollmentsCount: course._count.enrollments,
        matchReasons,
        recommendationScore: matchReasons.length,
      };
    });

    enhancedRecommendations.sort(
      (a, b) => b.recommendationScore - a.recommendationScore
    );

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Wishlist recommendations generated successfully",
      data: {
        recommendations: enhancedRecommendations,
        basedOn: {
          wishlistSize: wishlistItems.length,
          categories: categoryIds.length,
          instructors: instructorIds.length,
          preferredLevels: levels,
        },
        reasoning: "wishlist_analysis",
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    };

    await redisService.setCache(cacheKey, response, 900);

    res.status(200).json(response);
  } catch (error) {
    console.error(`GET_WISHLIST_RECOMMENDATIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to generate recommendations",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const shareWishlist = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { privacy = "private", expiresIn = 30 } = req.body;

    if (!["public", "private", "link_only"].includes(privacy)) {
      return res.status(400).json({
        success: false,
        message: "Invalid privacy setting",
        code: "INVALID_PRIVACY",
      });
    }

    const wishlistCount = await prisma.wishlistItem.count({
      where: {
        studentId: req.userAuthId,
      },
    });

    if (wishlistCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot share an empty wishlist",
        code: "WISHLIST_EMPTY",
      });
    }

    const shareToken = generateShareToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(expiresIn));

    const shareData = {
      studentId: req.userAuthId,
      privacy,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };

    await redisService.setJSON(`wishlist_share:${shareToken}`, shareData, {
      ex: parseInt(expiresIn) * 24 * 60 * 60,
    });

    const shareUrl = `${process.env.FRONTEND_URL}/shared-wishlist/${shareToken}`;

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Wishlist shared successfully",
      data: {
        shareToken,
        shareUrl,
        privacy,
        expiresAt,
        wishlistItemsCount: wishlistCount,
        validFor: `${expiresIn} days`,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SHARE_WISHLIST_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to share wishlist",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSharedWishlist = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { shareToken } = req.params;

    const cacheKey = generateCacheKey("shared_wishlist", {
      token: shareToken,
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

    const shareData = await redisService.getJSON(
      `wishlist_share:${shareToken}`
    );

    if (!shareData) {
      return res.status(404).json({
        success: false,
        message: "Shared wishlist not found or has expired",
        code: "SHARE_NOT_FOUND",
      });
    }

    if (new Date(shareData.expiresAt) < new Date()) {
      await redisService.del(`wishlist_share:${shareToken}`);
      return res.status(410).json({
        success: false,
        message: "Shared wishlist has expired",
        code: "SHARE_EXPIRED",
      });
    }

    const wishlistItems = await prisma.wishlistItem.findMany({
      where: {
        studentId: shareData.studentId,
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
            _count: {
              select: {
                reviews: true,
                enrollments: true,
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
      orderBy: { createdAt: "desc" },
    });

    const ownerInfo =
      wishlistItems.length > 0
        ? {
            name: `${wishlistItems[0].student.user.firstName} ${wishlistItems[0].student.user.lastName}`,
            profileImage: wishlistItems[0].student.user.profileImage,
          }
        : null;

    const result = {
      shareInfo: {
        token: shareToken,
        privacy: shareData.privacy,
        sharedAt: shareData.createdAt,
        expiresAt: shareData.expiresAt,
        owner: ownerInfo,
      },
      wishlistItems: wishlistItems.map((item) => ({
        id: item.id,
        addedAt: item.createdAt,
        course: {
          id: item.course.id,
          title: item.course.title,
          slug: item.course.slug,
          shortDescription: item.course.shortDescription,
          thumbnail: item.course.thumbnail,
          price: item.course.price,
          discountPrice: item.course.discountPrice,
          duration: item.course.duration,
          level: item.course.level,
          averageRating: item.course.averageRating,
          totalRatings: item.course.totalRatings,
          instructor: {
            id: item.course.instructor.id,
            name: `${item.course.instructor.user.firstName} ${item.course.instructor.user.lastName}`,
            profileImage: item.course.instructor.user.profileImage,
            rating: item.course.instructor.rating,
          },
          category: item.course.category,
          reviewsCount: item.course._count.reviews,
          enrollmentsCount: item.course._count.enrollments,
        },
      })),
      summary: {
        totalItems: wishlistItems.length,
        totalValue: wishlistItems.reduce((sum, item) => {
          const price = item.course.discountPrice || item.course.price;
          return sum + parseFloat(price);
        }, 0),
        categories: [
          ...new Set(wishlistItems.map((item) => item.course.category.name)),
        ],
        levels: [...new Set(wishlistItems.map((item) => item.course.level))],
      },
    };

    const executionTime = performance.now() - startTime;

    const response = {
      success: true,
      message: "Shared wishlist retrieved successfully",
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
    console.error(`GET_SHARED_WISHLIST_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      shareToken: req.params.shareToken,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve shared wishlist",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const updateWishlistCache = async (studentId) => {
  try {
    const cacheKey = `wishlist:${studentId}`;
    const count = await prisma.wishlistItem.count({
      where: { studentId },
    });
    await redisService.set(cacheKey, count.toString(), { ex: 3600 });
  } catch (error) {
    console.error("Error updating wishlist cache:", error);
  }
};

const updateCartCache = async (studentId) => {
  try {
    const cacheKey = `cart:${studentId}`;
    const count = await prisma.cartItem.count({
      where: { studentId },
    });
    await redisService.set(cacheKey, count.toString(), { ex: 3600 });
  } catch (error) {
    console.error("Error updating cart cache:", error);
  }
};

const getAvailableCategories = async (studentId) => {
  try {
    const categories = await prisma.category.findMany({
      where: {
        courses: {
          some: {
            wishlistItems: {
              some: {
                studentId,
              },
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: {
          select: {
            courses: {
              where: {
                wishlistItems: {
                  some: {
                    studentId,
                  },
                },
              },
            },
          },
        },
      },
    });

    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      courseCount: cat._count.courses,
    }));
  } catch (error) {
    console.error("Error getting available categories:", error);
    return [];
  }
};

const generateShareToken = () => {
  return `wl_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`;
};
