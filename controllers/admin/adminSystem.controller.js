import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";
import notificationService from "../../utils/notificationservice.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `system_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const getSystemSettings = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const cacheKey = "system_settings";
    let cachedSettings = await redisService.getJSON(cacheKey);

    if (cachedSettings) {
      return res.status(200).json({
        success: true,
        message: "System settings retrieved successfully",
        data: cachedSettings,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const settings = {
      platform: {
        name: process.env.PLATFORM_NAME || "Educademy",
        description:
          process.env.PLATFORM_DESCRIPTION || "Learn anything, anywhere",
        logo: process.env.PLATFORM_LOGO || "",
        favicon: process.env.PLATFORM_FAVICON || "",
        timezone: process.env.DEFAULT_TIMEZONE || "UTC",
        language: process.env.DEFAULT_LANGUAGE || "en",
        currency: process.env.DEFAULT_CURRENCY || "INR",
        contactEmail: process.env.CONTACT_EMAIL || "",
        supportEmail: process.env.SUPPORT_EMAIL || "",
        version: process.env.APP_VERSION || "1.0.0",
      },
      features: {
        enableRegistration: process.env.ENABLE_REGISTRATION !== "false",
        enableSocialLogin: process.env.ENABLE_SOCIAL_LOGIN !== "false",
        enableEmailVerification:
          process.env.ENABLE_EMAIL_VERIFICATION !== "false",
        enableCourseReview: process.env.ENABLE_COURSE_REVIEW !== "false",
        enableInstructorVerification:
          process.env.ENABLE_INSTRUCTOR_VERIFICATION !== "false",
        enableLiveStreaming: process.env.ENABLE_LIVE_STREAMING === "true",
        enableMobileApp: process.env.ENABLE_MOBILE_APP === "true",
        enableOfflineDownload: process.env.ENABLE_OFFLINE_DOWNLOAD === "true",
        enableCertificates: process.env.ENABLE_CERTIFICATES !== "false",
        enableCoupons: process.env.ENABLE_COUPONS !== "false",
      },
      limits: {
        maxCoursesPerInstructor:
          parseInt(process.env.MAX_COURSES_PER_INSTRUCTOR) || 100,
        maxStudentsPerCourse:
          parseInt(process.env.MAX_STUDENTS_PER_COURSE) || 10000,
        maxFileUploadSize: parseInt(process.env.MAX_FILE_UPLOAD_SIZE) || 100,
        maxVideoLength: parseInt(process.env.MAX_VIDEO_LENGTH) || 240,
        maxCoursePrice: parseInt(process.env.MAX_COURSE_PRICE) || 100000,
        minCoursePrice: parseInt(process.env.MIN_COURSE_PRICE) || 0,
        sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 2592000,
        rateLimitRequests: parseInt(process.env.RATE_LIMIT_REQUESTS) || 1000,
      },
      payments: {
        enableRazorpay: process.env.ENABLE_RAZORPAY === "true",
        enableStripe: process.env.ENABLE_STRIPE === "true",
        enablePaypal: process.env.ENABLE_PAYPAL === "true",
        defaultCommission: parseFloat(process.env.DEFAULT_COMMISSION) || 0.3,
        minPayoutAmount: parseInt(process.env.MIN_PAYOUT_AMOUNT) || 1000,
        payoutSchedule: process.env.PAYOUT_SCHEDULE || "monthly",
        enableInstantPayout: process.env.ENABLE_INSTANT_PAYOUT === "true",
        enableRefunds: process.env.ENABLE_REFUNDS !== "false",
        refundWindow: parseInt(process.env.REFUND_WINDOW) || 30,
      },
      security: {
        enableTwoFactor: process.env.ENABLE_TWO_FACTOR === "true",
        passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
        passwordRequireSpecial:
          process.env.PASSWORD_REQUIRE_SPECIAL !== "false",
        maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
        lockoutDuration: parseInt(process.env.LOCKOUT_DURATION) || 900,
        enableIPWhitelist: process.env.ENABLE_IP_WHITELIST === "true",
        enableCaptcha: process.env.ENABLE_CAPTCHA === "true",
        enableAuditLog: process.env.ENABLE_AUDIT_LOG !== "false",
      },
      maintenance: {
        maintenanceMode: process.env.MAINTENANCE_MODE === "true",
        maintenanceMessage:
          process.env.MAINTENANCE_MESSAGE || "System under maintenance",
        allowedIPs: process.env.MAINTENANCE_ALLOWED_IPS?.split(",") || [],
        scheduledMaintenance: process.env.SCHEDULED_MAINTENANCE || null,
        backupFrequency: process.env.BACKUP_FREQUENCY || "daily",
        logRetention: parseInt(process.env.LOG_RETENTION) || 90,
      },
    };

    await redisService.setJSON(cacheKey, settings, { ex: 3600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "System settings retrieved successfully",
      data: settings,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get system settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve system settings",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateSystemSettings = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const adminId = req.userAuthId;
    const { category, settings } = req.body;

    if (!category || !settings) {
      return res.status(400).json({
        success: false,
        message: "Category and settings are required",
        code: "INVALID_INPUT",
      });
    }

    const validCategories = [
      "platform",
      "features",
      "limits",
      "payments",
      "security",
      "maintenance",
    ];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: "Invalid settings category",
        code: "INVALID_CATEGORY",
      });
    }

    const currentSettings =
      (await redisService.getJSON("system_settings")) || {};
    const updatedSettings = {
      ...currentSettings,
      [category]: {
        ...currentSettings[category],
        ...settings,
      },
    };

    await redisService.setJSON("system_settings", updatedSettings, {
      ex: 3600,
    });

    const changeLog = {
      id: generateRequestId(),
      adminId,
      category,
      changes: settings,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    };

    await redisService.lpush(
      "system_settings_changes",
      JSON.stringify(changeLog)
    );
    await redisService.ltrim("system_settings_changes", 0, 99);

    if (category === "maintenance" && settings.maintenanceMode !== undefined) {
      if (settings.maintenanceMode) {
        await notificationService.createBulkNotifications({
          userIds: await getAllActiveUserIds(),
          type: "system_maintenance",
          title: "Scheduled Maintenance",
          message:
            settings.maintenanceMessage ||
            "System will be under maintenance shortly",
          priority: "HIGH",
          data: {
            maintenanceMode: true,
            message: settings.maintenanceMessage,
            scheduledTime: settings.scheduledMaintenance,
          },
        });
      }
    }

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `${category} settings updated successfully`,
      data: {
        category,
        updatedSettings: updatedSettings[category],
        changeId: changeLog.id,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Update system settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update system settings",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getAllCategories = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { includeStats = false, includeInactive = false } = req.query;

    const cacheKey = `admin_categories:${includeStats}:${includeInactive}`;
    let cachedCategories = await redisService.getJSON(cacheKey);

    if (cachedCategories) {
      return res.status(200).json({
        success: true,
        message: "Categories retrieved successfully",
        data: cachedCategories,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const where = includeInactive === "true" ? {} : { isActive: true };

    const categories = await prisma.category.findMany({
      where,
      include: {
        parent: true,
        subcategories: {
          where: includeInactive === "true" ? {} : { isActive: true },
          orderBy: { order: "asc" },
        },
        ...(includeStats === "true" && {
          courses: {
            select: { id: true, status: true, totalEnrollments: true },
          },
        }),
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });

    const formattedCategories = categories.map((category) => {
      const result = {
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        image: category.image,
        icon: category.icon,
        color: category.color,
        isActive: category.isActive,
        order: category.order,
        parentId: category.parentId,
        parent: category.parent
          ? {
              id: category.parent.id,
              name: category.parent.name,
              slug: category.parent.slug,
            }
          : null,
        subcategories: category.subcategories.map((sub) => ({
          id: sub.id,
          name: sub.name,
          slug: sub.slug,
          isActive: sub.isActive,
          order: sub.order,
        })),
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
      };

      if (includeStats === "true" && category.courses) {
        const publishedCourses = category.courses.filter(
          (c) => c.status === "PUBLISHED"
        );
        result.stats = {
          totalCourses: category.courses.length,
          publishedCourses: publishedCourses.length,
          totalEnrollments: publishedCourses.reduce(
            (sum, c) => sum + c.totalEnrollments,
            0
          ),
          avgEnrollments:
            publishedCourses.length > 0
              ? Math.round(
                  publishedCourses.reduce(
                    (sum, c) => sum + c.totalEnrollments,
                    0
                  ) / publishedCourses.length
                )
              : 0,
        };
      }

      return result;
    });

    const result = {
      categories: formattedCategories,
      total: formattedCategories.length,
      activeCount: formattedCategories.filter((c) => c.isActive).length,
      parentCategories: formattedCategories.filter((c) => !c.parentId).length,
      subcategories: formattedCategories.filter((c) => c.parentId).length,
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Categories retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get categories error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve categories",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createCategory = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      name,
      slug,
      description,
      image,
      icon,
      color,
      parentId,
      order = 0,
      isActive = true,
    } = req.body;

    if (!name || !slug) {
      return res.status(400).json({
        success: false,
        message: "Name and slug are required",
        code: "REQUIRED_FIELDS",
      });
    }

    const existingCategory = await prisma.category.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          { slug: { equals: slug, mode: "insensitive" } },
        ],
      },
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message:
          existingCategory.name.toLowerCase() === name.toLowerCase()
            ? "Category name already exists"
            : "Category slug already exists",
        code: "DUPLICATE_CATEGORY",
      });
    }

    if (parentId) {
      const parentCategory = await prisma.category.findUnique({
        where: { id: parentId },
      });

      if (!parentCategory) {
        return res.status(400).json({
          success: false,
          message: "Parent category not found",
          code: "PARENT_NOT_FOUND",
        });
      }

      if (parentCategory.parentId) {
        return res.status(400).json({
          success: false,
          message: "Cannot create subcategory under another subcategory",
          code: "INVALID_PARENT",
        });
      }
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        description,
        image,
        icon,
        color,
        parentId,
        order,
        isActive,
      },
      include: {
        parent: true,
        subcategories: true,
      },
    });

    await redisService.delPattern("admin_categories:*");
    await redisService.delPattern("categories:*");
    await redisService.del("course_categories");

    const executionTime = Math.round(performance.now() - startTime);

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        image: category.image,
        icon: category.icon,
        color: category.color,
        parentId: category.parentId,
        parent: category.parent,
        order: category.order,
        isActive: category.isActive,
        subcategories: category.subcategories,
        createdAt: category.createdAt,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Create category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create category",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateCategory = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { categoryId } = req.params;
    const updateData = req.body;

    if (!categoryId) {
      return res.status(400).json({
        success: false,
        message: "Category ID is required",
        code: "CATEGORY_ID_REQUIRED",
      });
    }

    const existingCategory = await prisma.category.findUnique({
      where: { id: categoryId },
      include: { subcategories: true, courses: true },
    });

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        code: "CATEGORY_NOT_FOUND",
      });
    }

    if (updateData.name || updateData.slug) {
      const duplicateCheck = await prisma.category.findFirst({
        where: {
          AND: [
            { id: { not: categoryId } },
            {
              OR: [
                ...(updateData.name
                  ? [{ name: { equals: updateData.name, mode: "insensitive" } }]
                  : []),
                ...(updateData.slug
                  ? [{ slug: { equals: updateData.slug, mode: "insensitive" } }]
                  : []),
              ],
            },
          ],
        },
      });

      if (duplicateCheck) {
        return res.status(400).json({
          success: false,
          message: "Category name or slug already exists",
          code: "DUPLICATE_CATEGORY",
        });
      }
    }

    if (
      updateData.parentId &&
      updateData.parentId !== existingCategory.parentId
    ) {
      if (updateData.parentId === categoryId) {
        return res.status(400).json({
          success: false,
          message: "Category cannot be its own parent",
          code: "INVALID_PARENT",
        });
      }

      if (existingCategory.subcategories.length > 0) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot move category with subcategories to become a subcategory",
          code: "HAS_SUBCATEGORIES",
        });
      }

      const parentCategory = await prisma.category.findUnique({
        where: { id: updateData.parentId },
      });

      if (!parentCategory) {
        return res.status(400).json({
          success: false,
          message: "Parent category not found",
          code: "PARENT_NOT_FOUND",
        });
      }

      if (parentCategory.parentId) {
        return res.status(400).json({
          success: false,
          message: "Cannot create subcategory under another subcategory",
          code: "INVALID_PARENT",
        });
      }
    }

    const updatedCategory = await prisma.category.update({
      where: { id: categoryId },
      data: updateData,
      include: {
        parent: true,
        subcategories: true,
        courses: {
          select: { id: true, status: true },
        },
      },
    });

    await redisService.delPattern("admin_categories:*");
    await redisService.delPattern("categories:*");
    await redisService.del("course_categories");

    if (updateData.isActive === false && existingCategory.courses.length > 0) {
      const activeCourses = existingCategory.courses.filter(
        (c) => c.status === "PUBLISHED"
      );
      if (activeCourses.length > 0) {
        console.warn(
          `Category ${categoryId} deactivated but has ${activeCourses.length} published courses`
        );
      }
    }

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: {
        id: updatedCategory.id,
        name: updatedCategory.name,
        slug: updatedCategory.slug,
        description: updatedCategory.description,
        image: updatedCategory.image,
        icon: updatedCategory.icon,
        color: updatedCategory.color,
        parentId: updatedCategory.parentId,
        parent: updatedCategory.parent,
        order: updatedCategory.order,
        isActive: updatedCategory.isActive,
        subcategories: updatedCategory.subcategories,
        updatedAt: updatedCategory.updatedAt,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Update category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update category",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { categoryId } = req.params;
    const { forceDelete = false } = req.query;

    if (!categoryId) {
      return res.status(400).json({
        success: false,
        message: "Category ID is required",
        code: "CATEGORY_ID_REQUIRED",
      });
    }

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: {
        subcategories: true,
        courses: true,
      },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        code: "CATEGORY_NOT_FOUND",
      });
    }

    if (category.courses.length > 0 && forceDelete !== "true") {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${category.courses.length} courses. Use forceDelete=true to proceed.`,
        code: "CATEGORY_HAS_COURSES",
        data: {
          coursesCount: category.courses.length,
          subcategoriesCount: category.subcategories.length,
        },
      });
    }

    if (category.subcategories.length > 0 && forceDelete !== "true") {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${category.subcategories.length} subcategories. Use forceDelete=true to proceed.`,
        code: "CATEGORY_HAS_SUBCATEGORIES",
        data: {
          coursesCount: category.courses.length,
          subcategoriesCount: category.subcategories.length,
        },
      });
    }

    if (forceDelete === "true") {
      await prisma.course.updateMany({
        where: {
          OR: [{ categoryId: categoryId }, { subcategoryId: categoryId }],
        },
        data: {
          categoryId: null,
          subcategoryId: null,
        },
      });

      if (category.subcategories.length > 0) {
        await prisma.category.deleteMany({
          where: { parentId: categoryId },
        });
      }
    }

    await prisma.category.delete({
      where: { id: categoryId },
    });

    await redisService.delPattern("admin_categories:*");
    await redisService.delPattern("categories:*");
    await redisService.del("course_categories");

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
      data: {
        deletedCategoryId: categoryId,
        coursesAffected: category.courses.length,
        subcategoriesDeleted:
          forceDelete === "true" ? category.subcategories.length : 0,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Delete category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete category",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getAllCoupons = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `admin_coupons:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      status,
      type,
      search,
      sortBy,
      sortOrder,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Coupons retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const where = {};

    if (status === "active") {
      where.isActive = true;
      where.validFrom = { lte: new Date() };
      where.validUntil = { gte: new Date() };
    } else if (status === "inactive") {
      where.isActive = false;
    } else if (status === "expired") {
      where.validUntil = { lt: new Date() };
    }

    if (type) {
      where.type = type.toUpperCase();
    }

    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [coupons, total] = await Promise.all([
      prisma.coupon.findMany({
        where,
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
          usages: {
            select: {
              id: true,
              discount: true,
              createdAt: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
            take: 5,
            orderBy: { createdAt: "desc" },
          },
          courses: {
            select: {
              id: true,
              title: true,
              slug: true,
            },
            take: 5,
          },
          _count: {
            select: {
              usages: true,
              courses: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.coupon.count({ where }),
    ]);

    const formattedCoupons = coupons.map((coupon) => {
      const now = new Date();
      const isExpired = coupon.validUntil < now;
      const isNotStarted = coupon.validFrom > now;
      const isUsageLimitReached =
        coupon.usageLimit && coupon.usedCount >= coupon.usageLimit;

      return {
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
        status: isExpired
          ? "expired"
          : isNotStarted
          ? "not_started"
          : !coupon.isActive
          ? "inactive"
          : isUsageLimitReached
          ? "usage_limit_reached"
          : "active",
        createdBy: coupon.createdBy,
        recentUsages: coupon.usages,
        applicableCourses: coupon.courses,
        stats: {
          totalUsages: coupon._count.usages,
          totalCourses: coupon._count.courses,
          remainingUsages: coupon.usageLimit
            ? Math.max(0, coupon.usageLimit - coupon.usedCount)
            : null,
          totalDiscount: coupon.usages.reduce(
            (sum, usage) => sum + parseFloat(usage.discount),
            0
          ),
        },
        createdAt: coupon.createdAt,
        updatedAt: coupon.updatedAt,
      };
    });

    const result = {
      coupons: formattedCoupons,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      filters: { status, type, search },
      sort: { sortBy, sortOrder },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Coupons retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get coupons error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve coupons",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createSystemCoupon = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const adminId = req.userAuthId;
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
      applicableTo = "ALL_COURSES",
      courseIds = [],
      isActive = true,
    } = req.body;

    if (!code || !title || !type || !value || !validFrom || !validUntil) {
      return res.status(400).json({
        success: false,
        message:
          "Code, title, type, value, validFrom, and validUntil are required",
        code: "REQUIRED_FIELDS",
      });
    }

    if (!["PERCENTAGE", "FIXED_AMOUNT"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Type must be PERCENTAGE or FIXED_AMOUNT",
        code: "INVALID_TYPE",
      });
    }

    if (type === "PERCENTAGE" && (value < 1 || value > 100)) {
      return res.status(400).json({
        success: false,
        message: "Percentage value must be between 1 and 100",
        code: "INVALID_PERCENTAGE",
      });
    }

    if (new Date(validFrom) >= new Date(validUntil)) {
      return res.status(400).json({
        success: false,
        message: "Valid until date must be after valid from date",
        code: "INVALID_DATE_RANGE",
      });
    }

    const existingCoupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (existingCoupon) {
      return res.status(400).json({
        success: false,
        message: "Coupon code already exists",
        code: "DUPLICATE_CODE",
      });
    }

    if (
      applicableTo === "SPECIFIC_COURSES" &&
      (!courseIds || courseIds.length === 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Course IDs are required when applicable to specific courses",
        code: "COURSES_REQUIRED",
      });
    }

    const couponData = {
      code: code.toUpperCase(),
      title,
      description,
      type,
      value,
      minimumAmount,
      maximumDiscount,
      usageLimit,
      isActive,
      validFrom: new Date(validFrom),
      validUntil: new Date(validUntil),
      applicableTo,
      createdById: adminId,
    };

    const coupon = await prisma.coupon.create({
      data: couponData,
      include: {
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (applicableTo === "SPECIFIC_COURSES" && courseIds.length > 0) {
      await prisma.coupon.update({
        where: { id: coupon.id },
        data: {
          courses: {
            connect: courseIds.map((id) => ({ id })),
          },
        },
      });
    }

    await redisService.delPattern("admin_coupons:*");
    await redisService.delPattern("coupon:*");

    const executionTime = Math.round(performance.now() - startTime);

    res.status(201).json({
      success: true,
      message: "System coupon created successfully",
      data: {
        id: coupon.id,
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        type: coupon.type,
        value: coupon.value,
        minimumAmount: coupon.minimumAmount,
        maximumDiscount: coupon.maximumDiscount,
        usageLimit: coupon.usageLimit,
        isActive: coupon.isActive,
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
        applicableTo: coupon.applicableTo,
        createdBy: coupon.createdBy,
        createdAt: coupon.createdAt,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Create system coupon error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create system coupon",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createAnnouncement = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const adminId = req.userAuthId;
    const {
      title,
      content,
      type = "INFO",
      priority = "NORMAL",
      targetAudience = "ALL",
      scheduledFor,
      expiresAt,
      isActive = true,
    } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: "Title and content are required",
        code: "REQUIRED_FIELDS",
      });
    }

    const validTypes = [
      "INFO",
      "WARNING",
      "UPDATE",
      "MAINTENANCE",
      "PROMOTION",
    ];
    const validPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
    const validAudiences = ["ALL", "STUDENTS", "INSTRUCTORS", "ADMINS"];

    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid announcement type",
        code: "INVALID_TYPE",
      });
    }

    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: "Invalid priority level",
        code: "INVALID_PRIORITY",
      });
    }

    if (!validAudiences.includes(targetAudience)) {
      return res.status(400).json({
        success: false,
        message: "Invalid target audience",
        code: "INVALID_AUDIENCE",
      });
    }

    const announcementId = generateRequestId();
    const announcementData = {
      id: announcementId,
      title,
      content,
      type,
      priority,
      targetAudience,
      isActive,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdBy: adminId,
      createdAt: new Date().toISOString(),
      readBy: [],
      dismissedBy: [],
    };

    const cacheKey = `announcement:${announcementId}`;
    await redisService.setJSON(cacheKey, announcementData, {
      ex: 30 * 24 * 60 * 60,
    });

    const allAnnouncementsKey = "announcements:all";
    await redisService.zadd(allAnnouncementsKey, Date.now(), announcementId);

    const activeAnnouncementsKey = `announcements:active:${targetAudience.toLowerCase()}`;
    if (isActive && (!scheduledFor || new Date(scheduledFor) <= new Date())) {
      await redisService.zadd(
        activeAnnouncementsKey,
        Date.now(),
        announcementId
      );
    }

    if (isActive && (!scheduledFor || new Date(scheduledFor) <= new Date())) {
      const userIds = await getTargetAudienceUserIds(targetAudience);

      if (userIds.length > 0) {
        await notificationService.createBulkNotifications({
          userIds,
          type: "system_announcement",
          title: title,
          message:
            content.substring(0, 200) + (content.length > 200 ? "..." : ""),
          priority: priority,
          data: {
            announcementId,
            type,
            targetAudience,
            fullContent: content,
          },
          actionUrl: "/announcements",
        });
      }
    }

    const executionTime = Math.round(performance.now() - startTime);

    res.status(201).json({
      success: true,
      message: "Announcement created successfully",
      data: {
        id: announcementId,
        title,
        content,
        type,
        priority,
        targetAudience,
        isActive,
        scheduledFor: announcementData.scheduledFor,
        expiresAt: announcementData.expiresAt,
        createdAt: announcementData.createdAt,
        notificationsSent:
          isActive && (!scheduledFor || new Date(scheduledFor) <= new Date()),
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Create announcement error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create announcement",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getAllAnnouncements = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 20,
      type,
      priority,
      targetAudience,
      isActive,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `admin_announcements:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      type,
      priority,
      targetAudience,
      isActive,
      sortBy,
      sortOrder,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Announcements retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const allAnnouncementsKey = "announcements:all";
    const announcementIds = await redisService.zrevrange(
      allAnnouncementsKey,
      0,
      -1
    );

    const announcements = [];
    for (const announcementId of announcementIds) {
      const announcement = await redisService.getJSON(
        `announcement:${announcementId}`
      );
      if (announcement) {
        if (type && announcement.type !== type) continue;
        if (priority && announcement.priority !== priority) continue;
        if (targetAudience && announcement.targetAudience !== targetAudience)
          continue;
        if (
          isActive !== undefined &&
          announcement.isActive !== (isActive === "true")
        )
          continue;

        const now = new Date();
        const isExpired =
          announcement.expiresAt && new Date(announcement.expiresAt) < now;
        const isScheduled =
          announcement.scheduledFor &&
          new Date(announcement.scheduledFor) > now;

        announcements.push({
          ...announcement,
          status: isExpired
            ? "expired"
            : isScheduled
            ? "scheduled"
            : announcement.isActive
            ? "active"
            : "inactive",
          readCount: announcement.readBy?.length || 0,
          dismissedCount: announcement.dismissedBy?.length || 0,
        });
      }
    }

    announcements.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];

      if (sortOrder === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    const total = announcements.length;
    const paginatedAnnouncements = announcements.slice(skip, skip + pageSize);

    const result = {
      announcements: paginatedAnnouncements,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      filters: { type, priority, targetAudience, isActive },
      sort: { sortBy, sortOrder },
      stats: {
        total,
        active: announcements.filter((a) => a.status === "active").length,
        scheduled: announcements.filter((a) => a.status === "scheduled").length,
        expired: announcements.filter((a) => a.status === "expired").length,
        inactive: announcements.filter((a) => a.status === "inactive").length,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Announcements retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get announcements error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve announcements",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSystemHealth = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const cacheKey = "system_health";
    let cachedHealth = await redisService.getJSON(cacheKey);

    if (cachedHealth) {
      return res.status(200).json({
        success: true,
        message: "System health retrieved successfully",
        data: cachedHealth,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const [
      dbHealth,
      redisHealth,
      userCount,
      courseCount,
      enrollmentCount,
      activeSessionCount,
    ] = await Promise.all([
      checkDatabaseHealth(),
      redisService.healthCheck(),
      prisma.user.count(),
      prisma.course.count(),
      prisma.enrollment.count(),
      getActiveSessionCount(),
    ]);

    const systemMetrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      version: process.env.APP_VERSION || "1.0.0",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
    };

    const health = {
      status: "healthy",
      services: {
        database: {
          status: dbHealth ? "healthy" : "unhealthy",
          responseTime: dbHealth?.responseTime || null,
          connections: dbHealth?.connections || null,
        },
        redis: {
          status: redisHealth ? "healthy" : "unhealthy",
          connected: redisHealth,
        },
        application: {
          status: "healthy",
          uptime: systemMetrics.uptime,
          memory: {
            used: Math.round(systemMetrics.memory.heapUsed / 1024 / 1024),
            total: Math.round(systemMetrics.memory.heapTotal / 1024 / 1024),
            usage: Math.round(
              (systemMetrics.memory.heapUsed / systemMetrics.memory.heapTotal) *
                100
            ),
          },
        },
      },
      platform: {
        totalUsers: userCount,
        totalCourses: courseCount,
        totalEnrollments: enrollmentCount,
        activeSessions: activeSessionCount,
      },
      system: systemMetrics,
      checks: {
        databaseConnectivity: dbHealth !== null,
        redisConnectivity: redisHealth,
        memoryUsage:
          systemMetrics.memory.heapUsed < systemMetrics.memory.heapTotal * 0.9,
        uptime: systemMetrics.uptime > 60,
      },
    };

    const overallHealthy =
      Object.values(health.checks).every((check) => check === true) &&
      health.services.database.status === "healthy" &&
      health.services.redis.status === "healthy";

    health.status = overallHealthy ? "healthy" : "degraded";

    await redisService.setJSON(cacheKey, health, { ex: 60 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "System health retrieved successfully",
      data: health,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get system health error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve system health",
      code: "INTERNAL_SERVER_ERROR",
      data: {
        status: "unhealthy",
        error: error.message,
      },
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const getAllActiveUserIds = async () => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return users.map((user) => user.id);
  } catch (error) {
    console.error("Get active user IDs error:", error);
    return [];
  }
};

const getTargetAudienceUserIds = async (audience) => {
  try {
    const where = { isActive: true };

    if (audience === "STUDENTS") {
      where.role = "STUDENT";
    } else if (audience === "INSTRUCTORS") {
      where.role = "INSTRUCTOR";
    } else if (audience === "ADMINS") {
      where.role = { in: ["ADMIN", "MODERATOR"] };
    }

    const users = await prisma.user.findMany({
      where,
      select: { id: true },
    });

    return users.map((user) => user.id);
  } catch (error) {
    console.error("Get target audience user IDs error:", error);
    return [];
  }
};

const checkDatabaseHealth = async () => {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const responseTime = Date.now() - start;

    return {
      responseTime,
      connections: null,
    };
  } catch (error) {
    console.error("Database health check failed:", error);
    return null;
  }
};

const getActiveSessionCount = async () => {
  try {
    const activeSessionsPattern = "session:*";
    const sessionKeys = await redisService.keys(activeSessionsPattern);
    return sessionKeys.length;
  } catch (error) {
    console.error("Get active session count error:", error);
    return 0;
  }
};
