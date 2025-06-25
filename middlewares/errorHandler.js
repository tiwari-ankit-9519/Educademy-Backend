export const errorHandler = (err, req, res, next) => {
  const stack = err?.stack;
  const statusCode = err?.statusCode ? err.statusCode : 500;
  const message = err?.message;

  res.status(statusCode).json({
    success: false,
    error: {
      message: message,
      ...(process.env.NODE_ENV === "development" && { stack }),
    },
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
  });
};

export const notFound = (req, res, next) => {
  const err = new Error(`Route ${req.originalUrl} not found`);
  err.statusCode = 404;
  next(err);
};

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((error) => {
    next(error);
  });
};

export const validationErrorHandler = (err, req, res, next) => {
  if (err.name === "ValidationError") {
    const validationErrors = Object.values(err.errors).map((error) => ({
      field: error.path,
      message: error.message,
      value: error.value,
    }));

    return res.status(400).json({
      success: false,
      error: {
        message: "Validation failed",
        details: validationErrors,
      },
      timestamp: new Date().toISOString(),
    });
  }
  next(err);
};

export const databaseErrorHandler = (err, req, res, next) => {
  if (err.name === "PrismaClientKnownRequestError") {
    let message = "Database operation failed";
    let statusCode = 500;
    switch (err.code) {
      case "P2002":
        message = "A record with this information already exists";
        statusCode = 409;
        break;
      case "P2025":
        message = "Record not found";
        statusCode = 404;
        break;
      case "P2003":
        message = "Foreign key constraint failed";
        statusCode = 400;
        break;
      default:
        message = "Database error occurred";
    }

    return res.status(statusCode).json({
      success: false,
      error: {
        message,
        code: err.code,
      },
      timestamp: new Date().toISOString(),
    });
  }
  next(err);
};

export const authErrorHandler = (err, req, res, next) => {
  if (err.name === "UnauthorizedError" || err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      error: {
        message: "Authentication failed",
        details: "Invalid or expired token",
      },
      timestamp: new Date().toISOString(),
    });
  }
  next(err);
};

export const rateLimitErrorHandler = (err, req, res, next) => {
  if (err.name === "TooManyRequestsError") {
    return res.status(429).json({
      success: false,
      error: {
        message: "Too many requests",
        details: "Rate limit exceeded. Please try again later.",
        retryAfter: err.retryAfter,
      },
      timestamp: new Date().toISOString(),
    });
  }
  next(err);
};
