import { PrismaClient } from "@prisma/client";
import redisService from "./redis.js";

const prisma = new PrismaClient();

export const calculateCommission = (amount, commissionRate = 0.7) => {
  const commission = Number(amount) * Number(commissionRate);
  const platformFee = Number(amount) - commission;

  return {
    commission: Math.round(commission * 100) / 100,
    platformFee: Math.round(platformFee * 100) / 100,
    commissionRate: Number(commissionRate),
  };
};

export const calculateTaxes = (
  earnings,
  country = "IN",
  taxYear = new Date().getFullYear()
) => {
  const taxRates = {
    IN: {
      brackets: [
        { min: 0, max: 250000, rate: 0 },
        { min: 250000, max: 500000, rate: 0.05 },
        { min: 500000, max: 1000000, rate: 0.2 },
        { min: 1000000, max: Infinity, rate: 0.3 },
      ],
      cessRate: 0.04,
    },
    US: {
      brackets: [
        { min: 0, max: 10275, rate: 0.1 },
        { min: 10275, max: 41775, rate: 0.12 },
        { min: 41775, max: 89450, rate: 0.22 },
        { min: 89450, max: 190750, rate: 0.24 },
        { min: 190750, max: 364200, rate: 0.32 },
        { min: 364200, max: 462500, rate: 0.35 },
        { min: 462500, max: Infinity, rate: 0.37 },
      ],
    },
  };

  const countryTax = taxRates[country] || taxRates.IN;
  let tax = 0;
  let remainingEarnings = Number(earnings);

  for (const bracket of countryTax.brackets) {
    if (remainingEarnings <= 0) break;

    const taxableInBracket = Math.min(
      remainingEarnings,
      bracket.max - bracket.min
    );
    tax += taxableInBracket * bracket.rate;
    remainingEarnings -= taxableInBracket;
  }

  if (countryTax.cessRate) {
    tax += tax * countryTax.cessRate;
  }

  return {
    grossEarnings: Number(earnings),
    taxableAmount: Number(earnings),
    taxAmount: Math.round(tax * 100) / 100,
    netEarnings: Math.round((Number(earnings) - tax) * 100) / 100,
    effectiveTaxRate: Number(earnings) > 0 ? (tax / Number(earnings)) * 100 : 0,
    country,
    taxYear,
  };
};

export const convertCurrency = async (amount, fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) {
    return { amount: Number(amount), rate: 1, fromCurrency, toCurrency };
  }

  const cacheKey = `exchange_rate:${fromCurrency}:${toCurrency}`;
  let exchangeRate = await redisService.get(cacheKey);

  if (!exchangeRate) {
    const rates = {
      INR: { USD: 0.012, EUR: 0.011, GBP: 0.0095 },
      USD: { INR: 83.0, EUR: 0.92, GBP: 0.79 },
      EUR: { INR: 90.0, USD: 1.09, GBP: 0.86 },
      GBP: { INR: 105.0, USD: 1.27, EUR: 1.16 },
    };

    exchangeRate = rates[fromCurrency]?.[toCurrency] || 1;
    await redisService.setex(cacheKey, 3600, exchangeRate.toString());
  } else {
    exchangeRate = parseFloat(exchangeRate);
  }

  return {
    amount: Math.round(Number(amount) * exchangeRate * 100) / 100,
    rate: exchangeRate,
    fromCurrency,
    toCurrency,
  };
};

export const generateEarningsCSV = (earnings, includeDetails = false) => {
  const headers = [
    "Date",
    "Transaction ID",
    "Gross Amount",
    "Your Earnings",
    "Platform Fee",
    "Currency",
    "Status",
  ];

  if (includeDetails) {
    headers.push("Course", "Student", "Country", "Payment Method");
  }

  const rows = earnings.map((earning) => {
    const row = [
      earning.createdAt.toISOString().split("T")[0],
      earning.id,
      earning.amount,
      earning.commission,
      earning.platformFee,
      earning.currency,
      earning.status,
    ];

    if (includeDetails && earning.payment) {
      row.push(
        earning.payment.enrollments[0]?.course?.title || "",
        earning.payment.enrollments[0]?.student
          ? `${earning.payment.enrollments[0].student.user.firstName} ${earning.payment.enrollments[0].student.user.lastName}`
          : "",
        earning.payment.enrollments[0]?.student?.user?.country || "",
        earning.payment.method || ""
      );
    }

    return row;
  });

  return [headers, ...rows].map((row) => row.join(",")).join("\n");
};

export const calculateGrowthRate = (current, previous) => {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

export const formatCurrency = (amount, currency = "INR") => {
  const formatters = {
    INR: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }),
    USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    EUR: new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }),
    GBP: new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }),
  };

  return formatters[currency]?.format(amount) || `${currency} ${amount}`;
};

export const generatePayoutReference = (instructorId, currency = "INR") => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `PAY_${currency}_${instructorId.substr(
    -8
  )}_${timestamp}_${random}`.toUpperCase();
};

export const validateMinPayoutAmount = (amount, currency = "INR") => {
  const minimums = {
    INR: 100,
    USD: 5,
    EUR: 5,
    GBP: 5,
  };

  const minAmount = minimums[currency] || minimums.INR;
  return Number(amount) >= minAmount;
};

export const calculatePayoutFees = (
  amount,
  payoutMethod = "bank_transfer",
  currency = "INR"
) => {
  const feeStructures = {
    bank_transfer: {
      INR: { fixed: 5, percentage: 0 },
      USD: { fixed: 1, percentage: 0 },
      EUR: { fixed: 1, percentage: 0 },
      GBP: { fixed: 1, percentage: 0 },
    },
    paypal: {
      INR: { fixed: 10, percentage: 0.02 },
      USD: { fixed: 0.3, percentage: 0.029 },
      EUR: { fixed: 0.35, percentage: 0.034 },
      GBP: { fixed: 0.3, percentage: 0.034 },
    },
    wise: {
      INR: { fixed: 15, percentage: 0.01 },
      USD: { fixed: 0.5, percentage: 0.004 },
      EUR: { fixed: 0.4, percentage: 0.004 },
      GBP: { fixed: 0.4, percentage: 0.004 },
    },
  };

  const feeStructure =
    feeStructures[payoutMethod]?.[currency] || feeStructures.bank_transfer.INR;
  const percentageFee = Number(amount) * feeStructure.percentage;
  const totalFee = feeStructure.fixed + percentageFee;

  return {
    grossAmount: Number(amount),
    fee: Math.round(totalFee * 100) / 100,
    netAmount: Math.round((Number(amount) - totalFee) * 100) / 100,
    feeStructure,
    payoutMethod,
    currency,
  };
};

export const getEarningsMetrics = async (instructorId, period = "monthly") => {
  const cacheKey = `earnings_metrics:${instructorId}:${period}`;
  let metrics = await redisService.getJSON(cacheKey);

  if (metrics) return metrics;

  const currentDate = new Date();
  let startDate, previousStartDate, previousEndDate;

  switch (period) {
    case "daily":
      startDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate()
      );
      previousStartDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
      previousEndDate = startDate;
      break;
    case "weekly":
      const dayOfWeek = currentDate.getDay();
      startDate = new Date(
        currentDate.getTime() - dayOfWeek * 24 * 60 * 60 * 1000
      );
      previousStartDate = new Date(
        startDate.getTime() - 7 * 24 * 60 * 60 * 1000
      );
      previousEndDate = startDate;
      break;
    case "monthly":
      startDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      previousStartDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - 1,
        1
      );
      previousEndDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        0
      );
      break;
    case "yearly":
      startDate = new Date(currentDate.getFullYear(), 0, 1);
      previousStartDate = new Date(currentDate.getFullYear() - 1, 0, 1);
      previousEndDate = new Date(currentDate.getFullYear() - 1, 11, 31);
      break;
    default:
      startDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      previousStartDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - 1,
        1
      );
      previousEndDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        0
      );
  }

  const [currentPeriod, previousPeriod] = await Promise.all([
    prisma.earning.aggregate({
      where: {
        instructorId,
        createdAt: { gte: startDate },
      },
      _sum: { amount: true, commission: true, platformFee: true },
      _count: true,
    }),

    prisma.earning.aggregate({
      where: {
        instructorId,
        createdAt: { gte: previousStartDate, lt: previousEndDate },
      },
      _sum: { amount: true, commission: true, platformFee: true },
      _count: true,
    }),
  ]);

  metrics = {
    current: {
      totalEarnings: currentPeriod._sum.amount || 0,
      commission: currentPeriod._sum.commission || 0,
      platformFee: currentPeriod._sum.platformFee || 0,
      transactions: currentPeriod._count,
    },
    previous: {
      totalEarnings: previousPeriod._sum.amount || 0,
      commission: previousPeriod._sum.commission || 0,
      platformFee: previousPeriod._sum.platformFee || 0,
      transactions: previousPeriod._count,
    },
    growth: {
      earnings: calculateGrowthRate(
        currentPeriod._sum.commission || 0,
        previousPeriod._sum.commission || 0
      ),
      transactions: calculateGrowthRate(
        currentPeriod._count,
        previousPeriod._count
      ),
    },
    period,
    calculatedAt: new Date().toISOString(),
  };

  await redisService.setJSON(cacheKey, metrics, { ex: 300 });
  return metrics;
};

export const generateTaxDocument = (
  earnings,
  taxYear = new Date().getFullYear()
) => {
  const totalEarnings = earnings.reduce(
    (sum, earning) => sum + Number(earning.commission),
    0
  );
  const totalPlatformFees = earnings.reduce(
    (sum, earning) => sum + Number(earning.platformFee),
    0
  );
  const totalGross = earnings.reduce(
    (sum, earning) => sum + Number(earning.amount),
    0
  );

  const quarterlyBreakdown = {
    Q1: { start: new Date(taxYear, 0, 1), end: new Date(taxYear, 2, 31) },
    Q2: { start: new Date(taxYear, 3, 1), end: new Date(taxYear, 5, 30) },
    Q3: { start: new Date(taxYear, 6, 1), end: new Date(taxYear, 8, 30) },
    Q4: { start: new Date(taxYear, 9, 1), end: new Date(taxYear, 11, 31) },
  };

  const quarterlyData = {};
  Object.entries(quarterlyBreakdown).forEach(([quarter, dates]) => {
    const quarterEarnings = earnings.filter(
      (earning) =>
        earning.createdAt >= dates.start && earning.createdAt <= dates.end
    );

    quarterlyData[quarter] = {
      earnings: quarterEarnings.reduce(
        (sum, earning) => sum + Number(earning.commission),
        0
      ),
      transactions: quarterEarnings.length,
    };
  });

  return {
    taxYear,
    summary: {
      totalGrossEarnings: totalGross,
      totalNetEarnings: totalEarnings,
      totalPlatformFees: totalPlatformFees,
      totalTransactions: earnings.length,
    },
    quarterly: quarterlyData,
    taxInfo: calculateTaxes(totalEarnings),
    generatedAt: new Date().toISOString(),
  };
};

export const schedulePayoutReminder = async (
  instructorId,
  availableBalance,
  currency = "INR"
) => {
  const minThreshold = {
    INR: 1000,
    USD: 50,
    EUR: 50,
    GBP: 50,
  };

  const threshold = minThreshold[currency] || minThreshold.INR;

  if (Number(availableBalance) >= threshold) {
    const reminderKey = `payout_reminder:${instructorId}`;
    const lastReminder = await redisService.get(reminderKey);

    if (!lastReminder) {
      await redisService.setex(
        reminderKey,
        7 * 24 * 60 * 60,
        Date.now().toString()
      );
      return {
        shouldRemind: true,
        message: `You have ${formatCurrency(
          availableBalance,
          currency
        )} available for payout.`,
        threshold,
        availableBalance: Number(availableBalance),
      };
    }
  }

  return {
    shouldRemind: false,
    threshold,
    availableBalance: Number(availableBalance),
  };
};
