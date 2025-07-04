import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";
import notificationService from "../../utils/notificationservice.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `coupon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const createCoupon = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const {
      code,
      title,
      description,
      type,
      value,
      minimumAmount,
      maximumDiscount,
      usageLimit,
      validFrom,
      validUntil,
      applicableTo,
      courseIds,
    } = req.body;

    if (!code || !title || !type || !value || !validFrom || !validUntil) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        code: "VALIDATION_ERROR",
      });
    }

    if (type === "PERCENTAGE" && (value < 1 || value > 100)) {
      return res.status(400).json({
        success: false,
        message: "Percentage value must be between 1 and 100",
        code: "VALIDATION_ERROR",
      });
    }

    if (type === "FIXED_AMOUNT" && value <= 0) {
      return res.status(400).json({
        success: false,
        message: "Fixed amount must be greater than 0",
        code: "VALIDATION_ERROR",
      });
    }

    if (new Date(validFrom) >= new Date(validUntil)) {
      return res.status(400).json({
        success: false,
        message: "Valid from date must be before valid until date",
        code: "VALIDATION_ERROR",
      });
    }

    const [instructor, existingCoupon] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      }),
      prisma.coupon.findUnique({
        where: { code: code.toUpperCase() },
      }),
    ]);

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    if (existingCoupon) {
      return res.status(409).json({
        success: false,
        message: "Coupon code already exists",
        code: "DUPLICATE_CODE",
      });
    }

    if (applicableTo === "SPECIFIC_COURSES" && courseIds?.length > 0) {
      const instructorCourses = await prisma.course.findMany({
        where: {
          id: { in: courseIds },
          instructorId: instructor.id,
          status: { not: "ARCHIVED" },
        },
        select: { id: true },
      });

      if (instructorCourses.length !== courseIds.length) {
        return res.status(403).json({
          success: false,
          message: "You can only create coupons for your own courses",
          code: "INVALID_COURSE_ACCESS",
        });
      }
    }

    const couponData = {
      code: code.toUpperCase(),
      title,
      description,
      type,
      value: parseFloat(value),
      minimumAmount: minimumAmount ? parseFloat(minimumAmount) : null,
      maximumDiscount: maximumDiscount ? parseFloat(maximumDiscount) : null,
      usageLimit: usageLimit ? parseInt(usageLimit) : null,
      validFrom: new Date(validFrom),
      validUntil: new Date(validUntil),
      applicableTo,
      createdById: req.userAuthId,
    };

    const coupon = await prisma.$transaction(async (tx) => {
      const newCoupon = await tx.coupon.create({
        data: couponData,
        include: {
          createdBy: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          _count: {
            select: {
              usages: true,
              courses: true,
            },
          },
        },
      });

      if (applicableTo === "SPECIFIC_COURSES" && courseIds?.length > 0) {
        await tx.coupon.update({
          where: { id: newCoupon.id },
          data: {
            courses: {
              connect: courseIds.map((id) => ({ id })),
            },
          },
        });
      }

      return newCoupon;
    });

    setImmediate(async () => {
      try {
        await Promise.all([
          redisService.del("coupons:*"),
          redisService.setJSON(`coupon:${coupon.id}`, coupon, { ex: 3600 }),
          notificationService.createNotification({
            userId: req.userAuthId,
            type: "SYSTEM_ANNOUNCEMENT",
            title: "Coupon Created Successfully",
            message: `Coupon "${title}" has been created successfully`,
            data: {
              couponId: coupon.id,
              couponCode: coupon.code,
              notificationType: "coupon_created",
            },
            actionUrl: "/instructor/coupons",
          }),
        ]);
      } catch (error) {
        console.error("Background operations failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      data: {
        coupon: {
          id: coupon.id,
          code: coupon.code,
          title: coupon.title,
          description: coupon.description,
          type: coupon.type,
          value: coupon.value,
          minimumAmount: coupon.minimumAmount,
          maximumDiscount: coupon.maximumDiscount,
          usageLimit: coupon.usageLimit,
          usedCount: coupon.usedCount,
          isActive: coupon.isActive,
          validFrom: coupon.validFrom,
          validUntil: coupon.validUntil,
          applicableTo: coupon.applicableTo,
          createdAt: coupon.createdAt,
          totalUsages: coupon._count.usages,
          connectedCourses: coupon._count.courses,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CREATE_COUPON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      body: req.body,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to create coupon",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCoupons = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 20,
      search,
      type,
      applicableTo,
      status,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `coupons:${Buffer.from(
      JSON.stringify({
        page: pageNumber,
        limit: pageSize,
        search,
        type,
        applicableTo,
        status,
        sortBy,
        sortOrder,
        userId: req.userAuthId,
        role: req.userRole,
      })
    ).toString("base64")}`;

    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Coupons retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const where = {};

    if (req.userRole === "INSTRUCTOR") {
      where.OR = [
        { createdById: req.userAuthId },
        { applicableTo: "ALL_COURSES" },
        {
          AND: [
            { applicableTo: "INSTRUCTOR" },
            {
              courses: {
                some: {
                  instructorId: req.userAuthId,
                },
              },
            },
          ],
        },
      ];
    } else if (req.userRole !== "ADMIN") {
      where.createdById = req.userAuthId;
    }

    if (search) {
      where.OR = [
        ...(where.OR || []),
        { code: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (type) {
      where.type = type;
    }

    if (applicableTo) {
      where.applicableTo = applicableTo;
    }

    if (status === "active") {
      where.isActive = true;
      where.validUntil = { gte: new Date() };
    } else if (status === "inactive") {
      where.isActive = false;
    } else if (status === "expired") {
      where.validUntil = { lt: new Date() };
    }

    let orderBy = { createdAt: "desc" };
    if (sortBy === "code") {
      orderBy = { code: sortOrder };
    } else if (sortBy === "value") {
      orderBy = { value: sortOrder };
    } else if (sortBy === "usageCount") {
      orderBy = { usedCount: sortOrder };
    } else if (sortBy === "validUntil") {
      orderBy = { validUntil: sortOrder };
    }

    const [coupons, total, activeCount, expiredCount, totalUsages] =
      await Promise.all([
        prisma.coupon.findMany({
          where,
          orderBy,
          skip,
          take: pageSize,
          include: {
            createdBy: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            _count: {
              select: {
                usages: true,
                courses: true,
              },
            },
          },
        }),
        prisma.coupon.count({ where }),
        prisma.coupon.count({
          where: {
            ...where,
            isActive: true,
            validUntil: { gte: new Date() },
          },
        }),
        prisma.coupon.count({
          where: {
            ...where,
            validUntil: { lt: new Date() },
          },
        }),
        prisma.couponUsage.count({
          where: {
            coupon: where,
          },
        }),
      ]);

    const result = {
      coupons: coupons.map((coupon) => ({
        id: coupon.id,
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        type: coupon.type,
        value: coupon.value,
        minimumAmount: coupon.minimumAmount,
        maximumDiscount: coupon.maximumDiscount,
        usageLimit: coupon.usageLimit,
        usedCount: coupon.usedCount,
        isActive: coupon.isActive,
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
        applicableTo: coupon.applicableTo,
        createdAt: coupon.createdAt,
        updatedAt: coupon.updatedAt,
        createdBy: coupon.createdBy,
        totalUsages: coupon._count.usages,
        connectedCourses: coupon._count.courses,
        status:
          new Date() > coupon.validUntil
            ? "expired"
            : coupon.isActive
            ? "active"
            : "inactive",
        usagePercentage: coupon.usageLimit
          ? Math.round((coupon.usedCount / coupon.usageLimit) * 100)
          : null,
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
        totalCoupons: total,
        activeCoupons: activeCount,
        expiredCoupons: expiredCount,
        totalUsages: totalUsages,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Coupons retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_COUPONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      query: req.query,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve coupons",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCouponById = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { couponId } = req.params;

    const cacheKey = `coupon:${couponId}`;
    let coupon = await redisService.getJSON(cacheKey);

    if (!coupon) {
      coupon = await prisma.coupon.findUnique({
        where: { id: couponId },
        include: {
          createdBy: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          courses: {
            select: {
              id: true,
              title: true,
              slug: true,
              thumbnail: true,
              price: true,
              discountPrice: true,
            },
          },
          usages: {
            take: 10,
            orderBy: { createdAt: "desc" },
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
              payment: {
                select: {
                  amount: true,
                  currency: true,
                  createdAt: true,
                },
              },
            },
          },
          _count: {
            select: {
              usages: true,
              courses: true,
            },
          },
        },
      });

      if (coupon) {
        await redisService.setJSON(cacheKey, coupon, { ex: 3600 });
      }
    }

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
        code: "COUPON_NOT_FOUND",
      });
    }

    if (
      req.userRole !== "ADMIN" &&
      coupon.createdById !== req.userAuthId &&
      req.userRole === "INSTRUCTOR"
    ) {
      const hasAccess = await prisma.course.findFirst({
        where: {
          instructorId: req.userAuthId,
          coupons: {
            some: {
              id: couponId,
            },
          },
        },
      });

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
          code: "ACCESS_DENIED",
        });
      }
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Coupon retrieved successfully",
      data: {
        coupon: {
          id: coupon.id,
          code: coupon.code,
          title: coupon.title,
          description: coupon.description,
          type: coupon.type,
          value: coupon.value,
          minimumAmount: coupon.minimumAmount,
          maximumDiscount: coupon.maximumDiscount,
          usageLimit: coupon.usageLimit,
          usedCount: coupon.usedCount,
          isActive: coupon.isActive,
          validFrom: coupon.validFrom,
          validUntil: coupon.validUntil,
          applicableTo: coupon.applicableTo,
          createdAt: coupon.createdAt,
          updatedAt: coupon.updatedAt,
          createdBy: coupon.createdBy,
          courses: coupon.courses,
          recentUsages: coupon.usages,
          totalUsages: coupon._count.usages,
          connectedCourses: coupon._count.courses,
          status:
            new Date() > coupon.validUntil
              ? "expired"
              : coupon.isActive
              ? "active"
              : "inactive",
          usagePercentage: coupon.usageLimit
            ? Math.round((coupon.usedCount / coupon.usageLimit) * 100)
            : null,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_COUPON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      couponId: req.params.couponId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve coupon",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateCoupon = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { couponId } = req.params;
    const {
      title,
      description,
      value,
      minimumAmount,
      maximumDiscount,
      usageLimit,
      validFrom,
      validUntil,
      isActive,
      courseIds,
    } = req.body;

    const existingCoupon = await prisma.coupon.findUnique({
      where: { id: couponId },
      include: {
        _count: {
          select: {
            usages: true,
          },
        },
      },
    });

    if (!existingCoupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
        code: "COUPON_NOT_FOUND",
      });
    }

    if (
      req.userRole !== "ADMIN" &&
      existingCoupon.createdById !== req.userAuthId
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        code: "ACCESS_DENIED",
      });
    }

    if (existingCoupon._count.usages > 0) {
      const restrictedFields = ["type", "value", "applicableTo"];
      const providedRestrictedFields = restrictedFields.filter(
        (field) => req.body[field] !== undefined
      );

      if (providedRestrictedFields.length > 0) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot modify type, value, or applicableTo after coupon has been used",
          code: "COUPON_IN_USE",
        });
      }
    }

    if (value !== undefined) {
      if (existingCoupon.type === "PERCENTAGE" && (value < 1 || value > 100)) {
        return res.status(400).json({
          success: false,
          message: "Percentage value must be between 1 and 100",
          code: "VALIDATION_ERROR",
        });
      }

      if (existingCoupon.type === "FIXED_AMOUNT" && value <= 0) {
        return res.status(400).json({
          success: false,
          message: "Fixed amount must be greater than 0",
          code: "VALIDATION_ERROR",
        });
      }
    }

    if (validFrom && validUntil) {
      if (new Date(validFrom) >= new Date(validUntil)) {
        return res.status(400).json({
          success: false,
          message: "Valid from date must be before valid until date",
          code: "VALIDATION_ERROR",
        });
      }
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (value !== undefined) updateData.value = parseFloat(value);
    if (minimumAmount !== undefined)
      updateData.minimumAmount = minimumAmount
        ? parseFloat(minimumAmount)
        : null;
    if (maximumDiscount !== undefined)
      updateData.maximumDiscount = maximumDiscount
        ? parseFloat(maximumDiscount)
        : null;
    if (usageLimit !== undefined)
      updateData.usageLimit = usageLimit ? parseInt(usageLimit) : null;
    if (validFrom !== undefined) updateData.validFrom = new Date(validFrom);
    if (validUntil !== undefined) updateData.validUntil = new Date(validUntil);
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedCoupon = await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.update({
        where: { id: couponId },
        data: updateData,
        include: {
          createdBy: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          _count: {
            select: {
              usages: true,
              courses: true,
            },
          },
        },
      });

      if (
        existingCoupon.applicableTo === "SPECIFIC_COURSES" &&
        courseIds !== undefined
      ) {
        await tx.coupon.update({
          where: { id: couponId },
          data: {
            courses: {
              set: courseIds.map((id) => ({ id })),
            },
          },
        });
      }

      return coupon;
    });

    await redisService.del(`coupon:${couponId}`);
    await redisService.del("coupons:*");

    const cacheKey = `coupon:${couponId}`;
    await redisService.setJSON(cacheKey, updatedCoupon, { ex: 3600 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Coupon updated successfully",
      data: {
        coupon: {
          id: updatedCoupon.id,
          code: updatedCoupon.code,
          title: updatedCoupon.title,
          description: updatedCoupon.description,
          type: updatedCoupon.type,
          value: updatedCoupon.value,
          minimumAmount: updatedCoupon.minimumAmount,
          maximumDiscount: updatedCoupon.maximumDiscount,
          usageLimit: updatedCoupon.usageLimit,
          usedCount: updatedCoupon.usedCount,
          isActive: updatedCoupon.isActive,
          validFrom: updatedCoupon.validFrom,
          validUntil: updatedCoupon.validUntil,
          applicableTo: updatedCoupon.applicableTo,
          updatedAt: updatedCoupon.updatedAt,
          totalUsages: updatedCoupon._count.usages,
          connectedCourses: updatedCoupon._count.courses,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_COUPON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      couponId: req.params.couponId,
      userId: req.userAuthId,
      body: req.body,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update coupon",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteCoupon = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { couponId } = req.params;

    const existingCoupon = await prisma.coupon.findUnique({
      where: { id: couponId },
      include: {
        _count: {
          select: {
            usages: true,
          },
        },
      },
    });

    if (!existingCoupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
        code: "COUPON_NOT_FOUND",
      });
    }

    if (
      req.userRole !== "ADMIN" &&
      existingCoupon.createdById !== req.userAuthId
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        code: "ACCESS_DENIED",
      });
    }

    if (existingCoupon._count.usages > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete coupon that has been used",
        code: "COUPON_IN_USE",
        data: {
          usageCount: existingCoupon._count.usages,
        },
      });
    }

    await prisma.coupon.delete({
      where: { id: couponId },
    });

    await redisService.del(`coupon:${couponId}`);
    await redisService.del("coupons:*");

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Coupon deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_COUPON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      couponId: req.params.couponId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete coupon",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const applyCoupon = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { couponId, paymentId, discountAmount } = req.body;

    if (!couponId || !paymentId || !discountAmount) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        code: "VALIDATION_ERROR",
      });
    }

    const [coupon, payment] = await Promise.all([
      prisma.coupon.findUnique({
        where: { id: couponId },
      }),
      prisma.payment.findUnique({
        where: { id: paymentId },
      }),
    ]);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
        code: "COUPON_NOT_FOUND",
      });
    }

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
        code: "PAYMENT_NOT_FOUND",
      });
    }

    const existingUsage = await prisma.couponUsage.findFirst({
      where: {
        couponId: couponId,
        userId: req.userAuthId,
      },
    });

    if (existingUsage) {
      return res.status(400).json({
        success: false,
        message: "Coupon already used by user",
        code: "ALREADY_USED",
      });
    }

    const couponUsage = await prisma.$transaction(async (tx) => {
      const usage = await tx.couponUsage.create({
        data: {
          couponId: couponId,
          paymentId: paymentId,
          userId: req.userAuthId,
          discount: parseFloat(discountAmount),
        },
        include: {
          coupon: {
            select: {
              code: true,
              title: true,
            },
          },
          payment: {
            select: {
              amount: true,
              currency: true,
            },
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      await tx.coupon.update({
        where: { id: couponId },
        data: {
          usedCount: {
            increment: 1,
          },
        },
      });

      return usage;
    });

    await redisService.del(`coupon:${couponId}`);
    await redisService.del("coupons:*");
    await redisService.del("coupon_validation:*");

    if (coupon.createdById !== req.userAuthId) {
      await notificationService.createNotification({
        userId: coupon.createdById,
        type: "coupon_used",
        title: "Coupon Used",
        message: `Your coupon "${coupon.code}" was used`,
        data: {
          couponId: coupon.id,
          couponCode: coupon.code,
          discountAmount: discountAmount,
          userName: `${couponUsage.user.firstName} ${couponUsage.user.lastName}`,
        },
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Coupon applied successfully",
      data: {
        usage: {
          id: couponUsage.id,
          discount: couponUsage.discount,
          createdAt: couponUsage.createdAt,
          coupon: couponUsage.coupon,
          payment: couponUsage.payment,
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
      body: req.body,
      userId: req.userAuthId,
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

export const getCouponAnalytics = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const {
      period = "30d",
      couponId,
      dateFrom,
      dateTo,
      groupBy = "day",
    } = req.query;

    const cacheKey = `coupon_analytics:${Buffer.from(
      JSON.stringify({
        period,
        couponId,
        dateFrom,
        dateTo,
        groupBy,
        userId: req.userAuthId,
        role: req.userRole,
      })
    ).toString("base64")}`;

    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Coupon analytics retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    let startDate, endDate;
    const now = new Date();

    if (dateFrom && dateTo) {
      startDate = new Date(dateFrom);
      endDate = new Date(dateTo);
    } else {
      switch (period) {
        case "7d":
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "30d":
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case "90d":
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case "1y":
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      endDate = now;
    }

    const where = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (req.userRole !== "ADMIN") {
      where.coupon = {
        createdById: req.userAuthId,
      };
    }

    if (couponId) {
      where.couponId = couponId;
    }

    const paymentWhere = {
      couponUsages: {
        some: where,
      },
    };

    const [
      totalUsages,
      totalDiscount,
      totalRevenue,
      usagesByPeriod,
      topCoupons,
      usagesByType,
      averageDiscount,
      conversionMetrics,
    ] = await Promise.all([
      prisma.couponUsage.count({ where }),
      prisma.couponUsage.aggregate({
        where,
        _sum: { discount: true },
      }),
      prisma.payment.aggregate({
        where: paymentWhere,
        _sum: { amount: true },
      }),
      prisma.couponUsage.groupBy({
        by: ["createdAt"],
        where,
        _count: { id: true },
        _sum: { discount: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.couponUsage.groupBy({
        by: ["couponId"],
        where,
        _count: { id: true },
        _sum: { discount: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      prisma.coupon.groupBy({
        by: ["type"],
        where: {
          createdById: req.userRole === "ADMIN" ? undefined : req.userAuthId,
          usages: {
            some: {
              createdAt: {
                gte: startDate,
                lte: endDate,
              },
            },
          },
        },
        _count: { id: true },
        _sum: {
          usedCount: true,
        },
      }),
      prisma.couponUsage.aggregate({
        where,
        _avg: { discount: true },
      }),
      prisma.coupon.findMany({
        where: {
          createdById: req.userRole === "ADMIN" ? undefined : req.userAuthId,
        },
        select: {
          id: true,
          code: true,
          usedCount: true,
          usageLimit: true,
          _count: {
            select: {
              usages: true,
            },
          },
        },
      }),
    ]);

    const topCouponsWithDetails = await prisma.coupon.findMany({
      where: {
        id: { in: topCoupons.map((tc) => tc.couponId) },
      },
      select: {
        id: true,
        code: true,
        title: true,
        type: true,
        value: true,
      },
    });

    const processedUsagesByPeriod = usagesByPeriod.reduce((acc, usage) => {
      const date = new Date(usage.createdAt);
      let key;

      if (groupBy === "day") {
        key = date.toISOString().split("T")[0];
      } else if (groupBy === "week") {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split("T")[0];
      } else if (groupBy === "month") {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
          2,
          "0"
        )}`;
      }

      if (!acc[key]) {
        acc[key] = { count: 0, discount: 0 };
      }
      acc[key].count += usage._count.id;
      acc[key].discount += Number(usage._sum.discount || 0);

      return acc;
    }, {});

    const conversionRate =
      conversionMetrics.length > 0
        ? (totalUsages / conversionMetrics.length) * 100
        : 0;

    const result = {
      summary: {
        totalUsages,
        totalDiscount: Number(totalDiscount._sum.discount || 0),
        totalRevenue: Number(totalRevenue._sum.amount || 0),
        averageDiscount: Number(averageDiscount._avg.discount || 0),
        conversionRate: Math.round(conversionRate * 100) / 100,
        period: { from: startDate, to: endDate },
      },
      trends: {
        usagesByPeriod: Object.entries(processedUsagesByPeriod)
          .map(([date, data]) => ({
            date,
            usages: data.count,
            discount: data.discount,
          }))
          .sort((a, b) => new Date(a.date) - new Date(b.date)),
      },
      topPerformers: topCoupons.map((tc) => {
        const details = topCouponsWithDetails.find((d) => d.id === tc.couponId);
        return {
          couponId: tc.couponId,
          code: details?.code,
          title: details?.title,
          type: details?.type,
          value: Number(details?.value || 0),
          usages: tc._count.id,
          totalDiscount: Number(tc._sum.discount || 0),
        };
      }),
      breakdown: {
        byType: usagesByType.map((ut) => ({
          type: ut.type,
          usages: ut._count.id,
          totalUsages: ut._sum.usedCount || 0,
        })),
      },
      performance: conversionMetrics.map((cm) => ({
        couponId: cm.id,
        code: cm.code,
        usageRate:
          cm.usageLimit > 0
            ? Math.round((cm.usedCount / cm.usageLimit) * 100)
            : null,
        totalUsages: cm._count.usages,
        remainingUses: cm.usageLimit
          ? Math.max(0, cm.usageLimit - cm.usedCount)
          : null,
      })),
    };

    await redisService.setJSON(cacheKey, result, { ex: 1800 });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Coupon analytics retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_COUPON_ANALYTICS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      query: req.query,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve coupon analytics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const toggleCouponStatus = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { couponId } = req.params;

    const [instructor, coupon] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      }),
      prisma.coupon.findUnique({
        where: { id: couponId },
        select: {
          id: true,
          code: true,
          title: true,
          isActive: true,
          createdById: true,
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

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
        code: "COUPON_NOT_FOUND",
      });
    }

    if (coupon.createdById !== req.userAuthId) {
      return res.status(403).json({
        success: false,
        message: "You can only modify coupons created by you",
        code: "ACCESS_DENIED",
      });
    }

    const updatedCoupon = await prisma.coupon.update({
      where: { id: couponId },
      data: {
        isActive: !coupon.isActive,
      },
      select: {
        id: true,
        code: true,
        title: true,
        isActive: true,
        updatedAt: true,
      },
    });

    setImmediate(async () => {
      try {
        await Promise.all([
          redisService.del(`coupon:${couponId}`),
          redisService.delPattern("coupons:*"),
        ]);
      } catch (error) {
        console.warn("Cache cleanup failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: `Coupon ${
        updatedCoupon.isActive ? "activated" : "deactivated"
      } successfully`,
      data: {
        coupon: updatedCoupon,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`TOGGLE_COUPON_STATUS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      couponId: req.params.couponId,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to toggle coupon status",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const bulkUpdateCoupons = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { couponIds, action, data } = req.body;

    if (!couponIds || !Array.isArray(couponIds) || couponIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid coupon IDs",
        code: "VALIDATION_ERROR",
      });
    }

    if (!["activate", "deactivate", "extend", "update"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action",
        code: "VALIDATION_ERROR",
      });
    }

    const coupons = await prisma.coupon.findMany({
      where: {
        id: { in: couponIds },
        ...(req.userRole !== "ADMIN" && { createdById: req.userAuthId }),
      },
      select: {
        id: true,
        code: true,
        createdById: true,
        _count: {
          select: {
            usages: true,
          },
        },
      },
    });

    if (coupons.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No valid coupons found",
        code: "NO_COUPONS_FOUND",
      });
    }

    const updateData = {};

    switch (action) {
      case "activate":
        updateData.isActive = true;
        break;
      case "deactivate":
        updateData.isActive = false;
        break;
      case "extend":
        if (!data?.validUntil) {
          return res.status(400).json({
            success: false,
            message: "Valid until date is required for extend action",
            code: "VALIDATION_ERROR",
          });
        }
        updateData.validUntil = new Date(data.validUntil);
        break;
      case "update":
        if (data?.usageLimit !== undefined)
          updateData.usageLimit = parseInt(data.usageLimit);
        if (data?.minimumAmount !== undefined)
          updateData.minimumAmount = parseFloat(data.minimumAmount);
        if (data?.maximumDiscount !== undefined)
          updateData.maximumDiscount = parseFloat(data.maximumDiscount);
        break;
    }

    const validCouponIds = coupons.map((c) => c.id);

    const updatedCoupons = await prisma.coupon.updateMany({
      where: {
        id: { in: validCouponIds },
      },
      data: updateData,
    });

    for (const couponId of validCouponIds) {
      await redisService.del(`coupon:${couponId}`);
    }
    await redisService.del("coupons:*");

    if (req.userRole === "ADMIN") {
      const affectedInstructors = [
        ...new Set(coupons.map((c) => c.createdById)),
      ];

      await notificationService.createBulkNotifications({
        userIds: affectedInstructors,
        type: "coupon_bulk_updated",
        title: "Coupons Updated",
        message: `${updatedCoupons.count} of your coupons have been updated`,
        data: {
          action,
          couponCount: updatedCoupons.count,
          couponCodes: coupons.map((c) => c.code),
        },
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: `${updatedCoupons.count} coupons updated successfully`,
      data: {
        updatedCount: updatedCoupons.count,
        action,
        affectedCoupons: coupons.map((c) => ({
          id: c.id,
          code: c.code,
        })),
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`BULK_UPDATE_COUPONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      body: req.body,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update coupons",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getExpiringSoonCoupons = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { days = 7 } = req.query;

    const daysAhead = parseInt(days);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const cacheKey = `expiring_coupons:${daysAhead}:${req.userAuthId}:${req.userRole}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Expiring coupons retrieved successfully",
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
      isActive: true,
      validUntil: {
        gte: new Date(),
        lte: futureDate,
      },
      ...(req.userRole !== "ADMIN" && { createdById: req.userAuthId }),
    };

    const expiringCoupons = await prisma.coupon.findMany({
      where,
      orderBy: { validUntil: "asc" },
      include: {
        _count: {
          select: {
            usages: true,
          },
        },
      },
    });

    const result = {
      count: expiringCoupons.length,
      coupons: expiringCoupons.map((coupon) => ({
        id: coupon.id,
        code: coupon.code,
        title: coupon.title,
        type: coupon.type,
        value: coupon.value,
        validUntil: coupon.validUntil,
        usedCount: coupon.usedCount,
        usageLimit: coupon.usageLimit,
        totalUsages: coupon._count.usages,
        daysLeft: Math.ceil(
          (new Date(coupon.validUntil) - new Date()) / (1000 * 60 * 60 * 24)
        ),
        usageRate: coupon.usageLimit
          ? Math.round((coupon.usedCount / coupon.usageLimit) * 100)
          : null,
      })),
    };

    await redisService.setJSON(cacheKey, result, { ex: 3600 });

    if (expiringCoupons.length > 0 && req.userRole !== "ADMIN") {
      await notificationService.createNotification({
        userId: req.userAuthId,
        type: "coupons_expiring",
        title: "Coupons Expiring Soon",
        message: `${expiringCoupons.length} of your coupons are expiring within ${daysAhead} days`,
        data: {
          count: expiringCoupons.length,
          daysAhead: daysAhead,
          couponCodes: expiringCoupons.slice(0, 5).map((c) => c.code),
        },
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Expiring coupons retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_EXPIRING_COUPONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      query: req.query,
      userId: req.userAuthId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve expiring coupons",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
