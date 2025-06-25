import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";

const prisma = new PrismaClient();

const generateAnalyticsId = () => {
  return `analytics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const calculateGrowthRate = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return (((current - previous) / previous) * 100).toFixed(2);
};

const getDateRange = (period) => {
  const now = new Date();
  const ranges = {
    "7d": new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    "30d": new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    "90d": new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
    "1y": new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
    all: new Date("2020-01-01"),
  };
  return ranges[period] || ranges["30d"];
};

export const getDashboardOverview = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "30d", refresh = false } = req.query;

    const cacheKey = `admin_dashboard_overview:${period}`;

    if (!refresh) {
      const cachedData = await redisService.getJSON(cacheKey);
      if (cachedData) {
        return res.status(200).json({
          success: true,
          message: "Dashboard overview retrieved successfully",
          data: cachedData,
          meta: {
            cached: true,
            executionTime: Math.round(performance.now() - startTime),
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    const fromDate = getDateRange(period);
    const previousPeriodStart = new Date(
      fromDate.getTime() - (Date.now() - fromDate.getTime())
    );

    const [
      totalUsers,
      totalCourses,
      totalRevenue,
      totalEnrollments,
      recentUsers,
      recentCourses,
      recentRevenue,
      recentEnrollments,
      previousUsers,
      previousCourses,
      previousRevenue,
      previousEnrollments,
      activeUsers,
      publishedCourses,
      pendingCourses,
      verifiedInstructors,
      totalInstructors,
      avgCourseRating,
      totalReviews,
      supportTickets,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.course.count(),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: "COMPLETED" },
      }),
      prisma.enrollment.count(),

      prisma.user.count({
        where: { createdAt: { gte: fromDate } },
      }),
      prisma.course.count({
        where: { createdAt: { gte: fromDate } },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: "COMPLETED",
          createdAt: { gte: fromDate },
        },
      }),
      prisma.enrollment.count({
        where: { createdAt: { gte: fromDate } },
      }),

      prisma.user.count({
        where: {
          createdAt: {
            gte: previousPeriodStart,
            lt: fromDate,
          },
        },
      }),
      prisma.course.count({
        where: {
          createdAt: {
            gte: previousPeriodStart,
            lt: fromDate,
          },
        },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: "COMPLETED",
          createdAt: {
            gte: previousPeriodStart,
            lt: fromDate,
          },
        },
      }),
      prisma.enrollment.count({
        where: {
          createdAt: {
            gte: previousPeriodStart,
            lt: fromDate,
          },
        },
      }),

      prisma.user.count({
        where: {
          isActive: true,
          lastLogin: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.course.count({
        where: { status: "PUBLISHED" },
      }),
      prisma.course.count({
        where: { status: "UNDER_REVIEW" },
      }),
      prisma.instructor.count({
        where: { isVerified: true },
      }),
      prisma.instructor.count(),
      prisma.course.aggregate({
        _avg: { averageRating: true },
        where: { status: "PUBLISHED" },
      }),
      prisma.review.count(),
      prisma.supportTicket.count({
        where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
      }),
    ]);

    const overview = {
      users: {
        total: totalUsers,
        recent: recentUsers,
        active: activeUsers,
        growth: calculateGrowthRate(recentUsers, previousUsers),
        activePercentage:
          totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : 0,
      },
      courses: {
        total: totalCourses,
        recent: recentCourses,
        published: publishedCourses,
        pending: pendingCourses,
        growth: calculateGrowthRate(recentCourses, previousCourses),
        publishedPercentage:
          totalCourses > 0
            ? ((publishedCourses / totalCourses) * 100).toFixed(1)
            : 0,
      },
      revenue: {
        total: Number(totalRevenue._sum?.amount || 0),
        recent: Number(recentRevenue._sum?.amount || 0),
        growth: calculateGrowthRate(
          Number(recentRevenue._sum?.amount || 0),
          Number(previousRevenue._sum?.amount || 0)
        ),
        averagePerUser:
          totalUsers > 0
            ? (Number(totalRevenue._sum?.amount || 0) / totalUsers).toFixed(2)
            : 0,
      },
      enrollments: {
        total: totalEnrollments,
        recent: recentEnrollments,
        growth: calculateGrowthRate(recentEnrollments, previousEnrollments),
        averagePerCourse:
          publishedCourses > 0
            ? (totalEnrollments / publishedCourses).toFixed(1)
            : 0,
      },
      instructors: {
        total: totalInstructors,
        verified: verifiedInstructors,
        verificationRate:
          totalInstructors > 0
            ? ((verifiedInstructors / totalInstructors) * 100).toFixed(1)
            : 0,
      },
      quality: {
        averageRating: Number(avgCourseRating._avg?.averageRating || 0).toFixed(
          1
        ),
        totalReviews,
        pendingSupport: supportTickets,
      },
      period,
      lastUpdated: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, overview, { ex: 1800 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Dashboard overview retrieved successfully",
      data: overview,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Dashboard overview error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve dashboard overview",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getUserAnalytics = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "30d", groupBy = "day" } = req.query;

    const cacheKey = `user_analytics:${period}:${groupBy}`;
    const cachedData = await redisService.getJSON(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "User analytics retrieved successfully",
        data: cachedData,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const fromDate = getDateRange(period);

    const [
      userGrowth,
      usersByRole,
      usersByStatus,
      topCountries,
      deviceStats,
      retentionStats,
      engagementStats,
    ] = await Promise.all([
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${groupBy}, "createdAt") as date,
          COUNT(*) as count,
          COUNT(CASE WHEN role = 'STUDENT' THEN 1 END) as students,
          COUNT(CASE WHEN role = 'INSTRUCTOR' THEN 1 END) as instructors
        FROM "User"
        WHERE "createdAt" >= ${fromDate}
        GROUP BY DATE_TRUNC(${groupBy}, "createdAt")
        ORDER BY date
      `,

      prisma.user.groupBy({
        by: ["role"],
        _count: { role: true },
        where: { createdAt: { gte: fromDate } },
      }),

      prisma.user.groupBy({
        by: ["isActive"],
        _count: { isActive: true },
      }),

      prisma.user.groupBy({
        by: ["country"],
        _count: { country: true },
        where: {
          country: { not: null },
          createdAt: { gte: fromDate },
        },
        orderBy: { _count: { country: "desc" } },
        take: 10,
      }),

      prisma.session.groupBy({
        by: ["deviceType"],
        _count: { deviceType: true },
        where: { createdAt: { gte: fromDate } },
      }),

      prisma.user.findMany({
        select: {
          id: true,
          createdAt: true,
          lastLogin: true,
        },
        where: { createdAt: { gte: fromDate } },
      }),

      prisma.userActivity.groupBy({
        by: ["action"],
        _count: { action: true },
        where: { createdAt: { gte: fromDate } },
        orderBy: { _count: { action: "desc" } },
        take: 10,
      }),
    ]);

    const now = new Date();
    const retention = {
      day1: 0,
      day7: 0,
      day30: 0,
    };

    retentionStats.forEach((user) => {
      if (user.lastLogin) {
        const daysSinceSignup = Math.floor(
          (now - user.createdAt) / (1000 * 60 * 60 * 24)
        );
        const daysSinceLastLogin = Math.floor(
          (now - user.lastLogin) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceSignup >= 1 && daysSinceLastLogin <= 1) retention.day1++;
        if (daysSinceSignup >= 7 && daysSinceLastLogin <= 7) retention.day7++;
        if (daysSinceSignup >= 30 && daysSinceLastLogin <= 30)
          retention.day30++;
      }
    });

    const analytics = {
      growth: userGrowth.map((item) => ({
        date: item.date,
        total: Number(item.count),
        students: Number(item.students),
        instructors: Number(item.instructors),
      })),
      demographics: {
        byRole: usersByRole.map((item) => ({
          role: item.role,
          count: item._count.role,
        })),
        byStatus: usersByStatus.map((item) => ({
          status: item.isActive ? "Active" : "Inactive",
          count: item._count.isActive,
        })),
        byCountry: topCountries.map((item) => ({
          country: item.country,
          count: item._count.country,
        })),
      },
      devices: deviceStats.map((item) => ({
        type: item.deviceType,
        count: item._count.deviceType,
      })),
      retention: {
        day1Retention:
          retentionStats.length > 0
            ? ((retention.day1 / retentionStats.length) * 100).toFixed(2)
            : 0,
        day7Retention:
          retentionStats.length > 0
            ? ((retention.day7 / retentionStats.length) * 100).toFixed(2)
            : 0,
        day30Retention:
          retentionStats.length > 0
            ? ((retention.day30 / retentionStats.length) * 100).toFixed(2)
            : 0,
      },
      engagement: engagementStats.map((item) => ({
        action: item.action,
        count: item._count.action,
      })),
      period,
      lastUpdated: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, analytics, { ex: 3600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "User analytics retrieved successfully",
      data: analytics,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("User analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve user analytics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCourseAnalytics = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "30d", groupBy = "day" } = req.query;

    const cacheKey = `course_analytics:${period}:${groupBy}`;
    const cachedData = await redisService.getJSON(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Course analytics retrieved successfully",
        data: cachedData,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const fromDate = getDateRange(period);

    const [
      courseCreation,
      coursesByCategory,
      coursesByLevel,
      coursesByStatus,
      topCourses,
      performanceMetrics,
      enrollmentTrends,
      revenueByCourse,
      completionRates,
      ratingDistribution,
    ] = await Promise.all([
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${groupBy}, "createdAt") as date,
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'PUBLISHED' THEN 1 END) as published,
          COUNT(CASE WHEN status = 'DRAFT' THEN 1 END) as drafts
        FROM "Course"
        WHERE "createdAt" >= ${fromDate}
        GROUP BY DATE_TRUNC(${groupBy}, "createdAt")
        ORDER BY date
      `,

      prisma.course.groupBy({
        by: ["categoryId"],
        _count: { categoryId: true },
        where: { createdAt: { gte: fromDate } },
        orderBy: { _count: { categoryId: "desc" } },
        take: 10,
      }),

      prisma.course.groupBy({
        by: ["level"],
        _count: { level: true },
        where: { createdAt: { gte: fromDate } },
      }),

      prisma.course.groupBy({
        by: ["status"],
        _count: { status: true },
      }),

      prisma.course.findMany({
        select: {
          id: true,
          title: true,
          totalEnrollments: true,
          averageRating: true,
          totalRevenue: true,
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
        where: {
          status: "PUBLISHED",
          createdAt: { gte: fromDate },
        },
        orderBy: { totalEnrollments: "desc" },
        take: 10,
      }),

      prisma.course.aggregate({
        _avg: {
          averageRating: true,
          totalEnrollments: true,
          completionRate: true,
        },
        where: {
          status: "PUBLISHED",
          createdAt: { gte: fromDate },
        },
      }),

      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${groupBy}, e."createdAt") as date,
          COUNT(*) as enrollments
        FROM "Enrollment" e
        WHERE e."createdAt" >= ${fromDate}
        GROUP BY DATE_TRUNC(${groupBy}, e."createdAt")
        ORDER BY date
      `,

      prisma.course.findMany({
        select: {
          id: true,
          title: true,
          totalRevenue: true,
          price: true,
          totalEnrollments: true,
        },
        where: {
          status: "PUBLISHED",
          totalRevenue: { gt: 0 },
        },
        orderBy: { totalRevenue: "desc" },
        take: 10,
      }),

      prisma.course.findMany({
        select: {
          id: true,
          title: true,
          completionRate: true,
          totalEnrollments: true,
        },
        where: {
          status: "PUBLISHED",
          totalEnrollments: { gt: 0 },
        },
        orderBy: { completionRate: "desc" },
        take: 10,
      }),

      prisma.course.groupBy({
        by: ["averageRating"],
        _count: { averageRating: true },
        where: {
          status: "PUBLISHED",
          averageRating: { gt: 0 },
        },
      }),
    ]);

    const categoryDetails = await prisma.category.findMany({
      where: {
        id: { in: coursesByCategory.map((item) => item.categoryId) },
      },
      select: {
        id: true,
        name: true,
      },
    });

    const analytics = {
      creation: courseCreation.map((item) => ({
        date: item.date,
        total: Number(item.total),
        published: Number(item.published),
        drafts: Number(item.drafts),
      })),
      distribution: {
        byCategory: coursesByCategory.map((item) => {
          const category = categoryDetails.find(
            (c) => c.id === item.categoryId
          );
          return {
            category: category?.name || "Unknown",
            count: item._count.categoryId,
          };
        }),
        byLevel: coursesByLevel.map((item) => ({
          level: item.level,
          count: item._count.level,
        })),
        byStatus: coursesByStatus.map((item) => ({
          status: item.status,
          count: item._count.status,
        })),
      },
      performance: {
        averageRating: Number(
          performanceMetrics._avg?.averageRating || 0
        ).toFixed(2),
        averageEnrollments: Number(
          performanceMetrics._avg?.totalEnrollments || 0
        ).toFixed(0),
        averageCompletionRate: Number(
          performanceMetrics._avg?.completionRate || 0
        ).toFixed(2),
      },
      topPerformers: {
        byEnrollments: topCourses.map((course) => ({
          id: course.id,
          title: course.title,
          enrollments: course.totalEnrollments,
          rating: Number(course.averageRating).toFixed(1),
          revenue: Number(course.totalRevenue),
          instructor: `${course.instructor.user.firstName} ${course.instructor.user.lastName}`,
        })),
        byRevenue: revenueByCourse.map((course) => ({
          id: course.id,
          title: course.title,
          revenue: Number(course.totalRevenue),
          price: Number(course.price),
          enrollments: course.totalEnrollments,
          revenuePerEnrollment:
            course.totalEnrollments > 0
              ? (Number(course.totalRevenue) / course.totalEnrollments).toFixed(
                  2
                )
              : 0,
        })),
        byCompletion: completionRates.map((course) => ({
          id: course.id,
          title: course.title,
          completionRate: Number(course.completionRate).toFixed(2),
          enrollments: course.totalEnrollments,
        })),
      },
      trends: {
        enrollments: enrollmentTrends.map((item) => ({
          date: item.date,
          count: Number(item.enrollments),
        })),
      },
      ratings: {
        distribution: ratingDistribution.reduce((acc, item) => {
          const rating = Math.floor(Number(item.averageRating));
          acc[`${rating}star`] =
            (acc[`${rating}star`] || 0) + item._count.averageRating;
          return acc;
        }, {}),
      },
      period,
      lastUpdated: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, analytics, { ex: 3600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Course analytics retrieved successfully",
      data: analytics,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Course analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve course analytics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getRevenueAnalytics = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "30d", groupBy = "day", currency = "INR" } = req.query;

    const cacheKey = `revenue_analytics:${period}:${groupBy}:${currency}`;
    const cachedData = await redisService.getJSON(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Revenue analytics retrieved successfully",
        data: cachedData,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const fromDate = getDateRange(period);

    const [
      revenueTrends,
      revenueByMethod,
      revenueByGateway,
      topEarningInstructors,
      refundAnalytics,
      monthlyRecurring,
      conversionFunnel,
      transactionStats,
    ] = await Promise.all([
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC(${groupBy}, "createdAt") as date,
          SUM(amount) as revenue,
          COUNT(*) as transactions,
          AVG(amount) as avg_transaction
        FROM "Payment"
        WHERE "createdAt" >= ${fromDate} 
        AND status = 'COMPLETED'
        AND currency = ${currency}
        GROUP BY DATE_TRUNC(${groupBy}, "createdAt")
        ORDER BY date
      `,

      prisma.payment.groupBy({
        by: ["method"],
        _sum: { amount: true },
        _count: { method: true },
        where: {
          status: "COMPLETED",
          createdAt: { gte: fromDate },
          currency,
        },
      }),

      prisma.payment.groupBy({
        by: ["gateway"],
        _sum: { amount: true },
        _count: { gateway: true },
        where: {
          status: "COMPLETED",
          createdAt: { gte: fromDate },
          currency,
        },
      }),

      prisma.instructor.findMany({
        select: {
          id: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          totalRevenue: true,
          totalStudents: true,
          totalCourses: true,
          earnings: {
            select: {
              amount: true,
            },
            where: {
              createdAt: { gte: fromDate },
              status: "PAID",
            },
          },
        },
        orderBy: { totalRevenue: "desc" },
        take: 10,
      }),

      prisma.payment.aggregate({
        _sum: { refundAmount: true },
        _count: { refundAmount: true },
        where: {
          status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] },
          createdAt: { gte: fromDate },
          currency,
        },
      }),

      prisma.$queryRaw`
        SELECT 
          EXTRACT(MONTH FROM "createdAt") as month,
          EXTRACT(YEAR FROM "createdAt") as year,
          SUM(amount) as revenue,
          COUNT(DISTINCT "courseId") as unique_courses
        FROM "Payment" p
        JOIN "Enrollment" e ON p.id = e."paymentId"
        WHERE p.status = 'COMPLETED' 
        AND p.currency = ${currency}
        AND p."createdAt" >= ${fromDate}
        GROUP BY EXTRACT(YEAR FROM "createdAt"), EXTRACT(MONTH FROM "createdAt")
        ORDER BY year, month
      `,

      prisma.$queryRaw`
        SELECT 
          'cart_created' as stage,
          COUNT(*) as count
        FROM "CartItem"
        WHERE "createdAt" >= ${fromDate}
        UNION ALL
        SELECT 
          'payment_initiated' as stage,
          COUNT(*) as count
        FROM "Payment"
        WHERE "createdAt" >= ${fromDate}
        UNION ALL
        SELECT 
          'payment_completed' as stage,
          COUNT(*) as count
        FROM "Payment"
        WHERE "createdAt" >= ${fromDate} AND status = 'COMPLETED'
      `,

      prisma.payment.aggregate({
        _sum: { amount: true },
        _avg: { amount: true },
        _count: { id: true },
        where: {
          status: "COMPLETED",
          createdAt: { gte: fromDate },
          currency,
        },
      }),
    ]);

    const analytics = {
      overview: {
        totalRevenue: Number(transactionStats._sum?.amount || 0),
        averageTransaction: Number(transactionStats._avg?.amount || 0).toFixed(
          2
        ),
        totalTransactions: transactionStats._count?.id || 0,
        refundAmount: Number(refundAnalytics._sum?.refundAmount || 0),
        refundRate:
          transactionStats._count?.id > 0
            ? (
                ((refundAnalytics._count?.refundAmount || 0) /
                  transactionStats._count.id) *
                100
              ).toFixed(2)
            : 0,
      },
      trends: revenueTrends.map((item) => ({
        date: item.date,
        revenue: Number(item.revenue),
        transactions: Number(item.transactions),
        averageTransaction: Number(item.avg_transaction).toFixed(2),
      })),
      breakdown: {
        byMethod: revenueByMethod.map((item) => ({
          method: item.method,
          revenue: Number(item._sum.amount),
          transactions: item._count.method,
          percentage:
            transactionStats._sum?.amount > 0
              ? (
                  (Number(item._sum.amount) /
                    Number(transactionStats._sum.amount)) *
                  100
                ).toFixed(2)
              : 0,
        })),
        byGateway: revenueByGateway.map((item) => ({
          gateway: item.gateway,
          revenue: Number(item._sum.amount),
          transactions: item._count.gateway,
          percentage:
            transactionStats._sum?.amount > 0
              ? (
                  (Number(item._sum.amount) /
                    Number(transactionStats._sum.amount)) *
                  100
                ).toFixed(2)
              : 0,
        })),
      },
      topEarners: topEarningInstructors.map((instructor) => ({
        id: instructor.id,
        name: `${instructor.user.firstName} ${instructor.user.lastName}`,
        totalRevenue: Number(instructor.totalRevenue),
        recentEarnings: instructor.earnings.reduce(
          (sum, earning) => sum + Number(earning.amount),
          0
        ),
        totalStudents: instructor.totalStudents,
        totalCourses: instructor.totalCourses,
        revenuePerStudent:
          instructor.totalStudents > 0
            ? (
                Number(instructor.totalRevenue) / instructor.totalStudents
              ).toFixed(2)
            : 0,
      })),
      monthly: monthlyRecurring.map((item) => ({
        month: Number(item.month),
        year: Number(item.year),
        revenue: Number(item.revenue),
        uniqueCourses: Number(item.unique_courses),
      })),
      funnel: conversionFunnel.reduce((acc, item) => {
        acc[item.stage] = Number(item.count);
        return acc;
      }, {}),
      currency,
      period,
      lastUpdated: new Date().toISOString(),
    };

    if (analytics.funnel.cart_created > 0) {
      analytics.conversion = {
        cartToPayment:
          analytics.funnel.payment_initiated > 0
            ? (
                (analytics.funnel.payment_initiated /
                  analytics.funnel.cart_created) *
                100
              ).toFixed(2)
            : 0,
        paymentToComplete:
          analytics.funnel.payment_initiated > 0
            ? (
                (analytics.funnel.payment_completed /
                  analytics.funnel.payment_initiated) *
                100
              ).toFixed(2)
            : 0,
        overallConversion:
          analytics.funnel.cart_created > 0
            ? (
                (analytics.funnel.payment_completed /
                  analytics.funnel.cart_created) *
                100
              ).toFixed(2)
            : 0,
      };
    }

    await redisService.setJSON(cacheKey, analytics, { ex: 3600 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Revenue analytics retrieved successfully",
      data: analytics,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Revenue analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve revenue analytics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getEngagementAnalytics = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { period = "30d" } = req.query;

    const cacheKey = `engagement_analytics:${period}`;
    const cachedData = await redisService.getJSON(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Engagement analytics retrieved successfully",
        data: cachedData,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const fromDate = getDateRange(period);

    const [
      totalSessions,
      averageSessionTime,
      pageViews,
      topPages,
      deviceUsage,
      browserUsage,
      learningActivity,
      contentInteractions,
      completionStats,
      socialActivity,
    ] = await Promise.all([
      prisma.session.count({
        where: { createdAt: { gte: fromDate } },
      }),

      prisma.session.aggregate({
        _avg: { sessionDuration: true },
        where: {
          createdAt: { gte: fromDate },
          sessionDuration: { not: null },
        },
      }),

      prisma.userActivity.count({
        where: {
          action: "page_view",
          createdAt: { gte: fromDate },
        },
      }),

      prisma.userActivity.groupBy({
        by: ["page"],
        _count: { page: true },
        where: {
          action: "page_view",
          createdAt: { gte: fromDate },
          page: { not: null },
        },
        orderBy: { _count: { page: "desc" } },
        take: 10,
      }),

      prisma.session.groupBy({
        by: ["deviceType"],
        _count: { deviceType: true },
        where: { createdAt: { gte: fromDate } },
      }),

      prisma.session.groupBy({
        by: ["browser"],
        _count: { browser: true },
        where: {
          createdAt: { gte: fromDate },
          browser: { not: null },
        },
      }),

      prisma.lessonCompletion.count({
        where: { completedAt: { gte: fromDate } },
      }),

      prisma.userActivity.groupBy({
        by: ["action"],
        _count: { action: true },
        where: {
          createdAt: { gte: fromDate },
          action: {
            in: [
              "video_play",
              "video_pause",
              "quiz_start",
              "quiz_complete",
              "download",
              "bookmark",
            ],
          },
        },
      }),

      prisma.enrollment.aggregate({
        _avg: { progress: true },
        where: { createdAt: { gte: fromDate } },
      }),

      prisma.review.count({
        where: { createdAt: { gte: fromDate } },
      }),
    ]);

    const analytics = {
      overview: {
        totalSessions,
        averageSessionTime: Math.round(
          Number(averageSessionTime._avg?.sessionDuration || 0) / 60
        ),
        totalPageViews: pageViews,
        pagesPerSession:
          totalSessions > 0 ? (pageViews / totalSessions).toFixed(2) : 0,
      },
      traffic: {
        topPages: topPages.map((item) => ({
          page: item.page,
          views: item._count.page,
        })),
        deviceUsage: deviceUsage.map((item) => ({
          device: item.deviceType,
          sessions: item._count.deviceType,
          percentage:
            totalSessions > 0
              ? ((item._count.deviceType / totalSessions) * 100).toFixed(1)
              : 0,
        })),
        browserUsage: browserUsage.map((item) => ({
          browser: item.browser,
          sessions: item._count.browser,
          percentage:
            totalSessions > 0
              ? ((item._count.browser / totalSessions) * 100).toFixed(1)
              : 0,
        })),
      },
      learning: {
        lessonsCompleted: learningActivity,
        averageProgress: Number(completionStats._avg?.progress || 0).toFixed(2),
        contentInteractions: contentInteractions.reduce((acc, item) => {
          acc[item.action] = item._count.action;
          return acc;
        }, {}),
      },
      social: {
        totalReviews: socialActivity,
        reviewsPerDay:
          period === "30d"
            ? (socialActivity / 30).toFixed(1)
            : period === "7d"
            ? (socialActivity / 7).toFixed(1)
            : socialActivity,
      },
      period,
      lastUpdated: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, analytics, { ex: 1800 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Engagement analytics retrieved successfully",
      data: analytics,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Engagement analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve engagement analytics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getComparativeAnalytics = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      period1 = "30d",
      period2 = "60d",
      metrics = "users,courses,revenue,enrollments",
    } = req.query;

    const cacheKey = `comparative_analytics:${period1}:${period2}:${metrics}`;
    const cachedData = await redisService.getJSON(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Comparative analytics retrieved successfully",
        data: cachedData,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const fromDate1 = getDateRange(period1);
    const fromDate2 = getDateRange(period2);
    const metricsArray = metrics.split(",");

    const comparativeData = {};

    if (metricsArray.includes("users")) {
      const [users1, users2] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: fromDate1 } } }),
        prisma.user.count({
          where: {
            createdAt: {
              gte: fromDate2,
              lt: fromDate1,
            },
          },
        }),
      ]);

      comparativeData.users = {
        period1: { value: users1, period: period1 },
        period2: { value: users2, period: period2 },
        growth: calculateGrowthRate(users1, users2),
        difference: users1 - users2,
      };
    }

    if (metricsArray.includes("courses")) {
      const [courses1, courses2] = await Promise.all([
        prisma.course.count({ where: { createdAt: { gte: fromDate1 } } }),
        prisma.course.count({
          where: {
            createdAt: {
              gte: fromDate2,
              lt: fromDate1,
            },
          },
        }),
      ]);

      comparativeData.courses = {
        period1: { value: courses1, period: period1 },
        period2: { value: courses2, period: period2 },
        growth: calculateGrowthRate(courses1, courses2),
        difference: courses1 - courses2,
      };
    }

    if (metricsArray.includes("revenue")) {
      const [revenue1, revenue2] = await Promise.all([
        prisma.payment.aggregate({
          _sum: { amount: true },
          where: {
            status: "COMPLETED",
            createdAt: { gte: fromDate1 },
          },
        }),
        prisma.payment.aggregate({
          _sum: { amount: true },
          where: {
            status: "COMPLETED",
            createdAt: {
              gte: fromDate2,
              lt: fromDate1,
            },
          },
        }),
      ]);

      const rev1 = Number(revenue1._sum?.amount || 0);
      const rev2 = Number(revenue2._sum?.amount || 0);

      comparativeData.revenue = {
        period1: { value: rev1, period: period1 },
        period2: { value: rev2, period: period2 },
        growth: calculateGrowthRate(rev1, rev2),
        difference: rev1 - rev2,
      };
    }

    if (metricsArray.includes("enrollments")) {
      const [enrollments1, enrollments2] = await Promise.all([
        prisma.enrollment.count({ where: { createdAt: { gte: fromDate1 } } }),
        prisma.enrollment.count({
          where: {
            createdAt: {
              gte: fromDate2,
              lt: fromDate1,
            },
          },
        }),
      ]);

      comparativeData.enrollments = {
        period1: { value: enrollments1, period: period1 },
        period2: { value: enrollments2, period: period2 },
        growth: calculateGrowthRate(enrollments1, enrollments2),
        difference: enrollments1 - enrollments2,
      };
    }

    const analytics = {
      comparison: comparativeData,
      summary: {
        totalMetrics: Object.keys(comparativeData).length,
        improvingMetrics: Object.values(comparativeData).filter(
          (metric) => metric.growth > 0
        ).length,
        decliningMetrics: Object.values(comparativeData).filter(
          (metric) => metric.growth < 0
        ).length,
      },
      periods: { period1, period2 },
      lastUpdated: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, analytics, { ex: 1800 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Comparative analytics retrieved successfully",
      data: analytics,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Comparative analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve comparative analytics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getRealtimeStats = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const cacheKey = "realtime_stats";
    const cachedData = await redisService.getJSON(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        message: "Real-time statistics retrieved successfully",
        data: cachedData,
        meta: {
          cached: true,
          executionTime: Math.round(performance.now() - startTime),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);

    const [
      activeUsers,
      newSignups24h,
      newSignupsHour,
      paymentsToday,
      recentActivity,
      systemHealth,
      liveEnrollments,
    ] = await Promise.all([
      prisma.session.count({
        where: {
          isActive: true,
          lastActivity: { gte: new Date(Date.now() - 30 * 60 * 1000) },
        },
      }),

      prisma.user.count({
        where: { createdAt: { gte: last24Hours } },
      }),

      prisma.user.count({
        where: { createdAt: { gte: lastHour } },
      }),

      prisma.payment.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: {
          status: "COMPLETED",
          createdAt: { gte: new Date().setHours(0, 0, 0, 0) },
        },
      }),

      prisma.userActivity.findMany({
        select: {
          action: true,
          createdAt: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
        where: { createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),

      redisService.exists("system_health"),

      prisma.enrollment.count({
        where: { createdAt: { gte: last24Hours } },
      }),
    ]);

    const stats = {
      live: {
        activeUsers,
        newSignupsLastHour: newSignupsHour,
        systemStatus: systemHealth ? "healthy" : "maintenance",
      },
      today: {
        newSignups: newSignups24h,
        totalPayments: paymentsToday._count?.id || 0,
        revenueToday: Number(paymentsToday._sum?.amount || 0),
        newEnrollments: liveEnrollments,
      },
      recentActivity: recentActivity.map((activity) => ({
        action: activity.action,
        user: `${activity.user.firstName} ${activity.user.lastName}`,
        timestamp: activity.createdAt,
      })),
      lastUpdated: new Date().toISOString(),
    };

    await redisService.setJSON(cacheKey, stats, { ex: 300 });

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Real-time statistics retrieved successfully",
      data: stats,
      meta: {
        cached: false,
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Real-time stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve real-time statistics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const exportAnalyticsData = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { type = "dashboard", period = "30d", format = "json" } = req.query;

    if (
      !["dashboard", "users", "courses", "revenue", "engagement"].includes(type)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid export type",
        code: "INVALID_EXPORT_TYPE",
      });
    }

    const exportId = generateAnalyticsId();
    const fromDate = getDateRange(period);

    let exportData = {};

    switch (type) {
      case "dashboard":
        const dashboardResponse = await getDashboardOverview(
          {
            query: { period, refresh: "true" },
          },
          {
            status: () => ({
              json: (data) => {
                exportData = data.data;
              },
            }),
          }
        );
        break;

      case "users":
        exportData = await prisma.user.findMany({
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            createdAt: true,
            lastLogin: true,
            isActive: true,
            country: true,
          },
          where: { createdAt: { gte: fromDate } },
        });
        break;

      case "courses":
        exportData = await prisma.course.findMany({
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            publishedAt: true,
            totalEnrollments: true,
            totalRevenue: true,
            averageRating: true,
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
          where: { createdAt: { gte: fromDate } },
        });
        break;

      case "revenue":
        exportData = await prisma.payment.findMany({
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            method: true,
            gateway: true,
            createdAt: true,
            enrollments: {
              select: {
                course: {
                  select: {
                    title: true,
                  },
                },
              },
            },
          },
          where: {
            createdAt: { gte: fromDate },
            status: "COMPLETED",
          },
        });
        break;
    }

    const exportRecord = {
      exportId,
      type,
      period,
      format,
      recordCount: Array.isArray(exportData) ? exportData.length : 1,
      generatedAt: new Date().toISOString(),
      generatedBy: req.userAuthId,
    };

    await redisService.setJSON(
      `export:${exportId}`,
      {
        ...exportRecord,
        data: exportData,
      },
      { ex: 3600 }
    );

    const executionTime = Math.round(performance.now() - startTime);

    res.status(200).json({
      success: true,
      message: "Analytics data exported successfully",
      data: {
        exportId,
        downloadUrl: `/api/admin/analytics/download/${exportId}`,
        ...exportRecord,
      },
      meta: {
        executionTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Export analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export analytics data",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const downloadExportedData = asyncHandler(async (req, res) => {
  const startTime = performance.now();

  try {
    const { exportId } = req.params;

    const exportData = await redisService.getJSON(`export:${exportId}`);

    if (!exportData) {
      return res.status(404).json({
        success: false,
        message: "Export not found or expired",
        code: "EXPORT_NOT_FOUND",
      });
    }

    const filename = `educademy_analytics_${exportData.type}_${exportData.period}_${exportId}.json`;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.status(200).json({
      exportInfo: {
        exportId: exportData.exportId,
        type: exportData.type,
        period: exportData.period,
        recordCount: exportData.recordCount,
        generatedAt: exportData.generatedAt,
      },
      data: exportData.data,
    });
  } catch (error) {
    console.error("Download export error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to download exported data",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        executionTime: Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
