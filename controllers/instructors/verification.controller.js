import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../utils/redis.js";
import emailService from "../utils/emailService.js";
import notificationService from "../utils/notificationservice.js";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `verification_${Date.now()}_${Math.random()
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

export const requestVerification = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;
    const {
      documents,
      qualifications,
      experience,
      portfolio,
      references,
      verificationLevel = "BASIC",
      additionalInfo,
    } = req.body;

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one verification document is required",
        code: "DOCUMENTS_REQUIRED",
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
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

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    if (instructor.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Instructor is already verified",
        code: "ALREADY_VERIFIED",
      });
    }

    const existingRequestKey = `verification_request:instructor:${instructor.id}`;
    const existingRequest = await redisService.getJSON(existingRequestKey);

    if (existingRequest && existingRequest.status === "PENDING") {
      return res.status(400).json({
        success: false,
        message: "A verification request is already pending review",
        code: "REQUEST_PENDING",
        data: {
          requestId: existingRequest.requestId,
          submittedAt: existingRequest.submittedAt,
          status: existingRequest.status,
        },
      });
    }

    const requestId = generateRequestId();
    const verificationData = {
      requestId,
      instructorId: instructor.id,
      instructorName: `${instructor.user.firstName} ${instructor.user.lastName}`,
      instructorEmail: instructor.user.email,
      documents,
      qualifications: qualifications || [],
      experience: experience || [],
      portfolio: portfolio || [],
      references: references || [],
      verificationLevel,
      additionalInfo: additionalInfo || "",
      status: "PENDING",
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      adminNotes: null,
      rejectionReason: null,
      priority: verificationLevel === "PREMIUM" ? "HIGH" : "NORMAL",
    };

    await redisService.setJSON(existingRequestKey, verificationData, {
      ex: 7 * 24 * 60 * 60,
    });

    const allRequestsKey = "verification_requests:pending";
    await redisService.zadd(allRequestsKey, Date.now(), requestId);

    const allRequestDataKey = `verification_request:${requestId}`;
    await redisService.setJSON(allRequestDataKey, verificationData, {
      ex: 7 * 24 * 60 * 60,
    });

    const statsKey = "verification_stats";
    await redisService.hincrby(statsKey, "total_requests", 1);
    await redisService.hincrby(statsKey, "pending_requests", 1);
    await redisService.hincrby(
      statsKey,
      `level_${verificationLevel.toLowerCase()}`,
      1
    );

    try {
      await emailService.send({
        to: instructor.user.email,
        subject: "Verification Request Submitted - Educademy",
        template: "verification",
        templateData: {
          userName: instructor.user.firstName,
          title: "Verification Request Submitted",
          subtitle: "Your instructor verification request is under review",
          message:
            "Thank you for submitting your verification request. Our team will review your documents and credentials within 3-5 business days.",
          isSuccess: false,
          actionButton: "Track Request",
          actionUrl: `${process.env.FRONTEND_URL}/instructor/verification`,
          tips: [
            `Request ID: ${requestId}`,
            `Verification Level: ${verificationLevel}`,
            "Review timeline: 3-5 business days",
            "You'll receive updates via email and notifications",
          ],
        },
      });
    } catch (emailError) {
      console.error("Failed to send verification request email:", emailError);
    }

    try {
      await notificationService.createNotification({
        userId: instructorId,
        type: "verification_request_submitted",
        title: "Verification Request Submitted",
        message: `Your ${verificationLevel.toLowerCase()} verification request has been submitted and is under review.`,
        priority: "NORMAL",
        data: {
          requestId,
          verificationLevel,
          submittedAt: verificationData.submittedAt,
        },
        actionUrl: "/instructor/verification",
      });
    } catch (notificationError) {
      console.error(
        "Failed to create verification notification:",
        notificationError
      );
    }

    await redisService.del(`instructor_profile:${instructorId}`);

    const executionTime = Math.round(performance.now() - startTime);

    res.status(201).json({
      success: true,
      message: "Verification request submitted successfully",
      data: {
        requestId,
        status: "PENDING",
        verificationLevel,
        submittedAt: verificationData.submittedAt,
        estimatedReviewTime: "3-5 business days",
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Request verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit verification request",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getMyVerificationRequests = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const instructorId = req.userAuthId;

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true, isVerified: true, verificationBadge: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const cacheKey = `instructor_verification_requests:${instructor.id}`;
    let cachedRequests = await redisService.getJSON(cacheKey);

    if (cachedRequests) {
      return res.status(200).json({
        success: true,
        message: "Verification requests retrieved successfully",
        data: {
          currentStatus: {
            isVerified: instructor.isVerified,
            verificationBadge: instructor.verificationBadge,
          },
          requests: cachedRequests.requests,
          totalRequests: cachedRequests.totalRequests,
        },
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const currentRequestKey = `verification_request:instructor:${instructor.id}`;
    const currentRequest = await redisService.getJSON(currentRequestKey);

    const requests = [];
    if (currentRequest) {
      requests.push({
        requestId: currentRequest.requestId,
        verificationLevel: currentRequest.verificationLevel,
        status: currentRequest.status,
        submittedAt: currentRequest.submittedAt,
        reviewedAt: currentRequest.reviewedAt,
        adminNotes: currentRequest.adminNotes,
        rejectionReason: currentRequest.rejectionReason,
        priority: currentRequest.priority,
      });
    }

    const responseData = {
      requests,
      totalRequests: requests.length,
    };

    await redisService.setJSON(cacheKey, responseData, { ex: 300 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Verification requests retrieved successfully",
      data: {
        currentStatus: {
          isVerified: instructor.isVerified,
          verificationBadge: instructor.verificationBadge,
        },
        requests: responseData.requests,
        totalRequests: responseData.totalRequests,
      },
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get verification requests error:", error);
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

export const getVerificationRequest = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { requestId } = req.params;
    const userId = req.userAuthId;
    const userRole = req.userRole;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Request ID is required",
        code: "REQUEST_ID_REQUIRED",
      });
    }

    const cacheKey = `verification_request_details:${requestId}`;
    let requestData = await redisService.getJSON(cacheKey);

    if (!requestData) {
      requestData = await redisService.getJSON(
        `verification_request:${requestId}`
      );

      if (!requestData) {
        return res.status(404).json({
          success: false,
          message: "Verification request not found",
          code: "REQUEST_NOT_FOUND",
        });
      }

      await redisService.setJSON(cacheKey, requestData, { ex: 600 });
    }

    if (userRole === "INSTRUCTOR") {
      const instructor = await prisma.instructor.findUnique({
        where: { userId: userId },
        select: { id: true },
      });

      if (!instructor || requestData.instructorId !== instructor.id) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You can only view your own requests",
          code: "ACCESS_DENIED",
        });
      }
    } else if (!["ADMIN", "MODERATOR"].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions",
        code: "INSUFFICIENT_PERMISSIONS",
      });
    }

    const responseData = {
      requestId: requestData.requestId,
      instructorName: requestData.instructorName,
      instructorEmail: requestData.instructorEmail,
      verificationLevel: requestData.verificationLevel,
      status: requestData.status,
      submittedAt: requestData.submittedAt,
      reviewedAt: requestData.reviewedAt,
      reviewedBy: requestData.reviewedBy,
      adminNotes: requestData.adminNotes,
      rejectionReason: requestData.rejectionReason,
      priority: requestData.priority,
      documents: requestData.documents || [],
      qualifications: requestData.qualifications || [],
      experience: requestData.experience || [],
      portfolio: requestData.portfolio || [],
      references: requestData.references || [],
      additionalInfo: requestData.additionalInfo || "",
    };

    if (userRole === "INSTRUCTOR") {
      delete responseData.adminNotes;
    }

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Verification request details retrieved successfully",
      data: responseData,
      meta: {
        cached: !!requestData,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get verification request error:", error);
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

export const updateVerificationRequest = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { requestId } = req.params;
    const instructorId = req.userAuthId;
    const {
      documents,
      qualifications,
      experience,
      portfolio,
      references,
      additionalInfo,
    } = req.body;

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const requestKey = `verification_request:${requestId}`;
    const requestData = await redisService.getJSON(requestKey);

    if (!requestData) {
      return res.status(404).json({
        success: false,
        message: "Verification request not found",
        code: "REQUEST_NOT_FOUND",
      });
    }

    if (requestData.instructorId !== instructor.id) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only update your own requests",
        code: "ACCESS_DENIED",
      });
    }

    if (requestData.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Cannot update ${requestData.status.toLowerCase()} verification request`,
        code: "INVALID_STATUS",
      });
    }

    const updatedData = {
      ...requestData,
      documents: documents || requestData.documents,
      qualifications: qualifications || requestData.qualifications,
      experience: experience || requestData.experience,
      portfolio: portfolio || requestData.portfolio,
      references: references || requestData.references,
      additionalInfo: additionalInfo || requestData.additionalInfo,
      updatedAt: new Date().toISOString(),
    };

    await redisService.setJSON(requestKey, updatedData, {
      ex: 7 * 24 * 60 * 60,
    });

    const instructorRequestKey = `verification_request:instructor:${instructor.id}`;
    await redisService.setJSON(instructorRequestKey, updatedData, {
      ex: 7 * 24 * 60 * 60,
    });

    await redisService.del(`instructor_verification_requests:${instructor.id}`);
    await redisService.del(`verification_request_details:${requestId}`);

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Verification request updated successfully",
      data: {
        requestId: updatedData.requestId,
        status: updatedData.status,
        updatedAt: updatedData.updatedAt,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Update verification request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update verification request",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const cancelVerificationRequest = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { requestId } = req.params;
    const instructorId = req.userAuthId;

    const instructor = await prisma.instructor.findUnique({
      where: { userId: instructorId },
      select: { id: true },
    });

    if (!instructor) {
      return res.status(404).json({
        success: false,
        message: "Instructor profile not found",
        code: "INSTRUCTOR_NOT_FOUND",
      });
    }

    const requestKey = `verification_request:${requestId}`;
    const requestData = await redisService.getJSON(requestKey);

    if (!requestData) {
      return res.status(404).json({
        success: false,
        message: "Verification request not found",
        code: "REQUEST_NOT_FOUND",
      });
    }

    if (requestData.instructorId !== instructor.id) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only cancel your own requests",
        code: "ACCESS_DENIED",
      });
    }

    if (requestData.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel ${requestData.status.toLowerCase()} verification request`,
        code: "INVALID_STATUS",
      });
    }

    const cancelledData = {
      ...requestData,
      status: "CANCELLED",
      cancelledAt: new Date().toISOString(),
      cancelledBy: instructor.id,
    };

    await redisService.setJSON(requestKey, cancelledData, {
      ex: 30 * 24 * 60 * 60,
    });

    const instructorRequestKey = `verification_request:instructor:${instructor.id}`;
    await redisService.del(instructorRequestKey);

    const allRequestsKey = "verification_requests:pending";
    await redisService.zrem(allRequestsKey, requestId);

    const statsKey = "verification_stats";
    await redisService.hincrby(statsKey, "pending_requests", -1);
    await redisService.hincrby(statsKey, "cancelled_requests", 1);

    await redisService.del(`instructor_verification_requests:${instructor.id}`);
    await redisService.del(`verification_request_details:${requestId}`);

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Verification request cancelled successfully",
      data: {
        requestId: cancelledData.requestId,
        status: cancelledData.status,
        cancelledAt: cancelledData.cancelledAt,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Cancel verification request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel verification request",
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

    const allRequestsKey = "verification_requests:pending";
    let requestIds = await redisService.zrevrange(allRequestsKey, 0, -1);

    const requests = [];
    for (const requestId of requestIds) {
      const requestData = await redisService.getJSON(
        `verification_request:${requestId}`
      );
      if (requestData) {
        if (status && requestData.status !== status) continue;
        if (
          verificationLevel &&
          requestData.verificationLevel !== verificationLevel
        )
          continue;
        if (priority && requestData.priority !== priority) continue;
        if (
          search &&
          !requestData.instructorName
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          !requestData.instructorEmail
            .toLowerCase()
            .includes(search.toLowerCase())
        )
          continue;

        requests.push({
          requestId: requestData.requestId,
          instructorName: requestData.instructorName,
          instructorEmail: requestData.instructorEmail,
          verificationLevel: requestData.verificationLevel,
          status: requestData.status,
          priority: requestData.priority,
          submittedAt: requestData.submittedAt,
          reviewedAt: requestData.reviewedAt,
          reviewedBy: requestData.reviewedBy,
        });
      }
    }

    requests.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];

      if (sortOrder === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    const total = requests.length;
    const paginatedRequests = requests.slice(skip, skip + pageSize);

    const result = {
      requests: paginatedRequests,
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

    const requestKey = `verification_request:${requestId}`;
    const requestData = await redisService.getJSON(requestKey);

    if (!requestData) {
      return res.status(404).json({
        success: false,
        message: "Verification request not found",
        code: "REQUEST_NOT_FOUND",
      });
    }

    if (requestData.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Cannot review ${requestData.status.toLowerCase()} verification request`,
        code: "INVALID_STATUS",
      });
    }

    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { firstName: true, lastName: true, email: true },
    });

    const reviewedData = {
      ...requestData,
      status: action === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewedAt: new Date().toISOString(),
      reviewedBy: `${admin.firstName} ${admin.lastName}`,
      reviewedById: adminId,
      adminNotes: adminNotes || "",
      rejectionReason: action === "REJECT" ? rejectionReason : null,
    };

    await redisService.setJSON(requestKey, reviewedData, {
      ex: 30 * 24 * 60 * 60,
    });

    const allRequestsKey = "verification_requests:pending";
    await redisService.zrem(allRequestsKey, requestId);

    const statsKey = "verification_stats";
    await redisService.hincrby(statsKey, "pending_requests", -1);

    if (action === "APPROVE") {
      await redisService.hincrby(statsKey, "approved_requests", 1);

      const instructor = await prisma.instructor.update({
        where: { id: requestData.instructorId },
        data: {
          isVerified: true,
          verificationBadge: generateVerificationBadge(
            requestData.verificationLevel
          ),
        },
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

      try {
        await emailService.send({
          to: instructor.user.email,
          subject: "Verification Approved - Congratulations! 🎉",
          template: "verification",
          templateData: {
            userName: instructor.user.firstName,
            title: "Verification Approved!",
            subtitle: "Your instructor verification has been approved",
            message: `Congratulations! Your ${requestData.verificationLevel.toLowerCase()} verification request has been approved. You now have a verified instructor badge on your profile.`,
            isSuccess: true,
            actionButton: "View Profile",
            actionUrl: `${process.env.FRONTEND_URL}/instructor/profile`,
            achievements: [
              "Verified instructor status granted",
              `${instructor.verificationBadge} badge added to profile`,
              "Enhanced credibility and visibility",
              "Access to premium instructor features",
            ],
          },
        });
      } catch (emailError) {
        console.error(
          "Failed to send verification approval email:",
          emailError
        );
      }

      try {
        await notificationService.createNotification({
          userId: requestData.instructorId,
          type: "verification_approved",
          title: "Verification Approved!",
          message: `Congratulations! Your ${requestData.verificationLevel.toLowerCase()} verification has been approved.`,
          priority: "HIGH",
          data: {
            requestId,
            verificationLevel: requestData.verificationLevel,
            verificationBadge: instructor.verificationBadge,
            approvedAt: reviewedData.reviewedAt,
          },
          actionUrl: "/instructor/profile",
        });
      } catch (notificationError) {
        console.error(
          "Failed to create verification approval notification:",
          notificationError
        );
      }
    } else {
      await redisService.hincrby(statsKey, "rejected_requests", 1);

      const instructor = await prisma.instructor.findUnique({
        where: { id: requestData.instructorId },
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

      try {
        await emailService.send({
          to: instructor.user.email,
          subject: "Verification Update Required - Educademy",
          template: "verification",
          templateData: {
            userName: instructor.user.firstName,
            title: "Verification Update Required",
            subtitle: "Your verification request needs additional information",
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
        });
      } catch (emailError) {
        console.error(
          "Failed to send verification rejection email:",
          emailError
        );
      }

      try {
        await notificationService.createNotification({
          userId: requestData.instructorId,
          type: "verification_rejected",
          title: "Verification Update Required",
          message: `Your ${requestData.verificationLevel.toLowerCase()} verification request needs updates before approval.`,
          priority: "NORMAL",
          data: {
            requestId,
            rejectionReason,
            verificationLevel: requestData.verificationLevel,
            rejectedAt: reviewedData.reviewedAt,
          },
          actionUrl: "/instructor/verification",
        });
      } catch (notificationError) {
        console.error(
          "Failed to create verification rejection notification:",
          notificationError
        );
      }
    }

    await redisService.delPattern("admin_verification_requests:*");
    await redisService.del(
      `instructor_verification_requests:${requestData.instructorId}`
    );
    await redisService.del(`verification_request_details:${requestId}`);
    await redisService.del(`instructor_profile:${requestData.instructorId}`);

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: `Verification request ${action.toLowerCase()}d successfully`,
      data: {
        requestId: reviewedData.requestId,
        status: reviewedData.status,
        reviewedAt: reviewedData.reviewedAt,
        reviewedBy: reviewedData.reviewedBy,
        verificationLevel: reviewedData.verificationLevel,
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
