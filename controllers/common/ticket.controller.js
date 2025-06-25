import { config } from "dotenv";
config();

import asyncHandler from "express-async-handler";
import { PrismaClient } from "@prisma/client";
import redisService from "../../utils/redis.js";
import emailService from "../../utils/emailService.js";
import notificationService from "../../utils/notificationservice.js";
import { uploadDocument } from "../../config/upload.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `support_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const validateTicketCreation = (data) => {
  const errors = [];
  const { subject, description, category, priority } = data;

  if (!subject?.trim()) {
    errors.push("Subject is required");
  } else if (subject.trim().length < 5) {
    errors.push("Subject must be at least 5 characters long");
  } else if (subject.trim().length > 200) {
    errors.push("Subject must be less than 200 characters");
  }

  if (!description?.trim()) {
    errors.push("Description is required");
  } else if (description.trim().length < 20) {
    errors.push("Description must be at least 20 characters long");
  } else if (description.trim().length > 5000) {
    errors.push("Description must be less than 5000 characters");
  }

  const validCategories = [
    "GENERAL",
    "TECHNICAL",
    "PAYMENT",
    "COURSE_CONTENT",
    "ACCOUNT",
    "REFUND",
    "BUG_REPORT",
    "FEATURE_REQUEST",
  ];
  if (category && !validCategories.includes(category.toUpperCase())) {
    errors.push("Invalid support category");
  }

  const validPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
  if (priority && !validPriorities.includes(priority.toUpperCase())) {
    errors.push("Invalid priority level");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const validateResponseData = (data) => {
  const errors = [];
  const { message } = data;

  if (!message?.trim()) {
    errors.push("Response message is required");
  } else if (message.trim().length < 5) {
    errors.push("Response must be at least 5 characters long");
  } else if (message.trim().length > 3000) {
    errors.push("Response must be less than 3000 characters");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

const validateTicketFilters = (filters) => {
  const errors = [];
  const { page, limit, status, category, priority, startDate, endDate } =
    filters;

  if (page && (isNaN(page) || parseInt(page) < 1)) {
    errors.push("Page must be a positive number");
  }

  if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
    errors.push("Limit must be between 1 and 100");
  }

  const validStatuses = [
    "OPEN",
    "IN_PROGRESS",
    "RESOLVED",
    "CLOSED",
    "ESCALATED",
  ];
  if (status && !validStatuses.includes(status.toUpperCase())) {
    errors.push("Invalid ticket status");
  }

  const validCategories = [
    "GENERAL",
    "TECHNICAL",
    "PAYMENT",
    "COURSE_CONTENT",
    "ACCOUNT",
    "REFUND",
    "BUG_REPORT",
    "FEATURE_REQUEST",
  ];
  if (category && !validCategories.includes(category.toUpperCase())) {
    errors.push("Invalid support category");
  }

  const validPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
  if (priority && !validPriorities.includes(priority.toUpperCase())) {
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

const buildTicketFilters = (query, userId, userRole) => {
  const filters = {
    page: parseInt(query.page) || 1,
    limit: Math.min(parseInt(query.limit) || 20, 100),
  };

  const where = {};

  if (userRole !== "ADMIN" && userRole !== "MODERATOR") {
    where.userId = userId;
  }

  if (query.status) {
    where.status = query.status.toUpperCase();
  }

  if (query.category) {
    where.category = query.category.toUpperCase();
  }

  if (query.priority) {
    where.priority = query.priority.toUpperCase();
  }

  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) where.createdAt.gte = new Date(query.startDate);
    if (query.endDate) where.createdAt.lte = new Date(query.endDate);
  }

  return { ...filters, where };
};

const generateTicketNumber = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 4);
  return `TKT-${timestamp}-${random}`.toUpperCase();
};

const determineTicketPriority = (category, description) => {
  const urgentKeywords = [
    "urgent",
    "critical",
    "emergency",
    "broken",
    "not working",
    "error",
    "crash",
  ];
  const highKeywords = [
    "payment",
    "refund",
    "billing",
    "account locked",
    "suspended",
  ];

  const lowerDescription = description.toLowerCase();

  if (category === "PAYMENT" || category === "REFUND") {
    return "HIGH";
  }

  if (urgentKeywords.some((keyword) => lowerDescription.includes(keyword))) {
    return "URGENT";
  }

  if (highKeywords.some((keyword) => lowerDescription.includes(keyword))) {
    return "HIGH";
  }

  return "MEDIUM";
};

const notifyStaffNewTicket = async (ticket, user) => {
  try {
    const staffUsers = await prisma.user.findMany({
      where: {
        role: { in: ["ADMIN", "MODERATOR"] },
        isActive: true,
      },
      select: { id: true },
    });

    const notifications = staffUsers.map((staff) =>
      notificationService.createNotification({
        userId: staff.id,
        type: "SUPPORT_TICKET_CREATED",
        title: "New Support Ticket",
        message: `New ${ticket.priority.toLowerCase()} priority ticket: ${
          ticket.subject
        }`,
        priority: ticket.priority === "URGENT" ? "HIGH" : "NORMAL",
        data: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          category: ticket.category,
          priority: ticket.priority,
          userName: `${user.firstName} ${user.lastName}`,
          userEmail: user.email,
        },
        actionUrl: `/admin/support/tickets/${ticket.id}`,
        sendEmail: ticket.priority === "URGENT",
        sendSocket: true,
      })
    );

    await Promise.all(notifications);
  } catch (error) {
    console.warn("Failed to notify staff of new ticket:", error);
  }
};

export const createSupportTicket = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  uploadDocument.array("attachments", 5)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    try {
      const validationResult = validateTicketCreation(req.body);
      if (!validationResult.isValid) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: validationResult.errors,
          code: "VALIDATION_ERROR",
        });
      }

      const rateLimitResult = await redisService.rateLimitCheck(
        `create_ticket:${req.userAuthId}`,
        10,
        3600
      );

      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          message: "Too many ticket creation requests. Please try again later.",
          retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
          code: "RATE_LIMIT_EXCEEDED",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.userAuthId },
        select: {
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

      const { subject, description, category = "GENERAL", priority } = req.body;

      const ticketNumber = generateTicketNumber();
      const determinedPriority =
        priority?.toUpperCase() ||
        determineTicketPriority(category.toUpperCase(), description);

      const attachments = req.files
        ? req.files.map((file) => ({
            filename: file.originalname,
            path: file.path,
            size: file.size,
            mimetype: file.mimetype,
          }))
        : [];

      const ticketData = {
        ticketNumber,
        subject: subject.trim(),
        description: description.trim(),
        category: category.toUpperCase(),
        priority: determinedPriority,
        status: "OPEN",
        userId: req.userAuthId,
        metadata: {
          userAgent: req.get("User-Agent"),
          ipAddress: req.ip,
          attachments,
          createdVia: "web",
        },
      };

      const ticket = await prisma.supportTicket.create({
        data: ticketData,
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

      const cacheKey = `support_tickets:${req.userAuthId}`;
      await redisService.del(cacheKey);

      const emailPromise = emailService.send({
        to: user.email,
        subject: `Support Ticket Created - ${ticketNumber}`,
        template: "support_ticket_created",
        templateData: {
          userName: user.firstName,
          ticketNumber,
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
          description: ticket.description,
          supportUrl: `${process.env.FRONTEND_URL}/support/tickets/${ticket.id}`,
        },
      });

      const notificationPromise = notificationService.createNotification({
        userId: req.userAuthId,
        type: "SUPPORT_TICKET_CREATED",
        title: "Support Ticket Created",
        message: `Your support ticket ${ticketNumber} has been created and will be reviewed soon.`,
        priority: "NORMAL",
        data: {
          ticketId: ticket.id,
          ticketNumber,
          category: ticket.category,
          priority: ticket.priority,
        },
        actionUrl: `/support/tickets/${ticket.id}`,
        sendEmail: false,
        sendSocket: true,
      });

      const staffNotificationPromise = notifyStaffNewTicket(ticket, user);

      await Promise.allSettled([
        emailPromise,
        notificationPromise,
        staffNotificationPromise,
      ]);

      const executionTime = performance.now() - startTime;

      res.status(201).json({
        success: true,
        message: "Support ticket created successfully",
        data: {
          ticket: {
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            subject: ticket.subject,
            description: ticket.description,
            category: ticket.category,
            priority: ticket.priority,
            status: ticket.status,
            createdAt: ticket.createdAt,
            attachments: attachments.length,
          },
          estimatedResponseTime:
            determinedPriority === "URGENT"
              ? "2-4 hours"
              : determinedPriority === "HIGH"
              ? "4-8 hours"
              : "24-48 hours",
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error(`CREATE_SUPPORT_TICKET_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        userId: req.userAuthId,
        body: req.body,
        ip: req.ip,
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Failed to create support ticket",
        code: "INTERNAL_SERVER_ERROR",
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    }
  });
});

export const getSupportTickets = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const validationResult = validateTicketFilters(req.query);
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid filters provided",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `get_tickets:${req.userAuthId}`,
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

    const filters = buildTicketFilters(req.query, req.userAuthId, req.userRole);
    const skip = (filters.page - 1) * filters.limit;

    const cacheKey = `support_tickets:${req.userAuthId}:${JSON.stringify(
      filters
    )}`;
    let cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult && filters.page === 1) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Support tickets retrieved successfully",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where: filters.where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip,
        take: filters.limit,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
          responses: {
            select: {
              id: true,
              createdAt: true,
              isStaffResponse: true,
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          _count: {
            select: {
              responses: true,
            },
          },
        },
      }),
      prisma.supportTicket.count({
        where: filters.where,
      }),
    ]);

    const result = {
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        resolvedAt: ticket.resolvedAt,
        user:
          req.userRole === "ADMIN" || req.userRole === "MODERATOR"
            ? {
                name: `${ticket.user.firstName} ${ticket.user.lastName}`,
                email: ticket.user.email,
                role: ticket.user.role,
              }
            : undefined,
        responseCount: ticket._count.responses,
        lastResponse: ticket.responses[0] || null,
        isOverdue: isTicketOverdue(ticket),
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
        hasNext: skip + filters.limit < total,
        hasPrev: filters.page > 1,
      },
      summary: await getTicketSummary(filters.where),
    };

    if (filters.page === 1) {
      await redisService.setJSON(cacheKey, result, { ex: 300 });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Support tickets retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`GET_SUPPORT_TICKETS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      query: req.query,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve support tickets",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSupportTicket = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { ticketId } = req.params;

    if (!ticketId) {
      return res.status(400).json({
        success: false,
        message: "Ticket ID is required",
        code: "MISSING_TICKET_ID",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `get_ticket_detail:${req.userAuthId}`,
      200,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const where = { id: ticketId };
    if (req.userRole !== "ADMIN" && req.userRole !== "MODERATOR") {
      where.userId = req.userAuthId;
    }

    const ticket = await prisma.supportTicket.findFirst({
      where,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            profileImage: true,
          },
        },
        responses: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                profileImage: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
        code: "TICKET_NOT_FOUND",
      });
    }

    const result = {
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        resolvedAt: ticket.resolvedAt,
        resolvedBy: ticket.resolvedBy,
        metadata: ticket.metadata,
        user:
          req.userRole === "ADMIN" || req.userRole === "MODERATOR"
            ? {
                name: `${ticket.user.firstName} ${ticket.user.lastName}`,
                email: ticket.user.email,
                role: ticket.user.role,
                profileImage: ticket.user.profileImage,
              }
            : {
                name: `${ticket.user.firstName} ${ticket.user.lastName}`,
                profileImage: ticket.user.profileImage,
              },
        responses: ticket.responses.map((response) => ({
          id: response.id,
          message: response.message,
          isStaffResponse: response.isStaffResponse,
          attachments: response.attachments,
          createdAt: response.createdAt,
          user: {
            name: `${response.user.firstName} ${response.user.lastName}`,
            profileImage: response.user.profileImage,
            role: response.user.role,
          },
        })),
        isOverdue: isTicketOverdue(ticket),
        timeline: generateTicketTimeline(ticket),
      },
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Support ticket retrieved successfully",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_SUPPORT_TICKET_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      ticketId: req.params.ticketId,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve support ticket",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const addTicketResponse = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  uploadDocument.array("attachments", 3)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    try {
      const { ticketId } = req.params;
      const validationResult = validateResponseData(req.body);

      if (!validationResult.isValid) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: validationResult.errors,
          code: "VALIDATION_ERROR",
        });
      }

      const rateLimitResult = await redisService.rateLimitCheck(
        `add_response:${req.userAuthId}`,
        50,
        3600
      );

      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          message: "Too many response requests. Please try again later.",
          code: "RATE_LIMIT_EXCEEDED",
        });
      }

      const where = { id: ticketId };
      if (req.userRole !== "ADMIN" && req.userRole !== "MODERATOR") {
        where.userId = req.userAuthId;
      }

      const ticket = await prisma.supportTicket.findFirst({
        where,
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

      if (!ticket) {
        return res.status(404).json({
          success: false,
          message: "Support ticket not found",
          code: "TICKET_NOT_FOUND",
        });
      }

      if (ticket.status === "CLOSED") {
        return res.status(400).json({
          success: false,
          message: "Cannot add response to a closed ticket",
          code: "TICKET_CLOSED",
        });
      }

      const { message } = req.body;
      const isStaffResponse =
        req.userRole === "ADMIN" || req.userRole === "MODERATOR";

      const attachments = req.files
        ? req.files.map((file) => ({
            filename: file.originalname,
            path: file.path,
            size: file.size,
            mimetype: file.mimetype,
          }))
        : [];

      const responseData = {
        message: message.trim(),
        isStaffResponse,
        attachments: attachments.length > 0 ? attachments : null,
        supportTicketId: ticketId,
        userId: req.userAuthId,
      };

      const result = await prisma.$transaction(async (tx) => {
        const response = await tx.supportTicketResponse.create({
          data: responseData,
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                profileImage: true,
                role: true,
              },
            },
          },
        });

        let updateData = { updatedAt: new Date() };

        if (isStaffResponse) {
          updateData.status = "IN_PROGRESS";
        } else if (ticket.status === "RESOLVED") {
          updateData.status = "OPEN";
        }

        const updatedTicket = await tx.supportTicket.update({
          where: { id: ticketId },
          data: updateData,
        });

        return { response, updatedTicket };
      });

      await redisService.delPattern(`support_tickets:${ticket.userId}*`);

      const recipientId = isStaffResponse ? ticket.userId : null;
      if (recipientId && recipientId !== req.userAuthId) {
        const notificationPromise = notificationService.createNotification({
          userId: recipientId,
          type: "SUPPORT_TICKET_UPDATED",
          title: "Support Ticket Response",
          message: `${
            isStaffResponse ? "Support team" : "You"
          } added a response to ticket ${ticket.ticketNumber}`,
          priority: "NORMAL",
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            responseId: result.response.id,
            isStaffResponse,
          },
          actionUrl: `/support/tickets/${ticket.id}`,
          sendEmail: isStaffResponse,
          sendSocket: true,
        });

        await Promise.allSettled([notificationPromise]);
      }

      const executionTime = performance.now() - startTime;

      res.status(201).json({
        success: true,
        message: "Response added successfully",
        data: {
          response: {
            id: result.response.id,
            message: result.response.message,
            isStaffResponse: result.response.isStaffResponse,
            attachments: attachments.length,
            createdAt: result.response.createdAt,
            user: {
              name: `${result.response.user.firstName} ${result.response.user.lastName}`,
              profileImage: result.response.user.profileImage,
              role: result.response.user.role,
            },
          },
          ticketStatus: result.updatedTicket.status,
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error(`ADD_TICKET_RESPONSE_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        ticketId: req.params.ticketId,
        userId: req.userAuthId,
        ip: req.ip,
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Failed to add response",
        code: "INTERNAL_SERVER_ERROR",
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    }
  });
});

export const updateTicketStatus = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { ticketId } = req.params;
    const { status, resolvedBy } = req.body;

    if (req.userRole !== "ADMIN" && req.userRole !== "MODERATOR") {
      return res.status(403).json({
        success: false,
        message: "Only staff members can update ticket status",
        code: "INSUFFICIENT_PERMISSIONS",
      });
    }

    const validStatuses = [
      "OPEN",
      "IN_PROGRESS",
      "RESOLVED",
      "CLOSED",
      "ESCALATED",
    ];
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket status",
        code: "INVALID_STATUS",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `update_ticket_status:${req.userAuthId}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many status update requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
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

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
        code: "TICKET_NOT_FOUND",
      });
    }

    const updateData = {
      status: status.toUpperCase(),
      updatedAt: new Date(),
    };

    if (
      status.toUpperCase() === "RESOLVED" ||
      status.toUpperCase() === "CLOSED"
    ) {
      updateData.resolvedAt = new Date();
      updateData.resolvedBy = resolvedBy || req.userAuthId;
    } else {
      updateData.resolvedAt = null;
      updateData.resolvedBy = null;
    }

    const updatedTicket = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: updateData,
    });

    await redisService.delPattern(`support_tickets:${ticket.userId}*`);

    const notificationMessage = getStatusUpdateMessage(
      ticket.status,
      status.toUpperCase()
    );
    if (notificationMessage) {
      const notificationPromise = notificationService.createNotification({
        userId: ticket.userId,
        type: "SUPPORT_TICKET_UPDATED",
        title: "Ticket Status Updated",
        message: notificationMessage,
        priority: status.toUpperCase() === "RESOLVED" ? "HIGH" : "NORMAL",
        data: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          oldStatus: ticket.status,
          newStatus: status.toUpperCase(),
        },
        actionUrl: `/support/tickets/${ticket.id}`,
        sendEmail: status.toUpperCase() === "RESOLVED",
        sendSocket: true,
      });

      await Promise.allSettled([notificationPromise]);
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Ticket status updated successfully",
      data: {
        ticket: {
          id: updatedTicket.id,
          ticketNumber: updatedTicket.ticketNumber,
          status: updatedTicket.status,
          resolvedAt: updatedTicket.resolvedAt,
          resolvedBy: updatedTicket.resolvedBy,
          updatedAt: updatedTicket.updatedAt,
        },
        statusChanged: ticket.status !== status.toUpperCase(),
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_TICKET_STATUS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      ticketId: req.params.ticketId,
      status: req.body.status,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update ticket status",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSupportCategories = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const rateLimitResult = await redisService.rateLimitCheck(
      `support_categories:${req.ip}`,
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

    const cacheKey = "support_categories";
    let categories = await redisService.getJSON(cacheKey);

    if (!categories) {
      categories = {
        categories: [
          {
            value: "GENERAL",
            label: "General Inquiry",
            description: "General questions and information requests",
            icon: "help-circle",
            estimatedResponse: "24-48 hours",
          },
          {
            value: "TECHNICAL",
            label: "Technical Issue",
            description: "Platform bugs, errors, and technical problems",
            icon: "tool",
            estimatedResponse: "4-8 hours",
          },
          {
            value: "PAYMENT",
            label: "Payment & Billing",
            description:
              "Payment issues, billing questions, and subscription problems",
            icon: "credit-card",
            estimatedResponse: "2-4 hours",
          },
          {
            value: "COURSE_CONTENT",
            label: "Course Content",
            description:
              "Issues with course materials, videos, or content quality",
            icon: "book-open",
            estimatedResponse: "8-12 hours",
          },
          {
            value: "ACCOUNT",
            label: "Account & Profile",
            description:
              "Account access, profile settings, and security concerns",
            icon: "user",
            estimatedResponse: "4-8 hours",
          },
          {
            value: "REFUND",
            label: "Refund Request",
            description: "Course refund requests and return policy questions",
            icon: "arrow-left-circle",
            estimatedResponse: "24-48 hours",
          },
          {
            value: "BUG_REPORT",
            label: "Bug Report",
            description: "Report bugs and unexpected platform behavior",
            icon: "bug",
            estimatedResponse: "2-4 hours",
          },
          {
            value: "FEATURE_REQUEST",
            label: "Feature Request",
            description: "Suggest new features and platform improvements",
            icon: "lightbulb",
            estimatedResponse: "48-72 hours",
          },
        ],
        priorities: [
          {
            value: "LOW",
            label: "Low",
            description: "Non-urgent, general inquiries",
            color: "green",
          },
          {
            value: "MEDIUM",
            label: "Medium",
            description: "Standard issues requiring attention",
            color: "yellow",
          },
          {
            value: "HIGH",
            label: "High",
            description: "Important issues affecting your experience",
            color: "orange",
          },
          {
            value: "URGENT",
            label: "Urgent",
            description: "Critical issues requiring immediate attention",
            color: "red",
          },
        ],
      };

      await redisService.setJSON(cacheKey, categories, { ex: 86400 });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Support categories retrieved successfully",
      data: categories,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_SUPPORT_CATEGORIES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve support categories",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSupportStats = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const rateLimitResult = await redisService.rateLimitCheck(
      `support_stats:${req.userAuthId}`,
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

    const where = {};
    if (req.userRole !== "ADMIN" && req.userRole !== "MODERATOR") {
      where.userId = req.userAuthId;
    }

    const [
      totalTickets,
      openTickets,
      resolvedTickets,
      avgResponseTime,
      ticketsByCategory,
      ticketsByPriority,
      recentActivity,
    ] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.count({
        where: { ...where, status: { in: ["OPEN", "IN_PROGRESS"] } },
      }),
      prisma.supportTicket.count({ where: { ...where, status: "RESOLVED" } }),
      getAverageResponseTime(where),
      prisma.supportTicket.groupBy({
        by: ["category"],
        where,
        _count: { category: true },
      }),
      prisma.supportTicket.groupBy({
        by: ["priority"],
        where,
        _count: { priority: true },
      }),
      prisma.supportTicket.findMany({
        where: {
          ...where,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: {
          createdAt: true,
          status: true,
        },
      }),
    ]);

    const stats = {
      overview: {
        totalTickets,
        openTickets,
        resolvedTickets,
        closedTickets: totalTickets - openTickets - resolvedTickets,
        resolutionRate:
          totalTickets > 0
            ? Math.round((resolvedTickets / totalTickets) * 100)
            : 0,
        avgResponseTime: avgResponseTime || "N/A",
      },
      distribution: {
        byCategory: ticketsByCategory.reduce((acc, item) => {
          acc[item.category] = item._count.category;
          return acc;
        }, {}),
        byPriority: ticketsByPriority.reduce((acc, item) => {
          acc[item.priority] = item._count.priority;
          return acc;
        }, {}),
      },
      trends: {
        last30Days: generateTrendData(recentActivity),
      },
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Support statistics retrieved successfully",
      data: stats,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_SUPPORT_STATS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve support statistics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const isTicketOverdue = (ticket) => {
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") return false;

  const now = new Date();
  const created = new Date(ticket.createdAt);
  const hoursDiff = (now - created) / (1000 * 60 * 60);

  const slaHours = {
    URGENT: 4,
    HIGH: 8,
    MEDIUM: 24,
    LOW: 48,
  };

  return hoursDiff > (slaHours[ticket.priority] || 24);
};

const generateTicketTimeline = (ticket) => {
  const timeline = [
    {
      event: "Ticket Created",
      timestamp: ticket.createdAt,
      type: "created",
      description: `Ticket ${ticket.ticketNumber} was created`,
    },
  ];

  if (ticket.responses && ticket.responses.length > 0) {
    ticket.responses.forEach((response) => {
      timeline.push({
        event: response.isStaffResponse ? "Staff Response" : "User Response",
        timestamp: response.createdAt,
        type: response.isStaffResponse ? "staff_response" : "user_response",
        description: `${
          response.isStaffResponse ? "Support team" : "User"
        } added a response`,
      });
    });
  }

  if (ticket.resolvedAt) {
    timeline.push({
      event: "Ticket Resolved",
      timestamp: ticket.resolvedAt,
      type: "resolved",
      description: "Ticket was marked as resolved",
    });
  }

  return timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
};

const getTicketSummary = async (where) => {
  const [statusCounts, priorityCounts] = await Promise.all([
    prisma.supportTicket.groupBy({
      by: ["status"],
      where,
      _count: { status: true },
    }),
    prisma.supportTicket.groupBy({
      by: ["priority"],
      where,
      _count: { priority: true },
    }),
  ]);

  return {
    byStatus: statusCounts.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {}),
    byPriority: priorityCounts.reduce((acc, item) => {
      acc[item.priority] = item._count.priority;
      return acc;
    }, {}),
  };
};

const getStatusUpdateMessage = (oldStatus, newStatus) => {
  const messages = {
    OPEN_IN_PROGRESS: "Your support ticket is now being reviewed by our team.",
    IN_PROGRESS_RESOLVED:
      "Your support ticket has been resolved. Please review the solution provided.",
    OPEN_RESOLVED:
      "Your support ticket has been resolved. Please review the solution provided.",
    RESOLVED_CLOSED: "Your support ticket has been closed.",
    RESOLVED_OPEN:
      "Your support ticket has been reopened for further assistance.",
  };

  return (
    messages[`${oldStatus}_${newStatus}`] ||
    `Your ticket status has been updated to ${newStatus.toLowerCase()}.`
  );
};

const getAverageResponseTime = async (where) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: {
        ...where,
        responses: { some: { isStaffResponse: true } },
      },
      include: {
        responses: {
          where: { isStaffResponse: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });

    if (tickets.length === 0) return null;

    const responseTimes = tickets.map((ticket) => {
      const firstResponse = ticket.responses[0];
      const createdTime = new Date(ticket.createdAt).getTime();
      const responseTime = new Date(firstResponse.createdAt).getTime();
      return (responseTime - createdTime) / (1000 * 60 * 60);
    });

    const avgHours =
      responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;

    if (avgHours < 1) {
      return `${Math.round(avgHours * 60)} minutes`;
    } else if (avgHours < 24) {
      return `${Math.round(avgHours)} hours`;
    } else {
      return `${Math.round(avgHours / 24)} days`;
    }
  } catch (error) {
    console.warn("Failed to calculate average response time:", error);
    return null;
  }
};

const generateTrendData = (recentActivity) => {
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return {
      date: date.toISOString().split("T")[0],
      created: 0,
      resolved: 0,
    };
  });

  recentActivity.forEach((ticket) => {
    const date = ticket.createdAt.toISOString().split("T")[0];
    const dayData = last30Days.find((day) => day.date === date);
    if (dayData) {
      dayData.created++;
      if (ticket.status === "RESOLVED") {
        dayData.resolved++;
      }
    }
  });

  return last30Days;
};
