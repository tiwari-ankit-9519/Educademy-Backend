import { config } from "dotenv";
config();

import asyncHandler from "express-async-handler";
import notificationService from "../../utils/notificationservice.js";
import redisService from "../../utils/redis.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const validateUserAuthentication = (req) => {
  if (!req.userAuthId) {
    throw new Error("User authentication required");
  }
  return req.userAuthId;
};

const validateNotificationFilters = (filters) => {
  const errors = [];
  const { page, limit, isRead, type, priority, startDate, endDate } = filters;

  if (page && (isNaN(page) || parseInt(page) < 1)) {
    errors.push("Page must be a positive number");
  }

  if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
    errors.push("Limit must be between 1 and 100");
  }

  if (isRead && !["true", "false"].includes(isRead.toLowerCase())) {
    errors.push("isRead must be true or false");
  }

  const validTypes = [
    "ASSIGNMENT_SUBMITTED",
    "ASSIGNMENT_GRADED",
    "QUIZ_COMPLETED",
    "QUIZ_GRADED",
    "COURSE_PUBLISHED",
    "NEW_ENROLLMENT",
    "PAYMENT_RECEIVED",
    "PAYMENT_FAILED",
    "REFUND_PROCESSED",
    "SYSTEM_ANNOUNCEMENT",
    "MESSAGE_RECEIVED",
    "COURSE_UPDATED",
    "NEW_REVIEW",
    "REVIEW_REPLY",
    "QNA_QUESTION",
    "QNA_ANSWER",
    "CERTIFICATE_ISSUED",
    "COUPON_EXPIRING",
    "ACHIEVEMENT_UNLOCKED",
    "SUPPORT_TICKET_CREATED",
    "SUPPORT_TICKET_UPDATED",
    "CONTENT_REPORTED",
    "ACCOUNT_BANNED",
    "ACCOUNT_REACTIVATED",
  ];

  if (type && !validTypes.includes(type)) {
    errors.push("Invalid notification type");
  }

  const validPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
  if (priority && !validPriorities.includes(priority)) {
    errors.push("Invalid priority level");
  }

  if (startDate && isNaN(Date.parse(startDate))) {
    errors.push("Invalid start date format");
  }

  if (endDate && isNaN(Date.parse(endDate))) {
    errors.push("Invalid end date format");
  }

  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    errors.push("Start date must be before end date");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const validateNotificationSettings = (settings) => {
  const errors = [];
  const {
    email,
    push,
    inApp,
    sms,
    assignmentUpdates,
    courseUpdates,
    accountUpdates,
    marketingUpdates,
    discussionUpdates,
    reviewUpdates,
    paymentUpdates,
  } = settings;

  const booleanFields = {
    email,
    push,
    inApp,
    sms,
    assignmentUpdates,
    courseUpdates,
    accountUpdates,
    marketingUpdates,
    discussionUpdates,
    reviewUpdates,
    paymentUpdates,
  };

  Object.entries(booleanFields).forEach(([key, value]) => {
    if (value !== undefined && typeof value !== "boolean") {
      errors.push(`${key} must be a boolean value`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const validateMarkReadRequest = (data) => {
  const errors = [];
  const { notificationIds, markAll } = data;

  if (
    markAll !== true &&
    (!notificationIds || !Array.isArray(notificationIds))
  ) {
    errors.push("notificationIds must be an array or markAll must be true");
  }

  if (notificationIds && Array.isArray(notificationIds)) {
    if (notificationIds.length === 0) {
      errors.push("notificationIds array cannot be empty");
    }

    if (notificationIds.length > 100) {
      errors.push("Cannot mark more than 100 notifications at once");
    }

    const invalidIds = notificationIds.filter(
      (id) => !id || typeof id !== "string"
    );
    if (invalidIds.length > 0) {
      errors.push("All notification IDs must be valid strings");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const buildNotificationFilters = (query) => {
  const filters = {
    page: parseInt(query.page) || 1,
    limit: Math.min(parseInt(query.limit) || 20, 100),
  };

  if (query.isRead !== undefined) {
    filters.isRead = query.isRead.toLowerCase() === "true";
  }

  if (query.type) {
    filters.type = query.type;
  }

  if (query.priority) {
    filters.priority = query.priority;
  }

  if (query.startDate) {
    filters.startDate = new Date(query.startDate);
  }

  if (query.endDate) {
    filters.endDate = new Date(query.endDate);
  }

  return filters;
};

const getNotificationCacheKey = (userId, filters) => {
  const filterString = Object.entries(filters)
    .sort()
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
  return `notifications:${userId}:${Buffer.from(filterString).toString(
    "base64"
  )}`;
};

export const getNotifications = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);

    const validationResult = validateNotificationFilters(req.query);
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid filters provided",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `get_notifications:${userId}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many notification requests. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const filters = buildNotificationFilters(req.query);
    const cacheKey = getNotificationCacheKey(userId, filters);

    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult && filters.page === 1) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Notifications retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
          userId,
        },
      });
    }

    const result = await notificationService.getUserNotifications(
      userId,
      filters
    );

    if (filters.page === 1 && result.notifications.length > 0) {
      await redisService.setJSON(cacheKey, result, { ex: 300 });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Notifications retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
        userId,
      },
    });
  } catch (error) {
    console.error(`GET_NOTIFICATIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      query: req.query,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve notifications",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);

    const rateLimitResult = await redisService.rateLimitCheck(
      `rate_limit:unread_count:${userId}`, // Different key for rate limiting
      200,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many unread count requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const cacheKey = `cache:unread_count:${userId}`; // Different key for caching
    let unreadCount = await redisService.get(cacheKey);

    if (unreadCount === null) {
      unreadCount = await notificationService.getUnreadCount(userId);
      await redisService.setex(cacheKey, 60, unreadCount.toString());
    } else {
      unreadCount = parseInt(unreadCount);
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Unread count retrieved successfully",
      data: {
        unreadCount,
        lastUpdated: new Date().toISOString(),
        userId,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_UNREAD_COUNT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve unread count",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getNotificationStats = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);

    const rateLimitResult = await redisService.rateLimitCheck(
      `notification_stats:${userId}`,
      50,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many stats requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const cacheKey = `notification_stats:${userId}`;
    let stats = await redisService.getJSON(cacheKey);

    if (!stats) {
      stats = await notificationService.getNotificationStats(userId);
      await redisService.setJSON(cacheKey, stats, { ex: 600 });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Notification statistics retrieved successfully",
      data: { ...stats, userId },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_NOTIFICATION_STATS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve notification statistics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const markNotificationsAsRead = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);

    const validationResult = validateMarkReadRequest(req.body);
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid request data",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `mark_read:${userId}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many mark as read requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const { notificationIds, markAll } = req.body;
    let markedCount = 0;

    if (markAll === true) {
      await notificationService.markAllAsRead(userId);
      const stats = await notificationService.getNotificationStats(userId);
      markedCount = stats.unread;
    } else {
      const validNotifications = await prisma.notification.findMany({
        where: {
          id: { in: notificationIds },
          userId: userId,
        },
        select: { id: true },
      });

      const validIds = validNotifications.map((n) => n.id);

      if (validIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid notifications found for this user",
          code: "INVALID_NOTIFICATIONS",
        });
      }

      await notificationService.markAsRead(validIds, userId);
      markedCount = validIds.length;
    }

    await Promise.all([
      redisService.del(`unread_count:${userId}`),
      redisService.delPattern(`notifications:${userId}:*`),
      redisService.del(`notification_stats:${userId}`),
    ]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: markAll
        ? "All notifications marked as read successfully"
        : `${markedCount} notifications marked as read successfully`,
      data: {
        markedCount,
        markAll: markAll === true,
        notificationIds: markAll ? [] : req.body.notificationIds || [],
        userId,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`MARK_NOTIFICATIONS_READ_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      requestBody: req.body,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteNotification = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);
    const { notificationId } = req.params;

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: "Notification ID is required",
        code: "MISSING_NOTIFICATION_ID",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `delete_notification:${userId}`,
      50,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many delete requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId: userId,
      },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message:
          "Notification not found or you don't have permission to delete it",
        code: "NOTIFICATION_NOT_FOUND",
      });
    }

    await notificationService.deleteNotification(notificationId, userId);

    await Promise.all([
      redisService.del(`unread_count:${userId}`),
      redisService.delPattern(`notifications:${userId}:*`),
      redisService.del(`notification_stats:${userId}`),
    ]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
      data: {
        deletedNotificationId: notificationId,
        userId,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_NOTIFICATION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      notificationId: req.params.notificationId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete notification",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteAllReadNotifications = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);

    const rateLimitResult = await redisService.rateLimitCheck(
      `delete_all_read:${userId}`,
      10,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many bulk delete requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const readNotifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        isRead: true,
      },
      select: { id: true },
    });

    const deletedCount = readNotifications.length;

    if (deletedCount === 0) {
      return res.status(200).json({
        success: true,
        message: "No read notifications to delete",
        data: { deletedCount: 0, userId },
        meta: {
          requestId,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    await notificationService.deleteAllRead(userId);

    await Promise.all([
      redisService.delPattern(`notifications:${userId}:*`),
      redisService.del(`notification_stats:${userId}`),
    ]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: `${deletedCount} read notifications deleted successfully`,
      data: {
        deletedCount,
        userId,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_ALL_READ_NOTIFICATIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete read notifications",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getNotificationSettings = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);

    const rateLimitResult = await redisService.rateLimitCheck(
      `get_notification_settings:${userId}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many settings requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const cacheKey = `notification_settings:${userId}`;
    let settings = await redisService.getJSON(cacheKey);

    if (!settings) {
      settings = await notificationService.getNotificationSettings(userId);
      if (settings) {
        await redisService.setJSON(cacheKey, settings, { ex: 3600 });
      }
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Notification settings retrieved successfully",
      data: {
        settings: settings || {
          email: true,
          push: true,
          inApp: true,
          sms: false,
          assignmentUpdates: true,
          courseUpdates: true,
          accountUpdates: true,
          marketingUpdates: false,
          discussionUpdates: true,
          reviewUpdates: true,
          paymentUpdates: true,
        },
        userId,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: !!settings,
      },
    });
  } catch (error) {
    console.error(`GET_NOTIFICATION_SETTINGS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve notification settings",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateNotificationSettings = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);

    const validationResult = validateNotificationSettings(req.body);
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid settings provided",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `update_notification_settings:${userId}`,
      20,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many settings update requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const {
      email,
      push,
      inApp,
      sms,
      assignmentUpdates,
      courseUpdates,
      accountUpdates,
      marketingUpdates,
      discussionUpdates,
      reviewUpdates,
      paymentUpdates,
    } = req.body;

    const updateData = {};

    if (email !== undefined) updateData.email = email;
    if (push !== undefined) updateData.push = push;
    if (inApp !== undefined) updateData.inApp = inApp;
    if (sms !== undefined) updateData.sms = sms;
    if (assignmentUpdates !== undefined)
      updateData.assignmentUpdates = assignmentUpdates;
    if (courseUpdates !== undefined) updateData.courseUpdates = courseUpdates;
    if (accountUpdates !== undefined)
      updateData.accountUpdates = accountUpdates;
    if (marketingUpdates !== undefined)
      updateData.marketingUpdates = marketingUpdates;
    if (discussionUpdates !== undefined)
      updateData.discussionUpdates = discussionUpdates;
    if (reviewUpdates !== undefined) updateData.reviewUpdates = reviewUpdates;
    if (paymentUpdates !== undefined)
      updateData.paymentUpdates = paymentUpdates;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No settings provided for update",
        code: "NO_UPDATES_PROVIDED",
      });
    }

    const updatedSettings =
      await notificationService.updateNotificationSettings(userId, updateData);

    await redisService.del(`notification_settings:${userId}`);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Notification settings updated successfully",
      data: {
        settings: updatedSettings,
        updatedFields: Object.keys(updateData),
        userId,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_NOTIFICATION_SETTINGS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      requestBody: req.body,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update notification settings",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const sendTestNotification = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);

    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({
        success: false,
        message: "Test notifications are not allowed in production",
        code: "PRODUCTION_RESTRICTED",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `test_notification:${userId}`,
      5,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many test notification requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const {
      type = "SYSTEM_ANNOUNCEMENT",
      title,
      message,
      priority = "NORMAL",
    } = req.body;

    const testNotification = await notificationService.createNotification({
      userId: userId,
      type,
      title: title || "Test Notification",
      message: message || "This is a test notification from the system.",
      priority,
      data: {
        isTest: true,
        timestamp: new Date().toISOString(),
        requestId,
      },
      sendEmail: false,
      sendSocket: true,
    });

    await redisService.del(`unread_count:${userId}`);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Test notification sent successfully",
      data: {
        notification: {
          id: testNotification.id,
          type: testNotification.type,
          title: testNotification.title,
          message: testNotification.message,
          priority: testNotification.priority,
          createdAt: testNotification.createdAt,
        },
        isTest: true,
        userId,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SEND_TEST_NOTIFICATION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      requestBody: req.body,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to send test notification",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getNotificationPreferences = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const userId = validateUserAuthentication(req);

    const rateLimitResult = await redisService.rateLimitCheck(
      `get_preferences:${userId}`,
      50,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many preference requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const settings = await notificationService.getNotificationSettings(userId);
    const stats = await notificationService.getNotificationStats(userId);

    const preferences = {
      settings: settings || {
        email: true,
        push: true,
        inApp: true,
        sms: false,
        assignmentUpdates: true,
        courseUpdates: true,
        accountUpdates: true,
        marketingUpdates: false,
        discussionUpdates: true,
        reviewUpdates: true,
        paymentUpdates: true,
      },
      statistics: stats,
      recommendations: generateNotificationRecommendations(settings, stats),
      userId,
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Notification preferences retrieved successfully",
      data: preferences,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_NOTIFICATION_PREFERENCES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve notification preferences",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const generateNotificationRecommendations = (settings, stats) => {
  const recommendations = [];

  if (stats.unread > 50) {
    recommendations.push({
      type: "HIGH_UNREAD_COUNT",
      message:
        "You have many unread notifications. Consider adjusting your notification preferences.",
      action: "Review notification types you want to receive",
    });
  }

  if (settings && !settings.email && !settings.push) {
    recommendations.push({
      type: "NO_DELIVERY_CHANNELS",
      message: "You won't receive any notifications with current settings.",
      action: "Enable at least one delivery method (email or push)",
    });
  }

  if (settings && settings.marketingUpdates) {
    recommendations.push({
      type: "MARKETING_ENABLED",
      message: "You're receiving marketing notifications.",
      action: "Disable marketing updates if you don't want promotional content",
    });
  }

  return recommendations;
};
