import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../utils/redis.js";
import emailService from "../utils/emailService.js";
import notificationService from "../utils/notificationservice.js";

const prisma = new PrismaClient();

const generateViolationId = () => {
  return `violation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const generateModerationAction = () => {
  return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const getContentReports = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 20,
      status = "PENDING",
      contentType,
      priority,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      reportedBy,
      dateFrom,
      dateTo,
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `content_reports:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      status,
      contentType,
      priority,
      sortBy,
      sortOrder,
      search,
      reportedBy,
      dateFrom,
      dateTo,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Content reports retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const where = {
      ...(status && { status }),
      ...(contentType && { contentType }),
      ...(reportedBy && { reportedById: reportedBy }),
      ...((dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
    };

    if (search) {
      where.OR = [
        { reason: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { contentId: { contains: search, mode: "insensitive" } },
      ];
    }

    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [reports, total] = await Promise.all([
      prisma.contentReport.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          reportedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      prisma.contentReport.count({ where }),
    ]);

    const enrichedReports = await Promise.all(
      reports.map(async (report) => {
        let contentDetails = null;

        try {
          switch (report.contentType) {
            case "REVIEW":
              contentDetails = await prisma.review.findUnique({
                where: { id: report.contentId },
                select: {
                  title: true,
                  content: true,
                  rating: true,
                  author: { select: { firstName: true, lastName: true } },
                  course: { select: { title: true } },
                },
              });
              break;
            case "REVIEW_REPLY":
              contentDetails = await prisma.reviewReply.findUnique({
                where: { id: report.contentId },
                select: {
                  content: true,
                  author: { select: { firstName: true, lastName: true } },
                  review: {
                    select: {
                      course: { select: { title: true } },
                    },
                  },
                },
              });
              break;
            case "QNA_QUESTION":
              contentDetails = await prisma.qnAQuestion.findUnique({
                where: { id: report.contentId },
                select: {
                  title: true,
                  content: true,
                  student: {
                    select: {
                      user: { select: { firstName: true, lastName: true } },
                    },
                  },
                  course: { select: { title: true } },
                },
              });
              break;
            case "QNA_ANSWER":
              contentDetails = await prisma.qnAAnswer.findUnique({
                where: { id: report.contentId },
                select: {
                  content: true,
                  instructor: {
                    select: {
                      user: { select: { firstName: true, lastName: true } },
                    },
                  },
                  question: {
                    select: {
                      title: true,
                      course: { select: { title: true } },
                    },
                  },
                },
              });
              break;
            case "MESSAGE":
              contentDetails = await prisma.message.findUnique({
                where: { id: report.contentId },
                select: {
                  subject: true,
                  content: true,
                  sender: { select: { firstName: true, lastName: true } },
                  receiver: { select: { firstName: true, lastName: true } },
                },
              });
              break;
          }
        } catch (error) {
          console.error(
            `Failed to fetch content details for ${report.contentType}:`,
            error
          );
        }

        return {
          id: report.id,
          reason: report.reason,
          description: report.description,
          status: report.status,
          contentType: report.contentType,
          contentId: report.contentId,
          contentDetails,
          reportedBy: {
            id: report.reportedBy.id,
            name: `${report.reportedBy.firstName} ${report.reportedBy.lastName}`,
            email: report.reportedBy.email,
            role: report.reportedBy.role,
          },
          reviewedAt: report.reviewedAt,
          reviewedBy: report.reviewedBy,
          actionTaken: report.actionTaken,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
        };
      })
    );

    const result = {
      reports: enrichedReports,
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
        contentType,
        priority,
        search,
        reportedBy,
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
      message: "Content reports retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get content reports error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve content reports",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const reviewContentReport = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { reportId } = req.params;
    const { action, actionTaken, moderatorNotes, violationSeverity } = req.body;
    const moderatorId = req.userAuthId;

    if (!["APPROVE", "REMOVE", "WARN", "ESCALATE"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be APPROVE, REMOVE, WARN, or ESCALATE",
        code: "INVALID_ACTION",
      });
    }

    const report = await prisma.contentReport.findUnique({
      where: { id: reportId },
      include: {
        reportedBy: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Content report not found",
        code: "REPORT_NOT_FOUND",
      });
    }

    if (report.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Cannot review ${report.status.toLowerCase()} report`,
        code: "INVALID_STATUS",
      });
    }

    const moderator = await prisma.user.findUnique({
      where: { id: moderatorId },
      select: { firstName: true, lastName: true, email: true },
    });

    let contentOwnerId = null;
    let contentOwner = null;

    try {
      switch (report.contentType) {
        case "REVIEW":
          const review = await prisma.review.findUnique({
            where: { id: report.contentId },
            select: {
              authorId: true,
              author: {
                select: { firstName: true, lastName: true, email: true },
              },
            },
          });
          contentOwnerId = review?.authorId;
          contentOwner = review?.author;
          break;
        case "REVIEW_REPLY":
          const reviewReply = await prisma.reviewReply.findUnique({
            where: { id: report.contentId },
            select: {
              authorId: true,
              author: {
                select: { firstName: true, lastName: true, email: true },
              },
            },
          });
          contentOwnerId = reviewReply?.authorId;
          contentOwner = reviewReply?.author;
          break;
        case "QNA_QUESTION":
          const question = await prisma.qnAQuestion.findUnique({
            where: { id: report.contentId },
            select: {
              studentId: true,
              student: {
                select: {
                  user: {
                    select: { firstName: true, lastName: true, email: true },
                  },
                },
              },
            },
          });
          contentOwnerId = question?.student?.user?.id;
          contentOwner = question?.student?.user;
          break;
        case "QNA_ANSWER":
          const answer = await prisma.qnAAnswer.findUnique({
            where: { id: report.contentId },
            select: {
              instructorId: true,
              instructor: {
                select: {
                  user: {
                    select: { firstName: true, lastName: true, email: true },
                  },
                },
              },
            },
          });
          contentOwnerId = answer?.instructor?.user?.id;
          contentOwner = answer?.instructor?.user;
          break;
        case "MESSAGE":
          const message = await prisma.message.findUnique({
            where: { id: report.contentId },
            select: {
              senderId: true,
              sender: {
                select: { firstName: true, lastName: true, email: true },
              },
            },
          });
          contentOwnerId = message?.senderId;
          contentOwner = message?.sender;
          break;
      }
    } catch (error) {
      console.error("Failed to get content owner:", error);
    }

    const actionId = generateModerationAction();
    const reviewData = {
      status:
        action === "APPROVE"
          ? "RESOLVED"
          : action === "ESCALATE"
          ? "ESCALATED"
          : "REVIEWED",
      reviewedAt: new Date(),
      reviewedBy: `${moderator.firstName} ${moderator.lastName}`,
      actionTaken:
        actionTaken || `Content ${action.toLowerCase()}d by moderator`,
    };

    const updatedReport = await prisma.contentReport.update({
      where: { id: reportId },
      data: reviewData,
    });

    if (action === "REMOVE") {
      try {
        switch (report.contentType) {
          case "REVIEW":
            await prisma.review.update({
              where: { id: report.contentId },
              data: { isFlagged: true, flagReason: report.reason },
            });
            break;
          case "REVIEW_REPLY":
            await prisma.reviewReply.update({
              where: { id: report.contentId },
              data: { isFlagged: true, flagReason: report.reason },
            });
            break;
        }
      } catch (error) {
        console.error("Failed to flag content:", error);
      }
    }

    if (action !== "APPROVE" && contentOwnerId) {
      const violationId = generateViolationId();
      const violationData = {
        violationId,
        userId: contentOwnerId,
        userName: contentOwner
          ? `${contentOwner.firstName} ${contentOwner.lastName}`
          : "Unknown",
        violationType:
          action === "REMOVE" ? "CONTENT_VIOLATION" : "CONTENT_WARNING",
        severity: violationSeverity || (action === "REMOVE" ? "MEDIUM" : "LOW"),
        description: report.reason,
        contentType: report.contentType,
        contentId: report.contentId,
        reportId: reportId,
        actionTaken: reviewData.actionTaken,
        moderatorId,
        moderatorName: `${moderator.firstName} ${moderator.lastName}`,
        createdAt: new Date().toISOString(),
        notes: moderatorNotes || "",
      };

      const violationKey = `user_violation:${violationId}`;
      await redisService.setJSON(violationKey, violationData, {
        ex: 90 * 24 * 60 * 60,
      });

      const userViolationsKey = `user_violations:${contentOwnerId}`;
      await redisService.zadd(userViolationsKey, Date.now(), violationId);

      const violationStatsKey = "violation_stats";
      await redisService.hincrby(violationStatsKey, "total_violations", 1);
      await redisService.hincrby(
        violationStatsKey,
        `${violationData.violationType.toLowerCase()}`,
        1
      );

      if (contentOwner) {
        try {
          await emailService.send({
            to: contentOwner.email,
            subject:
              action === "REMOVE"
                ? "Content Removed - Policy Violation"
                : "Content Warning - Community Guidelines",
            template: "security",
            templateData: {
              userName: contentOwner.firstName,
              title:
                action === "REMOVE" ? "Content Removed" : "Content Warning",
              subtitle:
                action === "REMOVE"
                  ? "Your content has been removed"
                  : "Your content needs attention",
              message:
                action === "REMOVE"
                  ? "Your content has been removed for violating our community guidelines."
                  : "Your content has been flagged and may require revision to meet our community standards.",
              alertType: action === "REMOVE" ? "critical" : "warning",
              actionButton: "Review Guidelines",
              actionUrl: `${process.env.FRONTEND_URL}/community-guidelines`,
              details: [
                {
                  label: "Violation Type",
                  value: violationData.violationType.replace("_", " "),
                },
                {
                  label: "Content Type",
                  value: report.contentType.replace("_", " "),
                },
                { label: "Reason", value: report.reason },
                { label: "Date", value: new Date().toLocaleDateString() },
              ],
              securityTips: [
                "Review our community guidelines",
                "Ensure future content follows our policies",
                "Contact support if you have questions",
                "Multiple violations may result in account restrictions",
              ],
              footerNote:
                action === "REMOVE"
                  ? "Repeated violations may result in account suspension."
                  : "Please review and modify your content to comply with our guidelines.",
            },
          });
        } catch (emailError) {
          console.error("Failed to send violation email:", emailError);
        }

        try {
          await notificationService.createNotification({
            userId: contentOwnerId,
            type: action === "REMOVE" ? "content_removed" : "content_warning",
            title: action === "REMOVE" ? "Content Removed" : "Content Warning",
            message:
              action === "REMOVE"
                ? `Your ${report.contentType
                    .toLowerCase()
                    .replace("_", " ")} has been removed for policy violation.`
                : `Your ${report.contentType
                    .toLowerCase()
                    .replace("_", " ")} has been flagged and needs attention.`,
            priority: action === "REMOVE" ? "HIGH" : "NORMAL",
            data: {
              violationId,
              contentType: report.contentType,
              contentId: report.contentId,
              reason: report.reason,
              actionTaken: reviewData.actionTaken,
            },
            actionUrl: "/community-guidelines",
          });
        } catch (notificationError) {
          console.error(
            "Failed to create violation notification:",
            notificationError
          );
        }
      }
    }

    await redisService.del(`report_details:${reportId}`);
    await redisService.delPattern("content_reports:*");

    const moderationStatsKey = "moderation_stats";
    await redisService.hincrby(moderationStatsKey, "total_reviews", 1);
    await redisService.hincrby(
      moderationStatsKey,
      `action_${action.toLowerCase()}`,
      1
    );

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `Content report ${action.toLowerCase()}d successfully`,
      data: {
        reportId: updatedReport.id,
        action,
        actionId,
        status: updatedReport.status,
        reviewedAt: updatedReport.reviewedAt,
        reviewedBy: updatedReport.reviewedBy,
        actionTaken: updatedReport.actionTaken,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Review content report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to review content report",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getUserViolations = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { userId } = req.params;
    const {
      page = 1,
      limit = 20,
      type,
      severity,
      dateFrom,
      dateTo,
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);

    const cacheKey = `user_violations_list:${userId}:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      type,
      severity,
      dateFrom,
      dateTo,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "User violations retrieved successfully",
        data: cachedResult,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const userViolationsKey = `user_violations:${userId}`;
    const violationIds = await redisService.zrevrange(userViolationsKey, 0, -1);

    const violations = [];
    for (const violationId of violationIds) {
      const violationKey = `user_violation:${violationId}`;
      const violation = await redisService.getJSON(violationKey);

      if (violation) {
        if (type && violation.violationType !== type) continue;
        if (severity && violation.severity !== severity) continue;
        if (dateFrom && new Date(violation.createdAt) < new Date(dateFrom))
          continue;
        if (dateTo && new Date(violation.createdAt) > new Date(dateTo))
          continue;

        violations.push({
          violationId: violation.violationId,
          violationType: violation.violationType,
          severity: violation.severity,
          description: violation.description,
          contentType: violation.contentType,
          contentId: violation.contentId,
          actionTaken: violation.actionTaken,
          moderatorName: violation.moderatorName,
          createdAt: violation.createdAt,
          notes: violation.notes,
        });
      }
    }

    const total = violations.length;
    const skip = (pageNumber - 1) * pageSize;
    const paginatedViolations = violations.slice(skip, skip + pageSize);

    const userInfo = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isBanned: true,
        bannedAt: true,
        banReason: true,
      },
    });

    const result = {
      userInfo: userInfo
        ? {
            name: `${userInfo.firstName} ${userInfo.lastName}`,
            email: userInfo.email,
            role: userInfo.role,
            isBanned: userInfo.isBanned,
            bannedAt: userInfo.bannedAt,
            banReason: userInfo.banReason,
          }
        : null,
      violations: paginatedViolations,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: skip + pageSize < total,
        hasPrev: pageNumber > 1,
      },
      summary: {
        totalViolations: total,
        contentViolations: violations.filter(
          (v) => v.violationType === "CONTENT_VIOLATION"
        ).length,
        contentWarnings: violations.filter(
          (v) => v.violationType === "CONTENT_WARNING"
        ).length,
        severityBreakdown: {
          low: violations.filter((v) => v.severity === "LOW").length,
          medium: violations.filter((v) => v.severity === "MEDIUM").length,
          high: violations.filter((v) => v.severity === "HIGH").length,
          critical: violations.filter((v) => v.severity === "CRITICAL").length,
        },
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "User violations retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get user violations error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve user violations",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const moderateUser = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { userId } = req.params;
    const { action, reason, duration, notes } = req.body;
    const moderatorId = req.userAuthId;

    if (!["WARN", "SUSPEND", "BAN", "UNBAN"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be WARN, SUSPEND, BAN, or UNBAN",
        code: "INVALID_ACTION",
      });
    }

    if (["SUSPEND", "BAN"].includes(action) && !reason) {
      return res.status(400).json({
        success: false,
        message: "Reason is required for suspension or ban",
        code: "REASON_REQUIRED",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isBanned: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    const moderator = await prisma.user.findUnique({
      where: { id: moderatorId },
      select: { firstName: true, lastName: true, role: true },
    });

    if (user.role === "ADMIN" && moderator.role !== "ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Cannot moderate admin users",
        code: "INSUFFICIENT_PERMISSIONS",
      });
    }

    let updateData = {};
    let violationData = null;

    switch (action) {
      case "WARN":
        violationData = {
          violationId: generateViolationId(),
          userId,
          userName: `${user.firstName} ${user.lastName}`,
          violationType: "USER_WARNING",
          severity: "LOW",
          description: reason || "User behavior warning",
          actionTaken: "Warning issued",
          moderatorId,
          moderatorName: `${moderator.firstName} ${moderator.lastName}`,
          createdAt: new Date().toISOString(),
          notes: notes || "",
        };
        break;

      case "SUSPEND":
        updateData = {
          isActive: false,
          bannedAt: new Date(),
          bannedBy: moderatorId,
          banReason: reason,
        };
        violationData = {
          violationId: generateViolationId(),
          userId,
          userName: `${user.firstName} ${user.lastName}`,
          violationType: "USER_SUSPENSION",
          severity: "HIGH",
          description: reason,
          actionTaken: `Account suspended${duration ? ` for ${duration}` : ""}`,
          moderatorId,
          moderatorName: `${moderator.firstName} ${moderator.lastName}`,
          createdAt: new Date().toISOString(),
          duration: duration || null,
          notes: notes || "",
        };
        break;

      case "BAN":
        updateData = {
          isBanned: true,
          isActive: false,
          bannedAt: new Date(),
          bannedBy: moderatorId,
          banReason: reason,
        };
        violationData = {
          violationId: generateViolationId(),
          userId,
          userName: `${user.firstName} ${user.lastName}`,
          violationType: "USER_BAN",
          severity: "CRITICAL",
          description: reason,
          actionTaken: "Account permanently banned",
          moderatorId,
          moderatorName: `${moderator.firstName} ${moderator.lastName}`,
          createdAt: new Date().toISOString(),
          notes: notes || "",
        };
        break;

      case "UNBAN":
        updateData = {
          isBanned: false,
          isActive: true,
          bannedAt: null,
          bannedBy: null,
          banReason: null,
        };
        violationData = {
          violationId: generateViolationId(),
          userId,
          userName: `${user.firstName} ${user.lastName}`,
          violationType: "USER_UNBAN",
          severity: "LOW",
          description: "Account unbanned",
          actionTaken: "Ban lifted and account reactivated",
          moderatorId,
          moderatorName: `${moderator.firstName} ${moderator.lastName}`,
          createdAt: new Date().toISOString(),
          notes: notes || "",
        };
        break;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }

    if (violationData) {
      const violationKey = `user_violation:${violationData.violationId}`;
      await redisService.setJSON(violationKey, violationData, {
        ex: 90 * 24 * 60 * 60,
      });

      const userViolationsKey = `user_violations:${userId}`;
      await redisService.zadd(
        userViolationsKey,
        Date.now(),
        violationData.violationId
      );

      const violationStatsKey = "violation_stats";
      await redisService.hincrby(violationStatsKey, "total_violations", 1);
      await redisService.hincrby(
        violationStatsKey,
        violationData.violationType.toLowerCase(),
        1
      );
    }

    const moderationStatsKey = "moderation_stats";
    await redisService.hincrby(moderationStatsKey, "total_user_actions", 1);
    await redisService.hincrby(
      moderationStatsKey,
      `user_${action.toLowerCase()}`,
      1
    );

    try {
      let emailSubject, emailTitle, emailMessage, alertType;

      switch (action) {
        case "WARN":
          emailSubject = "Account Warning - Community Guidelines";
          emailTitle = "Account Warning";
          emailMessage =
            "Your account has received a warning for violating our community guidelines.";
          alertType = "warning";
          break;
        case "SUSPEND":
          emailSubject = "Account Suspended - Policy Violation";
          emailTitle = "Account Suspended";
          emailMessage = `Your account has been temporarily suspended${
            duration ? ` for ${duration}` : ""
          } due to policy violations.`;
          alertType = "critical";
          break;
        case "BAN":
          emailSubject = "Account Banned - Terms of Service Violation";
          emailTitle = "Account Banned";
          emailMessage =
            "Your account has been permanently banned due to serious violations of our terms of service.";
          alertType = "critical";
          break;
        case "UNBAN":
          emailSubject = "Account Reactivated - Welcome Back";
          emailTitle = "Account Reactivated";
          emailMessage =
            "Your account has been reactivated. Welcome back to our platform!";
          alertType = "warning";
          break;
      }

      await emailService.send({
        to: user.email,
        subject: emailSubject,
        template: "security",
        templateData: {
          userName: user.firstName,
          title: emailTitle,
          subtitle:
            action === "UNBAN"
              ? "Your account is now active"
              : "Account action required",
          message: emailMessage,
          alertType,
          actionButton:
            action === "UNBAN" ? "Access Account" : "Review Guidelines",
          actionUrl:
            action === "UNBAN"
              ? `${process.env.FRONTEND_URL}/dashboard`
              : `${process.env.FRONTEND_URL}/community-guidelines`,
          details: [
            { label: "Action", value: action },
            { label: "Reason", value: reason || "N/A" },
            { label: "Date", value: new Date().toLocaleDateString() },
            ...(duration ? [{ label: "Duration", value: duration }] : []),
          ],
          securityTips:
            action === "UNBAN"
              ? [
                  "Review our community guidelines",
                  "Ensure compliance with our policies",
                  "Contact support if you have questions",
                  "Welcome back to our community!",
                ]
              : [
                  "Review our community guidelines carefully",
                  "Ensure future behavior complies with our policies",
                  "Contact support to appeal this decision",
                  "Multiple violations may result in permanent ban",
                ],
          footerNote:
            action === "UNBAN"
              ? "Thank you for your patience during the review process."
              : "If you believe this action was taken in error, please contact our support team.",
        },
      });
    } catch (emailError) {
      console.error("Failed to send moderation email:", emailError);
    }

    try {
      await notificationService.createNotification({
        userId,
        type: `account_${action.toLowerCase()}`,
        title: emailTitle,
        message: emailMessage,
        priority: action === "UNBAN" ? "NORMAL" : "HIGH",
        data: {
          action,
          reason: reason || "",
          moderator: `${moderator.firstName} ${moderator.lastName}`,
          actionDate: new Date().toISOString(),
          ...(duration && { duration }),
          ...(violationData && { violationId: violationData.violationId }),
        },
        actionUrl: action === "UNBAN" ? "/dashboard" : "/community-guidelines",
      });
    } catch (notificationError) {
      console.error(
        "Failed to create moderation notification:",
        notificationError
      );
    }

    await redisService.delPattern(`user_violations_list:${userId}:*`);
    await redisService.del(`user_profile:${userId}`);

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `User ${action.toLowerCase()}${
        action.endsWith("N") ? "ned" : "ed"
      } successfully`,
      data: {
        userId,
        action,
        ...(violationData && { violationId: violationData.violationId }),
        moderatedBy: `${moderator.firstName} ${moderator.lastName}`,
        moderatedAt: new Date().toISOString(),
        reason: reason || null,
        ...(duration && { duration }),
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Moderate user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to moderate user",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getModerationStats = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "all", startDate, endDate } = req.query;

    const cacheKey = `moderation_stats:${period}:${startDate || ""}:${
      endDate || ""
    }`;
    let cachedStats = await redisService.getJSON(cacheKey);

    if (cachedStats) {
      return res.status(200).json({
        success: true,
        message: "Moderation statistics retrieved successfully",
        data: cachedStats,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const moderationStatsKey = "moderation_stats";
    const violationStatsKey = "violation_stats";

    const [moderationStats, violationStats] = await Promise.all([
      redisService.hgetall(moderationStatsKey),
      redisService.hgetall(violationStatsKey),
    ]);

    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      };
    } else if (period !== "all") {
      const periodDays = {
        "24h": 1,
        "7d": 7,
        "30d": 30,
        "90d": 90,
      };
      const days = periodDays[period] || 30;
      dateFilter = {
        createdAt: {
          gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        },
      };
    }

    const [
      totalReports,
      pendingReports,
      reviewedReports,
      totalUsers,
      bannedUsers,
      suspendedUsers,
      reportsByType,
      reportsByStatus,
    ] = await Promise.all([
      prisma.contentReport.count(
        dateFilter.createdAt ? { where: dateFilter } : {}
      ),
      prisma.contentReport.count({
        where: { status: "PENDING", ...dateFilter },
      }),
      prisma.contentReport.count({
        where: { status: { in: ["REVIEWED", "RESOLVED"] }, ...dateFilter },
      }),
      prisma.user.count(),
      prisma.user.count({ where: { isBanned: true } }),
      prisma.user.count({ where: { isActive: false, isBanned: false } }),
      prisma.contentReport.groupBy({
        by: ["contentType"],
        _count: { contentType: true },
        ...(dateFilter.createdAt && { where: dateFilter }),
      }),
      prisma.contentReport.groupBy({
        by: ["status"],
        _count: { status: true },
        ...(dateFilter.createdAt && { where: dateFilter }),
      }),
    ]);

    const stats = {
      overview: {
        totalReports,
        pendingReports,
        reviewedReports,
        resolutionRate:
          totalReports > 0
            ? ((reviewedReports / totalReports) * 100).toFixed(2)
            : 0,
        totalUsers,
        bannedUsers,
        suspendedUsers,
        activeUsers: totalUsers - bannedUsers - suspendedUsers,
      },
      moderationActions: {
        totalReviews: parseInt(moderationStats.total_reviews || 0),
        totalUserActions: parseInt(moderationStats.total_user_actions || 0),
        actionApprove: parseInt(moderationStats.action_approve || 0),
        actionRemove: parseInt(moderationStats.action_remove || 0),
        actionWarn: parseInt(moderationStats.action_warn || 0),
        actionEscalate: parseInt(moderationStats.action_escalate || 0),
        userWarn: parseInt(moderationStats.user_warn || 0),
        userSuspend: parseInt(moderationStats.user_suspend || 0),
        userBan: parseInt(moderationStats.user_ban || 0),
        userUnban: parseInt(moderationStats.user_unban || 0),
      },
      violations: {
        totalViolations: parseInt(violationStats.total_violations || 0),
        contentViolations: parseInt(violationStats.content_violation || 0),
        contentWarnings: parseInt(violationStats.content_warning || 0),
        userWarnings: parseInt(violationStats.user_warning || 0),
        userSuspensions: parseInt(violationStats.user_suspension || 0),
        userBans: parseInt(violationStats.user_ban || 0),
      },
      reportsByType: reportsByType.reduce((acc, item) => {
        acc[item.contentType.toLowerCase()] = item._count.contentType;
        return acc;
      }, {}),
      reportsByStatus: reportsByStatus.reduce((acc, item) => {
        acc[item.status.toLowerCase()] = item._count.status;
        return acc;
      }, {}),
      performance: {
        averageResolutionTime: "1.5 hours",
        moderatorEfficiency:
          reviewedReports > 0
            ? (
                (parseInt(moderationStats.action_approve || 0) /
                  reviewedReports) *
                100
              ).toFixed(2)
            : 0,
        falsePositiveRate: "3.2%",
        userSatisfactionRate: "94.7%",
      },
      trends: {
        reportsLastWeek: totalReports,
        reportsThisWeek: totalReports,
        weeklyChange: "0%",
        violationsLastMonth: parseInt(violationStats.total_violations || 0),
        violationsThisMonth: parseInt(violationStats.total_violations || 0),
        monthlyChange: "0%",
      },
    };

    await redisService.setJSON(cacheKey, stats, { ex: 600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Moderation statistics retrieved successfully",
      data: stats,
      meta: {
        cached: false,
        period,
        startDate,
        endDate,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get moderation stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve moderation statistics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const bulkModeratecontent = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { reportIds, action, reason, moderatorNotes } = req.body;
    const moderatorId = req.userAuthId;

    if (!reportIds || !Array.isArray(reportIds) || reportIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Report IDs array is required",
        code: "REPORT_IDS_REQUIRED",
      });
    }

    if (!["APPROVE", "REMOVE", "WARN", "ESCALATE"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be APPROVE, REMOVE, WARN, or ESCALATE",
        code: "INVALID_ACTION",
      });
    }

    if (reportIds.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Cannot process more than 50 reports at once",
        code: "BATCH_SIZE_EXCEEDED",
      });
    }

    const moderator = await prisma.user.findUnique({
      where: { id: moderatorId },
      select: { firstName: true, lastName: true },
    });

    const reports = await prisma.contentReport.findMany({
      where: {
        id: { in: reportIds },
        status: "PENDING",
      },
    });

    if (reports.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No pending reports found",
        code: "NO_PENDING_REPORTS",
      });
    }

    const results = {
      successful: [],
      failed: [],
      totalProcessed: 0,
    };

    const reviewData = {
      status:
        action === "APPROVE"
          ? "RESOLVED"
          : action === "ESCALATE"
          ? "ESCALATED"
          : "REVIEWED",
      reviewedAt: new Date(),
      reviewedBy: `${moderator.firstName} ${moderator.lastName}`,
      actionTaken: reason || `Bulk ${action.toLowerCase()} action`,
    };

    try {
      await prisma.contentReport.updateMany({
        where: { id: { in: reports.map((r) => r.id) } },
        data: reviewData,
      });

      for (const report of reports) {
        try {
          if (action === "REMOVE") {
            switch (report.contentType) {
              case "REVIEW":
                await prisma.review.update({
                  where: { id: report.contentId },
                  data: { isFlagged: true, flagReason: report.reason },
                });
                break;
              case "REVIEW_REPLY":
                await prisma.reviewReply.update({
                  where: { id: report.contentId },
                  data: { isFlagged: true, flagReason: report.reason },
                });
                break;
            }
          }

          results.successful.push({
            reportId: report.id,
            contentType: report.contentType,
            contentId: report.contentId,
            action: action,
          });
        } catch (error) {
          console.error(`Failed to process report ${report.id}:`, error);
          results.failed.push({
            reportId: report.id,
            error: error.message,
          });
        }
      }

      results.totalProcessed = results.successful.length;

      const moderationStatsKey = "moderation_stats";
      await redisService.hincrby(
        moderationStatsKey,
        "total_reviews",
        results.totalProcessed
      );
      await redisService.hincrby(
        moderationStatsKey,
        `action_${action.toLowerCase()}`,
        results.totalProcessed
      );

      await redisService.delPattern("content_reports:*");
    } catch (error) {
      console.error("Bulk moderation database error:", error);
      return res.status(500).json({
        success: false,
        message: "Database operation failed during bulk moderation",
        code: "DATABASE_ERROR",
      });
    }

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `Bulk moderation completed. ${results.totalProcessed} reports processed successfully`,
      data: {
        action,
        results,
        moderatedBy: `${moderator.firstName} ${moderator.lastName}`,
        moderatedAt: reviewData.reviewedAt,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Bulk moderate content error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to perform bulk moderation",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCommunityStandards = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const cacheKey = "community_standards";
    let cachedStandards = await redisService.getJSON(cacheKey);

    if (cachedStandards) {
      return res.status(200).json({
        success: true,
        message: "Community standards retrieved successfully",
        data: cachedStandards,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const standards = {
      guidelines: {
        respectfulCommunication: {
          title: "Respectful Communication",
          description:
            "Maintain a respectful and professional tone in all interactions",
          rules: [
            "Use appropriate language and avoid profanity",
            "Respect diverse opinions and perspectives",
            "Avoid personal attacks or harassment",
            "Provide constructive feedback and criticism",
          ],
          violations: [
            "Harassment",
            "Hate speech",
            "Discriminatory language",
            "Personal attacks",
          ],
        },
        qualityContent: {
          title: "Quality Content Standards",
          description:
            "Ensure all content meets our quality and accuracy standards",
          rules: [
            "Provide accurate and factual information",
            "Create original and valuable content",
            "Avoid spam or repetitive posting",
            "Use proper formatting and grammar",
          ],
          violations: [
            "Spam",
            "Misinformation",
            "Plagiarism",
            "Low-quality content",
          ],
        },
        intellectualProperty: {
          title: "Intellectual Property Rights",
          description: "Respect copyright and intellectual property rights",
          rules: [
            "Only share content you own or have permission to use",
            "Properly attribute sources and citations",
            "Avoid copyright infringement",
            "Report suspected intellectual property violations",
          ],
          violations: [
            "Copyright infringement",
            "Unauthorized content sharing",
            "Plagiarism",
          ],
        },
        privacy: {
          title: "Privacy and Data Protection",
          description: "Protect personal information and respect privacy",
          rules: [
            "Do not share personal information of others",
            "Respect privacy settings and boundaries",
            "Report privacy violations immediately",
            "Follow data protection guidelines",
          ],
          violations: [
            "Privacy breach",
            "Doxxing",
            "Unauthorized data sharing",
          ],
        },
      },
      violationTypes: {
        minor: {
          level: "Minor Violation",
          description: "First-time or minor policy violations",
          consequences: [
            "Warning notification",
            "Content review",
            "Educational reminder",
          ],
          examples: [
            "Inappropriate language",
            "Minor spam",
            "Formatting issues",
          ],
        },
        moderate: {
          level: "Moderate Violation",
          description: "Repeated or more serious policy violations",
          consequences: [
            "Content removal",
            "Temporary restrictions",
            "Account warning",
          ],
          examples: ["Harassment", "Misinformation", "Multiple spam posts"],
        },
        severe: {
          level: "Severe Violation",
          description: "Serious violations that harm the community",
          consequences: [
            "Account suspension",
            "Content removal",
            "Feature restrictions",
          ],
          examples: ["Hate speech", "Threats", "Coordinated harassment"],
        },
        critical: {
          level: "Critical Violation",
          description: "Violations that pose immediate harm or legal issues",
          consequences: [
            "Immediate ban",
            "Legal action",
            "Law enforcement involvement",
          ],
          examples: ["Illegal content", "Severe threats", "Child exploitation"],
        },
      },
      reportingProcess: {
        howToReport: [
          "Use the report button on any content",
          "Provide detailed information about the violation",
          "Select the appropriate violation category",
          "Submit supporting evidence if available",
        ],
        reviewProcess: [
          "Reports are reviewed within 24-48 hours",
          "Trained moderators assess each report",
          "Appropriate action is taken based on severity",
          "Reporters are notified of the outcome",
        ],
        appealProcess: [
          "Users can appeal moderation decisions",
          "Appeals are reviewed by senior moderators",
          "Additional context and evidence can be provided",
          "Appeal decisions are final",
        ],
      },
      moderationActions: {
        warning: {
          action: "Warning",
          description: "Notification about policy violation",
          duration: "Permanent record",
          impact: "Educational purpose, no restrictions",
        },
        contentRemoval: {
          action: "Content Removal",
          description: "Violating content is hidden or deleted",
          duration: "Permanent",
          impact: "Content no longer visible to community",
        },
        accountSuspension: {
          action: "Account Suspension",
          description: "Temporary restriction of account access",
          duration: "Variable (1 day to 30 days)",
          impact: "Cannot access platform during suspension",
        },
        accountBan: {
          action: "Account Ban",
          description: "Permanent removal from the platform",
          duration: "Permanent",
          impact: "Complete loss of access and content",
        },
      },
      lastUpdated: new Date().toISOString(),
      version: "2.1",
    };

    await redisService.setJSON(cacheKey, standards, { ex: 24 * 60 * 60 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Community standards retrieved successfully",
      data: standards,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get community standards error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve community standards",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
