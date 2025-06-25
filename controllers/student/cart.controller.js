import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `cart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const addToCart = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.body;
    const studentId = req.userAuthId;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        price: true,
        discountPrice: true,
        status: true,
        instructorId: true,
        thumbnail: true,
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
        message: "Course is not available for purchase",
        code: "COURSE_NOT_AVAILABLE",
      });
    }

    if (course.instructorId === studentId) {
      return res.status(400).json({
        success: false,
        message: "You cannot purchase your own course",
        code: "OWN_COURSE_PURCHASE",
      });
    }

    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: {
          studentId: studentId,
          courseId: courseId,
        },
      },
    });

    if (existingEnrollment) {
      return res.status(400).json({
        success: false,
        message: "You are already enrolled in this course",
        code: "ALREADY_ENROLLED",
      });
    }

    const existingCartItem = await prisma.cartItem.findUnique({
      where: {
        studentId_courseId: {
          studentId: studentId,
          courseId: courseId,
        },
      },
    });

    if (existingCartItem) {
      return res.status(400).json({
        success: false,
        message: "Course is already in your cart",
        code: "ALREADY_IN_CART",
      });
    }

    const cartItem = await prisma.cartItem.create({
      data: {
        studentId: studentId,
        courseId: courseId,
        price: course.discountPrice || course.price,
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            discountPrice: true,
            thumbnail: true,
            averageRating: true,
            totalRatings: true,
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
        },
      },
    });

    const cacheKey = `cart:${studentId}`;
    await redisService.del(cacheKey);
    await redisService.del(`cart_totals:${studentId}`);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Course added to cart successfully",
      data: {
        cartItem: {
          id: cartItem.id,
          price: cartItem.price,
          addedAt: cartItem.createdAt,
          course: {
            id: cartItem.course.id,
            title: cartItem.course.title,
            slug: cartItem.course.slug,
            price: cartItem.course.price,
            discountPrice: cartItem.course.discountPrice,
            thumbnail: cartItem.course.thumbnail,
            averageRating: cartItem.course.averageRating,
            totalRatings: cartItem.course.totalRatings,
            instructor: {
              name: `${cartItem.course.instructor.user.firstName} ${cartItem.course.instructor.user.lastName}`,
            },
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
    console.error(`ADD_TO_CART_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.body.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to add course to cart",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const removeFromCart = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const studentId = req.userAuthId;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const cartItem = await prisma.cartItem.findUnique({
      where: {
        studentId_courseId: {
          studentId: studentId,
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

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Course not found in cart",
        code: "CART_ITEM_NOT_FOUND",
      });
    }

    await prisma.cartItem.delete({
      where: {
        studentId_courseId: {
          studentId: studentId,
          courseId: courseId,
        },
      },
    });

    const cacheKey = `cart:${studentId}`;
    await redisService.del(cacheKey);
    await redisService.del(`cart_totals:${studentId}`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course removed from cart successfully",
      data: {
        removedCourse: {
          id: courseId,
          title: cartItem.course.title,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REMOVE_FROM_CART_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to remove course from cart",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCart = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const studentId = req.userAuthId;
    const cacheKey = `cart:${studentId}`;

    let cartItems = await redisService.getJSON(cacheKey);

    if (!cartItems) {
      cartItems = await prisma.cartItem.findMany({
        where: { studentId: studentId },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              slug: true,
              price: true,
              discountPrice: true,
              thumbnail: true,
              averageRating: true,
              totalRatings: true,
              duration: true,
              level: true,
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
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (cartItems.length > 0) {
        await redisService.setJSON(cacheKey, cartItems, { ex: 300 });
      }
    }

    const formattedCartItems = cartItems.map((item) => ({
      id: item.id,
      price: item.price,
      addedAt: item.createdAt,
      course: {
        id: item.course.id,
        title: item.course.title,
        slug: item.course.slug,
        price: item.course.price,
        discountPrice: item.course.discountPrice,
        thumbnail: item.course.thumbnail,
        averageRating: item.course.averageRating,
        totalRatings: item.course.totalRatings,
        duration: item.course.duration,
        level: item.course.level,
        instructor: {
          name: `${item.course.instructor.user.firstName} ${item.course.instructor.user.lastName}`,
        },
      },
    }));

    const subtotal = cartItems.reduce(
      (sum, item) => sum + Number(item.price),
      0
    );

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Cart retrieved successfully",
      data: {
        cartItems: formattedCartItems,
        summary: {
          totalItems: cartItems.length,
          subtotal: subtotal,
          isEmpty: cartItems.length === 0,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cached: !!cartItems,
      },
    });
  } catch (error) {
    console.error(`GET_CART_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve cart",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const clearCart = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const studentId = req.userAuthId;

    const deletedItems = await prisma.cartItem.deleteMany({
      where: { studentId: studentId },
    });

    const cacheKey = `cart:${studentId}`;
    await redisService.del(cacheKey);
    await redisService.del(`cart_totals:${studentId}`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
      data: {
        itemsRemoved: deletedItems.count,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CLEAR_CART_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to clear cart",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const validateCoupon = async (
  couponCode,
  userId,
  cartTotal,
  courseIds = []
) => {
  const coupon = await prisma.coupon.findUnique({
    where: { code: couponCode },
    include: {
      courses: {
        select: { id: true },
      },
    },
  });

  if (!coupon) {
    return { valid: false, message: "Coupon code not found" };
  }

  if (!coupon.isActive) {
    return { valid: false, message: "Coupon is no longer active" };
  }

  const now = new Date();
  if (now < coupon.validFrom) {
    return { valid: false, message: "Coupon is not yet valid" };
  }

  if (now > coupon.validUntil) {
    return { valid: false, message: "Coupon has expired" };
  }

  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, message: "Coupon usage limit exceeded" };
  }

  if (coupon.minimumAmount && cartTotal < Number(coupon.minimumAmount)) {
    return {
      valid: false,
      message: `Minimum order amount of ₹${coupon.minimumAmount} required`,
    };
  }

  const hasUsedBefore = await prisma.couponUsage.findFirst({
    where: {
      couponId: coupon.id,
      userId: userId,
    },
  });

  if (hasUsedBefore) {
    return { valid: false, message: "You have already used this coupon" };
  }

  if (coupon.applicableTo === "SPECIFIC_COURSES") {
    const applicableCourseIds = coupon.courses.map((c) => c.id);
    const hasApplicableCourse = courseIds.some((id) =>
      applicableCourseIds.includes(id)
    );

    if (!hasApplicableCourse) {
      return {
        valid: false,
        message: "This coupon is not applicable to courses in your cart",
      };
    }
  }

  return { valid: true, coupon };
};

const calculateDiscount = (coupon, cartTotal, applicableCourseTotal = null) => {
  const baseAmount = applicableCourseTotal || cartTotal;

  let discountAmount = 0;

  if (coupon.type === "PERCENTAGE") {
    discountAmount = (baseAmount * Number(coupon.value)) / 100;
  } else if (coupon.type === "FIXED_AMOUNT") {
    discountAmount = Math.min(Number(coupon.value), baseAmount);
  }

  if (coupon.maximumDiscount) {
    discountAmount = Math.min(discountAmount, Number(coupon.maximumDiscount));
  }

  return Math.round(discountAmount * 100) / 100;
};

export const applyCoupon = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { couponCode } = req.body;
    const studentId = req.userAuthId;

    if (!couponCode) {
      return res.status(400).json({
        success: false,
        message: "Coupon code is required",
        code: "MISSING_COUPON_CODE",
      });
    }

    const cartItems = await prisma.cartItem.findMany({
      where: { studentId: studentId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            price: true,
            discountPrice: true,
            categoryId: true,
            instructorId: true,
          },
        },
      },
    });

    if (cartItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
        code: "EMPTY_CART",
      });
    }

    const cartTotal = cartItems.reduce(
      (sum, item) => sum + Number(item.price),
      0
    );
    const courseIds = cartItems.map((item) => item.course.id);

    const validation = await validateCoupon(
      couponCode.toUpperCase(),
      studentId,
      cartTotal,
      courseIds
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        code: "INVALID_COUPON",
      });
    }

    const { coupon } = validation;

    let applicableCourseTotal = cartTotal;
    let applicableCourses = cartItems;

    if (coupon.applicableTo === "SPECIFIC_COURSES") {
      const applicableCourseIds = coupon.courses.map((c) => c.id);
      applicableCourses = cartItems.filter((item) =>
        applicableCourseIds.includes(item.course.id)
      );
      applicableCourseTotal = applicableCourses.reduce(
        (sum, item) => sum + Number(item.price),
        0
      );
    } else if (coupon.applicableTo === "CATEGORY") {
      applicableCourses = cartItems.filter((item) =>
        coupon.categoryIds?.includes(item.course.categoryId)
      );
      applicableCourseTotal = applicableCourses.reduce(
        (sum, item) => sum + Number(item.price),
        0
      );
    } else if (coupon.applicableTo === "INSTRUCTOR") {
      applicableCourses = cartItems.filter((item) =>
        coupon.instructorIds?.includes(item.course.instructorId)
      );
      applicableCourseTotal = applicableCourses.reduce(
        (sum, item) => sum + Number(item.price),
        0
      );
    }

    const discountAmount = calculateDiscount(
      coupon,
      cartTotal,
      applicableCourseTotal
    );

    const sessionKey = `cart_coupon:${studentId}`;
    const couponSession = {
      couponId: coupon.id,
      code: coupon.code,
      title: coupon.title,
      type: coupon.type,
      value: coupon.value,
      discountAmount: discountAmount,
      appliedAt: new Date().toISOString(),
      applicableCourses: applicableCourses.map((item) => ({
        courseId: item.course.id,
        title: item.course.title,
      })),
    };

    await redisService.setJSON(sessionKey, couponSession, { ex: 3600 });

    await redisService.del(`cart_totals:${studentId}`);

    const finalTotal = Math.max(0, cartTotal - discountAmount);
    const savings = discountAmount;

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Coupon applied successfully",
      data: {
        coupon: {
          code: coupon.code,
          title: coupon.title,
          type: coupon.type,
          value: coupon.value,
          discountAmount: discountAmount,
          applicableCourses: applicableCourses.length,
        },
        totals: {
          subtotal: cartTotal,
          discount: discountAmount,
          total: finalTotal,
          savings: savings,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`APPLY_COUPON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      couponCode: req.body.couponCode,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to apply coupon",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const removeCoupon = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const studentId = req.userAuthId;
    const sessionKey = `cart_coupon:${studentId}`;

    const existingCoupon = await redisService.getJSON(sessionKey);

    if (!existingCoupon) {
      return res.status(400).json({
        success: false,
        message: "No coupon applied to remove",
        code: "NO_COUPON_APPLIED",
      });
    }

    await redisService.del(sessionKey);
    await redisService.del(`cart_totals:${studentId}`);

    const cartItems = await prisma.cartItem.findMany({
      where: { studentId: studentId },
    });

    const subtotal = cartItems.reduce(
      (sum, item) => sum + Number(item.price),
      0
    );

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Coupon removed successfully",
      data: {
        removedCoupon: {
          code: existingCoupon.code,
          discountAmount: existingCoupon.discountAmount,
        },
        totals: {
          subtotal: subtotal,
          discount: 0,
          total: subtotal,
          savings: 0,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REMOVE_COUPON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to remove coupon",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const validateCartCoupon = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { couponCode } = req.query;
    const studentId = req.userAuthId;

    if (!couponCode) {
      return res.status(400).json({
        success: false,
        message: "Coupon code is required",
        code: "MISSING_COUPON_CODE",
      });
    }

    const cartItems = await prisma.cartItem.findMany({
      where: { studentId: studentId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            categoryId: true,
            instructorId: true,
          },
        },
      },
    });

    if (cartItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
        code: "EMPTY_CART",
      });
    }

    const cartTotal = cartItems.reduce(
      (sum, item) => sum + Number(item.price),
      0
    );
    const courseIds = cartItems.map((item) => item.course.id);

    const validation = await validateCoupon(
      couponCode.toUpperCase(),
      studentId,
      cartTotal,
      courseIds
    );

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        code: "INVALID_COUPON",
      });
    }

    const { coupon } = validation;

    let applicableCourseTotal = cartTotal;
    let applicableCourses = cartItems;

    if (coupon.applicableTo === "SPECIFIC_COURSES") {
      const applicableCourseIds = coupon.courses.map((c) => c.id);
      applicableCourses = cartItems.filter((item) =>
        applicableCourseIds.includes(item.course.id)
      );
      applicableCourseTotal = applicableCourses.reduce(
        (sum, item) => sum + Number(item.price),
        0
      );
    }

    const discountAmount = calculateDiscount(
      coupon,
      cartTotal,
      applicableCourseTotal
    );

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Coupon is valid",
      data: {
        coupon: {
          code: coupon.code,
          title: coupon.title,
          description: coupon.description,
          type: coupon.type,
          value: coupon.value,
          minimumAmount: coupon.minimumAmount,
          maximumDiscount: coupon.maximumDiscount,
          validUntil: coupon.validUntil,
          applicableTo: coupon.applicableTo,
        },
        preview: {
          cartTotal: cartTotal,
          discountAmount: discountAmount,
          finalTotal: Math.max(0, cartTotal - discountAmount),
          savings: discountAmount,
          applicableCourses: applicableCourses.length,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`VALIDATE_COUPON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      couponCode: req.query.couponCode,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to validate coupon",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCartTotals = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const studentId = req.userAuthId;
    const cacheKey = `cart_totals:${studentId}`;

    let totals = await redisService.getJSON(cacheKey);

    if (!totals) {
      const cartItems = await prisma.cartItem.findMany({
        where: { studentId: studentId },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              price: true,
              discountPrice: true,
            },
          },
        },
      });

      const subtotal = cartItems.reduce(
        (sum, item) => sum + Number(item.price),
        0
      );

      const sessionKey = `cart_coupon:${studentId}`;
      const appliedCoupon = await redisService.getJSON(sessionKey);

      let discount = 0;
      let couponInfo = null;

      if (appliedCoupon) {
        discount = appliedCoupon.discountAmount;
        couponInfo = {
          code: appliedCoupon.code,
          title: appliedCoupon.title,
          type: appliedCoupon.type,
          value: appliedCoupon.value,
          discountAmount: discount,
        };
      }

      const total = Math.max(0, subtotal - discount);
      const savings = discount;

      totals = {
        subtotal: subtotal,
        discount: discount,
        total: total,
        savings: savings,
        itemCount: cartItems.length,
        appliedCoupon: couponInfo,
        breakdown: {
          courses: cartItems.map((item) => ({
            id: item.course.id,
            title: item.course.title,
            originalPrice: item.course.price,
            currentPrice: item.price,
            discount: Number(item.course.price) - Number(item.price),
          })),
        },
      };

      if (cartItems.length > 0) {
        await redisService.setJSON(cacheKey, totals, { ex: 300 });
      }
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Cart totals calculated successfully",
      data: totals,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cached: !!totals,
      },
    });
  } catch (error) {
    console.error(`GET_CART_TOTALS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to calculate cart totals",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const syncCart = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const studentId = req.userAuthId;

    const cartItems = await prisma.cartItem.findMany({
      where: { studentId: studentId },
      include: {
        course: {
          select: {
            id: true,
            status: true,
            price: true,
            discountPrice: true,
          },
        },
      },
    });

    let removedItems = [];
    let updatedItems = [];

    for (const item of cartItems) {
      if (item.course.status !== "PUBLISHED") {
        await prisma.cartItem.delete({
          where: { id: item.id },
        });
        removedItems.push({
          courseId: item.course.id,
          reason: "Course no longer available",
        });
        continue;
      }

      const currentPrice = item.course.discountPrice || item.course.price;
      if (Number(item.price) !== Number(currentPrice)) {
        await prisma.cartItem.update({
          where: { id: item.id },
          data: { price: currentPrice },
        });
        updatedItems.push({
          courseId: item.course.id,
          oldPrice: item.price,
          newPrice: currentPrice,
        });
      }
    }

    const existingEnrollments = await prisma.enrollment.findMany({
      where: {
        studentId: studentId,
        courseId: {
          in: cartItems.map((item) => item.course.id),
        },
      },
      select: { courseId: true },
    });

    for (const enrollment of existingEnrollments) {
      await prisma.cartItem.deleteMany({
        where: {
          studentId: studentId,
          courseId: enrollment.courseId,
        },
      });
      removedItems.push({
        courseId: enrollment.courseId,
        reason: "Already enrolled in course",
      });
    }

    await redisService.del(`cart:${studentId}`);
    await redisService.del(`cart_totals:${studentId}`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Cart synchronized successfully",
      data: {
        changes: {
          removedItems: removedItems,
          updatedItems: updatedItems,
          totalChanges: removedItems.length + updatedItems.length,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SYNC_CART_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to synchronize cart",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const moveToWishlist = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.body;
    const studentId = req.userAuthId;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const cartItem = await prisma.cartItem.findUnique({
      where: {
        studentId_courseId: {
          studentId: studentId,
          courseId: courseId,
        },
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
    });

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Course not found in cart",
        code: "CART_ITEM_NOT_FOUND",
      });
    }

    if (cartItem.course.status !== "PUBLISHED") {
      return res.status(400).json({
        success: false,
        message: "Cannot move unavailable course to wishlist",
        code: "COURSE_NOT_AVAILABLE",
      });
    }

    const existingWishlistItem = await prisma.wishlistItem.findUnique({
      where: {
        studentId_courseId: {
          studentId: studentId,
          courseId: courseId,
        },
      },
    });

    if (!existingWishlistItem) {
      await prisma.wishlistItem.create({
        data: {
          studentId: studentId,
          courseId: courseId,
        },
      });
    }

    await prisma.cartItem.delete({
      where: {
        studentId_courseId: {
          studentId: studentId,
          courseId: courseId,
        },
      },
    });

    await redisService.del(`cart:${studentId}`);
    await redisService.del(`cart_totals:${studentId}`);
    await redisService.del(`wishlist:${studentId}`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course moved to wishlist successfully",
      data: {
        course: {
          id: cartItem.course.id,
          title: cartItem.course.title,
        },
        action: "moved_to_wishlist",
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`MOVE_TO_WISHLIST_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.body.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to move course to wishlist",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCartSummary = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const studentId = req.userAuthId;

    const [cartItems, appliedCoupon] = await Promise.all([
      prisma.cartItem.findMany({
        where: { studentId: studentId },
        include: {
          course: {
            select: {
              id: true,
              title: true,
              price: true,
              discountPrice: true,
              thumbnail: true,
              level: true,
              duration: true,
            },
          },
        },
      }),
      redisService.getJSON(`cart_coupon:${studentId}`),
    ]);

    const subtotal = cartItems.reduce(
      (sum, item) => sum + Number(item.price),
      0
    );
    const discount = appliedCoupon ? appliedCoupon.discountAmount : 0;
    const total = Math.max(0, subtotal - discount);

    const summary = {
      itemCount: cartItems.length,
      subtotal: subtotal,
      discount: discount,
      total: total,
      savings: discount,
      isEmpty: cartItems.length === 0,
      courses: cartItems.map((item) => ({
        id: item.course.id,
        title: item.course.title,
        thumbnail: item.course.thumbnail,
        price: item.price,
        level: item.course.level,
        duration: item.course.duration,
      })),
      appliedCoupon: appliedCoupon
        ? {
            code: appliedCoupon.code,
            title: appliedCoupon.title,
            discountAmount: appliedCoupon.discountAmount,
          }
        : null,
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Cart summary retrieved successfully",
      data: summary,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_CART_SUMMARY_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to get cart summary",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const bulkAddToCart = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseIds } = req.body;
    const studentId = req.userAuthId;

    if (!courseIds || !Array.isArray(courseIds) || courseIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Course IDs array is required",
        code: "MISSING_COURSE_IDS",
      });
    }

    if (courseIds.length > 10) {
      return res.status(400).json({
        success: false,
        message: "Maximum 10 courses can be added at once",
        code: "TOO_MANY_COURSES",
      });
    }

    const courses = await prisma.course.findMany({
      where: {
        id: { in: courseIds },
        status: "PUBLISHED",
        instructorId: { not: studentId },
      },
      select: {
        id: true,
        title: true,
        price: true,
        discountPrice: true,
        instructorId: true,
      },
    });

    const existingEnrollments = await prisma.enrollment.findMany({
      where: {
        studentId: studentId,
        courseId: { in: courseIds },
      },
      select: { courseId: true },
    });

    const existingCartItems = await prisma.cartItem.findMany({
      where: {
        studentId: studentId,
        courseId: { in: courseIds },
      },
      select: { courseId: true },
    });

    const enrolledCourseIds = existingEnrollments.map((e) => e.courseId);
    const cartCourseIds = existingCartItems.map((c) => c.courseId);

    const addedCourses = [];
    const skippedCourses = [];

    for (const courseId of courseIds) {
      const course = courses.find((c) => c.id === courseId);

      if (!course) {
        skippedCourses.push({
          courseId,
          reason: "Course not found or not available",
        });
        continue;
      }

      if (enrolledCourseIds.includes(courseId)) {
        skippedCourses.push({
          courseId,
          title: course.title,
          reason: "Already enrolled",
        });
        continue;
      }

      if (cartCourseIds.includes(courseId)) {
        skippedCourses.push({
          courseId,
          title: course.title,
          reason: "Already in cart",
        });
        continue;
      }

      try {
        await prisma.cartItem.create({
          data: {
            studentId: studentId,
            courseId: courseId,
            price: course.discountPrice || course.price,
          },
        });

        addedCourses.push({
          courseId: courseId,
          title: course.title,
          price: course.discountPrice || course.price,
        });
      } catch (error) {
        skippedCourses.push({
          courseId,
          title: course.title,
          reason: "Failed to add to cart",
        });
      }
    }

    await redisService.del(`cart:${studentId}`);
    await redisService.del(`cart_totals:${studentId}`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: `${addedCourses.length} courses added to cart`,
      data: {
        added: addedCourses,
        skipped: skippedCourses,
        summary: {
          totalRequested: courseIds.length,
          added: addedCourses.length,
          skipped: skippedCourses.length,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`BULK_ADD_TO_CART_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseIds: req.body.courseIds,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to add courses to cart",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
