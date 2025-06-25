import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../utils/redis.js";
import emailService from "../utils/emailService.js";
import notificationService from "../utils/notificationservice.js";

const prisma = new PrismaClient();

const generateTransactionId = () => {
  return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const generatePayoutId = () => {
  return `payout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const formatCurrency = (amount, currency = "INR") => {
  const symbol = currency === "INR" ? "₹" : "$";
  return `${symbol}${parseFloat(amount).toLocaleString()}`;
};

export const getAllTransactions = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 20,
      status,
      method,
      gateway,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `admin_transactions:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      status,
      method,
      gateway,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      search,
      sortBy,
      sortOrder,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Transactions retrieved successfully",
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
    if (method) where.method = method;
    if (gateway) where.gateway = gateway;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    if (minAmount || maxAmount) {
      where.amount = {};
      if (minAmount) where.amount.gte = parseFloat(minAmount);
      if (maxAmount) where.amount.lte = parseFloat(maxAmount);
    }

    if (search) {
      where.OR = [
        { transactionId: { contains: search, mode: "insensitive" } },
        {
          enrollments: {
            some: {
              student: {
                user: { email: { contains: search, mode: "insensitive" } },
              },
            },
          },
        },
      ];
    }

    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [transactions, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          enrollments: {
            include: {
              student: {
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
              course: {
                select: {
                  title: true,
                  instructor: {
                    include: {
                      user: {
                        select: {
                          firstName: true,
                          lastName: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          couponUsages: {
            include: {
              coupon: {
                select: {
                  code: true,
                  type: true,
                  value: true,
                },
              },
            },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    const transactionsData = transactions.map((payment) => ({
      id: payment.id,
      transactionId: payment.transactionId,
      amount: payment.amount,
      originalAmount: payment.originalAmount,
      discountAmount: payment.discountAmount,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      gateway: payment.gateway,
      createdAt: payment.createdAt,
      student: payment.enrollments[0]?.student
        ? {
            name: `${payment.enrollments[0].student.user.firstName} ${payment.enrollments[0].student.user.lastName}`,
            email: payment.enrollments[0].student.user.email,
          }
        : null,
      courses: payment.enrollments.map((enrollment) => ({
        title: enrollment.course.title,
        instructor: `${enrollment.course.instructor.user.firstName} ${enrollment.course.instructor.user.lastName}`,
      })),
      coupon: payment.couponUsages[0]?.coupon
        ? {
            code: payment.couponUsages[0].coupon.code,
            discount: payment.couponUsages[0].discount,
          }
        : null,
      refundAmount: payment.refundAmount,
      refundedAt: payment.refundedAt,
    }));

    const result = {
      transactions: transactionsData,
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
        method,
        gateway,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
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
      message: "Transactions retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get all transactions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve transactions",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getTransactionDetails = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { transactionId } = req.params;

    const cacheKey = `transaction_details:${transactionId}`;
    let cachedTransaction = await redisService.getJSON(cacheKey);

    if (cachedTransaction) {
      return res.status(200).json({
        success: true,
        message: "Transaction details retrieved successfully",
        data: cachedTransaction,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const transaction = await prisma.payment.findUnique({
      where: { id: transactionId },
      include: {
        enrollments: {
          include: {
            student: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phoneNumber: true,
                  },
                },
              },
            },
            course: {
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
              },
            },
          },
        },
        earnings: {
          include: {
            instructor: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
        couponUsages: {
          include: {
            coupon: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
        code: "TRANSACTION_NOT_FOUND",
      });
    }

    const transactionDetails = {
      id: transaction.id,
      transactionId: transaction.transactionId,
      amount: transaction.amount,
      originalAmount: transaction.originalAmount,
      discountAmount: transaction.discountAmount,
      tax: transaction.tax,
      currency: transaction.currency,
      status: transaction.status,
      method: transaction.method,
      gateway: transaction.gateway,
      gatewayResponse: transaction.gatewayResponse,
      metadata: transaction.metadata,
      refundAmount: transaction.refundAmount,
      refundReason: transaction.refundReason,
      refundedAt: transaction.refundedAt,
      invoiceUrl: transaction.invoiceUrl,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      student: transaction.enrollments[0]?.student
        ? {
            id: transaction.enrollments[0].student.user.id,
            name: `${transaction.enrollments[0].student.user.firstName} ${transaction.enrollments[0].student.user.lastName}`,
            email: transaction.enrollments[0].student.user.email,
            phoneNumber: transaction.enrollments[0].student.user.phoneNumber,
          }
        : null,
      courses: transaction.enrollments.map((enrollment) => ({
        id: enrollment.course.id,
        title: enrollment.course.title,
        price: enrollment.course.price,
        instructor: {
          name: `${enrollment.course.instructor.user.firstName} ${enrollment.course.instructor.user.lastName}`,
          email: enrollment.course.instructor.user.email,
        },
      })),
      earnings: transaction.earnings.map((earning) => ({
        id: earning.id,
        amount: earning.amount,
        commission: earning.commission,
        platformFee: earning.platformFee,
        status: earning.status,
        instructor: {
          name: `${earning.instructor.user.firstName} ${earning.instructor.user.lastName}`,
        },
      })),
      couponUsage: transaction.couponUsages[0]
        ? {
            couponCode: transaction.couponUsages[0].coupon.code,
            couponType: transaction.couponUsages[0].coupon.type,
            couponValue: transaction.couponUsages[0].coupon.value,
            discountApplied: transaction.couponUsages[0].discount,
            usedBy: `${transaction.couponUsages[0].user.firstName} ${transaction.couponUsages[0].user.lastName}`,
          }
        : null,
    };

    await redisService.setJSON(cacheKey, transactionDetails, { ex: 600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Transaction details retrieved successfully",
      data: transactionDetails,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get transaction details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve transaction details",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const processRefund = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { transactionId } = req.params;
    const { refundAmount, refundReason, notifyUser = true } = req.body;

    if (!refundAmount || !refundReason) {
      return res.status(400).json({
        success: false,
        message: "Refund amount and reason are required",
        code: "MISSING_REQUIRED_FIELDS",
      });
    }

    const transaction = await prisma.payment.findUnique({
      where: { id: transactionId },
      include: {
        enrollments: {
          include: {
            student: {
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
            course: {
              select: {
                title: true,
              },
            },
          },
        },
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
        code: "TRANSACTION_NOT_FOUND",
      });
    }

    if (transaction.status !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "Only completed transactions can be refunded",
        code: "INVALID_TRANSACTION_STATUS",
      });
    }

    const totalRefundable =
      parseFloat(transaction.amount) -
      parseFloat(transaction.refundAmount || 0);
    if (parseFloat(refundAmount) > totalRefundable) {
      return res.status(400).json({
        success: false,
        message: `Refund amount cannot exceed ${formatCurrency(
          totalRefundable
        )}`,
        code: "REFUND_AMOUNT_EXCEEDED",
      });
    }

    const newRefundAmount =
      parseFloat(transaction.refundAmount || 0) + parseFloat(refundAmount);
    const isFullRefund = newRefundAmount >= parseFloat(transaction.amount);
    const newStatus = isFullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED";

    const updatedTransaction = await prisma.payment.update({
      where: { id: transactionId },
      data: {
        refundAmount: newRefundAmount,
        refundReason,
        refundedAt: new Date(),
        status: newStatus,
      },
    });

    if (isFullRefund) {
      await prisma.enrollment.updateMany({
        where: { paymentId: transactionId },
        data: { status: "REFUNDED" },
      });
    }

    await prisma.earning.updateMany({
      where: { paymentId: transactionId },
      data: { status: "CANCELLED" },
    });

    if (notifyUser && transaction.enrollments[0]?.student) {
      const student = transaction.enrollments[0].student;
      const courseTitle = transaction.enrollments[0].course.title;

      try {
        await emailService.sendRefundProcessed({
          email: student.user.email,
          firstName: student.user.firstName,
          amount: refundAmount,
          currency: transaction.currency,
          refundId: `REF_${Date.now()}`,
          courseName: courseTitle,
          reason: refundReason,
        });
      } catch (emailError) {
        console.error("Failed to send refund email:", emailError);
      }

      try {
        await notificationService.createNotification({
          userId: student.user.id,
          type: "refund_processed",
          title: "Refund Processed",
          message: `Your refund of ${formatCurrency(
            refundAmount
          )} has been processed successfully.`,
          priority: "HIGH",
          data: {
            transactionId,
            refundAmount,
            refundReason,
            courseTitle,
            processedAt: new Date().toISOString(),
          },
          actionUrl: "/student/purchases",
        });
      } catch (notificationError) {
        console.error(
          "Failed to create refund notification:",
          notificationError
        );
      }
    }

    await redisService.del(`transaction_details:${transactionId}`);
    await redisService.delPattern("admin_transactions:*");
    await redisService.delPattern("revenue_overview:*");
    await redisService.delPattern("financial_analytics:*");

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Refund processed successfully",
      data: {
        transactionId: updatedTransaction.id,
        refundAmount: parseFloat(refundAmount),
        totalRefunded: newRefundAmount,
        status: newStatus,
        refundedAt: updatedTransaction.refundedAt,
        refundReason,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Process refund error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process refund",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getAllPayouts = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      page = 1,
      limit = 20,
      status,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      instructorId,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const cacheKey = `admin_payouts:${JSON.stringify({
      page: pageNumber,
      limit: pageSize,
      status,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      instructorId,
      sortBy,
      sortOrder,
    })}`;

    let cachedResult = await redisService.getJSON(cacheKey);
    if (cachedResult) {
      return res.status(200).json({
        success: true,
        message: "Payouts retrieved successfully",
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
    if (instructorId) where.instructorId = instructorId;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    if (minAmount || maxAmount) {
      where.amount = {};
      if (minAmount) where.amount.gte = parseFloat(minAmount);
      if (maxAmount) where.amount.lte = parseFloat(maxAmount);
    }

    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [payouts, total] = await Promise.all([
      prisma.payout.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
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
        },
      }),
      prisma.payout.count({ where }),
    ]);

    const payoutsData = payouts.map((payout) => ({
      id: payout.id,
      amount: payout.amount,
      currency: payout.currency,
      status: payout.status,
      requestedAt: payout.requestedAt,
      processedAt: payout.processedAt,
      gatewayId: payout.gatewayId,
      instructor: {
        id: payout.instructor.id,
        name: `${payout.instructor.user.firstName} ${payout.instructor.user.lastName}`,
        email: payout.instructor.user.email,
      },
    }));

    const result = {
      payouts: payoutsData,
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
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        instructorId,
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
      message: "Payouts retrieved successfully",
      data: result,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get all payouts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve payouts",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const processPayout = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { payoutId } = req.params;

    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
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
      },
    });

    if (!payout) {
      return res.status(404).json({
        success: false,
        message: "Payout not found",
        code: "PAYOUT_NOT_FOUND",
      });
    }

    if (payout.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Payout is already ${payout.status.toLowerCase()}`,
        code: "INVALID_PAYOUT_STATUS",
      });
    }

    const gatewayId = generatePayoutId();

    const updatedPayout = await prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: "COMPLETED",
        processedAt: new Date(),
        gatewayId,
        gatewayResponse: {
          processed_by: "admin",
          processed_at: new Date().toISOString(),
          gateway_reference: gatewayId,
        },
      },
    });

    await prisma.earning.updateMany({
      where: {
        instructorId: payout.instructorId,
        status: "PENDING",
      },
      data: {
        status: "PAID",
        paidAt: new Date(),
      },
    });

    try {
      await emailService.sendInstructorPayout({
        email: payout.instructor.user.email,
        firstName: payout.instructor.user.firstName,
        amount: payout.amount,
        currency: payout.currency,
        payoutId: gatewayId,
        period: new Date().toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        }),
        studentCount: 0,
      });
    } catch (emailError) {
      console.error("Failed to send payout email:", emailError);
    }

    try {
      await notificationService.createNotification({
        userId: payout.instructor.userId,
        type: "payout_processed",
        title: "Payout Processed",
        message: `Your payout of ${formatCurrency(
          payout.amount
        )} has been processed successfully.`,
        priority: "HIGH",
        data: {
          payoutId: updatedPayout.id,
          amount: payout.amount,
          currency: payout.currency,
          gatewayId,
          processedAt: updatedPayout.processedAt,
        },
        actionUrl: "/instructor/earnings",
      });
    } catch (notificationError) {
      console.error("Failed to create payout notification:", notificationError);
    }

    await redisService.delPattern("admin_payouts:*");
    await redisService.delPattern("revenue_overview:*");
    await redisService.delPattern("financial_analytics:*");

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Payout processed successfully",
      data: {
        payoutId: updatedPayout.id,
        amount: updatedPayout.amount,
        currency: updatedPayout.currency,
        status: updatedPayout.status,
        processedAt: updatedPayout.processedAt,
        gatewayId: updatedPayout.gatewayId,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Process payout error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process payout",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getRevenueOverview = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "30", currency = "INR" } = req.query;

    const cacheKey = `revenue_overview:${period}:${currency}`;
    let cachedOverview = await redisService.getJSON(cacheKey);

    if (cachedOverview) {
      return res.status(200).json({
        success: true,
        message: "Revenue overview retrieved successfully",
        data: cachedOverview,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const periodDays = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const [
      totalRevenue,
      periodRevenue,
      totalTransactions,
      periodTransactions,
      refundData,
      payoutData,
      topCourses,
      topInstructors,
    ] = await Promise.all([
      prisma.payment.aggregate({
        where: {
          status: "COMPLETED",
          currency,
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: {
          status: "COMPLETED",
          currency,
          createdAt: { gte: startDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.count({
        where: { status: "COMPLETED" },
      }),
      prisma.payment.count({
        where: {
          status: "COMPLETED",
          createdAt: { gte: startDate },
        },
      }),
      prisma.payment.aggregate({
        where: {
          status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] },
          currency,
          refundedAt: { gte: startDate },
        },
        _sum: { refundAmount: true },
        _count: true,
      }),
      prisma.payout.aggregate({
        where: {
          status: "COMPLETED",
          currency,
          processedAt: { gte: startDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.enrollment.groupBy({
        by: ["courseId"],
        where: {
          createdAt: { gte: startDate },
          payment: { status: "COMPLETED" },
        },
        _count: { courseId: true },
        _sum: { payment: { amount: true } },
        orderBy: { _count: { courseId: "desc" } },
        take: 5,
      }),
      prisma.earning.groupBy({
        by: ["instructorId"],
        where: {
          createdAt: { gte: startDate },
          status: { in: ["PENDING", "PAID"] },
        },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 5,
      }),
    ]);

    const courseIds = topCourses.map((item) => item.courseId);
    const instructorIds = topInstructors.map((item) => item.instructorId);

    const [courseDetails, instructorDetails] = await Promise.all([
      prisma.course.findMany({
        where: { id: { in: courseIds } },
        select: { id: true, title: true },
      }),
      prisma.instructor.findMany({
        where: { id: { in: instructorIds } },
        include: {
          user: {
            select: { firstName: true, lastName: true },
          },
        },
      }),
    ]);

    const overview = {
      summary: {
        totalRevenue: totalRevenue._sum.amount || 0,
        periodRevenue: periodRevenue._sum.amount || 0,
        totalTransactions: totalRevenue._count,
        periodTransactions: periodRevenue._count,
        totalRefunds: refundData._sum.refundAmount || 0,
        totalPayouts: payoutData._sum.amount || 0,
        netRevenue:
          (periodRevenue._sum.amount || 0) -
          (refundData._sum.refundAmount || 0),
        currency,
      },
      growth: {
        revenueGrowth: 0,
        transactionGrowth: 0,
        refundRate:
          periodTransactions > 0
            ? ((refundData._count / periodTransactions) * 100).toFixed(2)
            : 0,
      },
      topPerformers: {
        courses: topCourses.map((item) => {
          const course = courseDetails.find((c) => c.id === item.courseId);
          return {
            courseId: item.courseId,
            title: course?.title || "Unknown Course",
            enrollments: item._count.courseId,
            revenue: item._sum?.payment?.amount || 0,
          };
        }),
        instructors: topInstructors.map((item) => {
          const instructor = instructorDetails.find(
            (i) => i.id === item.instructorId
          );
          return {
            instructorId: item.instructorId,
            name: instructor
              ? `${instructor.user.firstName} ${instructor.user.lastName}`
              : "Unknown Instructor",
            earnings: item._sum.amount || 0,
          };
        }),
      },
      metrics: {
        averageTransactionValue:
          periodTransactions > 0
            ? ((periodRevenue._sum.amount || 0) / periodTransactions).toFixed(2)
            : 0,
        payoutRatio:
          periodRevenue._sum.amount > 0
            ? (
                ((payoutData._sum.amount || 0) /
                  (periodRevenue._sum.amount || 1)) *
                100
              ).toFixed(2)
            : 0,
        platformRevenue:
          (periodRevenue._sum.amount || 0) - (payoutData._sum.amount || 0),
      },
    };

    await redisService.setJSON(cacheKey, overview, { ex: 1800 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Revenue overview retrieved successfully",
      data: overview,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get revenue overview error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve revenue overview",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getFinancialAnalytics = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      period = "12",
      granularity = "month",
      currency = "INR",
    } = req.query;

    const cacheKey = `financial_analytics:${period}:${granularity}:${currency}`;
    let cachedAnalytics = await redisService.getJSON(cacheKey);

    if (cachedAnalytics) {
      return res.status(200).json({
        success: true,
        message: "Financial analytics retrieved successfully",
        data: cachedAnalytics,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const periodMonths = parseInt(period);
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - periodMonths);

    const [
      revenueByMethod,
      revenueByGateway,
      revenueByStatus,
      monthlyTrends,
      instructorEarnings,
      platformMetrics,
    ] = await Promise.all([
      prisma.payment.groupBy({
        by: ["method"],
        where: {
          createdAt: { gte: startDate },
          currency,
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.groupBy({
        by: ["gateway"],
        where: {
          createdAt: { gte: startDate },
          currency,
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.groupBy({
        by: ["status"],
        where: {
          createdAt: { gte: startDate },
          currency,
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', "createdAt") as month,
          SUM(amount) as revenue,
          COUNT(*) as transactions
        FROM "Payment"
        WHERE "createdAt" >= ${startDate}
          AND currency = ${currency}
        GROUP BY DATE_TRUNC('month', "createdAt")
        ORDER BY month DESC
        LIMIT 12
      `,
      prisma.earning.aggregate({
        where: {
          createdAt: { gte: startDate },
        },
        _sum: {
          amount: true,
          commission: true,
          platformFee: true,
        },
      }),
      prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT p.id) as total_transactions,
          SUM(p.amount) as total_revenue,
          AVG(p.amount) as avg_transaction_value,
          COUNT(DISTINCT e.id) as total_enrollments,
          COUNT(DISTINCT c.id) as courses_sold,
          COUNT(DISTINCT i.id) as active_instructors
        FROM "Payment" p
        LEFT JOIN "Enrollment" e ON p.id = e."paymentId"
        LEFT JOIN "Course" c ON e."courseId" = c.id
        LEFT JOIN "Instructor" i ON c."instructorId" = i.id
        WHERE p."createdAt" >= ${startDate}
          AND p.currency = ${currency}
      `,
    ]);

    const analytics = {
      breakdown: {
        byPaymentMethod: revenueByMethod.map((item) => ({
          method: item.method,
          revenue: item._sum.amount || 0,
          transactions: item._count,
          percentage: 0,
        })),
        byGateway: revenueByGateway.map((item) => ({
          gateway: item.gateway,
          revenue: item._sum.amount || 0,
          transactions: item._count,
          percentage: 0,
        })),
        byStatus: revenueByStatus.map((item) => ({
          status: item.status,
          revenue: item._sum.amount || 0,
          transactions: item._count,
          percentage: 0,
        })),
      },
      trends: {
        monthly: monthlyTrends.map((item) => ({
          month: item.month,
          revenue: parseFloat(item.revenue) || 0,
          transactions: parseInt(item.transactions) || 0,
        })),
      },
      earnings: {
        totalInstructorEarnings: instructorEarnings._sum.amount || 0,
        totalCommissions: instructorEarnings._sum.commission || 0,
        totalPlatformFees: instructorEarnings._sum.platformFee || 0,
      },
      metrics: platformMetrics[0] || {
        total_transactions: 0,
        total_revenue: 0,
        avg_transaction_value: 0,
        total_enrollments: 0,
        courses_sold: 0,
        active_instructors: 0,
      },
    };

    const totalRevenue = analytics.breakdown.byPaymentMethod.reduce(
      (sum, item) => sum + item.revenue,
      0
    );
    if (totalRevenue > 0) {
      analytics.breakdown.byPaymentMethod.forEach((item) => {
        item.percentage = ((item.revenue / totalRevenue) * 100).toFixed(2);
      });
      analytics.breakdown.byGateway.forEach((item) => {
        item.percentage = ((item.revenue / totalRevenue) * 100).toFixed(2);
      });
      analytics.breakdown.byStatus.forEach((item) => {
        item.percentage = ((item.revenue / totalRevenue) * 100).toFixed(2);
      });
    }

    await redisService.setJSON(cacheKey, analytics, { ex: 3600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Financial analytics retrieved successfully",
      data: analytics,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get financial analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve financial analytics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getPaymentStats = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const cacheKey = "payment_stats_overview";
    let cachedStats = await redisService.getJSON(cacheKey);

    if (cachedStats) {
      return res.status(200).json({
        success: true,
        message: "Payment statistics retrieved successfully",
        data: cachedStats,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const [
      totalStats,
      todayStats,
      weekStats,
      monthStats,
      statusDistribution,
      methodDistribution,
      gatewayDistribution,
    ] = await Promise.all([
      prisma.payment.aggregate({
        _sum: { amount: true },
        _count: true,
        _avg: { amount: true },
      }),
      prisma.payment.aggregate({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.groupBy({
        by: ["status"],
        _count: true,
      }),
      prisma.payment.groupBy({
        by: ["method"],
        _count: true,
      }),
      prisma.payment.groupBy({
        by: ["gateway"],
        _count: true,
      }),
    ]);

    const stats = {
      overview: {
        totalRevenue: totalStats._sum.amount || 0,
        totalTransactions: totalStats._count,
        averageTransactionValue: totalStats._avg.amount || 0,
        todayRevenue: todayStats._sum.amount || 0,
        todayTransactions: todayStats._count,
        weekRevenue: weekStats._sum.amount || 0,
        weekTransactions: weekStats._count,
        monthRevenue: monthStats._sum.amount || 0,
        monthTransactions: monthStats._count,
      },
      distribution: {
        byStatus: statusDistribution.map((item) => ({
          status: item.status,
          count: item._count,
          percentage:
            totalStats._count > 0
              ? ((item._count / totalStats._count) * 100).toFixed(2)
              : 0,
        })),
        byMethod: methodDistribution.map((item) => ({
          method: item.method,
          count: item._count,
          percentage:
            totalStats._count > 0
              ? ((item._count / totalStats._count) * 100).toFixed(2)
              : 0,
        })),
        byGateway: gatewayDistribution.map((item) => ({
          gateway: item.gateway,
          count: item._count,
          percentage:
            totalStats._count > 0
              ? ((item._count / totalStats._count) * 100).toFixed(2)
              : 0,
        })),
      },
      growth: {
        dailyGrowth: 0,
        weeklyGrowth: 0,
        monthlyGrowth: 0,
      },
    };

    await redisService.setJSON(cacheKey, stats, { ex: 900 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Payment statistics retrieved successfully",
      data: stats,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Get payment stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve payment statistics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
