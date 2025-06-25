import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";
import emailService from "../../utils/emailService.js";
import notificationService from "../../utils/notificationservice.js";
import paymentService from "../../utils/paymentService.js";

const prisma = new PrismaClient();

const generateOrderId = () => {
  return `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const calculateTax = (amount, taxRate = 0.18) => {
  return Math.round(amount * taxRate * 100) / 100;
};

const validateCoupon = async (couponCode, userId, courseIds, totalAmount) => {
  if (!couponCode) return null;

  const coupon = await prisma.coupon.findFirst({
    where: {
      code: couponCode.toUpperCase(),
      isActive: true,
      validFrom: { lte: new Date() },
      validUntil: { gte: new Date() },
    },
    include: {
      courses: { select: { id: true } },
      usages: { where: { userId } },
    },
  });

  if (!coupon) {
    throw new Error("Invalid or expired coupon code");
  }

  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    throw new Error("Coupon usage limit exceeded");
  }

  if (coupon.usages.length > 0) {
    throw new Error("Coupon already used by this user");
  }

  if (coupon.minimumAmount && totalAmount < coupon.minimumAmount) {
    throw new Error(`Minimum order amount should be ₹${coupon.minimumAmount}`);
  }

  if (coupon.applicableTo === "SPECIFIC_COURSES") {
    const applicableCourseIds = coupon.courses.map((c) => c.id);
    const hasApplicableCourse = courseIds.some((id) =>
      applicableCourseIds.includes(id)
    );
    if (!hasApplicableCourse) {
      throw new Error("Coupon not applicable to selected courses");
    }
  }

  let discountAmount = 0;
  if (coupon.type === "PERCENTAGE") {
    discountAmount = (totalAmount * coupon.value) / 100;
    if (coupon.maximumDiscount && discountAmount > coupon.maximumDiscount) {
      discountAmount = parseFloat(coupon.maximumDiscount);
    }
  } else {
    discountAmount = parseFloat(coupon.value);
  }

  return {
    coupon,
    discountAmount: Math.min(discountAmount, totalAmount),
  };
};

export const initiateCheckout = asyncHandler(async (req, res) => {
  const { courseIds, gateway, couponCode, billingAddress } = req.body;
  const userId = req.userAuthId;

  if (!courseIds || !Array.isArray(courseIds) || courseIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Course IDs are required",
    });
  }

  if (!paymentService.validateGateway(gateway)) {
    return res.status(400).json({
      success: false,
      message: "Invalid payment gateway",
    });
  }

  const courses = await prisma.course.findMany({
    where: {
      id: { in: courseIds },
      status: "PUBLISHED",
    },
    include: {
      instructor: {
        include: {
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  if (courses.length !== courseIds.length) {
    return res.status(400).json({
      success: false,
      message: "One or more courses not found or not available",
    });
  }

  const existingEnrollments = await prisma.enrollment.findMany({
    where: {
      studentId: userId,
      courseId: { in: courseIds },
      status: { in: ["ACTIVE", "COMPLETED"] },
    },
  });

  if (existingEnrollments.length > 0) {
    return res.status(400).json({
      success: false,
      message: "You are already enrolled in one or more of these courses",
    });
  }

  let subtotal = 0;
  const orderItems = courses.map((course) => {
    const price = parseFloat(course.discountPrice || course.price);
    subtotal += price;
    return {
      courseId: course.id,
      title: course.title,
      price: price,
      originalPrice: parseFloat(course.price),
      instructorName: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
    };
  });

  const couponValidation = await validateCoupon(
    couponCode,
    userId,
    courseIds,
    subtotal
  );
  const discountAmount = couponValidation?.discountAmount || 0;
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = calculateTax(taxableAmount);
  const finalAmount = taxableAmount + taxAmount;

  const orderId = generateOrderId();

  try {
    let gatewayOrderId = null;
    let clientSecret = null;

    const orderData = {
      amount: finalAmount,
      currency: "INR",
      receipt: orderId,
      notes: {
        orderId,
        userId,
        courses: courseIds.join(","),
      },
      metadata: {
        orderId,
        userId,
        courses: courseIds.join(","),
      },
    };

    const gatewayOrder = await paymentService.createOrder(gateway, orderData);

    if (gateway === "RAZORPAY") {
      gatewayOrderId = gatewayOrder.id;
    } else if (gateway === "STRIPE") {
      gatewayOrderId = gatewayOrder.id;
      clientSecret = gatewayOrder.client_secret;
    }

    const payment = await prisma.payment.create({
      data: {
        amount: finalAmount,
        originalAmount: subtotal,
        discountAmount,
        tax: taxAmount,
        currency: "INR",
        status: "PENDING",
        method: "CREDIT_CARD",
        gateway,
        transactionId: gatewayOrderId,
        metadata: {
          orderId,
          courseIds,
          orderItems,
          billingAddress,
          couponCode: couponValidation?.coupon?.code,
        },
      },
    });

    if (couponValidation) {
      await prisma.couponUsage.create({
        data: {
          couponId: couponValidation.coupon.id,
          paymentId: payment.id,
          userId,
          discount: discountAmount,
        },
      });

      await prisma.coupon.update({
        where: { id: couponValidation.coupon.id },
        data: { usedCount: { increment: 1 } },
      });
    }

    await redisService.setJSON(
      `checkout:${orderId}`,
      {
        paymentId: payment.id,
        userId,
        courseIds,
        finalAmount,
      },
      { ex: 3600 }
    );

    res.status(200).json({
      success: true,
      message: "Checkout initiated successfully",
      data: {
        paymentId: payment.id,
        orderId,
        gatewayOrderId,
        clientSecret,
        amount: finalAmount,
        currency: "INR",
        orderItems,
        subtotal,
        discountAmount,
        taxAmount,
        gateway,
        razorpayKeyId:
          gateway === "RAZORPAY" ? process.env.RAZORPAY_KEY_ID : undefined,
        stripePublishableKey:
          gateway === "STRIPE" ? process.env.STRIPE_PUBLISHABLE_KEY : undefined,
      },
    });
  } catch (error) {
    console.error("Checkout initiation failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initiate checkout",
      error: error.message,
    });
  }
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const { paymentId, orderId, signature, gateway } = req.body;
  const userId = req.userAuthId;

  if (!paymentId || !orderId) {
    return res.status(400).json({
      success: false,
      message: "Payment ID and Order ID are required",
    });
  }

  const checkoutData = await redisService.getJSON(`checkout:${orderId}`);
  if (!checkoutData || checkoutData.userId !== userId) {
    return res.status(400).json({
      success: false,
      message: "Invalid checkout session",
    });
  }

  const payment = await prisma.payment.findUnique({
    where: { id: checkoutData.paymentId },
    include: { couponUsages: true },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment record not found",
    });
  }

  try {
    let isVerified = false;
    let paymentDetails = null;

    if (gateway === "RAZORPAY") {
      isVerified = paymentService.verifyRazorpayPayment({
        orderId,
        paymentId,
        signature,
      });

      if (isVerified) {
        paymentDetails = await paymentService.fetchPaymentDetails(
          gateway,
          paymentId
        );
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: "COMPLETED",
            method: paymentDetails.method?.toUpperCase() || "CREDIT_CARD",
            gatewayResponse: paymentDetails,
          },
        });
      }
    } else if (gateway === "STRIPE") {
      isVerified = await paymentService.verifyPayment(gateway, {
        paymentIntentId: paymentId,
      });

      if (isVerified) {
        paymentDetails = await paymentService.fetchPaymentDetails(
          gateway,
          paymentId
        );
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: "COMPLETED",
            method:
              paymentDetails.payment_method_types[0]?.toUpperCase() ||
              "CREDIT_CARD",
            gatewayResponse: paymentDetails,
          },
        });
      }
    }

    if (!isVerified) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });

      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    await processPayment(payment.id, checkoutData.courseIds, userId);

    await redisService.del(`checkout:${orderId}`);

    res.status(200).json({
      success: true,
      message: "Payment verified and processed successfully",
      data: {
        paymentId: payment.id,
        transactionId: paymentId,
        amount: payment.amount,
        status: "COMPLETED",
      },
    });
  } catch (error) {
    console.error("Payment verification failed:", error);

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED" },
    });

    res.status(500).json({
      success: false,
      message: "Payment verification failed",
      error: error.message,
    });
  }
});

const processPayment = async (paymentId, courseIds, userId) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { couponUsages: true },
  });

  const courses = await prisma.course.findMany({
    where: { id: { in: courseIds } },
    include: { instructor: true },
  });

  const enrollments = [];
  const earnings = [];

  for (const course of courses) {
    const enrollment = await prisma.enrollment.create({
      data: {
        studentId: userId,
        courseId: course.id,
        paymentId: payment.id,
        status: "ACTIVE",
        enrollmentSource: "PURCHASE",
        discountApplied: payment.discountAmount,
      },
    });

    enrollments.push(enrollment);

    await prisma.course.update({
      where: { id: course.id },
      data: {
        totalEnrollments: { increment: 1 },
        totalRevenue: {
          increment: parseFloat(course.discountPrice || course.price),
        },
      },
    });

    await prisma.instructor.update({
      where: { id: course.instructorId },
      data: {
        totalStudents: { increment: 1 },
        totalRevenue: {
          increment: parseFloat(course.discountPrice || course.price) * 0.7,
        },
      },
    });

    const instructorEarning =
      parseFloat(course.discountPrice || course.price) * 0.7;
    const platformFee = parseFloat(course.discountPrice || course.price) * 0.3;

    const earning = await prisma.earning.create({
      data: {
        amount: instructorEarning,
        commission: instructorEarning,
        platformFee: platformFee,
        instructorId: course.instructorId,
        paymentId: payment.id,
        status: "PENDING",
      },
    });

    earnings.push(earning);

    await notificationService.createNotification({
      userId: course.instructor.userId,
      type: "NEW_ENROLLMENT",
      title: "New Student Enrolled",
      message: `A new student has enrolled in your course "${course.title}"`,
      priority: "NORMAL",
      data: {
        courseId: course.id,
        courseName: course.title,
        studentId: userId,
        enrollmentId: enrollment.id,
        amount: parseFloat(course.discountPrice || course.price),
      },
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });

  await emailService.sendPurchaseConfirmation({
    email: user.email,
    firstName: user.firstName,
    amount: payment.amount,
    currency: payment.currency,
    transactionId: payment.transactionId,
    courseName:
      courses.length === 1 ? courses[0].title : `${courses.length} courses`,
    courseUrl:
      courses.length === 1
        ? `${process.env.FRONTEND_URL}/courses/${courses[0].slug}`
        : `${process.env.FRONTEND_URL}/my-learning`,
  });

  await notificationService.createNotification({
    userId,
    type: "PAYMENT_RECEIVED",
    title: "Purchase Successful",
    message: `Your purchase of ${courses.length} course(s) has been completed successfully`,
    priority: "HIGH",
    data: {
      paymentId: payment.id,
      amount: payment.amount,
      courses: courses.map((c) => ({ id: c.id, title: c.title })),
      enrollmentIds: enrollments.map((e) => e.id),
    },
  });

  await prisma.cartItem.deleteMany({
    where: {
      studentId: userId,
      courseId: { in: courseIds },
    },
  });
};

export const getPurchaseHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, gateway } = req.query;
  const userId = req.userAuthId;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status) where.status = status;
  if (gateway) where.gateway = gateway;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where: {
        ...where,
        enrollments: {
          some: { studentId: userId },
        },
      },
      include: {
        enrollments: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
                slug: true,
                thumbnail: true,
                instructor: {
                  include: {
                    user: { select: { firstName: true, lastName: true } },
                  },
                },
              },
            },
          },
        },
        couponUsages: {
          include: {
            coupon: { select: { code: true, type: true, value: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: parseInt(limit),
    }),
    prisma.payment.count({
      where: {
        ...where,
        enrollments: {
          some: { studentId: userId },
        },
      },
    }),
  ]);

  const formattedPayments = payments.map((payment) => ({
    id: payment.id,
    amount: payment.amount,
    originalAmount: payment.originalAmount,
    discountAmount: payment.discountAmount,
    tax: payment.tax,
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
    gateway: payment.gateway,
    transactionId: payment.transactionId,
    createdAt: payment.createdAt,
    refundAmount: payment.refundAmount,
    refundedAt: payment.refundedAt,
    invoiceUrl: payment.invoiceUrl,
    courses: payment.enrollments.map((enrollment) => ({
      id: enrollment.course.id,
      title: enrollment.course.title,
      slug: enrollment.course.slug,
      thumbnail: enrollment.course.thumbnail,
      instructor: `${enrollment.course.instructor.user.firstName} ${enrollment.course.instructor.user.lastName}`,
      enrollmentId: enrollment.id,
      enrollmentStatus: enrollment.status,
    })),
    coupon: payment.couponUsages[0]?.coupon || null,
  }));

  res.status(200).json({
    success: true,
    message: "Purchase history retrieved successfully",
    data: {
      payments: formattedPayments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasNext: skip + parseInt(limit) < total,
        hasPrev: parseInt(page) > 1,
      },
    },
  });
});

export const getPaymentDetails = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const userId = req.userAuthId;

  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      enrollments: {
        some: { studentId: userId },
      },
    },
    include: {
      enrollments: {
        include: {
          course: {
            include: {
              instructor: {
                include: {
                  user: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      },
      couponUsages: {
        include: {
          coupon: true,
        },
      },
    },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found",
    });
  }

  const formattedPayment = {
    id: payment.id,
    amount: payment.amount,
    originalAmount: payment.originalAmount,
    discountAmount: payment.discountAmount,
    tax: payment.tax,
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
    gateway: payment.gateway,
    transactionId: payment.transactionId,
    createdAt: payment.createdAt,
    refundAmount: payment.refundAmount,
    refundedAt: payment.refundedAt,
    refundReason: payment.refundReason,
    invoiceUrl: payment.invoiceUrl,
    metadata: payment.metadata,
    courses: payment.enrollments.map((enrollment) => ({
      id: enrollment.course.id,
      title: enrollment.course.title,
      slug: enrollment.course.slug,
      thumbnail: enrollment.course.thumbnail,
      price: enrollment.course.price,
      discountPrice: enrollment.course.discountPrice,
      instructor: {
        id: enrollment.course.instructor.id,
        name: `${enrollment.course.instructor.user.firstName} ${enrollment.course.instructor.user.lastName}`,
      },
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        progress: enrollment.progress,
        enrolledAt: enrollment.createdAt,
      },
    })),
    couponUsed: payment.couponUsages[0] || null,
    gatewayResponse: payment.gatewayResponse,
  };

  res.status(200).json({
    success: true,
    message: "Payment details retrieved successfully",
    data: formattedPayment,
  });
});

export const requestRefund = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { reason, description } = req.body;
  const userId = req.userAuthId;

  if (!reason) {
    return res.status(400).json({
      success: false,
      message: "Refund reason is required",
    });
  }

  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      status: "COMPLETED",
      enrollments: {
        some: {
          studentId: userId,
          status: { in: ["ACTIVE", "COMPLETED"] },
        },
      },
    },
    include: {
      enrollments: {
        include: {
          course: { select: { title: true } },
        },
      },
    },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found or not eligible for refund",
    });
  }

  const daysSincePurchase = Math.floor(
    (new Date() - payment.createdAt) / (1000 * 60 * 60 * 24)
  );
  if (daysSincePurchase > 30) {
    return res.status(400).json({
      success: false,
      message: "Refund period has expired (30 days)",
    });
  }

  if (payment.refundAmount && payment.refundAmount > 0) {
    return res.status(400).json({
      success: false,
      message: "Refund already processed for this payment",
    });
  }

  const updatedPayment = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      metadata: {
        ...payment.metadata,
        refundRequest: {
          reason,
          description,
          requestedAt: new Date(),
          status: "PENDING",
        },
      },
    },
  });

  await notificationService.createNotification({
    userId,
    type: "REFUND_REQUESTED",
    title: "Refund Request Submitted",
    message: "Your refund request has been submitted and is under review",
    priority: "NORMAL",
    data: {
      paymentId,
      reason,
      amount: payment.amount,
      courses: payment.enrollments.map((e) => e.course.title),
    },
  });

  res.status(200).json({
    success: true,
    message: "Refund request submitted successfully",
    data: {
      paymentId,
      requestStatus: "PENDING",
      amount: payment.amount,
      estimatedProcessingTime: "3-5 business days",
    },
  });
});

export const processRefund = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { action, adminNotes } = req.body;
  const adminId = req.userAuthId;

  if (!["APPROVE", "REJECT"].includes(action)) {
    return res.status(400).json({
      success: false,
      message: "Invalid action. Must be APPROVE or REJECT",
    });
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      enrollments: {
        include: {
          student: {
            include: {
              user: { select: { firstName: true, email: true } },
            },
          },
          course: { select: { title: true } },
        },
      },
    },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found",
    });
  }

  const refundRequest = payment.metadata?.refundRequest;
  if (!refundRequest || refundRequest.status !== "PENDING") {
    return res.status(400).json({
      success: false,
      message: "No pending refund request found",
    });
  }

  if (action === "REJECT") {
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        metadata: {
          ...payment.metadata,
          refundRequest: {
            ...refundRequest,
            status: "REJECTED",
            rejectedAt: new Date(),
            adminNotes,
            reviewedBy: adminId,
          },
        },
      },
    });

    const userId = payment.enrollments[0].student.user.id;
    await notificationService.createNotification({
      userId,
      type: "REFUND_REJECTED",
      title: "Refund Request Rejected",
      message: `Your refund request has been rejected. ${adminNotes || ""}`,
      priority: "HIGH",
      data: { paymentId, adminNotes },
    });

    return res.status(200).json({
      success: true,
      message: "Refund request rejected successfully",
    });
  }

  try {
    const refundResponse = await paymentService.createRefund(
      payment.gateway,
      payment.transactionId,
      {
        amount: parseFloat(payment.amount),
        notes: { reason: refundRequest.reason, adminNotes },
        metadata: { reason: refundRequest.reason, adminNotes },
      }
    );

    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: "REFUNDED",
        refundAmount: payment.amount,
        refundReason: refundRequest.reason,
        refundedAt: new Date(),
        gatewayResponse: {
          ...payment.gatewayResponse,
          refund: refundResponse,
        },
        metadata: {
          ...payment.metadata,
          refundRequest: {
            ...refundRequest,
            status: "APPROVED",
            processedAt: new Date(),
            adminNotes,
            reviewedBy: adminId,
          },
        },
      },
    });

    await prisma.enrollment.updateMany({
      where: { paymentId },
      data: { status: "REFUNDED" },
    });

    for (const enrollment of payment.enrollments) {
      await prisma.course.update({
        where: { id: enrollment.courseId },
        data: {
          totalEnrollments: { decrement: 1 },
          totalRevenue: { decrement: parseFloat(payment.amount) },
        },
      });
    }

    const userId = payment.enrollments[0].student.user.id;
    const userEmail = payment.enrollments[0].student.user.email;
    const userName = payment.enrollments[0].student.user.firstName;

    await emailService.sendRefundProcessed({
      email: userEmail,
      firstName: userName,
      amount: payment.amount,
      currency: payment.currency,
      refundId: refundResponse?.id || `REF_${Date.now()}`,
      courseName: payment.enrollments.map((e) => e.course.title).join(", "),
      reason: refundRequest.reason,
    });

    await notificationService.createNotification({
      userId,
      type: "REFUND_PROCESSED",
      title: "Refund Processed",
      message: "Your refund has been processed successfully",
      priority: "HIGH",
      data: {
        paymentId,
        refundAmount: payment.amount,
        refundId: refundResponse?.id,
        estimatedDelivery: "5-7 business days",
      },
    });

    res.status(200).json({
      success: true,
      message: "Refund processed successfully",
      data: {
        paymentId,
        refundAmount: payment.amount,
        refundId: refundResponse?.id,
        status: "PROCESSED",
      },
    });
  } catch (error) {
    console.error("Refund processing failed:", error);

    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        metadata: {
          ...payment.metadata,
          refundRequest: {
            ...refundRequest,
            status: "FAILED",
            failedAt: new Date(),
            error: error.message,
            reviewedBy: adminId,
          },
        },
      },
    });

    res.status(500).json({
      success: false,
      message: "Failed to process refund",
      error: error.message,
    });
  }
});

export const retryPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { gateway } = req.body;
  const userId = req.userAuthId;

  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      status: "FAILED",
      enrollments: {
        some: { studentId: userId },
      },
    },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Failed payment not found",
    });
  }

  const courseIds = payment.metadata?.courseIds;
  if (!courseIds) {
    return res.status(400).json({
      success: false,
      message: "Invalid payment data",
    });
  }

  const retryOrderId = generateOrderId();

  try {
    const orderData = {
      amount: parseFloat(payment.amount),
      currency: "INR",
      receipt: retryOrderId,
      notes: {
        orderId: retryOrderId,
        userId,
        originalPaymentId: paymentId,
        courses: courseIds.join(","),
      },
      metadata: {
        orderId: retryOrderId,
        userId,
        originalPaymentId: paymentId,
        courses: courseIds.join(","),
      },
    };

    const gatewayOrder = await paymentService.createOrder(gateway, orderData);

    let gatewayOrderId = null;
    let clientSecret = null;

    if (gateway === "RAZORPAY") {
      gatewayOrderId = gatewayOrder.id;
    } else if (gateway === "STRIPE") {
      gatewayOrderId = gatewayOrder.id;
      clientSecret = gatewayOrder.client_secret;
    }

    const newPayment = await prisma.payment.create({
      data: {
        amount: payment.amount,
        originalAmount: payment.originalAmount,
        discountAmount: payment.discountAmount,
        tax: payment.tax,
        currency: payment.currency,
        status: "PENDING",
        method: "CREDIT_CARD",
        gateway,
        transactionId: gatewayOrderId,
        metadata: {
          ...payment.metadata,
          retryOf: paymentId,
          orderId: retryOrderId,
        },
      },
    });

    await redisService.setJSON(
      `checkout:${retryOrderId}`,
      {
        paymentId: newPayment.id,
        userId,
        courseIds,
        finalAmount: parseFloat(payment.amount),
        isRetry: true,
      },
      { ex: 3600 }
    );

    res.status(200).json({
      success: true,
      message: "Payment retry initiated successfully",
      data: {
        paymentId: newPayment.id,
        orderId: retryOrderId,
        gatewayOrderId,
        clientSecret,
        amount: payment.amount,
        currency: payment.currency,
        gateway,
        razorpayKeyId:
          gateway === "RAZORPAY" ? process.env.RAZORPAY_KEY_ID : undefined,
        stripePublishableKey:
          gateway === "STRIPE" ? process.env.STRIPE_PUBLISHABLE_KEY : undefined,
      },
    });
  } catch (error) {
    console.error("Payment retry failed:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retry payment",
      error: error.message,
    });
  }
});

export const cancelPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const userId = req.userAuthId;

  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      status: "PENDING",
      enrollments: {
        some: { studentId: userId },
      },
    },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Pending payment not found",
    });
  }

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "CANCELLED" },
  });

  await prisma.couponUsage.deleteMany({
    where: { paymentId },
  });

  if (payment.metadata?.couponCode) {
    const coupon = await prisma.coupon.findFirst({
      where: { code: payment.metadata.couponCode },
    });
    if (coupon) {
      await prisma.coupon.update({
        where: { id: coupon.id },
        data: { usedCount: { decrement: 1 } },
      });
    }
  }

  res.status(200).json({
    success: true,
    message: "Payment cancelled successfully",
    data: { paymentId, status: "CANCELLED" },
  });
});

export const getRefundRequests = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const payments = await prisma.payment.findMany({
    where: {
      metadata: {
        path: ["refundRequest", "status"],
        equals: status || "PENDING",
      },
    },
    include: {
      enrollments: {
        include: {
          student: {
            include: {
              user: {
                select: { firstName: true, lastName: true, email: true },
              },
            },
          },
          course: { select: { title: true, slug: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    skip,
    take: parseInt(limit),
  });

  const total = await prisma.payment.count({
    where: {
      metadata: {
        path: ["refundRequest", "status"],
        equals: status || "PENDING",
      },
    },
  });

  const formattedRequests = payments.map((payment) => ({
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    transactionId: payment.transactionId,
    gateway: payment.gateway,
    purchaseDate: payment.createdAt,
    refundRequest: payment.metadata?.refundRequest,
    student: {
      id: payment.enrollments[0]?.student.id,
      name: `${payment.enrollments[0]?.student.user.firstName} ${payment.enrollments[0]?.student.user.lastName}`,
      email: payment.enrollments[0]?.student.user.email,
    },
    courses: payment.enrollments.map((e) => ({
      title: e.course.title,
      slug: e.course.slug,
    })),
  }));

  res.status(200).json({
    success: true,
    message: "Refund requests retrieved successfully",
    data: {
      requests: formattedRequests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasNext: skip + parseInt(limit) < total,
        hasPrev: parseInt(page) > 1,
      },
    },
  });
});

export const getPaymentAnalytics = asyncHandler(async (req, res) => {
  const { period = "month", gateway, status } = req.query;

  let dateFilter = {};
  const now = new Date();

  switch (period) {
    case "day":
      dateFilter = {
        gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      };
      break;
    case "week":
      const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
      dateFilter = { gte: weekStart };
      break;
    case "month":
      dateFilter = {
        gte: new Date(now.getFullYear(), now.getMonth(), 1),
      };
      break;
    case "year":
      dateFilter = {
        gte: new Date(now.getFullYear(), 0, 1),
      };
      break;
  }

  const where = {
    createdAt: dateFilter,
    ...(gateway && { gateway }),
    ...(status && { status }),
  };

  const [
    totalPayments,
    successfulPayments,
    failedPayments,
    refundedPayments,
    totalRevenue,
    paymentsByGateway,
    paymentsByMethod,
    recentPayments,
  ] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.count({ where: { ...where, status: "COMPLETED" } }),
    prisma.payment.count({ where: { ...where, status: "FAILED" } }),
    prisma.payment.count({ where: { ...where, status: "REFUNDED" } }),
    prisma.payment.aggregate({
      where: { ...where, status: "COMPLETED" },
      _sum: { amount: true },
    }),
    prisma.payment.groupBy({
      by: ["gateway"],
      where: { ...where, status: "COMPLETED" },
      _count: { gateway: true },
      _sum: { amount: true },
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: { ...where, status: "COMPLETED" },
      _count: { method: true },
    }),
    prisma.payment.findMany({
      where: { ...where, status: "COMPLETED" },
      include: {
        enrollments: {
          include: {
            course: { select: { title: true } },
            student: {
              include: {
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const successRate =
    totalPayments > 0 ? (successfulPayments / totalPayments) * 100 : 0;
  const failureRate =
    totalPayments > 0 ? (failedPayments / totalPayments) * 100 : 0;

  res.status(200).json({
    success: true,
    message: "Payment analytics retrieved successfully",
    data: {
      summary: {
        totalPayments,
        successfulPayments,
        failedPayments,
        refundedPayments,
        totalRevenue: totalRevenue._sum.amount || 0,
        successRate: Math.round(successRate * 100) / 100,
        failureRate: Math.round(failureRate * 100) / 100,
      },
      breakdown: {
        byGateway: paymentsByGateway.map((item) => ({
          gateway: item.gateway,
          count: item._count.gateway,
          revenue: item._sum.amount || 0,
        })),
        byMethod: paymentsByMethod.map((item) => ({
          method: item.method,
          count: item._count.method,
        })),
      },
      recentPayments: recentPayments.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        gateway: payment.gateway,
        method: payment.method,
        createdAt: payment.createdAt,
        student: `${payment.enrollments[0]?.student.user.firstName} ${payment.enrollments[0]?.student.user.lastName}`,
        courses: payment.enrollments.map((e) => e.course.title),
      })),
      period,
    },
  });
});
