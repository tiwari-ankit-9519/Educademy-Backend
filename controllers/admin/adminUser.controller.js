import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";
import emailService from "../../utils/emailService.js";
import notificationService from "../../utils/notificationservice.js";
import { deleteFromCloudinary } from "../../config/upload.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `admin_action_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;
};

const generateVerificationBadge = (verificationLevel) => {
  const badges = {
    BASIC: "✓ Verified Instructor",
    EXPERT: "⭐ Expert Instructor",
    PREMIUM: "👑 Premium Instructor",
    INDUSTRY: "🏆 Industry Expert",
  };
  return badges[verificationLevel] || badges.BASIC;
};

export const getAllUsers = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 20,
      role,
      status,
      isVerified,
      isBanned,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      dateFrom,
      dateTo,
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `admin_users:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      role,
      status,
      isVerified,
      isBanned,
      search,
      sortBy,
      sortOrder,
      dateFrom,
      dateTo,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Users retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const where = {};

    if (role) where.role = role;
    if (status !== undefined) where.isActive = status === "active";
    if (isVerified !== undefined) where.isVerified = isVerified === "true";
    if (isBanned !== undefined) where.isBanned = isBanned === "true";

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
          isVerified: true,
          isBanned: true,
          bannedAt: true,
          banReason: true,
          createdAt: true,
          lastLogin: true,
          profileImage: true,
          country: true,
          studentProfile: {
            select: {
              id: true,
              skillLevel: true,
              totalLearningTime: true,
            },
          },
          instructorProfile: {
            select: {
              id: true,
              isVerified: true,
              rating: true,
              totalStudents: true,
              totalCourses: true,
            },
          },
          adminProfile: {
            select: {
              id: true,
              department: true,
              permissions: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const processedUsers = users.map((user) => ({
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      isVerified: user.isVerified,
      isBanned: user.isBanned,
      bannedAt: user.bannedAt,
      banReason: user.banReason,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      profileImage: user.profileImage,
      country: user.country,
      profile:
        user.role === "STUDENT"
          ? user.studentProfile
          : user.role === "INSTRUCTOR"
          ? user.instructorProfile
          : user.adminProfile,
    }));

    const result = {
      users: processedUsers,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      filters: {
        role,
        status,
        isVerified,
        isBanned,
        search,
        dateFrom,
        dateTo,
      },
      sort: {
        sortBy,
        sortOrder,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Users retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve users",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getUserDetails = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { userId } = req.params;

    const cacheKey = `admin_user_details:${userId}`;
    let cachedUser = await redisService.getJSON(cacheKey);

    if (cachedUser) {
      return res.status(200).json({
        success: true,
        message: "User details retrieved successfully",
        data: cachedUser,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        studentProfile: {
          include: {
            enrollments: {
              include: {
                course: {
                  select: {
                    id: true,
                    title: true,
                    thumbnail: true,
                    price: true,
                  },
                },
              },
              take: 5,
              orderBy: { createdAt: "desc" },
            },
            wishlist: {
              include: {
                course: {
                  select: {
                    id: true,
                    title: true,
                    thumbnail: true,
                    price: true,
                  },
                },
              },
              take: 5,
            },
            cart: {
              include: {
                course: {
                  select: {
                    id: true,
                    title: true,
                    thumbnail: true,
                    price: true,
                  },
                },
              },
              take: 5,
            },
            certificates: {
              include: {
                course: {
                  select: {
                    id: true,
                    title: true,
                  },
                },
              },
              take: 5,
              orderBy: { createdAt: "desc" },
            },
          },
        },
        instructorProfile: {
          include: {
            courses: {
              select: {
                id: true,
                title: true,
                status: true,
                totalEnrollments: true,
                averageRating: true,
                totalRevenue: true,
              },
              take: 10,
              orderBy: { createdAt: "desc" },
            },
            earnings: {
              select: {
                amount: true,
                status: true,
                createdAt: true,
              },
              take: 10,
              orderBy: { createdAt: "desc" },
            },
          },
        },
        adminProfile: true,
        reviews: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
              },
            },
          },
          take: 5,
          orderBy: { createdAt: "desc" },
        },
        sessions: {
          where: { isActive: true },
          select: {
            deviceType: true,
            browser: true,
            ipAddress: true,
            lastActivity: true,
          },
          take: 5,
          orderBy: { lastActivity: "desc" },
        },
        notifications: {
          select: {
            type: true,
            isRead: true,
            createdAt: true,
          },
          take: 10,
          orderBy: { createdAt: "desc" },
        },
        userActivities: {
          select: {
            action: true,
            createdAt: true,
            ipAddress: true,
          },
          take: 20,
          orderBy: { createdAt: "desc" },
        },
        socialLogins: {
          select: {
            provider: true,
            createdAt: true,
          },
        },
        supportTickets: {
          select: {
            id: true,
            subject: true,
            status: true,
            priority: true,
            createdAt: true,
          },
          take: 5,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    const userStats = {
      totalLogins: user.userActivities.filter((a) => a.action === "login")
        .length,
      activeDevices: user.sessions.length,
      unreadNotifications: user.notifications.filter((n) => !n.isRead).length,
      lastActiveDate: user.sessions[0]?.lastActivity || user.lastLogin,
      accountAge: Math.floor(
        (new Date() - new Date(user.createdAt)) / (1000 * 60 * 60 * 24)
      ),
      totalReviews: user.reviews.length,
      averageRating:
        user.reviews.length > 0
          ? (
              user.reviews.reduce((sum, review) => sum + review.rating, 0) /
              user.reviews.length
            ).toFixed(1)
          : 0,
      totalSupportTickets: user.supportTickets.length,
      socialLoginProviders: user.socialLogins.map((login) => login.provider),
    };

    if (user.role === "STUDENT" && user.studentProfile) {
      userStats.totalEnrollments = user.studentProfile.enrollments.length;
      userStats.totalWishlistItems = user.studentProfile.wishlist.length;
      userStats.totalCartItems = user.studentProfile.cart.length;
      userStats.totalCertificates = user.studentProfile.certificates.length;
      userStats.totalLearningTime = user.studentProfile.totalLearningTime;
      userStats.skillLevel = user.studentProfile.skillLevel;
    }

    if (user.role === "INSTRUCTOR" && user.instructorProfile) {
      userStats.totalCourses = user.instructorProfile.totalCourses;
      userStats.totalStudents = user.instructorProfile.totalStudents;
      userStats.totalRevenue = Number(user.instructorProfile.totalRevenue);
      userStats.instructorRating = user.instructorProfile.rating;
      userStats.isVerifiedInstructor = user.instructorProfile.isVerified;
      userStats.totalEarnings = user.instructorProfile.earnings.reduce(
        (sum, earning) => sum + Number(earning.amount),
        0
      );
    }

    const userDetails = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      isVerified: user.isVerified,
      isBanned: user.isBanned,
      bannedAt: user.bannedAt,
      banReason: user.banReason,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      profileImage: user.profileImage,
      bio: user.bio,
      country: user.country,
      phoneNumber: user.phoneNumber,
      dateOfBirth: user.dateOfBirth,
      website: user.website,
      linkedinProfile: user.linkedinProfile,
      twitterProfile: user.twitterProfile,
      githubProfile: user.githubProfile,
      timezone: user.timezone,
      language: user.language,
      profile:
        user.role === "STUDENT"
          ? user.studentProfile
          : user.role === "INSTRUCTOR"
          ? user.instructorProfile
          : user.adminProfile,
      reviews: user.reviews,
      sessions: user.sessions,
      recentActivities: user.userActivities,
      recentNotifications: user.notifications,
      socialLogins: user.socialLogins,
      supportTickets: user.supportTickets,
      stats: userStats,
    };

    await redisService.setJSON(cacheKey, userDetails, { ex: 600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "User details retrieved successfully",
      data: userDetails,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get user details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve user details",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { userId } = req.params;
    const { action, reason, duration } = req.body;
    const adminId = req.userAuthId;

    if (
      ![
        "activate",
        "deactivate",
        "ban",
        "unban",
        "verify",
        "unverify",
      ].includes(action)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid action",
        code: "INVALID_ACTION",
      });
    }

    if (["ban", "deactivate"].includes(action) && !reason) {
      return res.status(400).json({
        success: false,
        message: "Reason is required for ban/deactivate actions",
        code: "REASON_REQUIRED",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        isBanned: true,
        isVerified: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { firstName: true, lastName: true },
    });

    let updateData = {};
    let actionMessage = "";
    let emailTemplate = null;
    let notificationType = "";
    let notificationMessage = "";

    switch (action) {
      case "activate":
        updateData = { isActive: true };
        actionMessage = "activated";
        notificationType = "account_reactivated";
        notificationMessage = "Your account has been reactivated";
        emailTemplate = {
          subject: "Account Reactivated - Educademy",
          template: "verification",
          templateData: {
            userName: user.firstName,
            title: "Account Reactivated",
            subtitle: "Your account is now active",
            message:
              "Your Educademy account has been reactivated. You can now access all platform features.",
            isSuccess: true,
            actionButton: "Access Dashboard",
            actionUrl: `${process.env.FRONTEND_URL}/dashboard`,
          },
        };
        break;

      case "deactivate":
        updateData = { isActive: false };
        actionMessage = "deactivated";
        notificationType = "account_deactivated";
        notificationMessage = `Your account has been deactivated. Reason: ${reason}`;
        emailTemplate = {
          subject: "Account Deactivated - Educademy",
          template: "security",
          templateData: {
            userName: user.firstName,
            title: "Account Deactivated",
            subtitle: "Your account has been temporarily deactivated",
            message:
              "Your Educademy account has been deactivated due to policy violations.",
            alertType: "warning",
            actionButton: "Contact Support",
            actionUrl: `${process.env.FRONTEND_URL}/support`,
            details: [
              { label: "Reason", value: reason },
              { label: "Action Date", value: new Date().toLocaleDateString() },
              {
                label: "Action By",
                value: `${admin.firstName} ${admin.lastName}`,
              },
            ],
            footerNote:
              "Contact support if you believe this action was taken in error.",
          },
        };
        break;

      case "ban":
        const banUntil = duration
          ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000)
          : null;
        updateData = {
          isBanned: true,
          isActive: false,
          bannedAt: new Date(),
          bannedBy: adminId,
          banReason: reason,
        };
        actionMessage = "banned";
        notificationType = "account_banned";
        notificationMessage = `Your account has been banned. Reason: ${reason}`;
        emailTemplate = {
          subject: "Account Banned - Educademy",
          template: "security",
          templateData: {
            userName: user.firstName,
            title: "Account Banned",
            subtitle: "Your account has been banned",
            message:
              "Your Educademy account has been banned due to serious policy violations.",
            alertType: "critical",
            actionButton: "Appeal Ban",
            actionUrl: `${process.env.FRONTEND_URL}/ban-appeal`,
            details: [
              { label: "Reason", value: reason },
              { label: "Ban Date", value: new Date().toLocaleDateString() },
              {
                label: "Duration",
                value: duration ? `${duration} days` : "Permanent",
              },
              {
                label: "Action By",
                value: `${admin.firstName} ${admin.lastName}`,
              },
            ],
            footerNote:
              "You can appeal this decision through our support system.",
          },
        };
        break;

      case "unban":
        updateData = {
          isBanned: false,
          isActive: true,
          bannedAt: null,
          bannedBy: null,
          banReason: null,
        };
        actionMessage = "unbanned";
        notificationType = "account_unbanned";
        notificationMessage = "Your account ban has been lifted";
        emailTemplate = {
          subject: "Account Unbanned - Educademy",
          template: "verification",
          templateData: {
            userName: user.firstName,
            title: "Account Unbanned",
            subtitle: "Your ban has been lifted",
            message:
              "Your Educademy account ban has been lifted. You can now access the platform normally.",
            isSuccess: true,
            actionButton: "Access Dashboard",
            actionUrl: `${process.env.FRONTEND_URL}/dashboard`,
          },
        };
        break;

      case "verify":
        updateData = { isVerified: true };
        actionMessage = "verified";
        notificationType = "account_verified";
        notificationMessage = "Your account has been verified";
        emailTemplate = {
          subject: "Account Verified - Educademy",
          template: "verification",
          templateData: {
            userName: user.firstName,
            title: "Account Verified!",
            subtitle: "Your account is now verified",
            message:
              "Congratulations! Your Educademy account has been verified by our admin team.",
            isSuccess: true,
            actionButton: "Access Dashboard",
            actionUrl: `${process.env.FRONTEND_URL}/dashboard`,
          },
        };
        break;

      case "unverify":
        updateData = { isVerified: false };
        actionMessage = "unverified";
        notificationType = "account_unverified";
        notificationMessage = "Your account verification has been removed";
        break;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    try {
      if (emailTemplate) {
        await emailService.send({
          to: user.email,
          subject: emailTemplate.subject,
          template: emailTemplate.template,
          templateData: emailTemplate.templateData,
        });
      }
    } catch (emailError) {
      console.error("Failed to send status update email:", emailError);
    }

    try {
      await notificationService.createNotification({
        userId: user.id,
        type: notificationType,
        title: `Account ${
          actionMessage.charAt(0).toUpperCase() + actionMessage.slice(1)
        }`,
        message: notificationMessage,
        priority: ["ban", "deactivate"].includes(action) ? "HIGH" : "NORMAL",
        data: {
          action,
          reason,
          actionBy: `${admin.firstName} ${admin.lastName}`,
          actionDate: new Date().toISOString(),
        },
      });
    } catch (notificationError) {
      console.error(
        "Failed to create status update notification:",
        notificationError
      );
    }

    await redisService.delPattern("admin_users:*");
    await redisService.del(`admin_user_details:${userId}`);
    await redisService.del(`user:${userId}`);

    const actionId = generateRequestId();
    await prisma.userActivity.create({
      data: {
        userId: user.id,
        action: `admin_${action}`,
        details: {
          actionId,
          reason,
          adminId,
          adminName: `${admin.firstName} ${admin.lastName}`,
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `User ${actionMessage} successfully`,
      data: {
        userId: updatedUser.id,
        action,
        actionDate: new Date().toISOString(),
        actionBy: `${admin.firstName} ${admin.lastName}`,
        newStatus: {
          isActive: updatedUser.isActive,
          isBanned: updatedUser.isBanned,
          isVerified: updatedUser.isVerified,
        },
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user status",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const bulkUpdateUsers = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { userIds, action, reason } = req.body;
    const adminId = req.userAuthId;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "User IDs array is required",
        code: "USER_IDS_REQUIRED",
      });
    }

    if (
      ![
        "activate",
        "deactivate",
        "ban",
        "unban",
        "verify",
        "unverify",
        "delete",
      ].includes(action)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid bulk action",
        code: "INVALID_ACTION",
      });
    }

    if (userIds.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Maximum 100 users can be updated at once",
        code: "BULK_LIMIT_EXCEEDED",
      });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
      },
    });

    if (users.length !== userIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some user IDs are invalid",
        code: "INVALID_USER_IDS",
      });
    }

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { firstName: true, lastName: true },
    });

    let updateData = {};
    let actionMessage = "";

    switch (action) {
      case "activate":
        updateData = { isActive: true };
        actionMessage = "activated";
        break;
      case "deactivate":
        updateData = { isActive: false };
        actionMessage = "deactivated";
        break;
      case "ban":
        updateData = {
          isBanned: true,
          isActive: false,
          bannedAt: new Date(),
          bannedBy: adminId,
          banReason: reason,
        };
        actionMessage = "banned";
        break;
      case "unban":
        updateData = {
          isBanned: false,
          isActive: true,
          bannedAt: null,
          bannedBy: null,
          banReason: null,
        };
        actionMessage = "unbanned";
        break;
      case "verify":
        updateData = { isVerified: true };
        actionMessage = "verified";
        break;
      case "unverify":
        updateData = { isVerified: false };
        actionMessage = "unverified";
        break;
    }

    let successCount = 0;
    let failedUsers = [];

    if (action === "delete") {
      for (const user of users) {
        try {
          await prisma.user.delete({
            where: { id: user.id },
          });
          successCount++;
        } catch (error) {
          failedUsers.push({
            userId: user.id,
            email: user.email,
            error: "Failed to delete user",
          });
        }
      }
    } else {
      try {
        const result = await prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: updateData,
        });
        successCount = result.count;
      } catch (error) {
        console.error("Bulk update error:", error);
        return res.status(500).json({
          success: false,
          message: "Bulk update failed",
          code: "BULK_UPDATE_FAILED",
        });
      }
    }

    for (const user of users) {
      try {
        if (action !== "delete") {
          await notificationService.createNotification({
            userId: user.id,
            type: `account_${action}`,
            title: `Account ${
              actionMessage.charAt(0).toUpperCase() + actionMessage.slice(1)
            }`,
            message: `Your account has been ${actionMessage} by admin`,
            priority: ["ban", "deactivate", "delete"].includes(action)
              ? "HIGH"
              : "NORMAL",
            data: {
              action,
              reason,
              actionBy: `${admin.firstName} ${admin.lastName}`,
              actionDate: new Date().toISOString(),
              bulkAction: true,
            },
          });
        }

        await prisma.userActivity.create({
          data: {
            userId: user.id,
            action: `admin_bulk_${action}`,
            details: {
              reason,
              adminId,
              adminName: `${admin.firstName} ${admin.lastName}`,
              bulkAction: true,
              totalAffected: successCount,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
          },
        });
      } catch (error) {
        console.error(
          `Failed to create notification/activity for user ${user.id}:`,
          error
        );
      }
    }

    await redisService.delPattern("admin_users:*");
    for (const userId of userIds) {
      await redisService.del(`admin_user_details:${userId}`);
      await redisService.del(`user:${userId}`);
    }

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `Bulk ${action} completed`,
      data: {
        action,
        totalRequested: userIds.length,
        successCount,
        failedCount: failedUsers.length,
        failedUsers,
        actionBy: `${admin.firstName} ${admin.lastName}`,
        actionDate: new Date().toISOString(),
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Bulk update users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to perform bulk operation",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteUser = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { userId } = req.params;
    const { reason, confirmEmail } = req.body;
    const adminId = req.userAuthId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (confirmEmail !== user.email) {
      return res.status(400).json({
        success: false,
        message: "Email confirmation does not match",
        code: "EMAIL_MISMATCH",
      });
    }

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { firstName: true, lastName: true, email: true },
    });

    await prisma.user.delete({
      where: { id: userId },
    });

    try {
      await emailService.send({
        to: user.email,
        subject: "Account Deleted - Educademy",
        template: "security",
        templateData: {
          userName: user.firstName,
          title: "Account Deleted",
          subtitle: "Your account has been permanently deleted",
          message:
            "Your Educademy account has been permanently deleted by our admin team.",
          alertType: "critical",
          details: [
            { label: "Reason", value: reason || "Admin action" },
            { label: "Deletion Date", value: new Date().toLocaleDateString() },
            {
              label: "Action By",
              value: `${admin.firstName} ${admin.lastName}`,
            },
          ],
          footerNote:
            "This action cannot be undone. All your data has been permanently removed.",
        },
      });
    } catch (emailError) {
      console.error("Failed to send deletion email:", emailError);
    }

    await redisService.delPattern("admin_users:*");
    await redisService.del(`admin_user_details:${userId}`);
    await redisService.del(`user:${userId}`);

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
      data: {
        deletedUserId: userId,
        deletedUserEmail: user.email,
        reason: reason || "Admin action",
        deletedBy: `${admin.firstName} ${admin.lastName}`,
        deletionDate: new Date().toISOString(),
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getUserStats = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "30d" } = req.query;

    const cacheKey = `admin_user_stats:${period}`;
    let cachedStats = await redisService.getJSON(cacheKey);

    if (cachedStats) {
      return res.status(200).json({
        success: true,
        message: "User statistics retrieved successfully",
        data: cachedStats,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    let dateFilter = {};
    const now = new Date();

    switch (period) {
      case "7d":
        dateFilter.gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        dateFilter.gte = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        dateFilter.gte = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "1y":
        dateFilter.gte = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
    }

    const [
      totalUsers,
      activeUsers,
      verifiedUsers,
      bannedUsers,
      newUsers,
      usersByRole,
      usersByCountry,
      recentActivity,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isVerified: true } }),
      prisma.user.count({ where: { isBanned: true } }),
      prisma.user.count({ where: { createdAt: dateFilter } }),
      prisma.user.groupBy({
        by: ["role"],
        _count: { role: true },
      }),
      prisma.user.groupBy({
        by: ["country"],
        where: { country: { not: null } },
        _count: { country: true },
        orderBy: { _count: { country: "desc" } },
        take: 10,
      }),
      prisma.userActivity.count({
        where: {
          createdAt: dateFilter,
          action: "login",
        },
      }),
    ]);

    const stats = {
      overview: {
        totalUsers,
        activeUsers,
        verifiedUsers,
        bannedUsers,
        newUsers,
        activeRate:
          totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(2) : 0,
        verificationRate:
          totalUsers > 0 ? ((verifiedUsers / totalUsers) * 100).toFixed(2) : 0,
        recentLogins: recentActivity,
      },
      distribution: {
        byRole: usersByRole.reduce((acc, item) => {
          acc[item.role] = item._count.role;
          return acc;
        }, {}),
        byCountry: usersByCountry.map((item) => ({
          country: item.country,
          count: item._count.country,
        })),
      },
      growth: {
        newUsersThisPeriod: newUsers,
        period: period,
      },
    };

    await redisService.setJSON(cacheKey, stats, { ex: 900 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "User statistics retrieved successfully",
      data: stats,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get user stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve user statistics",
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
    const {
      page = 1,
      limit = 50,
      search,
      isActive,
      hasParent,
      sortBy = "order",
      sortOrder = "asc",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `admin_categories:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      search,
      isActive,
      hasParent,
      sortBy,
      sortOrder,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Categories retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    if (hasParent !== undefined) {
      if (hasParent === "true") {
        where.parentId = { not: null };
      } else {
        where.parentId = null;
      }
    }

    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [categories, total] = await Promise.all([
      prisma.category.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          parent: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          subcategories: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
            },
          },
          courses: {
            select: {
              id: true,
              status: true,
            },
          },
          subcategoryCourses: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      }),
      prisma.category.count({ where }),
    ]);

    const processedCategories = categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      image: category.image,
      icon: category.icon,
      color: category.color,
      isActive: category.isActive,
      order: category.order,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      parent: category.parent,
      subcategoriesCount: category.subcategories.length,
      coursesCount:
        category.courses.length + category.subcategoryCourses.length,
      publishedCoursesCount: [
        ...category.courses,
        ...category.subcategoryCourses,
      ].filter((course) => course.status === "PUBLISHED").length,
    }));

    const result = {
      categories: processedCategories,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      filters: {
        search,
        isActive,
        hasParent,
      },
      sort: {
        sortBy,
        sortOrder,
      },
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
    console.error("Get all categories error:", error);
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
    const { name, description, icon, color, parentId, order = 0 } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
        code: "NAME_REQUIRED",
      });
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim("-");

    const existingCategory = await prisma.category.findFirst({
      where: {
        OR: [{ name: { equals: name, mode: "insensitive" } }, { slug }],
      },
    });

    if (existingCategory) {
      if (req.file) {
        const publicId = req.file.filename || req.file.public_id;
        if (publicId) {
          await deleteFromCloudinary(publicId, "image");
        }
      }

      return res.status(400).json({
        success: false,
        message: "Category with this name or slug already exists",
        code: "CATEGORY_EXISTS",
      });
    }

    if (parentId) {
      const parentCategory = await prisma.category.findUnique({
        where: { id: parentId },
      });

      if (!parentCategory) {
        if (req.file) {
          const publicId = req.file.filename || req.file.public_id;
          if (publicId) {
            await deleteFromCloudinary(publicId, "image");
          }
        }

        return res.status(400).json({
          success: false,
          message: "Parent category not found",
          code: "PARENT_NOT_FOUND",
        });
      }

      if (parentCategory.parentId) {
        if (req.file) {
          const publicId = req.file.filename || req.file.public_id;
          if (publicId) {
            await deleteFromCloudinary(publicId, "image");
          }
        }

        return res.status(400).json({
          success: false,
          message: "Cannot create subcategory under another subcategory",
          code: "NESTED_SUBCATEGORY_NOT_ALLOWED",
        });
      }
    }

    let imageUrl = null;
    let imagePublicId = null;

    if (req.file) {
      imageUrl = req.file.path;
      imagePublicId = req.file.filename || req.file.public_id;
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        description,
        image: imageUrl,
        icon,
        color,
        parentId,
        order: parseInt(order),
        isActive: true,
      },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            subcategories: true,
            courses: true,
          },
        },
      },
    });

    await redisService.delPattern("admin_categories:*");
    await redisService.delPattern("categories:*");
    await redisService.del("category_tree");

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
        imagePublicId: imagePublicId,
        icon: category.icon,
        color: category.color,
        order: category.order,
        isActive: category.isActive,
        parent: category.parent,
        subcategoriesCount: category._count.subcategories,
        coursesCount: category._count.courses,
        createdAt: category.createdAt,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Create category error:", error);

    if (req.file) {
      const publicId = req.file.filename || req.file.public_id;
      if (publicId) {
        try {
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error(
            "Error deleting uploaded file after error:",
            deleteError
          );
        }
      }
    }

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
    const { name, description, icon, color, parentId, order, isActive } =
      req.body;

    const existingCategory = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (!existingCategory) {
      if (req.file) {
        const publicId = req.file.filename || req.file.public_id;
        if (publicId) {
          await deleteFromCloudinary(publicId, "image");
        }
      }

      return res.status(404).json({
        success: false,
        message: "Category not found",
        code: "CATEGORY_NOT_FOUND",
      });
    }

    let slug = existingCategory.slug;
    if (name && name !== existingCategory.name) {
      slug = name
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim("-");

      const existingSlug = await prisma.category.findFirst({
        where: {
          AND: [
            { id: { not: categoryId } },
            {
              OR: [{ name: { equals: name, mode: "insensitive" } }, { slug }],
            },
          ],
        },
      });

      if (existingSlug) {
        if (req.file) {
          const publicId = req.file.filename || req.file.public_id;
          if (publicId) {
            await deleteFromCloudinary(publicId, "image");
          }
        }

        return res.status(400).json({
          success: false,
          message: "Category with this name or slug already exists",
          code: "CATEGORY_EXISTS",
        });
      }
    }

    if (parentId && parentId !== existingCategory.parentId) {
      if (parentId === categoryId) {
        if (req.file) {
          const publicId = req.file.filename || req.file.public_id;
          if (publicId) {
            await deleteFromCloudinary(publicId, "image");
          }
        }

        return res.status(400).json({
          success: false,
          message: "Category cannot be its own parent",
          code: "INVALID_PARENT",
        });
      }

      const parentCategory = await prisma.category.findUnique({
        where: { id: parentId },
      });

      if (!parentCategory) {
        if (req.file) {
          const publicId = req.file.filename || req.file.public_id;
          if (publicId) {
            await deleteFromCloudinary(publicId, "image");
          }
        }

        return res.status(400).json({
          success: false,
          message: "Parent category not found",
          code: "PARENT_NOT_FOUND",
        });
      }

      if (parentCategory.parentId) {
        if (req.file) {
          const publicId = req.file.filename || req.file.public_id;
          if (publicId) {
            await deleteFromCloudinary(publicId, "image");
          }
        }

        return res.status(400).json({
          success: false,
          message: "Cannot create subcategory under another subcategory",
          code: "NESTED_SUBCATEGORY_NOT_ALLOWED",
        });
      }
    }

    let imageUrl = existingCategory.image;
    let oldImagePublicId = null;

    if (req.file) {
      if (existingCategory.image) {
        try {
          const oldImageUrl = existingCategory.image;
          const urlParts = oldImageUrl.split("/");
          const publicIdWithExtension = urlParts[urlParts.length - 1];
          oldImagePublicId = publicIdWithExtension.split(".")[0];

          const folderPath = urlParts.slice(-3, -1).join("/");
          if (folderPath) {
            oldImagePublicId = `${folderPath}/${oldImagePublicId}`;
          }
        } catch (error) {
          console.error("Error parsing old image URL:", error);
        }
      }

      imageUrl = req.file.path;
    }

    const updateData = {
      ...(name && { name, slug }),
      ...(description !== undefined && { description }),
      ...(imageUrl && { image: imageUrl }),
      ...(icon !== undefined && { icon }),
      ...(color !== undefined && { color }),
      ...(parentId !== undefined && { parentId }),
      ...(order !== undefined && { order: parseInt(order) }),
      ...(isActive !== undefined && {
        isActive: isActive === "true" || isActive === true,
      }),
    };

    const category = await prisma.category.update({
      where: { id: categoryId },
      data: updateData,
      include: {
        parent: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            subcategories: true,
            courses: true,
          },
        },
      },
    });

    if (oldImagePublicId && req.file) {
      try {
        await deleteFromCloudinary(oldImagePublicId, "image");
      } catch (deleteError) {
        console.error("Error deleting old image:", deleteError);
      }
    }

    await redisService.delPattern("admin_categories:*");
    await redisService.delPattern("categories:*");
    await redisService.del("category_tree");

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        image: category.image,
        icon: category.icon,
        color: category.color,
        order: category.order,
        isActive: category.isActive,
        parent: category.parent,
        subcategoriesCount: category._count.subcategories,
        coursesCount: category._count.courses,
        updatedAt: category.updatedAt,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Update category error:", error);

    if (req.file) {
      const publicId = req.file.filename || req.file.public_id;
      if (publicId) {
        try {
          await deleteFromCloudinary(publicId, "image");
        } catch (deleteError) {
          console.error(
            "Error deleting uploaded file after error:",
            deleteError
          );
        }
      }
    }

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

    if (category.subcategories.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete category that has subcategories",
        code: "HAS_SUBCATEGORIES",
        data: {
          subcategoriesCount: category.subcategories.length,
        },
      });
    }

    if (category.courses.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete category that has courses",
        code: "HAS_COURSES",
        data: {
          coursesCount: category.courses.length,
        },
      });
    }

    let imagePublicId = null;
    if (category.image) {
      try {
        const imageUrl = category.image;
        const urlParts = imageUrl.split("/");
        const publicIdWithExtension = urlParts[urlParts.length - 1];
        imagePublicId = publicIdWithExtension.split(".")[0];

        const folderPath = urlParts.slice(-3, -1).join("/");
        if (folderPath) {
          imagePublicId = `${folderPath}/${imagePublicId}`;
        }
      } catch (error) {
        console.error("Error parsing image URL for deletion:", error);
      }
    }

    await prisma.category.delete({
      where: { id: categoryId },
    });

    if (imagePublicId) {
      try {
        await deleteFromCloudinary(imagePublicId, "image");
      } catch (deleteError) {
        console.error("Error deleting category image:", deleteError);
      }
    }

    await redisService.delPattern("admin_categories:*");
    await redisService.delPattern("categories:*");
    await redisService.del("category_tree");

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
      data: {
        deletedCategory: {
          id: category.id,
          name: category.name,
          slug: category.slug,
        },
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

export const getSingleCategory = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { categoryId } = req.params;

    const cacheKey = `admin_category:${categoryId}`;
    let cachedCategory = await redisService.getJSON(cacheKey);

    if (cachedCategory) {
      return res.status(200).json({
        success: true,
        message: "Category details retrieved successfully",
        data: cachedCategory,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: {
        parent: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        subcategories: {
          select: {
            id: true,
            name: true,
            slug: true,
            isActive: true,
            order: true,
            _count: {
              select: {
                courses: true,
                subcategoryCourses: true,
              },
            },
          },
          orderBy: { order: "asc" },
        },
        courses: {
          select: {
            id: true,
            title: true,
            status: true,
            averageRating: true,
            totalEnrollments: true,
            createdAt: true,
          },
          take: 10,
          orderBy: { createdAt: "desc" },
        },
        subcategoryCourses: {
          select: {
            id: true,
            title: true,
            status: true,
            averageRating: true,
            totalEnrollments: true,
            createdAt: true,
          },
          take: 10,
          orderBy: { createdAt: "desc" },
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

    const totalCourses =
      category.courses.length + category.subcategoryCourses.length;
    const publishedCourses = [
      ...category.courses,
      ...category.subcategoryCourses,
    ].filter((course) => course.status === "PUBLISHED").length;

    const categoryDetails = {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      image: category.image,
      icon: category.icon,
      color: category.color,
      isActive: category.isActive,
      order: category.order,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      parent: category.parent,
      subcategories: category.subcategories.map((sub) => ({
        ...sub,
        totalCourses: sub._count.courses + sub._count.subcategoryCourses,
      })),
      recentCourses: [...category.courses, ...category.subcategoryCourses]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10),
      stats: {
        totalCourses,
        publishedCourses,
        subcategoriesCount: category.subcategories.length,
        avgCoursesPerSubcategory:
          category.subcategories.length > 0
            ? (totalCourses / category.subcategories.length).toFixed(1)
            : 0,
      },
    };

    await redisService.setJSON(cacheKey, categoryDetails, { ex: 900 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Category details retrieved successfully",
      data: categoryDetails,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get single category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve category details",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getAllVerificationRequests = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 20,
      status,
      verificationLevel,
      priority,
      sortBy = "submittedAt",
      sortOrder = "desc",
      search,
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `admin_verification_requests:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      status,
      verificationLevel,
      priority,
      sortBy,
      sortOrder,
      search,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Verification requests retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const where = {};
    if (status) where.status = status;
    if (verificationLevel) where.verificationLevel = verificationLevel;
    if (priority) where.priority = priority;
    if (search) {
      where.OR = [
        {
          instructor: {
            user: {
              OR: [
                { firstName: { contains: search, mode: "insensitive" } },
                { lastName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        },
        { requestId: { contains: search, mode: "insensitive" } },
      ];
    }

    const orderBy = {};
    if (
      sortBy === "submittedAt" ||
      sortBy === "reviewedAt" ||
      sortBy === "createdAt" ||
      sortBy === "updatedAt"
    ) {
      orderBy[sortBy] = sortOrder;
    } else if (sortBy === "instructorName") {
      orderBy.instructor = {
        user: {
          firstName: sortOrder,
        },
      };
    } else {
      orderBy[sortBy] = sortOrder;
    }

    const [requests, total] = await Promise.all([
      prisma.verificationRequest.findMany({
        where,
        include: {
          instructor: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          reviewedByUser: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy,
        skip,
        take: pageSize,
      }),
      prisma.verificationRequest.count({ where }),
    ]);

    const formattedRequests = requests.map((request) => ({
      requestId: request.requestId,
      instructorId: request.instructorId,
      instructorName: `${request.instructor.user.firstName} ${request.instructor.user.lastName}`,
      instructorEmail: request.instructor.user.email,
      verificationLevel: request.verificationLevel,
      status: request.status,
      priority: request.priority,
      submittedAt: request.submittedAt,
      reviewedAt: request.reviewedAt,
      reviewedBy: request.reviewedByUser
        ? `${request.reviewedByUser.firstName} ${request.reviewedByUser.lastName}`
        : null,
      documentsCount: request.documents
        ? Array.isArray(request.documents)
          ? request.documents.length
          : 0
        : 0,
      qualificationsCount: request.qualifications
        ? Array.isArray(request.qualifications)
          ? request.qualifications.length
          : 0
        : 0,
      experienceCount: request.experience
        ? Array.isArray(request.experience)
          ? request.experience.length
          : 0
        : 0,
      additionalInfo: request.additionalInfo
        ? request.additionalInfo.substring(0, 100) + "..."
        : null,
    }));

    const stats = await prisma.verificationRequest.groupBy({
      by: ["status"],
      _count: true,
    });

    const statsMap = stats.reduce((acc, stat) => {
      acc[stat.status.toLowerCase()] = stat._count;
      return acc;
    }, {});

    const levelStats = await prisma.verificationRequest.groupBy({
      by: ["verificationLevel"],
      _count: true,
    });

    const levelStatsMap = levelStats.reduce((acc, stat) => {
      acc[`level_${stat.verificationLevel.toLowerCase()}`] = stat._count;
      return acc;
    }, {});

    const result = {
      requests: formattedRequests,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      filters: {
        status,
        verificationLevel,
        priority,
        search,
      },
      sort: {
        sortBy,
        sortOrder,
      },
      stats: {
        totalRequests: total,
        pendingRequests: statsMap.pending || 0,
        approvedRequests: statsMap.approved || 0,
        rejectedRequests: statsMap.rejected || 0,
        underReviewRequests: statsMap.under_review || 0,
        levelBasic: levelStatsMap.level_basic || 0,
        levelPremium: levelStatsMap.level_premium || 0,
        levelExpert: levelStatsMap.level_expert || 0,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Verification requests retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get all verification requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve verification requests",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getVerificationRequestById = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Request ID is required",
        code: "REQUEST_ID_REQUIRED",
      });
    }

    let requestData = await redisService.getJSON(
      `verification_request:${requestId}`
    );

    if (!requestData) {
      requestData = await prisma.verificationRequest.findUnique({
        where: { requestId },
        include: {
          instructor: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          reviewedByUser: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (requestData) {
        const formattedData = {
          ...requestData,
          instructorName: `${requestData.instructor.user.firstName} ${requestData.instructor.user.lastName}`,
          instructorEmail: requestData.instructor.user.email,
          reviewedBy: requestData.reviewedByUser
            ? `${requestData.reviewedByUser.firstName} ${requestData.reviewedByUser.lastName}`
            : null,
        };
        await redisService.setJSON(
          `verification_request:${requestId}`,
          formattedData,
          { ex: 7 * 24 * 60 * 60 }
        );
        requestData = formattedData;
      }
    }

    if (!requestData) {
      return res.status(404).json({
        success: false,
        message: "Verification request not found",
        code: "REQUEST_NOT_FOUND",
      });
    }

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Verification request retrieved successfully",
      data: {
        request: requestData,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get verification request by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve verification request",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const reviewVerificationRequest = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { requestId } = req.params;
    const { action, adminNotes, rejectionReason } = req.body;
    const adminId = req.userAuthId;

    if (!["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be APPROVE or REJECT",
        code: "INVALID_ACTION",
      });
    }

    if (action === "REJECT" && !rejectionReason) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required when rejecting a request",
        code: "REJECTION_REASON_REQUIRED",
      });
    }

    const verificationRequest = await prisma.verificationRequest.findUnique({
      where: { requestId },
      include: {
        instructor: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!verificationRequest) {
      return res.status(404).json({
        success: false,
        message: "Verification request not found",
        code: "REQUEST_NOT_FOUND",
      });
    }

    if (verificationRequest.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Cannot review ${verificationRequest.status.toLowerCase()} verification request`,
        code: "INVALID_STATUS",
      });
    }

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { firstName: true, lastName: true, email: true },
    });

    const newStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
    const verificationBadge =
      action === "APPROVE"
        ? `${verificationRequest.verificationLevel}_VERIFIED`
        : null;

    const updatedRequest = await prisma.$transaction(async (tx) => {
      const request = await tx.verificationRequest.update({
        where: { requestId },
        data: {
          status: newStatus,
          reviewedAt: new Date(),
          reviewedBy: `${admin.firstName} ${admin.lastName}`,
          reviewedById: adminId,
          adminNotes: adminNotes || "",
          rejectionReason: action === "REJECT" ? rejectionReason : null,
        },
        include: {
          instructor: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      if (action === "APPROVE") {
        await tx.instructor.update({
          where: { id: verificationRequest.instructorId },
          data: {
            isVerified: true,
            verificationBadge: verificationBadge,
          },
        });

        await tx.user.update({
          where: { id: verificationRequest.instructor.user.id },
          data: {
            isVerified: true,
          },
        });
      }

      return request;
    });

    await Promise.all([
      redisService.setJSON(
        `verification_request:${requestId}`,
        {
          ...updatedRequest,
          instructorName: `${updatedRequest.instructor.user.firstName} ${updatedRequest.instructor.user.lastName}`,
          instructorEmail: updatedRequest.instructor.user.email,
        },
        { ex: 30 * 24 * 60 * 60 }
      ),
      redisService.del(
        `verification_request:instructor:${verificationRequest.instructorId}`
      ),
      redisService.zrem("verification_requests:pending", requestId),
      redisService.del(
        `instructor_profile:${verificationRequest.instructorId}`
      ),
      redisService.del(
        `user_profile:${verificationRequest.instructor.user.id}`
      ),
      redisService.delPattern(
        `profile_cache:*${verificationRequest.instructor.user.id}*`
      ),
      redisService.delPattern("admin_verification_requests:*"),
    ]);

    setImmediate(async () => {
      try {
        if (action === "APPROVE") {
          await Promise.all([
            emailService.send({
              to: verificationRequest.instructor.user.email,
              subject: "Verification Approved - Congratulations! 🎉",
              template: "verification",
              templateData: {
                userName: verificationRequest.instructor.user.firstName,
                title: "Verification Approved!",
                subtitle: "Your instructor verification has been approved",
                message: `Congratulations! Your ${verificationRequest.verificationLevel.toLowerCase()} verification request has been approved. You now have a verified instructor badge on your profile.`,
                isSuccess: true,
                actionButton: "View Profile",
                actionUrl: `${process.env.FRONTEND_URL}/instructor/profile`,
                achievements: [
                  "Verified instructor status granted",
                  `${verificationBadge} badge added to profile`,
                  "Enhanced credibility and visibility",
                  "Access to premium instructor features",
                ],
              },
            }),
            notificationService.createNotification({
              userId: verificationRequest.instructor.user.id,
              type: "SYSTEM_ANNOUNCEMENT",
              title: "Verification Approved!",
              message: `Congratulations! Your ${verificationRequest.verificationLevel.toLowerCase()} verification has been approved.`,
              priority: "HIGH",
              data: {
                requestId,
                verificationLevel: verificationRequest.verificationLevel,
                verificationBadge: verificationBadge,
                approvedAt: updatedRequest.reviewedAt,
                notificationType: "verification_approved",
              },
              actionUrl: "/instructor/profile",
            }),
          ]);
        } else {
          await Promise.all([
            emailService.send({
              to: verificationRequest.instructor.user.email,
              subject: "Verification Update Required - Educademy",
              template: "verification",
              templateData: {
                userName: verificationRequest.instructor.user.firstName,
                title: "Verification Update Required",
                subtitle:
                  "Your verification request needs additional information",
                message:
                  "Your verification request has been reviewed and requires some updates before it can be approved. Please review the feedback and resubmit your request.",
                isSuccess: false,
                actionButton: "Update Request",
                actionUrl: `${process.env.FRONTEND_URL}/instructor/verification`,
                suggestions: [
                  rejectionReason,
                  "Review all required documents",
                  "Ensure all information is accurate and complete",
                  "Contact support if you need assistance",
                ],
              },
            }),
            notificationService.createNotification({
              userId: verificationRequest.instructor.user.id,
              type: "SYSTEM_ANNOUNCEMENT",
              title: "Verification Update Required",
              message: `Your ${verificationRequest.verificationLevel.toLowerCase()} verification request needs updates before approval.`,
              priority: "NORMAL",
              data: {
                requestId,
                rejectionReason,
                verificationLevel: verificationRequest.verificationLevel,
                rejectedAt: updatedRequest.reviewedAt,
                notificationType: "verification_rejected",
              },
              actionUrl: "/instructor/verification",
            }),
          ]);
        }
      } catch (error) {
        console.error("Background notification error:", error);
      }
    });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `Verification request ${action.toLowerCase()}d successfully`,
      data: {
        requestId: updatedRequest.requestId,
        status: updatedRequest.status,
        reviewedAt: updatedRequest.reviewedAt,
        reviewedBy: updatedRequest.reviewedBy,
        verificationLevel: updatedRequest.verificationLevel,
        verificationBadge: verificationBadge,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Review verification request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to review verification request",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getVerificationStats = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "all" } = req.query;

    const cacheKey = `verification_stats:${period}`;
    let cachedStats = await redisService.getJSON(cacheKey);

    if (cachedStats) {
      return res.status(200).json({
        success: true,
        message: "Verification statistics retrieved successfully",
        data: cachedStats,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const statsKey = "verification_stats";
    const redisStats = await redisService.hgetall(statsKey);

    const dbStats = await prisma.instructor.aggregate({
      _count: {
        id: true,
      },
      where: {
        isVerified: true,
      },
    });

    const totalInstructors = await prisma.instructor.count();

    const verificationsByLevel = await prisma.instructor.groupBy({
      by: ["verificationBadge"],
      where: {
        isVerified: true,
        verificationBadge: { not: null },
      },
      _count: {
        verificationBadge: true,
      },
    });

    const stats = {
      overview: {
        totalRequests: parseInt(redisStats.total_requests || 0),
        pendingRequests: parseInt(redisStats.pending_requests || 0),
        approvedRequests: parseInt(redisStats.approved_requests || 0),
        rejectedRequests: parseInt(redisStats.rejected_requests || 0),
        cancelledRequests: parseInt(redisStats.cancelled_requests || 0),
        totalInstructors,
        verifiedInstructors: dbStats._count.id,
        verificationRate:
          totalInstructors > 0
            ? ((dbStats._count.id / totalInstructors) * 100).toFixed(2)
            : 0,
      },
      byLevel: {
        basic: parseInt(redisStats.level_basic || 0),
        expert: parseInt(redisStats.level_expert || 0),
        premium: parseInt(redisStats.level_premium || 0),
        industry: parseInt(redisStats.level_industry || 0),
      },
      verificationDistribution: verificationsByLevel.reduce(
        (acc, item) => {
          const level = item.verificationBadge.toLowerCase().includes("expert")
            ? "expert"
            : item.verificationBadge.toLowerCase().includes("premium")
            ? "premium"
            : item.verificationBadge.toLowerCase().includes("industry")
            ? "industry"
            : "basic";
          acc[level] = item._count.verificationBadge;
          return acc;
        },
        { basic: 0, expert: 0, premium: 0, industry: 0 }
      ),
      performance: {
        averageReviewTime: "2.5 days",
        approvalRate:
          redisStats.total_requests > 0
            ? (
                (parseInt(redisStats.approved_requests || 0) /
                  parseInt(redisStats.total_requests)) *
                100
              ).toFixed(2)
            : 0,
        rejectionRate:
          redisStats.total_requests > 0
            ? (
                (parseInt(redisStats.rejected_requests || 0) /
                  parseInt(redisStats.total_requests)) *
                100
              ).toFixed(2)
            : 0,
      },
    };

    await redisService.setJSON(cacheKey, stats, { ex: 600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Verification statistics retrieved successfully",
      data: stats,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get verification stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve verification statistics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
