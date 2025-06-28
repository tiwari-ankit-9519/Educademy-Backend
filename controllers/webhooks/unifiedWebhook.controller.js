import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import asyncHandler from "express-async-handler";
import paymentService from "../../utils/paymentService.js";
import emailService from "../../utils/emailService.js";
import notificationService from "../../utils/notificationservice.js";
import redisService from "../../utils/redis.js";

const prisma = new PrismaClient();

const detectPaymentGateway = (req) => {
  const stripeSignature = req.headers["stripe-signature"];
  const razorpaySignature = req.headers["x-razorpay-signature"];
  const paypalSignature = req.headers["paypal-transmission-id"];

  if (stripeSignature) return "STRIPE";
  if (razorpaySignature) return "RAZORPAY";
  if (paypalSignature) return "PAYPAL";

  return null;
};

const verifyStripeSignature = (body, signature, secret) => {
  try {
    const stripe = paymentService.getStripe();
    return stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    console.error("Stripe signature verification failed:", error);
    return null;
  }
};

const verifyRazorpaySignature = (body, signature, secret) => {
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");
    return expectedSignature === signature;
  } catch (error) {
    console.error("Razorpay signature verification failed:", error);
    return false;
  }
};

const verifyPayPalSignature = (body, headers, secret) => {
  try {
    return true;
  } catch (error) {
    console.error("PayPal signature verification failed:", error);
    return false;
  }
};

const processSuccessfulPayment = async (
  paymentId,
  courseIds,
  userId,
  socketManager
) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { couponUsages: true },
    });

    if (!payment) {
      console.error(`Payment ${paymentId} not found`);
      return;
    }

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
      const platformFee =
        parseFloat(course.discountPrice || course.price) * 0.3;

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

    if (user) {
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

      if (socketManager) {
        socketManager.notifyPaymentSuccess(userId, {
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          courses: courses.map((c) => ({ id: c.id, title: c.title })),
          enrollmentIds: enrollments.map((e) => e.id),
        });
      }
    }

    await prisma.cartItem.deleteMany({
      where: {
        studentId: userId,
        courseId: { in: courseIds },
      },
    });

    const orderId = payment.metadata?.orderId;
    if (orderId) {
      await redisService.del(`checkout:${orderId}`);
    }
  } catch (error) {
    console.error("Error processing successful payment:", error);
  }
};

const processFailedPayment = async (payment, reason, socketManager) => {
  try {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED" },
    });

    if (payment.metadata?.userId) {
      await notificationService.createNotification({
        userId: payment.metadata.userId,
        type: "PAYMENT_FAILED",
        title: "Payment Failed",
        message: `Your payment of ${payment.currency === "INR" ? "₹" : "$"}${
          payment.amount
        } has failed. Please try again.`,
        priority: "HIGH",
        data: {
          paymentId: payment.id,
          amount: payment.amount,
          reason: reason || "Payment processing failed",
        },
      });

      if (socketManager) {
        socketManager.notifyPaymentFailed(payment.metadata.userId, {
          paymentId: payment.id,
          reason: reason || "Payment processing failed",
          amount: payment.amount,
        });
      }
    }

    if (payment.couponUsages?.length > 0) {
      await prisma.couponUsage.deleteMany({
        where: { paymentId: payment.id },
      });

      const couponCode = payment.metadata?.couponCode;
      if (couponCode) {
        const coupon = await prisma.coupon.findFirst({
          where: { code: couponCode },
        });
        if (coupon) {
          await prisma.coupon.update({
            where: { id: coupon.id },
            data: { usedCount: { decrement: 1 } },
          });
        }
      }
    }
  } catch (error) {
    console.error("Error processing failed payment:", error);
  }
};

const handleStripeWebhook = async (event, socketManager) => {
  try {
    console.log(`Processing Stripe event: ${event.type}`);

    switch (event.type) {
      case "payment_intent.succeeded":
        await handleStripePaymentSuccess(event.data.object, socketManager);
        break;

      case "checkout.session.completed":
        await handleStripeCheckoutCompleted(event.data.object, socketManager);
        break;

      case "payment_intent.payment_failed":
        await handleStripePaymentFailed(event.data.object, socketManager);
        break;

      case "charge.dispute.created":
        await handleStripeDispute(event.data.object);
        break;

      case "invoice.payment_succeeded":
        console.log("Stripe subscription payment succeeded");
        break;

      case "customer.subscription.deleted":
        console.log("Stripe subscription cancelled");
        break;

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }
  } catch (error) {
    console.error("Error handling Stripe webhook:", error);
    throw error;
  }
};

const handleStripePaymentSuccess = async (paymentIntent, socketManager) => {
  const payment = await prisma.payment.findFirst({
    where: {
      transactionId: paymentIntent.id,
      status: "PENDING",
    },
  });

  if (!payment) {
    console.log(
      `Payment not found for Stripe payment intent: ${paymentIntent.id}`
    );
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "COMPLETED",
      method:
        paymentIntent.payment_method_types?.[0]?.toUpperCase() || "CREDIT_CARD",
      gatewayResponse: paymentIntent,
    },
  });

  const courseIds = payment.metadata?.courseIds;
  const userId = payment.metadata?.userId || paymentIntent.metadata?.userId;

  if (courseIds && Array.isArray(courseIds) && userId) {
    await processSuccessfulPayment(
      payment.id,
      courseIds,
      userId,
      socketManager
    );
  }
};

const handleStripeCheckoutCompleted = async (session, socketManager) => {
  const payment = await prisma.payment.findFirst({
    where: {
      transactionId: session.payment_intent,
      status: "PENDING",
    },
  });

  if (!payment) {
    console.log(`Payment not found for Stripe session: ${session.id}`);
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "COMPLETED",
      gatewayResponse: session,
    },
  });

  const courseIds = payment.metadata?.courseIds;
  const userId = payment.metadata?.userId || session.metadata?.userId;

  if (courseIds && Array.isArray(courseIds) && userId) {
    await processSuccessfulPayment(
      payment.id,
      courseIds,
      userId,
      socketManager
    );
  }
};

const handleStripePaymentFailed = async (paymentIntent, socketManager) => {
  const payment = await prisma.payment.findFirst({
    where: {
      transactionId: paymentIntent.id,
      status: "PENDING",
    },
  });

  if (!payment) {
    console.log(
      `Payment not found for failed Stripe payment: ${paymentIntent.id}`
    );
    return;
  }

  const reason = paymentIntent.last_payment_error?.message || "Payment failed";
  await processFailedPayment(payment, reason, socketManager);
};

const handleStripeDispute = async (charge) => {
  const payment = await prisma.payment.findFirst({
    where: { transactionId: charge.payment_intent },
  });

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        metadata: {
          ...payment.metadata,
          dispute: {
            id: charge.id,
            amount: charge.amount,
            currency: charge.currency,
            reason: charge.outcome?.reason,
            status: charge.status,
            createdAt: new Date(),
          },
        },
      },
    });
  }
};

const handleRazorpayWebhook = async (body, socketManager) => {
  try {
    const { event, payload } = JSON.parse(body);
    console.log(`Processing Razorpay event: ${event}`);

    switch (event) {
      case "payment.captured":
        await handleRazorpayPaymentCaptured(
          payload.payment.entity,
          socketManager
        );
        break;

      case "payment.failed":
        await handleRazorpayPaymentFailed(
          payload.payment.entity,
          socketManager
        );
        break;

      case "order.paid":
        await handleRazorpayOrderPaid(
          payload.order.entity,
          payload.payment.entity,
          socketManager
        );
        break;

      case "refund.created":
        await handleRazorpayRefundCreated(payload.refund.entity);
        break;

      case "refund.processed":
        await handleRazorpayRefundProcessed(payload.refund.entity);
        break;

      case "payment.dispute.created":
        await handleRazorpayDispute(payload.dispute.entity);
        break;

      default:
        console.log(`Unhandled Razorpay event: ${event}`);
    }
  } catch (error) {
    console.error("Error handling Razorpay webhook:", error);
    throw error;
  }
};

const handleRazorpayPaymentCaptured = async (
  razorpayPayment,
  socketManager
) => {
  const payment = await prisma.payment.findFirst({
    where: {
      transactionId: razorpayPayment.order_id,
      status: "PENDING",
    },
  });

  if (!payment) {
    console.log(
      `Payment not found for Razorpay order: ${razorpayPayment.order_id}`
    );
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "COMPLETED",
      method: razorpayPayment.method?.toUpperCase() || "CREDIT_CARD",
      gatewayResponse: razorpayPayment,
    },
  });

  const courseIds = payment.metadata?.courseIds;
  const userId = payment.metadata?.userId || razorpayPayment.notes?.userId;

  if (courseIds && Array.isArray(courseIds) && userId) {
    await processSuccessfulPayment(
      payment.id,
      courseIds,
      userId,
      socketManager
    );
  }
};

const handleRazorpayPaymentFailed = async (razorpayPayment, socketManager) => {
  const payment = await prisma.payment.findFirst({
    where: {
      transactionId: razorpayPayment.order_id,
      status: "PENDING",
    },
  });

  if (!payment) {
    console.log(
      `Payment not found for failed Razorpay payment: ${razorpayPayment.order_id}`
    );
    return;
  }

  const reason = razorpayPayment.error_description || "Payment failed";
  await processFailedPayment(payment, reason, socketManager);
};

const handleRazorpayOrderPaid = async (
  razorpayOrder,
  razorpayPayment,
  socketManager
) => {
  const payment = await prisma.payment.findFirst({
    where: {
      transactionId: razorpayOrder.id,
      status: "PENDING",
    },
  });

  if (!payment) {
    console.log(`Payment not found for Razorpay order: ${razorpayOrder.id}`);
    return;
  }

  if (payment.status !== "COMPLETED") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "COMPLETED",
        method: razorpayPayment.method?.toUpperCase() || "CREDIT_CARD",
        gatewayResponse: { order: razorpayOrder, payment: razorpayPayment },
      },
    });

    const courseIds = payment.metadata?.courseIds;
    const userId = payment.metadata?.userId || razorpayOrder.notes?.userId;

    if (courseIds && Array.isArray(courseIds) && userId) {
      await processSuccessfulPayment(
        payment.id,
        courseIds,
        userId,
        socketManager
      );
    }
  }
};

const handleRazorpayRefundCreated = async (razorpayRefund) => {
  const payment = await prisma.payment.findFirst({
    where: { transactionId: razorpayRefund.payment_id },
  });

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "REFUNDED",
        refundAmount: razorpayRefund.amount / 100,
        refundedAt: new Date(razorpayRefund.created_at * 1000),
        gatewayResponse: {
          ...payment.gatewayResponse,
          refund: razorpayRefund,
        },
      },
    });

    await prisma.enrollment.updateMany({
      where: { paymentId: payment.id },
      data: { status: "REFUNDED" },
    });
  }
};

const handleRazorpayRefundProcessed = async (razorpayRefund) => {
  const payment = await prisma.payment.findFirst({
    where: { transactionId: razorpayRefund.payment_id },
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

  if (payment && payment.enrollments.length > 0) {
    const user = payment.enrollments[0].student.user;

    await emailService.sendRefundProcessed({
      email: user.email,
      firstName: user.firstName,
      amount: razorpayRefund.amount / 100,
      currency: "INR",
      refundId: razorpayRefund.id,
      courseName: payment.enrollments.map((e) => e.course.title).join(", "),
      reason: payment.metadata?.refundRequest?.reason || "Refund processed",
    });
  }
};

const handleRazorpayDispute = async (razorpayDispute) => {
  const payment = await prisma.payment.findFirst({
    where: { transactionId: razorpayDispute.payment_id },
  });

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        metadata: {
          ...payment.metadata,
          dispute: {
            id: razorpayDispute.id,
            amount: razorpayDispute.amount,
            currency: razorpayDispute.currency,
            reason: razorpayDispute.reason_description,
            status: razorpayDispute.status,
            createdAt: new Date(razorpayDispute.created_at * 1000),
          },
        },
      },
    });
  }
};

const handlePayPalWebhook = async (body, socketManager) => {
  try {
    const event = JSON.parse(body);
    console.log(`Processing PayPal event: ${event.event_type}`);

    switch (event.event_type) {
      case "PAYMENT.CAPTURE.COMPLETED":
        await handlePayPalPaymentCompleted(event.resource, socketManager);
        break;

      case "PAYMENT.CAPTURE.DENIED":
        await handlePayPalPaymentFailed(event.resource, socketManager);
        break;

      case "PAYMENT.CAPTURE.REFUNDED":
        await handlePayPalRefund(event.resource);
        break;

      default:
        console.log(`Unhandled PayPal event: ${event.event_type}`);
    }
  } catch (error) {
    console.error("Error handling PayPal webhook:", error);
    throw error;
  }
};

const handlePayPalPaymentCompleted = async (resource, socketManager) => {
  console.log("PayPal payment completed - implementation pending");
};

const handlePayPalPaymentFailed = async (resource, socketManager) => {
  console.log("PayPal payment failed - implementation pending");
};

const handlePayPalRefund = async (resource) => {
  console.log("PayPal refund - implementation pending");
};

export const handleUnifiedWebhook = asyncHandler(async (req, res) => {
  try {
    const gateway = detectPaymentGateway(req);
    const socketManager = req.app.get("socketManager");

    if (!gateway) {
      console.error("Could not detect payment gateway");
      return res.status(400).json({
        success: false,
        message: "Could not detect payment gateway",
      });
    }

    console.log(`Processing ${gateway} webhook`);

    let isVerified = false;
    let event = null;

    switch (gateway) {
      case "STRIPE":
        const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripeSecret) {
          return res.status(500).json({
            success: false,
            message: "Stripe webhook secret not configured",
          });
        }

        event = verifyStripeSignature(
          req.body,
          req.headers["stripe-signature"],
          stripeSecret
        );
        isVerified = !!event;

        if (isVerified) {
          await handleStripeWebhook(event, socketManager);
        }
        break;

      case "RAZORPAY":
        const razorpaySecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!razorpaySecret) {
          return res.status(500).json({
            success: false,
            message: "Razorpay webhook secret not configured",
          });
        }

        isVerified = verifyRazorpaySignature(
          req.body,
          req.headers["x-razorpay-signature"],
          razorpaySecret
        );

        if (isVerified) {
          await handleRazorpayWebhook(req.body, socketManager);
        }
        break;

      case "PAYPAL":
        const paypalSecret = process.env.PAYPAL_WEBHOOK_SECRET;
        if (!paypalSecret) {
          return res.status(500).json({
            success: false,
            message: "PayPal webhook secret not configured",
          });
        }

        isVerified = verifyPayPalSignature(req.body, req.headers, paypalSecret);

        if (isVerified) {
          await handlePayPalWebhook(req.body, socketManager);
        }
        break;
    }

    if (!isVerified) {
      console.error(`${gateway} signature verification failed`);
      return res.status(400).json({
        success: false,
        message: "Signature verification failed",
      });
    }

    res.status(200).json({
      success: true,
      message: `${gateway} webhook processed successfully`,
      gateway,
    });
  } catch (error) {
    console.error("Unified webhook processing error:", error);
    res.status(500).json({
      success: false,
      message: "Webhook processing failed",
      error: error.message,
    });
  }
});

export const getWebhookStatus = asyncHandler(async (req, res) => {
  const availableGateways = paymentService.getAvailableGateways();

  res.status(200).json({
    success: true,
    message: "Unified webhook endpoint is active",
    supportedGateways: availableGateways,
    webhookUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
    timestamp: new Date().toISOString(),
  });
});

export const testWebhook = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({
      success: false,
      message: "Test endpoint not available in production",
    });
  }

  const { gateway = "stripe" } = req.query;
  const socketManager = req.app.get("socketManager");

  let testPayload;

  switch (gateway.toUpperCase()) {
    case "STRIPE":
      testPayload = {
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_test123",
            amount: 5000,
            currency: "usd",
            status: "succeeded",
            metadata: { userId: "test_user_id" },
          },
        },
      };
      req.headers["stripe-signature"] = "test_signature";
      break;

    case "RAZORPAY":
      testPayload = {
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_test123",
              order_id: "order_test123",
              amount: 50000,
              currency: "INR",
              status: "captured",
              method: "card",
              notes: { userId: "test_user_id" },
            },
          },
        },
      };
      req.headers["x-razorpay-signature"] = "test_signature";
      break;

    case "PAYPAL":
      testPayload = {
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "test123",
          amount: { value: "50.00", currency_code: "USD" },
          status: "COMPLETED",
        },
      };
      req.headers["paypal-transmission-id"] = "test_signature";
      break;

    default:
      return res.status(400).json({
        success: false,
        message: "Invalid gateway for testing",
      });
  }

  req.body = Buffer.from(JSON.stringify(testPayload));

  console.log(`Test ${gateway} webhook payload:`, testPayload);

  res.status(200).json({
    success: true,
    message: `Test ${gateway} webhook data received`,
    gateway,
    payload: testPayload,
  });
});
