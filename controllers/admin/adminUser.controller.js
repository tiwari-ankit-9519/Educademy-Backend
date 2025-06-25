import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../utils/redis.js";
import emailService from "../utils/emailService.js";
import notificationService from "../utils/notificationservice.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `admin_action_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;
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
    };

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
      sessions: user.sessions,
      recentActivities: user.userActivities,
      recentNotifications: user.notifications,
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
    const {
      name,
      description,
      image,
      icon,
      color,
      parentId,
      order = 0,
    } = req.body;

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
          code: "NESTED_SUBCATEGORY_NOT_ALLOWED",
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
        icon: category.icon,
        color: category.color,
        order: category.order,
        isActive: category.isActive,
        parent: category.parent,
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
    const { name, description, image, icon, color, parentId, order, isActive } =
      req.body;

    const existingCategory = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
        code: "CATEGORY_NOT_FOUND",
      });
    }

    let updateData = {};

    if (name && name !== existingCategory.name) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim("-");

      const duplicateCategory = await prisma.category.findFirst({
        where: {
          AND: [
            { id: { not: categoryId } },
            {
              OR: [{ name: { equals: name, mode: "insensitive" } }, { slug }],
            },
          ],
        },
      });

      if (duplicateCategory) {
        return res.status(400).json({
          success: false,
          message: "Category with this name already exists",
          code: "CATEGORY_EXISTS",
        });
      }

      updateData.name = name;
      updateData.slug = slug;
    }

    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (order !== undefined) updateData.order = parseInt(order);
    if (isActive !== undefined) updateData.isActive = isActive;

    if (parentId !== undefined) {
      if (parentId === categoryId) {
        return res.status(400).json({
          success: false,
          message: "Category cannot be parent of itself",
          code: "SELF_PARENT_NOT_ALLOWED",
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
            message: "Cannot set subcategory as parent",
            code: "SUBCATEGORY_AS_PARENT_NOT_ALLOWED",
          });
        }

        const childCategories = await prisma.category.findMany({
          where: { parentId: categoryId },
        });

        if (childCategories.length > 0) {
          return res.status(400).json({
            success: false,
            message:
              "Cannot make category with subcategories a subcategory itself",
            code: "CATEGORY_HAS_CHILDREN",
          });
        }
      }

      updateData.parentId = parentId;
    }

    const updatedCategory = await prisma.category.update({
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
        subcategories: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    await redisService.delPattern("admin_categories:*");
    await redisService.delPattern("categories:*");
    await redisService.del("category_tree");
    await redisService.del(`category:${categoryId}`);

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
        order: updatedCategory.order,
        isActive: updatedCategory.isActive,
        parent: updatedCategory.parent,
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

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: {
        subcategories: true,
        courses: true,
        subcategoryCourses: true,
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
    const hasSubcategories = category.subcategories.length > 0;

    if (!forceDelete && (totalCourses > 0 || hasSubcategories)) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete category with associated courses or subcategories",
        code: "CATEGORY_HAS_DEPENDENCIES",
        data: {
          coursesCount: totalCourses,
          subcategoriesCount: category.subcategories.length,
          forceDeleteRequired: true,
        },
      });
    }

    if (forceDelete) {
      if (hasSubcategories) {
        await prisma.category.updateMany({
          where: { parentId: categoryId },
          data: { parentId: null },
        });
      }

      if (totalCourses > 0) {
        await prisma.course.updateMany({
          where: {
            OR: [{ categoryId: categoryId }, { subcategoryId: categoryId }],
          },
          data: {
            categoryId: category.parentId || categoryId,
            subcategoryId: null,
          },
        });
      }
    }

    await prisma.category.delete({
      where: { id: categoryId },
    });

    await redisService.delPattern("admin_categories:*");
    await redisService.delPattern("categories:*");
    await redisService.del("category_tree");
    await redisService.del(`category:${categoryId}`);

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
      data: {
        deletedCategoryId: categoryId,
        deletedCategoryName: category.name,
        forceDelete,
        reassignedCourses: forceDelete ? totalCourses : 0,
        reassignedSubcategories: forceDelete
          ? category.subcategories.length
          : 0,
        deletedAt: new Date().toISOString(),
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
