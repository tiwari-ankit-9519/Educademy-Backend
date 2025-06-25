import rateLimit from "express-rate-limit";

export const validatePayoutRequest = (req, res, next) => {
  const { amount, paymentMethod, accountDetails } = req.body;

  const errors = [];

  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    errors.push("Valid amount is required");
  }

  if (parseFloat(amount) < 10) {
    errors.push("Minimum payout amount is $10");
  }

  if (parseFloat(amount) > 10000) {
    errors.push("Maximum payout amount is $10,000 per request");
  }

  if (!paymentMethod) {
    errors.push("Payment method is required");
  }

  const validPaymentMethods = ["BANK_TRANSFER", "PAYPAL", "STRIPE", "WISE"];
  if (paymentMethod && !validPaymentMethods.includes(paymentMethod)) {
    errors.push("Invalid payment method");
  }

  if (!accountDetails || typeof accountDetails !== "object") {
    errors.push("Account details are required");
  } else {
    if (paymentMethod === "BANK_TRANSFER") {
      if (!accountDetails.accountNumber || !accountDetails.routingNumber) {
        errors.push("Bank account number and routing number are required");
      }
      if (!accountDetails.accountHolderName) {
        errors.push("Account holder name is required");
      }
    }

    if (paymentMethod === "PAYPAL") {
      if (!accountDetails.email) {
        errors.push("PayPal email is required");
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (accountDetails.email && !emailRegex.test(accountDetails.email)) {
        errors.push("Valid PayPal email is required");
      }
    }

    if (paymentMethod === "STRIPE") {
      if (!accountDetails.stripeAccountId) {
        errors.push("Stripe account ID is required");
      }
    }

    if (paymentMethod === "WISE") {
      if (!accountDetails.email) {
        errors.push("Wise account email is required");
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors,
      code: "VALIDATION_ERROR",
    });
  }

  next();
};

export const validatePaymentDetails = (req, res, next) => {
  const { paymentMethod, accountDetails } = req.body;

  const errors = [];

  if (!paymentMethod) {
    errors.push("Payment method is required");
  }

  const validPaymentMethods = ["BANK_TRANSFER", "PAYPAL", "STRIPE", "WISE"];
  if (paymentMethod && !validPaymentMethods.includes(paymentMethod)) {
    errors.push("Invalid payment method");
  }

  if (!accountDetails || typeof accountDetails !== "object") {
    errors.push("Account details are required");
  } else {
    switch (paymentMethod) {
      case "BANK_TRANSFER":
        if (!accountDetails.accountNumber) {
          errors.push("Bank account number is required");
        }
        if (!accountDetails.routingNumber) {
          errors.push("Bank routing number is required");
        }
        if (!accountDetails.accountHolderName) {
          errors.push("Account holder name is required");
        }
        if (!accountDetails.bankName) {
          errors.push("Bank name is required");
        }
        if (
          accountDetails.accountNumber &&
          accountDetails.accountNumber.length < 8
        ) {
          errors.push("Account number must be at least 8 digits");
        }
        if (
          accountDetails.routingNumber &&
          accountDetails.routingNumber.length !== 9
        ) {
          errors.push("Routing number must be exactly 9 digits");
        }
        break;

      case "PAYPAL":
        if (!accountDetails.email) {
          errors.push("PayPal email is required");
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (accountDetails.email && !emailRegex.test(accountDetails.email)) {
          errors.push("Valid PayPal email is required");
        }
        break;

      case "STRIPE":
        if (!accountDetails.stripeAccountId) {
          errors.push("Stripe account ID is required");
        }
        if (
          accountDetails.stripeAccountId &&
          !accountDetails.stripeAccountId.startsWith("acct_")
        ) {
          errors.push("Invalid Stripe account ID format");
        }
        break;

      case "WISE":
        if (!accountDetails.email) {
          errors.push("Wise account email is required");
        }
        if (!accountDetails.currency) {
          errors.push("Currency is required for Wise transfers");
        }
        const wiseEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (
          accountDetails.email &&
          !wiseEmailRegex.test(accountDetails.email)
        ) {
          errors.push("Valid Wise account email is required");
        }
        break;

      default:
        errors.push("Unsupported payment method");
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Payment details validation failed",
      errors,
      code: "PAYMENT_VALIDATION_ERROR",
    });
  }

  next();
};

export const validateDateRange = (req, res, next) => {
  const { startDate, endDate, dateRange, period } = req.query;

  const errors = [];

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime())) {
      errors.push("Invalid start date format");
    }

    if (isNaN(end.getTime())) {
      errors.push("Invalid end date format");
    }

    if (start.getTime() && end.getTime() && start > end) {
      errors.push("Start date cannot be after end date");
    }

    const maxRangeMs = 365 * 24 * 60 * 60 * 1000; // 1 year
    if (start.getTime() && end.getTime() && end - start > maxRangeMs) {
      errors.push("Date range cannot exceed 1 year");
    }

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    if (start > futureDate || end > futureDate) {
      errors.push("Dates cannot be in the future");
    }
  }

  if (dateRange) {
    const validRanges = [
      "today",
      "yesterday",
      "last7days",
      "last30days",
      "last90days",
      "lastyear",
      "custom",
    ];
    if (!validRanges.includes(dateRange)) {
      errors.push("Invalid date range option");
    }
  }

  if (period) {
    const validPeriods = ["daily", "weekly", "monthly", "quarterly", "yearly"];
    if (!validPeriods.includes(period)) {
      errors.push("Invalid period option");
    }
  }

  if (dateRange === "custom" && (!startDate || !endDate)) {
    errors.push("Start date and end date are required for custom date range");
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Date range validation failed",
      errors,
      code: "DATE_VALIDATION_ERROR",
    });
  }

  next();
};

export const payoutRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3, // Maximum 3 payout requests per day
  message: {
    success: false,
    error: {
      message: "Too many payout requests",
      details:
        "You can only request 3 payouts per day. Please try again tomorrow.",
      retryAfter: "24 hours",
    },
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(
      `Payout rate limit exceeded for instructor: ${req.instructorProfile?.id}, IP: ${req.ip}`
    );

    res.status(429).json({
      success: false,
      error: {
        message: "Too many payout requests",
        details:
          "You have exceeded the daily limit of 3 payout requests. Please try again tomorrow.",
        retryAfter: "24 hours",
        limit: req.rateLimit.limit,
        remaining: req.rateLimit.remaining,
        resetTime: new Date(Date.now() + req.rateLimit.resetTime),
      },
      timestamp: new Date().toISOString(),
    });
  },
});

export const validateCurrency = (req, res, next) => {
  const { currency } = req.query;

  if (currency) {
    const validCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR"];
    if (!validCurrencies.includes(currency.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid currency",
        supportedCurrencies: validCurrencies,
        code: "INVALID_CURRENCY",
      });
    }
    req.query.currency = currency.toUpperCase();
  }

  next();
};

export const validatePaginationParams = (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({
      success: false,
      message: "Page must be a positive integer",
      code: "INVALID_PAGE",
    });
  }

  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    return res.status(400).json({
      success: false,
      message: "Limit must be between 1 and 100",
      code: "INVALID_LIMIT",
    });
  }

  req.query.page = pageNum;
  req.query.limit = limitNum;

  next();
};

export const validateInstructorAccess = async (req, res, next) => {
  try {
    if (!req.instructorProfile || !req.instructorProfile.id) {
      return res.status(403).json({
        success: false,
        message: "Instructor profile required",
        code: "INSTRUCTOR_ACCESS_DENIED",
      });
    }

    if (!req.instructorProfile.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Instructor verification required for earnings access",
        code: "VERIFICATION_REQUIRED",
      });
    }

    next();
  } catch (error) {
    console.error("Instructor access validation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate instructor access",
      code: "ACCESS_VALIDATION_ERROR",
    });
  }
};

export const calculateDateRange = (dateRange, startDate, endDate) => {
  const now = new Date();
  let start, end;

  switch (dateRange) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      break;
    case "yesterday":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "last7days":
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      end = now;
      break;
    case "last30days":
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      end = now;
      break;
    case "last90days":
      start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      end = now;
      break;
    case "lastyear":
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear(), 0, 1);
      break;
    case "custom":
      start = startDate ? new Date(startDate) : null;
      end = endDate ? new Date(endDate) : null;
      break;
    default:
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      end = now;
  }

  return { start, end };
};

export const formatCurrency = (amount, currency = "USD") => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const validateAmount = (amount, min = 10, max = 10000) => {
  const numAmount = parseFloat(amount);

  if (isNaN(numAmount)) {
    return { isValid: false, error: "Amount must be a valid number" };
  }

  if (numAmount < min) {
    return {
      isValid: false,
      error: `Minimum amount is ${formatCurrency(min)}`,
    };
  }

  if (numAmount > max) {
    return {
      isValid: false,
      error: `Maximum amount is ${formatCurrency(max)}`,
    };
  }

  return { isValid: true };
};

export const calculateGrowthRate = (currentValue, previousValue) => {
  if (!previousValue || previousValue === 0) {
    return currentValue > 0 ? 100 : 0;
  }

  const growthRate = ((currentValue - previousValue) / previousValue) * 100;
  return Math.round(growthRate * 100) / 100; // Round to 2 decimal places
};

export const calculatePercentageChange = (current, previous) => {
  if (!previous || previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return ((current - previous) / previous) * 100;
};

export const groupDataByPeriod = (data, period = "daily") => {
  const grouped = {};

  data.forEach((item) => {
    const date = new Date(item.createdAt || item.date);
    let key;

    switch (period) {
      case "daily":
        key = date.toISOString().split("T")[0];
        break;
      case "weekly":
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        key = startOfWeek.toISOString().split("T")[0];
        break;
      case "monthly":
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
          2,
          "0"
        )}`;
        break;
      case "quarterly":
        const quarter = Math.floor(date.getMonth() / 3) + 1;
        key = `${date.getFullYear()}-Q${quarter}`;
        break;
      case "yearly":
        key = date.getFullYear().toString();
        break;
      default:
        key = date.toISOString().split("T")[0];
    }

    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  });

  return grouped;
};

export const calculateCommission = (amount, rate = 0.7) => {
  const commission = parseFloat(amount) * rate;
  return Math.round(commission * 100) / 100;
};

export const calculateTotalRevenue = (earnings) => {
  return earnings.reduce((total, earning) => {
    return total + parseFloat(earning.amount || earning.commission || 0);
  }, 0);
};

export const calculateAverageEarning = (earnings) => {
  if (!earnings || earnings.length === 0) return 0;

  const total = calculateTotalRevenue(earnings);
  return total / earnings.length;
};

export const getEarningsPeriodComparison = (
  currentPeriodEarnings,
  previousPeriodEarnings
) => {
  const currentTotal = calculateTotalRevenue(currentPeriodEarnings);
  const previousTotal = calculateTotalRevenue(previousPeriodEarnings);
  const growthRate = calculateGrowthRate(currentTotal, previousTotal);

  return {
    current: currentTotal,
    previous: previousTotal,
    difference: currentTotal - previousTotal,
    growthRate: growthRate,
    trend: growthRate > 0 ? "up" : growthRate < 0 ? "down" : "stable",
  };
};

export const formatFinancialReport = (data, currency = "USD") => {
  return {
    ...data,
    formattedAmounts: {
      total: formatCurrency(data.total || 0, currency),
      pending: formatCurrency(data.pending || 0, currency),
      paid: formatCurrency(data.paid || 0, currency),
      commission: formatCurrency(data.commission || 0, currency),
    },
  };
};

export const validateFinancialData = (data) => {
  const errors = [];

  if (data.amount && (isNaN(data.amount) || data.amount < 0)) {
    errors.push("Amount must be a positive number");
  }

  if (data.commission && (isNaN(data.commission) || data.commission < 0)) {
    errors.push("Commission must be a positive number");
  }

  if (data.tax && (isNaN(data.tax) || data.tax < 0)) {
    errors.push("Tax must be a positive number");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const generatePayoutReference = (
  instructorId,
  timestamp = Date.now()
) => {
  const prefix = "PO";
  const instructorCode = instructorId.slice(-6).toUpperCase();
  const timeCode = timestamp.toString().slice(-6);
  const randomCode = Math.random().toString(36).substr(2, 4).toUpperCase();

  return `${prefix}-${instructorCode}-${timeCode}-${randomCode}`;
};

export const generateEarningsCSV = (earnings, instructorInfo = {}) => {
  const headers = [
    "Date",
    "Course Title",
    "Student Name",
    "Gross Amount",
    "Commission Rate",
    "Net Commission",
    "Status",
    "Payment Method",
    "Transaction ID",
    "Tax Amount",
    "Currency",
  ];

  const rows = earnings.map((earning) => [
    new Date(earning.createdAt).toLocaleDateString(),
    earning.course?.title || "N/A",
    earning.payment?.user?.name || "N/A",
    earning.amount || "0.00",
    earning.commissionRate || "70%",
    earning.commission || "0.00",
    earning.status || "PENDING",
    earning.payment?.method || "N/A",
    earning.payment?.transactionId || "N/A",
    earning.taxAmount || "0.00",
    earning.currency || "USD",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row
        .map((cell) =>
          typeof cell === "string" && cell.includes(",") ? `"${cell}"` : cell
        )
        .join(",")
    ),
  ].join("\n");

  return {
    content: csvContent,
    filename: `earnings-${instructorInfo.id || "instructor"}-${
      new Date().toISOString().split("T")[0]
    }.csv`,
    mimeType: "text/csv",
  };
};

export const validateMinPayoutAmount = (amount, currency = "USD") => {
  const minAmounts = {
    USD: 10,
    EUR: 10,
    GBP: 8,
    CAD: 13,
    AUD: 15,
    JPY: 1000,
    INR: 750,
  };

  const minAmount = minAmounts[currency] || minAmounts.USD;
  const numAmount = parseFloat(amount);

  if (isNaN(numAmount)) {
    return {
      isValid: false,
      error: "Amount must be a valid number",
      minAmount: minAmount,
    };
  }

  if (numAmount < minAmount) {
    return {
      isValid: false,
      error: `Minimum payout amount is ${formatCurrency(minAmount, currency)}`,
      minAmount: minAmount,
    };
  }

  return {
    isValid: true,
    amount: numAmount,
    minAmount: minAmount,
  };
};

export const getEarningsMetrics = (earnings, timeframe = "month") => {
  if (!earnings || earnings.length === 0) {
    return {
      totalEarnings: 0,
      totalCommission: 0,
      averageEarning: 0,
      transactionCount: 0,
      growthRate: 0,
      topCourse: null,
      metrics: {},
    };
  }

  const now = new Date();
  let startDate;

  switch (timeframe) {
    case "week":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "month":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "quarter":
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "year":
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const currentPeriodEarnings = earnings.filter(
    (earning) => new Date(earning.createdAt) >= startDate
  );

  const previousPeriodStart = new Date(
    startDate.getTime() - (now.getTime() - startDate.getTime())
  );
  const previousPeriodEarnings = earnings.filter(
    (earning) =>
      new Date(earning.createdAt) >= previousPeriodStart &&
      new Date(earning.createdAt) < startDate
  );

  const totalEarnings = currentPeriodEarnings.reduce(
    (sum, earning) => sum + parseFloat(earning.amount || 0),
    0
  );
  const totalCommission = currentPeriodEarnings.reduce(
    (sum, earning) => sum + parseFloat(earning.commission || 0),
    0
  );
  const previousTotalCommission = previousPeriodEarnings.reduce(
    (sum, earning) => sum + parseFloat(earning.commission || 0),
    0
  );

  const courseEarnings = {};
  currentPeriodEarnings.forEach((earning) => {
    const courseId = earning.courseId;
    if (!courseEarnings[courseId]) {
      courseEarnings[courseId] = {
        courseId,
        title: earning.course?.title || "Unknown Course",
        totalEarnings: 0,
        transactionCount: 0,
      };
    }
    courseEarnings[courseId].totalEarnings += parseFloat(
      earning.commission || 0
    );
    courseEarnings[courseId].transactionCount += 1;
  });

  const topCourse =
    Object.values(courseEarnings).sort(
      (a, b) => b.totalEarnings - a.totalEarnings
    )[0] || null;

  return {
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
    averageEarning:
      currentPeriodEarnings.length > 0
        ? Math.round((totalCommission / currentPeriodEarnings.length) * 100) /
          100
        : 0,
    transactionCount: currentPeriodEarnings.length,
    growthRate: calculateGrowthRate(totalCommission, previousTotalCommission),
    topCourse,
    metrics: {
      dailyAverage:
        Math.round(
          (totalCommission /
            (timeframe === "week"
              ? 7
              : timeframe === "month"
              ? 30
              : timeframe === "quarter"
              ? 90
              : 365)) *
            100
        ) / 100,
      courseCount: Object.keys(courseEarnings).length,
      conversionRate: 0, // Would need additional data to calculate
      refundRate: 0, // Would need additional data to calculate
    },
  };
};

export const generateTaxDocument = (
  earnings,
  instructorInfo,
  taxYear = new Date().getFullYear()
) => {
  const yearEarnings = earnings.filter(
    (earning) => new Date(earning.createdAt).getFullYear() === taxYear
  );

  const totalGrossIncome = yearEarnings.reduce(
    (sum, earning) => sum + parseFloat(earning.amount || 0),
    0
  );
  const totalCommission = yearEarnings.reduce(
    (sum, earning) => sum + parseFloat(earning.commission || 0),
    0
  );
  const totalTax = yearEarnings.reduce(
    (sum, earning) => sum + parseFloat(earning.taxAmount || 0),
    0
  );

  const monthlyBreakdown = {};
  for (let month = 0; month < 12; month++) {
    const monthEarnings = yearEarnings.filter(
      (earning) => new Date(earning.createdAt).getMonth() === month
    );
    monthlyBreakdown[month + 1] = {
      grossIncome: monthEarnings.reduce(
        (sum, earning) => sum + parseFloat(earning.amount || 0),
        0
      ),
      netIncome: monthEarnings.reduce(
        (sum, earning) => sum + parseFloat(earning.commission || 0),
        0
      ),
      taxWithheld: monthEarnings.reduce(
        (sum, earning) => sum + parseFloat(earning.taxAmount || 0),
        0
      ),
      transactionCount: monthEarnings.length,
    };
  }

  return {
    taxYear,
    instructorInfo: {
      name: `${instructorInfo.firstName} ${instructorInfo.lastName}`,
      email: instructorInfo.email,
      taxId: instructorInfo.taxId || "Not Provided",
      address: instructorInfo.address || "Not Provided",
    },
    summary: {
      totalGrossIncome: Math.round(totalGrossIncome * 100) / 100,
      totalNetIncome: Math.round(totalCommission * 100) / 100,
      totalTaxWithheld: Math.round(totalTax * 100) / 100,
      totalTransactions: yearEarnings.length,
    },
    monthlyBreakdown,
    generatedAt: new Date().toISOString(),
    documentId: `TAX-${instructorInfo.id}-${taxYear}-${Date.now()}`,
  };
};

export const schedulePayoutReminder = (
  instructorId,
  payoutData,
  reminderType = "pending"
) => {
  const reminderSchedule = {
    pending: [1, 3, 7], // Days after payout request
    overdue: [14, 21, 30], // Days for overdue payments
    monthly: [1], // 1st of each month for monthly statements
    quarterly: [1], // 1st day of quarter for quarterly reports
  };

  const now = new Date();
  const reminders = [];

  const scheduleDays =
    reminderSchedule[reminderType] || reminderSchedule.pending;

  scheduleDays.forEach((days) => {
    const reminderDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    reminders.push({
      id: `reminder-${instructorId}-${Date.now()}-${days}`,
      instructorId,
      type: reminderType,
      scheduledFor: reminderDate,
      payoutData: {
        amount: payoutData.amount,
        currency: payoutData.currency,
        paymentMethod: payoutData.paymentMethod,
        requestDate: payoutData.requestDate || now,
      },
      status: "SCHEDULED",
      message: generateReminderMessage(reminderType, days, payoutData),
      createdAt: now,
    });
  });

  return reminders;
};

const generateReminderMessage = (type, days, payoutData) => {
  const amount = formatCurrency(payoutData.amount, payoutData.currency);

  switch (type) {
    case "pending":
      if (days === 1) {
        return `Your payout request of ${amount} is being processed and should be completed within 3-5 business days.`;
      } else if (days === 3) {
        return `Update: Your payout of ${amount} is still being processed. Expected completion within 2-3 business days.`;
      } else {
        return `Your payout request of ${amount} is taking longer than expected. Please contact support if you have concerns.`;
      }
    case "overdue":
      return `Your payout of ${amount} is overdue. Please contact our support team for immediate assistance.`;
    case "monthly":
      return `Your monthly earnings statement is now available for download.`;
    case "quarterly":
      return `Your quarterly earnings report and tax documents are ready for review.`;
    default:
      return `Reminder: Please review your payout status for ${amount}.`;
  }
};

export default {
  validatePayoutRequest,
  validatePaymentDetails,
  validateDateRange,
  payoutRateLimit,
  validateCurrency,
  validatePaginationParams,
  validateInstructorAccess,
  calculateDateRange,
  formatCurrency,
  validateAmount,
  calculateGrowthRate,
  calculatePercentageChange,
  groupDataByPeriod,
  calculateCommission,
  calculateTotalRevenue,
  calculateAverageEarning,
  getEarningsPeriodComparison,
  formatFinancialReport,
  validateFinancialData,
  generatePayoutReference,
  generateEarningsCSV,
  validateMinPayoutAmount,
  getEarningsMetrics,
  generateTaxDocument,
  schedulePayoutReminder,
};
