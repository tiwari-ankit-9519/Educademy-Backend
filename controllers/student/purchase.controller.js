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

const createPaymentLink = async (gateway, orderData) => {
  if (gateway === "RAZORPAY") {
    const razorpayAuth = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString("base64");

    const paymentLinkData = {
      amount: Math.round(orderData.amount * 100),
      currency: orderData.currency,
      accept_partial: false,
      description: orderData.description,
      notify: {
        sms: false,
        email: false,
      },
      reminder_enable: false,
      notes: orderData.notes,
      callback_url: orderData.callback_url,
      callback_method: orderData.callback_method,
      expire_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    };

    if (orderData.customer && orderData.customer.email) {
      paymentLinkData.customer = {};
      if (orderData.customer.name)
        paymentLinkData.customer.name = orderData.customer.name;
      if (orderData.customer.email)
        paymentLinkData.customer.email = orderData.customer.email;
      if (orderData.customer.contact)
        paymentLinkData.customer.contact = orderData.customer.contact;

      paymentLinkData.notify = {
        sms: !!orderData.customer.contact,
        email: !!orderData.customer.email,
      };
      paymentLinkData.reminder_enable = true;
    }

    const response = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${razorpayAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentLinkData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        `Razorpay Payment Link creation failed: ${
          error.error?.description || "Unknown error"
        }`
      );
    }

    return await response.json();
  }

  if (gateway === "STRIPE") {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: orderData.currency.toLowerCase(),
            product_data: {
              name: orderData.description || "Course Purchase",
            },
            unit_amount: Math.round(orderData.amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&order_id=${orderData.receipt}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancel?order_id=${orderData.receipt}`,
      metadata: orderData.metadata,
      client_reference_id: orderData.receipt,
    });

    return {
      id: session.id,
      url: session.url,
      client_secret: session.client_secret,
    };
  }

  if (gateway === "CASHFREE") {
    const cashfreeAuth = Buffer.from(
      `${process.env.CASHFREE_APP_ID}:${process.env.CASHFREE_SECRET_KEY}`
    ).toString("base64");

    const cashfreeData = {
      order_id: orderData.receipt,
      order_amount: orderData.amount,
      order_currency: orderData.currency,
      customer_details: {
        customer_id: orderData.notes.userId,
        customer_email: orderData.customer?.email || "customer@example.com",
        customer_phone: orderData.customer?.contact || "9999999999",
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/payment/callback?order_id=${orderData.receipt}`,
        notify_url: `${process.env.BACKEND_URL}/api/payment/webhook/cashfree`,
      },
      order_note: orderData.description,
    };

    const response = await fetch(`${process.env.CASHFREE_BASE_URL}/pg/orders`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${cashfreeAuth}`,
        "Content-Type": "application/json",
        "x-api-version": "2022-09-01",
      },
      body: JSON.stringify(cashfreeData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        `Cashfree order creation failed: ${error.message || "Unknown error"}`
      );
    }

    const result = await response.json();
    return {
      id: result.order_id,
      order_id: result.order_id,
      payment_session_id: result.payment_session_id,
      payment_link: result.payment_link,
    };
  }

  if (gateway === "PAYU") {
    const crypto = require("crypto");

    const txnid = `TXN_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const amount = orderData.amount;
    const productinfo = orderData.description || "Course Purchase";
    const firstname = orderData.customer?.name || "Customer";
    const email = orderData.customer?.email || "customer@example.com";
    const phone = orderData.customer?.contact || "9999999999";
    const surl = `${process.env.FRONTEND_URL}/payment/success?order_id=${orderData.receipt}`;
    const furl = `${process.env.FRONTEND_URL}/payment/failure?order_id=${orderData.receipt}`;

    const hashString = `${process.env.PAYU_KEY}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||||${process.env.PAYU_SALT}`;
    const hash = crypto.createHash("sha512").update(hashString).digest("hex");

    const payuData = {
      key: process.env.PAYU_KEY,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      phone,
      surl,
      furl,
      hash,
      service_provider: "payu_paisa",
    };

    const formData = new URLSearchParams(payuData);
    const paymentUrl = `${process.env.PAYU_BASE_URL}/_payment`;

    return {
      id: txnid,
      txnid,
      hash,
      payment_url: paymentUrl,
      form_data: payuData,
    };
  }

  if (gateway === "PAYPAL") {
    const paypalAuth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString("base64");

    const tokenResponse = await fetch(
      `${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${paypalAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      }
    );

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: orderData.receipt,
          amount: {
            currency_code:
              orderData.currency === "INR" ? "USD" : orderData.currency,
            value: (orderData.amount / 80).toFixed(2),
          },
          description: orderData.description || "Course Purchase",
        },
      ],
      application_context: {
        return_url: `${process.env.FRONTEND_URL}/payment/success?order_id=${orderData.receipt}`,
        cancel_url: `${process.env.FRONTEND_URL}/payment/cancel?order_id=${orderData.receipt}`,
        brand_name: "Your Learning Platform",
        locale: "en-US",
        landing_page: "BILLING",
        user_action: "PAY_NOW",
      },
    };

    const orderResponse = await fetch(
      `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderPayload),
      }
    );

    if (!orderResponse.ok) {
      const error = await orderResponse.json();
      throw new Error(
        `PayPal order creation failed: ${error.message || "Unknown error"}`
      );
    }

    return await orderResponse.json();
  }

  throw new Error(`Unsupported gateway: ${gateway}`);
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

  const [courses, existingEnrollments] = await Promise.all([
    prisma.course.findMany({
      where: {
        id: { in: courseIds },
        status: "PUBLISHED",
      },
      select: {
        id: true,
        title: true,
        price: true,
        discountPrice: true,
        instructor: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    }),
    prisma.enrollment.findMany({
      where: {
        studentId: userId,
        courseId: { in: courseIds },
        status: { in: ["ACTIVE", "COMPLETED"] },
      },
      select: { courseId: true },
    }),
  ]);

  if (courses.length !== courseIds.length) {
    return res.status(400).json({
      success: false,
      message: "One or more courses not found or not available",
    });
  }

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
    let gatewayOrder;
    let checkoutUrl = null;
    let clientSecret = null;
    let gatewayConfig = {};

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
        orderItems,
      },
      description: `Course Purchase - ${orderItems
        .map((item) => item.title)
        .join(", ")}`,
      customer: {
        email: req.userEmail,
        contact: req.userPhone,
        name: req.userName,
      },
      notify: {
        sms: true,
        email: true,
      },
      reminder_enable: true,
      callback_url: `${process.env.FRONTEND_URL}/payment/callback`,
      callback_method: "get",
    };

    gatewayOrder = await createPaymentLink(gateway, orderData);

    if (gateway === "RAZORPAY") {
      checkoutUrl = gatewayOrder.short_url;
      gatewayConfig = {
        paymentLinkId: gatewayOrder.id,
        shortUrl: gatewayOrder.short_url,
      };
    } else if (gateway === "STRIPE") {
      checkoutUrl = gatewayOrder.url;
      gatewayConfig = {
        sessionId: gatewayOrder.id,
        checkoutUrl: gatewayOrder.url,
      };
    } else if (gateway === "CASHFREE") {
      checkoutUrl = gatewayOrder.payment_link;
      gatewayConfig = {
        orderId: gatewayOrder.order_id,
        paymentSessionId: gatewayOrder.payment_session_id,
      };
    } else if (gateway === "PAYU") {
      checkoutUrl = gatewayOrder.payment_url;
      gatewayConfig = {
        key: process.env.PAYU_KEY,
        txnid: gatewayOrder.txnid,
        hash: gatewayOrder.hash,
        formData: gatewayOrder.form_data,
      };
    } else if (gateway === "PAYPAL") {
      checkoutUrl = gatewayOrder.links?.find(
        (link) => link.rel === "approve"
      )?.href;
      gatewayConfig = {
        orderId: gatewayOrder.id,
        clientId: process.env.PAYPAL_CLIENT_ID,
      };
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
        transactionId: gatewayOrder.id,
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
      await Promise.all([
        prisma.couponUsage.create({
          data: {
            couponId: couponValidation.coupon.id,
            paymentId: payment.id,
            userId,
            discount: discountAmount,
          },
        }),
        prisma.coupon.update({
          where: { id: couponValidation.coupon.id },
          data: { usedCount: { increment: 1 } },
        }),
      ]);
    }

    await redisService.setJSON(
      `checkout:${orderId}`,
      {
        paymentId: payment.id,
        gatewayOrderId: gatewayOrder.id,
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
        gatewayOrderId: gatewayOrder.id,
        checkoutUrl,
        clientSecret,
        amount: finalAmount,
        currency: "INR",
        orderItems,
        subtotal,
        discountAmount,
        taxAmount,
        gateway,
        gatewayConfig,
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
  const { paymentId, gatewayOrderId, signature, orderId, gateway, payerId } =
    req.body;
  const userId = req.userAuthId;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required",
    });
  }

  if (gateway === "RAZORPAY" && (!paymentId || !gatewayOrderId || !signature)) {
    return res.status(400).json({
      success: false,
      message: "Payment ID, order ID, and signature are required for Razorpay",
    });
  }

  if (gateway === "STRIPE" && !paymentId) {
    return res.status(400).json({
      success: false,
      message: "Payment Intent ID is required for Stripe",
    });
  }

  if (gateway === "CASHFREE" && (!paymentId || !signature)) {
    return res.status(400).json({
      success: false,
      message: "Payment ID and signature are required for Cashfree",
    });
  }

  if (gateway === "PAYU" && (!paymentId || !signature)) {
    return res.status(400).json({
      success: false,
      message: "Transaction ID and hash are required for PayU",
    });
  }

  if (gateway === "PAYPAL" && (!paymentId || !payerId)) {
    return res.status(400).json({
      success: false,
      message: "Payment ID and Payer ID are required for PayPal",
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
    select: {
      id: true,
      amount: true,
      status: true,
      transactionId: true,
      couponUsages: {
        select: { id: true },
      },
    },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment record not found",
    });
  }

  if (payment.status === "COMPLETED") {
    return res.status(400).json({
      success: false,
      message: "Payment already verified",
    });
  }

  const getPaymentMethod = (gateway, paymentDetails) => {
    if (gateway === "RAZORPAY") {
      const method = paymentDetails?.method?.toLowerCase();
      switch (method) {
        case "card":
          return paymentDetails?.card?.type === "credit"
            ? "CREDIT_CARD"
            : "DEBIT_CARD";
        case "upi":
          return "UPI";
        case "netbanking":
          return "NET_BANKING";
        case "wallet":
          return "WALLET";
        case "emi":
          return "EMI";
        case "bank_transfer":
          return "BANK_TRANSFER";
        default:
          return "UPI";
      }
    } else if (gateway === "STRIPE") {
      const methodType =
        paymentDetails?.payment_method_types?.[0]?.toLowerCase();
      switch (methodType) {
        case "card":
          return "CREDIT_CARD";
        case "upi":
          return "UPI";
        case "bank_transfer":
          return "BANK_TRANSFER";
        default:
          return "CREDIT_CARD";
      }
    } else if (gateway === "CASHFREE") {
      const method = paymentDetails?.payment_method?.toLowerCase();
      switch (method) {
        case "card":
          return "CREDIT_CARD";
        case "upi":
          return "UPI";
        case "netbanking":
          return "NET_BANKING";
        case "wallet":
          return "WALLET";
        case "bank_transfer":
          return "BANK_TRANSFER";
        default:
          return "UPI";
      }
    } else if (gateway === "PAYU") {
      const mode = paymentDetails?.mode?.toLowerCase();
      switch (mode) {
        case "cc":
        case "dc":
        case "creditcard":
        case "debitcard":
          return mode === "cc" || mode === "creditcard"
            ? "CREDIT_CARD"
            : "DEBIT_CARD";
        case "upi":
          return "UPI";
        case "nb":
        case "netbanking":
          return "NET_BANKING";
        case "wallet":
          return "WALLET";
        case "emi":
          return "EMI";
        case "banktransfer":
          return "BANK_TRANSFER";
        default:
          return "CREDIT_CARD";
      }
    } else if (gateway === "PAYPAL") {
      return "CREDIT_CARD";
    }
    return "CREDIT_CARD";
  };

  try {
    let isVerified = false;
    let paymentDetails = null;
    let verificationData = {};

    if (gateway === "RAZORPAY") {
      if (checkoutData.gatewayOrderId !== gatewayOrderId) {
        return res.status(400).json({
          success: false,
          message: "Order ID mismatch",
        });
      }

      verificationData = {
        orderId: gatewayOrderId,
        paymentId: paymentId,
        signature: signature,
      };

      isVerified = paymentService.verifyRazorpayPayment(verificationData);
    } else if (gateway === "STRIPE") {
      verificationData = {
        paymentIntentId: paymentId,
      };

      isVerified = await paymentService.verifyPayment(
        gateway,
        verificationData
      );
    } else if (gateway === "CASHFREE") {
      verificationData = {
        orderId: checkoutData.gatewayOrderId,
        paymentId: paymentId,
        signature: signature,
      };

      isVerified = await paymentService.verifyPayment(
        gateway,
        verificationData
      );
    } else if (gateway === "PAYU") {
      verificationData = {
        txnid: paymentId,
        amount: checkoutData.finalAmount,
        hash: signature,
      };

      isVerified = await paymentService.verifyPayment(
        gateway,
        verificationData
      );
    } else if (gateway === "PAYPAL") {
      verificationData = {
        paymentId: paymentId,
        payerId: payerId,
      };

      isVerified = await paymentService.verifyPayment(
        gateway,
        verificationData
      );
    }

    if (isVerified) {
      paymentDetails = await paymentService.fetchPaymentDetails(
        gateway,
        paymentId
      );
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

    const paymentMethod = getPaymentMethod(gateway, paymentDetails);

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "COMPLETED",
        method: paymentMethod,
        gatewayResponse: paymentDetails,
        transactionId: paymentId,
      },
    });

    setImmediate(async () => {
      try {
        await processPayment(payment.id, checkoutData.courseIds, userId);
        await redisService.del(`checkout:${orderId}`);
      } catch (error) {
        console.error("Background payment processing failed:", error);
      }
    });

    res.status(200).json({
      success: true,
      message: "Payment verified and processed successfully",
      data: {
        paymentId: payment.id,
        transactionId: paymentId,
        amount: payment.amount,
        status: "COMPLETED",
        message: "Enrollment processing initiated",
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

  const student = await prisma.student.findUnique({
    where: { userId: userId },
    select: { id: true },
  });

  if (!student) {
    throw new Error(`Student profile not found for user: ${userId}`);
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
        studentId: student.id,
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
        studentId: student.id,
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
      studentId: student.id,
      courseId: { in: courseIds },
    },
  });
};

export const getPurchaseHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, gateway } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status) where.status = status;
  if (gateway) where.gateway = gateway;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where: {
        ...where,
        enrollments: {
          some: { studentId: req.studentProfile.id },
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
          some: { studentId: req.studentProfile.id },
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
