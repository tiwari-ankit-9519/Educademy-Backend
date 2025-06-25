import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";
import emailService from "../../utils/emailService.js";
import notificationService from "../../utils/notificationservice.js";
import { Decimal } from "@prisma/client/runtime/library.js";
import {
  calculateGrowthRate,
  formatCurrency,
  generateEarningsCSV,
  validateMinPayoutAmount,
  generatePayoutReference,
  getEarningsMetrics,
  generateTaxDocument,
  schedulePayoutReminder,
} from "../../helper/payoutHelperFunctions.js";

const prisma = new PrismaClient();

const getEarningsOverview = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const cacheKey = `earnings_overview:${instructorId}`;

  try {
    let cachedData = await redisService.getJSON(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Earnings overview retrieved successfully",
        data: cachedData,
        cached: true,
      });
    }

    // Use utility function for metrics calculation
    const metrics = await getEarningsMetrics(instructorId, "monthly");

    const currentDate = new Date();
    const currentMonthStart = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1
    );
    const yearStart = new Date(currentDate.getFullYear(), 0, 1);

    const [
      totalEarnings,
      yearlyEarnings,
      pendingPayouts,
      totalPayouts,
      recentEarnings,
      coursesWithEarnings,
    ] = await Promise.all([
      prisma.earning.aggregate({
        where: { instructorId },
        _sum: { amount: true, commission: true },
        _count: true,
      }),

      prisma.earning.aggregate({
        where: {
          instructorId,
          createdAt: { gte: yearStart },
        },
        _sum: { amount: true, commission: true },
      }),

      prisma.payout.aggregate({
        where: {
          instructorId,
          status: "PENDING",
        },
        _sum: { amount: true },
        _count: true,
      }),

      prisma.payout.aggregate({
        where: {
          instructorId,
          status: "COMPLETED",
        },
        _sum: { amount: true },
        _count: true,
      }),

      prisma.earning.findMany({
        where: { instructorId },
        include: {
          payment: {
            include: {
              enrollments: {
                include: {
                  course: {
                    select: { title: true, slug: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),

      prisma.earning.groupBy({
        by: ["paymentId"],
        where: { instructorId },
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: "desc" } },
        take: 10,
      }),
    ]);

    const availableBalance =
      (totalEarnings._sum.commission || 0) -
      (totalPayouts._sum.amount || 0) -
      (pendingPayouts._sum.amount || 0);

    // Check for payout reminders using utility function
    const payoutReminder = await schedulePayoutReminder(
      instructorId,
      availableBalance
    );

    const overviewData = {
      summary: {
        totalEarnings: formatCurrency(totalEarnings._sum.commission || 0),
        totalEarningsRaw: totalEarnings._sum.commission || 0,
        availableBalance: formatCurrency(availableBalance),
        availableBalanceRaw: availableBalance,
        currentMonthEarnings: formatCurrency(metrics.current.commission),
        currentMonthEarningsRaw: metrics.current.commission,
        lastMonthEarnings: formatCurrency(metrics.previous.commission),
        lastMonthEarningsRaw: metrics.previous.commission,
        yearlyEarnings: formatCurrency(yearlyEarnings._sum.commission || 0),
        yearlyEarningsRaw: yearlyEarnings._sum.commission || 0,
        monthlyGrowth: Math.round(metrics.growth.earnings * 100) / 100,
        totalTransactions: totalEarnings._count,
      },
      payouts: {
        pendingAmount: formatCurrency(pendingPayouts._sum.amount || 0),
        pendingAmountRaw: pendingPayouts._sum.amount || 0,
        pendingCount: pendingPayouts._count,
        totalPaidOut: formatCurrency(totalPayouts._sum.amount || 0),
        totalPaidOutRaw: totalPayouts._sum.amount || 0,
        totalPayouts: totalPayouts._count,
      },
      recentActivity: recentEarnings.map((earning) => ({
        id: earning.id,
        amount: formatCurrency(earning.commission),
        amountRaw: earning.commission,
        createdAt: earning.createdAt,
        course: earning.payment.enrollments[0]?.course || null,
        status: earning.status,
      })),
      topCourses: await Promise.all(
        coursesWithEarnings.slice(0, 5).map(async (item) => {
          const payment = await prisma.payment.findUnique({
            where: { id: item.paymentId },
            include: {
              enrollments: {
                include: {
                  course: {
                    select: {
                      id: true,
                      title: true,
                      slug: true,
                      thumbnail: true,
                    },
                  },
                },
              },
            },
          });
          return {
            course: payment?.enrollments[0]?.course || null,
            earnings: formatCurrency(item._sum.amount),
            earningsRaw: item._sum.amount,
            transactions: item._count,
          };
        })
      ),
      alerts: payoutReminder.shouldRemind
        ? [
            {
              type: "info",
              message: payoutReminder.message,
              action: "request_payout",
            },
          ]
        : [],
    };

    await redisService.setJSON(cacheKey, overviewData, { ex: 300 });

    res.status(200).json({
      success: true,
      message: "Earnings overview retrieved successfully",
      data: overviewData,
    });
  } catch (error) {
    console.error("Get earnings overview error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve earnings overview",
      error: error.message,
    });
  }
});

const getEarningsStats = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { period = "monthly", year = new Date().getFullYear() } = req.query;

  const cacheKey = `earnings_stats:${instructorId}:${period}:${year}`;

  try {
    let cachedData = await redisService.getJSON(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Earnings statistics retrieved successfully",
        data: cachedData,
        cached: true,
      });
    }

    let dateFilter;

    if (period === "daily") {
      const startDate = new Date(year, new Date().getMonth(), 1);
      const endDate = new Date(year, new Date().getMonth() + 1, 0);
      dateFilter = { gte: startDate, lte: endDate };
    } else if (period === "weekly") {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31);
      dateFilter = { gte: startDate, lte: endDate };
    } else {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31);
      dateFilter = { gte: startDate, lte: endDate };
    }

    const [earningsData, payoutsData] = await Promise.all([
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${period}, created_at) as period,
          SUM(amount) as total_amount,
          SUM(commission) as total_commission,
          COUNT(*) as transaction_count,
          AVG(amount) as avg_amount
        FROM "Earning"
        WHERE instructor_id = ${instructorId}
          AND created_at >= ${dateFilter.gte}
          AND created_at <= ${dateFilter.lte}
        GROUP BY DATE_TRUNC(${period}, created_at)
        ORDER BY period ASC
      `,

      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${period}, created_at) as period,
          SUM(amount) as payout_amount,
          COUNT(*) as payout_count
        FROM "Payout"
        WHERE instructor_id = ${instructorId}
          AND created_at >= ${dateFilter.gte}
          AND created_at <= ${dateFilter.lte}
          AND status = 'COMPLETED'
        GROUP BY DATE_TRUNC(${period}, created_at)
        ORDER BY period ASC
      `,
    ]);

    // Calculate growth rates using utility function
    const currentTotal = earningsData.reduce(
      (sum, item) => sum + parseFloat(item.total_commission),
      0
    );
    const previousTotal =
      earningsData.length > 1
        ? earningsData
            .slice(0, -1)
            .reduce((sum, item) => sum + parseFloat(item.total_commission), 0)
        : 0;

    const growthRate = calculateGrowthRate(currentTotal, previousTotal);

    const statsData = {
      period,
      year: parseInt(year),
      earnings: earningsData.map((item) => ({
        period: item.period,
        amount: formatCurrency(parseFloat(item.total_commission)),
        amountRaw: parseFloat(item.total_commission),
        grossAmount: formatCurrency(parseFloat(item.total_amount)),
        grossAmountRaw: parseFloat(item.total_amount),
        transactions: parseInt(item.transaction_count),
        averageAmount: formatCurrency(parseFloat(item.avg_amount)),
        averageAmountRaw: parseFloat(item.avg_amount),
      })),
      payouts: payoutsData.map((item) => ({
        period: item.period,
        amount: formatCurrency(parseFloat(item.payout_amount)),
        amountRaw: parseFloat(item.payout_amount),
        count: parseInt(item.payout_count),
      })),
      summary: {
        totalEarnings: formatCurrency(currentTotal),
        totalEarningsRaw: currentTotal,
        totalTransactions: earningsData.reduce(
          (sum, item) => sum + parseInt(item.transaction_count),
          0
        ),
        totalPayouts: formatCurrency(
          payoutsData.reduce(
            (sum, item) => sum + parseFloat(item.payout_amount),
            0
          )
        ),
        averageTransaction: formatCurrency(
          earningsData.length > 0
            ? earningsData.reduce(
                (sum, item) => sum + parseFloat(item.avg_amount),
                0
              ) / earningsData.length
            : 0
        ),
        growthRate: Math.round(growthRate * 100) / 100,
      },
    };

    await redisService.setJSON(cacheKey, statsData, { ex: 600 });

    res.status(200).json({
      success: true,
      message: "Earnings statistics retrieved successfully",
      data: statsData,
    });
  } catch (error) {
    console.error("Get earnings stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve earnings statistics",
      error: error.message,
    });
  }
});

const requestPayout = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { amount, currency = "INR" } = req.body;

  try {
    // Use utility function for validation
    if (!validateMinPayoutAmount(amount, currency)) {
      return res.status(400).json({
        success: false,
        message: `Minimum payout amount is ${formatCurrency(100, currency)}`,
      });
    }

    const availableBalance = await prisma.earning.aggregate({
      where: {
        instructorId,
        status: "PENDING",
      },
      _sum: { commission: true },
    });

    const pendingPayouts = await prisma.payout.aggregate({
      where: {
        instructorId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
      _sum: { amount: true },
    });

    const completedPayouts = await prisma.payout.aggregate({
      where: {
        instructorId,
        status: "COMPLETED",
      },
      _sum: { amount: true },
    });

    const totalAvailable =
      (availableBalance._sum.commission || 0) -
      (pendingPayouts._sum.amount || 0) -
      (completedPayouts._sum.amount || 0);

    if (amount > totalAvailable) {
      return res.status(400).json({
        success: false,
        message: "Insufficient available balance for payout",
        data: {
          requestedAmount: formatCurrency(amount, currency),
          availableBalance: formatCurrency(totalAvailable, currency),
        },
      });
    }

    const instructor = await prisma.instructor.findUnique({
      where: { id: instructorId },
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

    if (!instructor.paymentDetails) {
      return res.status(400).json({
        success: false,
        message:
          "Payment details not configured. Please update your payment information.",
      });
    }

    // Generate payout reference using utility function
    const payoutReference = generatePayoutReference(instructorId, currency);

    const payout = await prisma.payout.create({
      data: {
        amount: new Decimal(amount),
        currency,
        status: "PENDING",
        gatewayId: payoutReference,
        instructorId,
      },
    });

    await prisma.earning.updateMany({
      where: {
        instructorId,
        status: "PENDING",
      },
      data: {
        status: "PAID",
        paidAt: new Date(),
      },
    });

    await notificationService.createNotification({
      userId: instructor.user.id,
      type: "payout_requested",
      title: "Payout Request Submitted",
      message: `Your payout request for ${formatCurrency(
        amount,
        currency
      )} has been submitted and is pending approval.`,
      data: {
        payoutId: payout.id,
        amount,
        currency,
        status: "PENDING",
        reference: payoutReference,
      },
    });

    await emailService.sendInstructorPayout({
      email: instructor.user.email,
      firstName: instructor.user.firstName,
      amount,
      currency,
      payoutId: payout.id,
      period: "Current",
      studentCount: 0,
    });

    await redisService.delPattern(`earnings_overview:${instructorId}`);
    await redisService.delPattern(`detailed_earnings:${instructorId}:*`);
    await redisService.delPattern(`payout_history:${instructorId}:*`);

    res.status(201).json({
      success: true,
      message: "Payout request submitted successfully",
      data: {
        payout: {
          id: payout.id,
          amount: formatCurrency(payout.amount, currency),
          amountRaw: payout.amount,
          currency: payout.currency,
          status: payout.status,
          reference: payoutReference,
          requestedAt: payout.requestedAt,
        },
      },
    });
  } catch (error) {
    console.error("Request payout error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit payout request",
      error: error.message,
    });
  }
});

const generateFinancialReport = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const {
    type = "monthly",
    startDate,
    endDate,
    format = "json",
    includeDetails = false,
  } = req.query;

  const cacheKey = `financial_report:${instructorId}:${type}:${
    startDate || ""
  }:${endDate || ""}:${format}:${includeDetails}`;

  try {
    let cachedData = await redisService.getJSON(cacheKey);
    if (cachedData && format === "json") {
      return res.status(200).json({
        success: true,
        message: "Financial report generated successfully",
        data: cachedData,
        cached: true,
      });
    }

    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const where = { instructorId };
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter;
    }

    const instructor = await prisma.instructor.findUnique({
      where: { id: instructorId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            country: true,
          },
        },
      },
    });

    const [earnings, payouts, coursePerformance] = await Promise.all([
      prisma.earning.findMany({
        where,
        include: includeDetails
          ? {
              payment: {
                include: {
                  enrollments: {
                    include: {
                      course: {
                        select: { title: true, price: true },
                      },
                      student: {
                        include: {
                          user: {
                            select: {
                              firstName: true,
                              lastName: true,
                              country: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            }
          : undefined,
        orderBy: { createdAt: "desc" },
      }),

      prisma.payout.findMany({
        where: {
          instructorId,
          ...(Object.keys(dateFilter).length > 0
            ? { requestedAt: dateFilter }
            : {}),
        },
        orderBy: { requestedAt: "desc" },
      }),

      prisma.$queryRaw`
        SELECT 
          c.id,
          c.title,
          c.price,
          COUNT(DISTINCT en.id) as enrollments,
          SUM(e.amount) as total_earnings,
          SUM(e.commission) as instructor_earnings,
          SUM(e.platform_fee) as platform_fees,
          AVG(e.amount) as avg_earning_per_sale
        FROM "Course" c
        LEFT JOIN "Enrollment" en ON c.id = en.course_id
        LEFT JOIN "Payment" p ON en.payment_id = p.id
        LEFT JOIN "Earning" e ON p.id = e.payment_id
        WHERE c.instructor_id = ${instructorId}
          ${startDate ? `AND e.created_at >= ${new Date(startDate)}` : ""}
          ${endDate ? `AND e.created_at <= ${new Date(endDate)}` : ""}
        GROUP BY c.id, c.title, c.price
        ORDER BY total_earnings DESC NULLS LAST
      `,
    ]);

    const totalCommission = earnings.reduce(
      (sum, earning) => sum + Number(earning.commission),
      0
    );

    // Generate tax document using utility function
    const taxInfo = generateTaxDocument(earnings, new Date().getFullYear());

    const reportData = {
      reportInfo: {
        generatedAt: new Date().toISOString(),
        instructor: {
          name: `${instructor.user.firstName} ${instructor.user.lastName}`,
          email: instructor.user.email,
          country: instructor.user.country,
          commissionRate: instructor.commissionRate,
        },
        period: {
          type,
          startDate: startDate || earnings[earnings.length - 1]?.createdAt,
          endDate: endDate || earnings[0]?.createdAt,
        },
      },
      summary: {
        totalGrossEarnings: formatCurrency(taxInfo.summary.totalGrossEarnings),
        totalInstructorEarnings: formatCurrency(
          taxInfo.summary.totalNetEarnings
        ),
        totalPlatformFees: formatCurrency(taxInfo.summary.totalPlatformFees),
        totalTransactions: taxInfo.summary.totalTransactions,
        averageTransactionValue: formatCurrency(
          taxInfo.summary.totalTransactions > 0
            ? taxInfo.summary.totalGrossEarnings /
                taxInfo.summary.totalTransactions
            : 0
        ),
      },
      earnings: earnings.map((earning) => ({
        id: earning.id,
        amount: formatCurrency(earning.amount),
        commission: formatCurrency(earning.commission),
        platformFee: formatCurrency(earning.platformFee),
        currency: earning.currency,
        status: earning.status,
        createdAt: earning.createdAt,
        paidAt: earning.paidAt,
        ...(includeDetails && earning.payment
          ? {
              courseTitle: earning.payment.enrollments[0]?.course?.title,
              studentName: earning.payment.enrollments[0]?.student
                ? `${earning.payment.enrollments[0].student.user.firstName} ${earning.payment.enrollments[0].student.user.lastName}`
                : null,
              studentCountry:
                earning.payment.enrollments[0]?.student?.user?.country,
              transactionId: earning.payment.transactionId,
            }
          : {}),
      })),
      payouts: payouts.map((payout) => ({
        id: payout.id,
        amount: formatCurrency(payout.amount),
        currency: payout.currency,
        status: payout.status,
        requestedAt: payout.requestedAt,
        processedAt: payout.processedAt,
        reference: payout.gatewayId,
      })),
      coursePerformance: coursePerformance.map((course) => ({
        id: course.id,
        title: course.title,
        price: formatCurrency(parseFloat(course.price || 0)),
        enrollments: parseInt(course.enrollments || 0),
        totalEarnings: formatCurrency(parseFloat(course.total_earnings || 0)),
        instructorEarnings: formatCurrency(
          parseFloat(course.instructor_earnings || 0)
        ),
        platformFees: formatCurrency(parseFloat(course.platform_fees || 0)),
        averageEarningPerSale: formatCurrency(
          parseFloat(course.avg_earning_per_sale || 0)
        ),
      })),
      taxInformation: taxInfo,
    };

    if (format === "csv") {
      // Use utility function for CSV generation
      const csvContent = generateEarningsCSV(earnings, includeDetails);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="financial-report-${
          new Date().toISOString().split("T")[0]
        }.csv"`
      );
      return res.status(200).send(csvContent);
    }

    await redisService.setJSON(cacheKey, reportData, { ex: 1800 });

    res.status(200).json({
      success: true,
      message: "Financial report generated successfully",
      data: reportData,
    });
  } catch (error) {
    console.error("Generate financial report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate financial report",
      error: error.message,
    });
  }
});

const getDetailedEarnings = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const {
    page = 1,
    limit = 20,
    status,
    startDate,
    endDate,
    courseId,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  const pageNumber = Math.max(parseInt(page), 1);
  const pageSize = Math.min(parseInt(limit), 100);
  const skip = (pageNumber - 1) * pageSize;

  const cacheKey = `detailed_earnings:${instructorId}:${page}:${limit}:${
    status || "all"
  }:${startDate || ""}:${endDate || ""}:${
    courseId || ""
  }:${sortBy}:${sortOrder}`;

  try {
    let cachedData = await redisService.getJSON(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Detailed earnings retrieved successfully",
        data: cachedData,
        cached: true,
      });
    }

    const where = { instructorId };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (courseId) {
      where.payment = {
        enrollments: {
          some: { courseId },
        },
      };
    }

    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [earnings, totalCount, summary] = await Promise.all([
      prisma.earning.findMany({
        where,
        include: {
          payment: {
            include: {
              enrollments: {
                include: {
                  course: {
                    select: {
                      id: true,
                      title: true,
                      slug: true,
                      thumbnail: true,
                      price: true,
                    },
                  },
                  student: {
                    include: {
                      user: {
                        select: {
                          firstName: true,
                          lastName: true,
                          email: true,
                          country: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy,
        skip,
        take: pageSize,
      }),

      prisma.earning.count({ where }),

      prisma.earning.aggregate({
        where,
        _sum: {
          amount: true,
          commission: true,
          platformFee: true,
        },
        _avg: {
          amount: true,
        },
        _count: true,
      }),
    ]);

    const detailedEarnings = earnings.map((earning) => ({
      id: earning.id,
      amount: formatCurrency(earning.amount),
      amountRaw: earning.amount,
      commission: formatCurrency(earning.commission),
      commissionRaw: earning.commission,
      platformFee: formatCurrency(earning.platformFee),
      platformFeeRaw: earning.platformFee,
      currency: earning.currency,
      status: earning.status,
      createdAt: earning.createdAt,
      paidAt: earning.paidAt,
      payment: {
        id: earning.payment.id,
        amount: formatCurrency(earning.payment.amount),
        method: earning.payment.method,
        gateway: earning.payment.gateway,
        transactionId: earning.payment.transactionId,
        createdAt: earning.payment.createdAt,
      },
      enrollments: earning.payment.enrollments.map((enrollment) => ({
        id: enrollment.id,
        course: enrollment.course,
        student: {
          name: `${enrollment.student.user.firstName} ${enrollment.student.user.lastName}`,
          email: enrollment.student.user.email,
          country: enrollment.student.user.country,
        },
        enrolledAt: enrollment.createdAt,
      })),
    }));

    const result = {
      earnings: detailedEarnings,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        hasNext: skip + pageSize < totalCount,
        hasPrev: pageNumber > 1,
      },
      summary: {
        totalAmount: formatCurrency(summary._sum.amount || 0),
        totalCommission: formatCurrency(summary._sum.commission || 0),
        totalPlatformFee: formatCurrency(summary._sum.platformFee || 0),
        averageAmount: formatCurrency(summary._avg.amount || 0),
        transactionCount: summary._count,
      },
      filters: {
        status,
        startDate,
        endDate,
        courseId,
        sortBy,
        sortOrder,
      },
    };

    await redisService.setJSON(cacheKey, result, { ex: 300 });

    res.status(200).json({
      success: true,
      message: "Detailed earnings retrieved successfully",
      data: result,
    });
  } catch (error) {
    console.error("Get detailed earnings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve detailed earnings",
      error: error.message,
    });
  }
});

const getCourseEarnings = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { courseId } = req.params;
  const { startDate, endDate, page = 1, limit = 20 } = req.query;

  const pageNumber = Math.max(parseInt(page), 1);
  const pageSize = Math.min(parseInt(limit), 50);
  const skip = (pageNumber - 1) * pageSize;

  const cacheKey = `course_earnings:${instructorId}:${courseId}:${
    startDate || ""
  }:${endDate || ""}:${page}:${limit}`;

  try {
    let cachedData = await redisService.getJSON(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Course earnings retrieved successfully",
        data: cachedData,
        cached: true,
      });
    }

    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        instructorId,
      },
      select: {
        id: true,
        title: true,
        slug: true,
        thumbnail: true,
        price: true,
        totalEnrollments: true,
        totalRevenue: true,
      },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found or access denied",
      });
    }

    const where = {
      payment: {
        enrollments: {
          some: { courseId },
        },
      },
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [earnings, totalCount, summary, monthlyBreakdown] = await Promise.all(
      [
        prisma.earning.findMany({
          where,
          include: {
            payment: {
              include: {
                enrollments: {
                  where: { courseId },
                  include: {
                    student: {
                      include: {
                        user: {
                          select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            country: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),

        prisma.earning.count({ where }),

        prisma.earning.aggregate({
          where,
          _sum: {
            amount: true,
            commission: true,
            platformFee: true,
          },
          _count: true,
        }),

        prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', e.created_at) as month,
          SUM(e.amount) as earnings,
          SUM(e.commission) as commission,
          COUNT(*) as transactions
        FROM "Earning" e
        JOIN "Payment" p ON e.payment_id = p.id
        JOIN "Enrollment" en ON p.id = en.payment_id
        WHERE en.course_id = ${courseId}
          AND e.instructor_id = ${instructorId}
          ${startDate ? `AND e.created_at >= ${new Date(startDate)}` : ""}
          ${endDate ? `AND e.created_at <= ${new Date(endDate)}` : ""}
        GROUP BY DATE_TRUNC('month', e.created_at)
        ORDER BY month DESC
        LIMIT 12
      `,
      ]
    );

    const result = {
      course: {
        ...course,
        price: formatCurrency(course.price),
        totalRevenue: formatCurrency(course.totalRevenue),
      },
      earnings: earnings.map((earning) => ({
        id: earning.id,
        amount: formatCurrency(earning.amount),
        commission: formatCurrency(earning.commission),
        platformFee: formatCurrency(earning.platformFee),
        createdAt: earning.createdAt,
        student: earning.payment.enrollments[0]
          ? {
              name: `${earning.payment.enrollments[0].student.user.firstName} ${earning.payment.enrollments[0].student.user.lastName}`,
              email: earning.payment.enrollments[0].student.user.email,
              country: earning.payment.enrollments[0].student.user.country,
            }
          : null,
        payment: {
          id: earning.payment.id,
          amount: formatCurrency(earning.payment.amount),
          method: earning.payment.method,
          transactionId: earning.payment.transactionId,
        },
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        hasNext: skip + pageSize < totalCount,
        hasPrev: pageNumber > 1,
      },
      summary: {
        totalEarnings: formatCurrency(summary._sum.amount || 0),
        totalCommission: formatCurrency(summary._sum.commission || 0),
        totalPlatformFee: formatCurrency(summary._sum.platformFee || 0),
        transactionCount: summary._count,
      },
      monthlyBreakdown: monthlyBreakdown.map((item) => ({
        month: item.month,
        earnings: formatCurrency(parseFloat(item.earnings)),
        commission: formatCurrency(parseFloat(item.commission)),
        transactions: parseInt(item.transactions),
      })),
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

    res.status(200).json({
      success: true,
      message: "Course earnings retrieved successfully",
      data: result,
    });
  } catch (error) {
    console.error("Get course earnings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve course earnings",
      error: error.message,
    });
  }
});

const getPayoutHistory = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const {
    page = 1,
    limit = 20,
    status,
    startDate,
    endDate,
    sortBy = "requestedAt",
    sortOrder = "desc",
  } = req.query;

  const pageNumber = Math.max(parseInt(page), 1);
  const pageSize = Math.min(parseInt(limit), 50);
  const skip = (pageNumber - 1) * pageSize;

  const cacheKey = `payout_history:${instructorId}:${page}:${limit}:${
    status || "all"
  }:${startDate || ""}:${endDate || ""}:${sortBy}:${sortOrder}`;

  try {
    let cachedData = await redisService.getJSON(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Payout history retrieved successfully",
        data: cachedData,
        cached: true,
      });
    }

    const where = { instructorId };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.requestedAt = {};
      if (startDate) where.requestedAt.gte = new Date(startDate);
      if (endDate) where.requestedAt.lte = new Date(endDate);
    }

    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [payouts, totalCount, summary] = await Promise.all([
      prisma.payout.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
      }),

      prisma.payout.count({ where }),

      prisma.payout.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const result = {
      payouts: payouts.map((payout) => ({
        id: payout.id,
        amount: formatCurrency(payout.amount, payout.currency),
        amountRaw: payout.amount,
        currency: payout.currency,
        status: payout.status,
        requestedAt: payout.requestedAt,
        processedAt: payout.processedAt,
        reference: payout.gatewayId,
        gatewayResponse: payout.gatewayResponse,
      })),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        hasNext: skip + pageSize < totalCount,
        hasPrev: pageNumber > 1,
      },
      summary: {
        totalAmount: formatCurrency(summary._sum.amount || 0),
        totalPayouts: summary._count,
      },
      statusBreakdown: await prisma.payout.groupBy({
        by: ["status"],
        where: { instructorId },
        _sum: { amount: true },
        _count: true,
      }),
    };

    await redisService.setJSON(cacheKey, result, { ex: 600 });

    res.status(200).json({
      success: true,
      message: "Payout history retrieved successfully",
      data: result,
    });
  } catch (error) {
    console.error("Get payout history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve payout history",
      error: error.message,
    });
  }
});

const getRevenueAnalytics = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const {
    timeframe = "monthly",
    year = new Date().getFullYear(),
    compareToLastYear = false,
  } = req.query;

  const cacheKey = `revenue_analytics:${instructorId}:${timeframe}:${year}:${compareToLastYear}`;

  try {
    let cachedData = await redisService.getJSON(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Revenue analytics retrieved successfully",
        data: cachedData,
        cached: true,
      });
    }

    const currentYearStart = new Date(year, 0, 1);
    const currentYearEnd = new Date(year, 11, 31);
    const lastYearStart = new Date(year - 1, 0, 1);
    const lastYearEnd = new Date(year - 1, 11, 31);

    const [
      currentYearEarnings,
      lastYearEarnings,
      topPerformingCourses,
      geographicBreakdown,
      paymentMethodBreakdown,
    ] = await Promise.all([
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${timeframe}, e.created_at) as period,
          SUM(e.amount) as earnings,
          SUM(e.commission) as commission,
          SUM(e.platform_fee) as platform_fee,
          COUNT(*) as transactions,
          COUNT(DISTINCT p.id) as unique_payments
        FROM "Earning" e
        JOIN "Payment" p ON e.payment_id = p.id
        WHERE e.instructor_id = ${instructorId}
          AND e.created_at >= ${currentYearStart}
          AND e.created_at <= ${currentYearEnd}
        GROUP BY DATE_TRUNC(${timeframe}, e.created_at)
        ORDER BY period ASC
      `,

      compareToLastYear
        ? prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${timeframe}, e.created_at) as period,
          SUM(e.commission) as earnings,
          COUNT(*) as transactions
        FROM "Earning" e
        WHERE e.instructor_id = ${instructorId}
          AND e.created_at >= ${lastYearStart}
          AND e.created_at <= ${lastYearEnd}
        GROUP BY DATE_TRUNC(${timeframe}, e.created_at)
        ORDER BY period ASC
      `
        : [],

      prisma.$queryRaw`
        SELECT 
          c.id,
          c.title,
          c.thumbnail,
          c.price,
          SUM(e.commission) as total_earnings,
          COUNT(*) as total_transactions,
          COUNT(DISTINCT en.student_id) as unique_students
        FROM "Earning" e
        JOIN "Payment" p ON e.payment_id = p.id
        JOIN "Enrollment" en ON p.id = en.payment_id
        JOIN "Course" c ON en.course_id = c.id
        WHERE e.instructor_id = ${instructorId}
          AND e.created_at >= ${currentYearStart}
          AND e.created_at <= ${currentYearEnd}
        GROUP BY c.id, c.title, c.thumbnail, c.price
        ORDER BY total_earnings DESC
        LIMIT 10
      `,

      prisma.$queryRaw`
        SELECT 
          u.country,
          COUNT(DISTINCT en.student_id) as student_count,
          SUM(e.commission) as total_earnings,
          COUNT(*) as transactions
        FROM "Earning" e
        JOIN "Payment" p ON e.payment_id = p.id
        JOIN "Enrollment" en ON p.id = en.payment_id
        JOIN "Student" s ON en.student_id = s.id
        JOIN "User" u ON s.user_id = u.id
        WHERE e.instructor_id = ${instructorId}
          AND e.created_at >= ${currentYearStart}
          AND e.created_at <= ${currentYearEnd}
          AND u.country IS NOT NULL
        GROUP BY u.country
        ORDER BY total_earnings DESC
        LIMIT 15
      `,

      prisma.$queryRaw`
        SELECT 
          p.method,
          p.gateway,
          SUM(e.commission) as total_earnings,
          COUNT(*) as transactions,
          AVG(e.commission) as avg_earning
        FROM "Earning" e
        JOIN "Payment" p ON e.payment_id = p.id
        WHERE e.instructor_id = ${instructorId}
          AND e.created_at >= ${currentYearStart}
          AND e.created_at <= ${currentYearEnd}
        GROUP BY p.method, p.gateway
        ORDER BY total_earnings DESC
      `,
    ]);

    // Calculate growth rates using utility function
    const currentTotal = currentYearEarnings.reduce(
      (sum, item) => sum + parseFloat(item.commission || 0),
      0
    );
    const previousTotal =
      compareToLastYear && lastYearEarnings.length > 0
        ? lastYearEarnings.reduce(
            (sum, item) => sum + parseFloat(item.earnings || 0),
            0
          )
        : 0;

    const growthRate = calculateGrowthRate(currentTotal, previousTotal);

    const analyticsData = {
      timeframe,
      year: parseInt(year),
      revenue: {
        current: currentYearEarnings.map((item) => ({
          period: item.period,
          earnings: formatCurrency(parseFloat(item.earnings || 0)),
          commission: formatCurrency(parseFloat(item.commission || 0)),
          platformFee: formatCurrency(parseFloat(item.platform_fee || 0)),
          transactions: parseInt(item.transactions || 0),
          uniquePayments: parseInt(item.unique_payments || 0),
        })),
        previous: compareToLastYear
          ? lastYearEarnings.map((item) => ({
              period: item.period,
              earnings: formatCurrency(parseFloat(item.earnings || 0)),
              transactions: parseInt(item.transactions || 0),
            }))
          : [],
      },
      topCourses: topPerformingCourses.map((course) => ({
        id: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        price: formatCurrency(parseFloat(course.price || 0)),
        totalEarnings: formatCurrency(parseFloat(course.total_earnings || 0)),
        totalTransactions: parseInt(course.total_transactions || 0),
        uniqueStudents: parseInt(course.unique_students || 0),
      })),
      geography: geographicBreakdown.map((item) => ({
        country: item.country || "Unknown",
        studentCount: parseInt(item.student_count || 0),
        totalEarnings: formatCurrency(parseFloat(item.total_earnings || 0)),
        transactions: parseInt(item.transactions || 0),
      })),
      paymentMethods: paymentMethodBreakdown.map((item) => ({
        method: item.method,
        gateway: item.gateway,
        totalEarnings: formatCurrency(parseFloat(item.total_earnings || 0)),
        transactions: parseInt(item.transactions || 0),
        averageEarning: formatCurrency(parseFloat(item.avg_earning || 0)),
      })),
      summary: {
        totalRevenue: formatCurrency(currentTotal),
        totalTransactions: currentYearEarnings.reduce(
          (sum, item) => sum + parseInt(item.transactions || 0),
          0
        ),
        averageTransactionValue: formatCurrency(
          currentYearEarnings.length > 0
            ? currentTotal /
                currentYearEarnings.reduce(
                  (sum, item) => sum + parseInt(item.transactions || 0),
                  0
                )
            : 0
        ),
        growthRate: Math.round(growthRate * 100) / 100,
      },
    };

    await redisService.setJSON(cacheKey, analyticsData, { ex: 900 });

    res.status(200).json({
      success: true,
      message: "Revenue analytics retrieved successfully",
      data: analyticsData,
    });
  } catch (error) {
    console.error("Get revenue analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve revenue analytics",
      error: error.message,
    });
  }
});

const getPaymentBreakdown = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { startDate, endDate, groupBy = "month" } = req.query;

  const cacheKey = `payment_breakdown:${instructorId}:${startDate || ""}:${
    endDate || ""
  }:${groupBy}`;

  try {
    let cachedData = await redisService.getJSON(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Payment breakdown retrieved successfully",
        data: cachedData,
        cached: true,
      });
    }

    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const where = { instructorId };
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter;
    }

    const [
      totalBreakdown,
      statusBreakdown,
      currencyBreakdown,
      commissionAnalysis,
    ] = await Promise.all([
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${groupBy}, e.created_at) as period,
          SUM(e.amount) as gross_earnings,
          SUM(e.commission) as instructor_commission,
          SUM(e.platform_fee) as platform_fees,
          COUNT(*) as transaction_count,
          AVG(e.amount) as avg_transaction
        FROM "Earning" e
        WHERE e.instructor_id = ${instructorId}
          ${startDate ? `AND e.created_at >= ${new Date(startDate)}` : ""}
          ${endDate ? `AND e.created_at <= ${new Date(endDate)}` : ""}
        GROUP BY DATE_TRUNC(${groupBy}, e.created_at)
        ORDER BY period DESC
      `,

      prisma.earning.groupBy({
        by: ["status"],
        where,
        _sum: {
          amount: true,
          commission: true,
          platformFee: true,
        },
        _count: true,
      }),

      prisma.earning.groupBy({
        by: ["currency"],
        where,
        _sum: {
          amount: true,
          commission: true,
          platformFee: true,
        },
        _count: true,
      }),

      prisma.$queryRaw`
        SELECT 
          i.commission_rate,
          COUNT(*) as transaction_count,
          SUM(e.amount) as total_amount,
          SUM(e.commission) as total_commission,
          AVG(e.commission / e.amount * 100) as avg_commission_rate
        FROM "Earning" e
        JOIN "Instructor" i ON e.instructor_id = i.id
        WHERE e.instructor_id = ${instructorId}
          ${startDate ? `AND e.created_at >= ${new Date(startDate)}` : ""}
          ${endDate ? `AND e.created_at <= ${new Date(endDate)}` : ""}
        GROUP BY i.commission_rate
      `,
    ]);

    const breakdownData = {
      timeline: totalBreakdown.map((item) => ({
        period: item.period,
        grossEarnings: formatCurrency(parseFloat(item.gross_earnings || 0)),
        instructorCommission: formatCurrency(
          parseFloat(item.instructor_commission || 0)
        ),
        platformFees: formatCurrency(parseFloat(item.platform_fees || 0)),
        transactionCount: parseInt(item.transaction_count || 0),
        averageTransaction: formatCurrency(
          parseFloat(item.avg_transaction || 0)
        ),
      })),
      byStatus: statusBreakdown.map((item) => ({
        status: item.status,
        amount: formatCurrency(item._sum.amount || 0),
        commission: formatCurrency(item._sum.commission || 0),
        platformFee: formatCurrency(item._sum.platformFee || 0),
        count: item._count,
      })),
      byCurrency: currencyBreakdown.map((item) => ({
        currency: item.currency,
        amount: formatCurrency(item._sum.amount || 0, item.currency),
        commission: formatCurrency(item._sum.commission || 0, item.currency),
        platformFee: formatCurrency(item._sum.platformFee || 0, item.currency),
        count: item._count,
      })),
      commissionAnalysis: commissionAnalysis.map((item) => ({
        commissionRate: parseFloat(item.commission_rate || 0),
        transactionCount: parseInt(item.transaction_count || 0),
        totalAmount: formatCurrency(parseFloat(item.total_amount || 0)),
        totalCommission: formatCurrency(parseFloat(item.total_commission || 0)),
        averageCommissionRate: parseFloat(item.avg_commission_rate || 0),
      })),
      summary: {
        totalGrossEarnings: formatCurrency(
          totalBreakdown.reduce(
            (sum, item) => sum + parseFloat(item.gross_earnings || 0),
            0
          )
        ),
        totalCommission: formatCurrency(
          totalBreakdown.reduce(
            (sum, item) => sum + parseFloat(item.instructor_commission || 0),
            0
          )
        ),
        totalPlatformFees: formatCurrency(
          totalBreakdown.reduce(
            (sum, item) => sum + parseFloat(item.platform_fees || 0),
            0
          )
        ),
        totalTransactions: totalBreakdown.reduce(
          (sum, item) => sum + parseInt(item.transaction_count || 0),
          0
        ),
      },
    };

    await redisService.setJSON(cacheKey, breakdownData, { ex: 600 });

    res.status(200).json({
      success: true,
      message: "Payment breakdown retrieved successfully",
      data: breakdownData,
    });
  } catch (error) {
    console.error("Get payment breakdown error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve payment breakdown",
      error: error.message,
    });
  }
});

const updatePaymentDetails = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const { paymentDetails } = req.body;

  try {
    if (!paymentDetails || typeof paymentDetails !== "object") {
      return res.status(400).json({
        success: false,
        message: "Valid payment details are required",
      });
    }

    const requiredFields = ["accountType", "accountNumber", "bankName"];
    const missingFields = requiredFields.filter(
      (field) => !paymentDetails[field]
    );

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required payment details",
        missingFields,
      });
    }

    const updatedInstructor = await prisma.instructor.update({
      where: { id: instructorId },
      data: {
        paymentDetails: {
          ...paymentDetails,
          updatedAt: new Date().toISOString(),
        },
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

    await notificationService.createNotification({
      userId: updatedInstructor.user.id,
      type: "payment_details_updated",
      title: "Payment Details Updated",
      message: "Your payment details have been successfully updated.",
      data: {
        updatedAt: new Date().toISOString(),
      },
    });

    await redisService.delPattern(`earnings_overview:${instructorId}`);

    res.status(200).json({
      success: true,
      message: "Payment details updated successfully",
      data: {
        paymentDetails: updatedInstructor.paymentDetails,
      },
    });
  } catch (error) {
    console.error("Update payment details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update payment details",
      error: error.message,
    });
  }
});

const getFinancialDashboard = asyncHandler(async (req, res) => {
  const instructorId = req.instructorProfile.id;
  const cacheKey = `financial_dashboard:${instructorId}`;

  try {
    let cachedData = await redisService.getJSON(cacheKey);
    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Financial dashboard retrieved successfully",
        data: cachedData,
        cached: true,
      });
    }

    // Use utility function for metrics calculation
    const monthlyMetrics = await getEarningsMetrics(instructorId, "monthly");
    const weeklyMetrics = await getEarningsMetrics(instructorId, "weekly");

    const [upcomingPayouts, recentTransactions, performanceMetrics] =
      await Promise.all([
        prisma.payout.findMany({
          where: {
            instructorId,
            status: { in: ["PENDING", "PROCESSING"] },
          },
          orderBy: { requestedAt: "desc" },
          take: 5,
        }),

        prisma.earning.findMany({
          where: { instructorId },
          include: {
            payment: {
              include: {
                enrollments: {
                  include: {
                    course: {
                      select: { title: true, thumbnail: true },
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),

        prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT en.student_id) as total_students,
          COUNT(DISTINCT c.id) as active_courses,
          AVG(e.commission) as avg_transaction_value,
          SUM(CASE WHEN e.created_at >= ${new Date(
            Date.now() - 30 * 24 * 60 * 60 * 1000
          )} THEN 1 ELSE 0 END) as recent_sales
        FROM "Earning" e
        JOIN "Payment" p ON e.payment_id = p.id
        JOIN "Enrollment" en ON p.id = en.payment_id
        JOIN "Course" c ON en.course_id = c.id
        WHERE e.instructor_id = ${instructorId}
      `,
      ]);

    const dashboardData = {
      quickStats: {
        last30DaysEarnings: formatCurrency(monthlyMetrics.current.commission),
        last30DaysEarningsRaw: monthlyMetrics.current.commission,
        last30DaysTransactions: monthlyMetrics.current.transactions,
        last7DaysEarnings: formatCurrency(weeklyMetrics.current.commission),
        last7DaysEarningsRaw: weeklyMetrics.current.commission,
        earningsGrowth: Math.round(monthlyMetrics.growth.earnings * 100) / 100,
        transactionGrowth:
          Math.round(monthlyMetrics.growth.transactions * 100) / 100,
        totalStudents: parseInt(performanceMetrics[0]?.total_students || 0),
        activeCourses: parseInt(performanceMetrics[0]?.active_courses || 0),
        averageTransactionValue: formatCurrency(
          parseFloat(performanceMetrics[0]?.avg_transaction_value || 0)
        ),
        recentSales: parseInt(performanceMetrics[0]?.recent_sales || 0),
      },
      upcomingPayouts: upcomingPayouts.map((payout) => ({
        id: payout.id,
        amount: formatCurrency(payout.amount, payout.currency),
        currency: payout.currency,
        status: payout.status,
        requestedAt: payout.requestedAt,
        reference: payout.gatewayId,
        estimatedProcessingTime:
          payout.status === "PENDING" ? "2-3 business days" : "Processing",
      })),
      recentActivity: recentTransactions.map((earning) => ({
        id: earning.id,
        amount: formatCurrency(earning.commission),
        course: earning.payment.enrollments[0]?.course || null,
        createdAt: earning.createdAt,
        type: "earning",
      })),
      alerts: [],
    };

    // Generate alerts based on conditions
    if (
      upcomingPayouts.length === 0 &&
      monthlyMetrics.current.commission > 100
    ) {
      dashboardData.alerts.push({
        type: "info",
        message: `You have ${formatCurrency(
          monthlyMetrics.current.commission
        )} available for payout. Consider requesting a payout.`,
        action: "request_payout",
      });
    }

    if (monthlyMetrics.current.transactions === 0) {
      dashboardData.alerts.push({
        type: "warning",
        message:
          "No sales in the last 30 days. Consider promoting your courses.",
        action: "view_analytics",
      });
    }

    if (monthlyMetrics.growth.earnings < -20) {
      dashboardData.alerts.push({
        type: "warning",
        message:
          "Earnings have decreased significantly compared to last period.",
        action: "view_detailed_analytics",
      });
    }

    await redisService.setJSON(cacheKey, dashboardData, { ex: 600 });

    res.status(200).json({
      success: true,
      message: "Financial dashboard retrieved successfully",
      data: dashboardData,
    });
  } catch (error) {
    console.error("Get financial dashboard error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve financial dashboard",
      error: error.message,
    });
  }
});

export {
  getEarningsOverview,
  getEarningsStats,
  getDetailedEarnings,
  getCourseEarnings,
  requestPayout,
  getPayoutHistory,
  getRevenueAnalytics,
  getPaymentBreakdown,
  generateFinancialReport,
  updatePaymentDetails,
  getFinancialDashboard,
};
