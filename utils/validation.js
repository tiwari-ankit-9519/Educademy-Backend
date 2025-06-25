import Joi from "joi";
import asyncHandler from "express-async-handler";

const validatePayoutRequest = asyncHandler(async (req, res, next) => {
  const schema = Joi.object({
    amount: Joi.number().positive().min(100).max(1000000).required().messages({
      "number.base": "Amount must be a number",
      "number.positive": "Amount must be positive",
      "number.min": "Minimum payout amount is 100",
      "number.max": "Maximum payout amount is 1,000,000",
      "any.required": "Amount is required",
    }),
    currency: Joi.string()
      .valid("INR", "USD", "EUR", "GBP")
      .default("INR")
      .messages({
        "any.only": "Currency must be one of INR, USD, EUR, GBP",
      }),
  });

  try {
    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => ({
          field: detail.path[0],
          message: detail.message,
        })),
      });
    }

    req.body = value;
    next();
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid request data",
      error: error.message,
    });
  }
});

const validatePaymentDetails = asyncHandler(async (req, res, next) => {
  const schema = Joi.object({
    paymentDetails: Joi.object({
      accountType: Joi.string()
        .valid("savings", "current", "business")
        .required()
        .messages({
          "any.only": "Account type must be savings, current, or business",
          "any.required": "Account type is required",
        }),
      accountNumber: Joi.string()
        .alphanum()
        .min(8)
        .max(20)
        .required()
        .messages({
          "string.alphanum":
            "Account number must contain only letters and numbers",
          "string.min": "Account number must be at least 8 characters",
          "string.max": "Account number must not exceed 20 characters",
          "any.required": "Account number is required",
        }),
      bankName: Joi.string().min(2).max(100).required().messages({
        "string.min": "Bank name must be at least 2 characters",
        "string.max": "Bank name must not exceed 100 characters",
        "any.required": "Bank name is required",
      }),
      ifscCode: Joi.string()
        .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
        .messages({
          "string.pattern.base": "Invalid IFSC code format",
        }),
      swiftCode: Joi.string()
        .pattern(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/)
        .messages({
          "string.pattern.base": "Invalid SWIFT code format",
        }),
      routingNumber: Joi.string()
        .pattern(/^\d{9}$/)
        .messages({
          "string.pattern.base": "Invalid routing number format",
        }),
      accountHolderName: Joi.string().min(2).max(100).required().messages({
        "string.min": "Account holder name must be at least 2 characters",
        "string.max": "Account holder name must not exceed 100 characters",
        "any.required": "Account holder name is required",
      }),
      branchAddress: Joi.string().max(500).messages({
        "string.max": "Branch address must not exceed 500 characters",
      }),
      currency: Joi.string().valid("INR", "USD", "EUR", "GBP").default("INR"),
      isDefault: Joi.boolean().default(true),
      isVerified: Joi.boolean().default(false),
    }).required(),
  });

  try {
    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    req.body = value;
    next();
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid payment details",
      error: error.message,
    });
  }
});

const validateDateRange = asyncHandler(async (req, res, next) => {
  const schema = Joi.object({
    startDate: Joi.date().iso().max("now").messages({
      "date.base": "Start date must be a valid date",
      "date.iso": "Start date must be in ISO format",
      "date.max": "Start date cannot be in the future",
    }),
    endDate: Joi.date().iso().min(Joi.ref("startDate")).max("now").messages({
      "date.base": "End date must be a valid date",
      "date.iso": "End date must be in ISO format",
      "date.min": "End date must be after start date",
      "date.max": "End date cannot be in the future",
    }),
    period: Joi.string()
      .valid("daily", "weekly", "monthly", "yearly")
      .default("monthly"),
    timeframe: Joi.string()
      .valid("daily", "weekly", "monthly", "yearly")
      .default("monthly"),
    year: Joi.number()
      .integer()
      .min(2020)
      .max(new Date().getFullYear())
      .default(new Date().getFullYear()),
    compareToLastYear: Joi.boolean().default(false),
    groupBy: Joi.string()
      .valid("day", "week", "month", "quarter", "year")
      .default("month"),
    format: Joi.string().valid("json", "csv", "pdf").default("json"),
    includeDetails: Joi.boolean().default(false),
    type: Joi.string()
      .valid("summary", "detailed", "monthly", "yearly")
      .default("monthly"),
  }).with("endDate", "startDate");

  try {
    const { error, value } = schema.validate(req.query);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => ({
          field: detail.path[0],
          message: detail.message,
        })),
      });
    }

    if (value.startDate && value.endDate) {
      const daysDiff =
        Math.abs(new Date(value.endDate) - new Date(value.startDate)) /
        (1000 * 60 * 60 * 24);
      if (daysDiff > 365) {
        return res.status(400).json({
          success: false,
          message: "Date range cannot exceed 365 days",
        });
      }
    }

    req.query = { ...req.query, ...value };
    next();
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid date range",
      error: error.message,
    });
  }
});

const validatePaginationQuery = asyncHandler(async (req, res, next) => {
  const schema = Joi.object({
    page: Joi.number().integer().min(1).default(1).messages({
      "number.base": "Page must be a number",
      "number.integer": "Page must be an integer",
      "number.min": "Page must be at least 1",
    }),
    limit: Joi.number().integer().min(1).max(100).default(20).messages({
      "number.base": "Limit must be a number",
      "number.integer": "Limit must be an integer",
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
    }),
    sortBy: Joi.string()
      .valid(
        "createdAt",
        "amount",
        "commission",
        "platformFee",
        "status",
        "paidAt"
      )
      .default("createdAt"),
    sortOrder: Joi.string().valid("asc", "desc").default("desc"),
    status: Joi.string().valid("PENDING", "PAID", "CANCELLED", "ON_HOLD"),
    courseId: Joi.string()
      .pattern(/^[a-zA-Z0-9]+$/)
      .messages({
        "string.pattern.base": "Invalid course ID format",
      }),
  });

  try {
    const { error, value } = schema.validate(req.query);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => ({
          field: detail.path[0],
          message: detail.message,
        })),
      });
    }

    req.query = { ...req.query, ...value };
    next();
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid query parameters",
      error: error.message,
    });
  }
});

const validateCourseIdParam = asyncHandler(async (req, res, next) => {
  const schema = Joi.object({
    courseId: Joi.string()
      .required()
      .pattern(/^[a-zA-Z0-9]+$/)
      .messages({
        "string.pattern.base": "Invalid course ID format",
        "any.required": "Course ID is required",
      }),
  });

  try {
    const { error, value } = schema.validate(req.params);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => ({
          field: detail.path[0],
          message: detail.message,
        })),
      });
    }

    req.params = value;
    next();
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid course ID",
      error: error.message,
    });
  }
});

export {
  validatePayoutRequest,
  validatePaymentDetails,
  validateDateRange,
  validatePaginationQuery,
  validateCourseIdParam,
};
