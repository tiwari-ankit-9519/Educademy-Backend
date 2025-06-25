import express from "express";
import cors from "cors";
import session from "express-session";
import { RedisStore } from "connect-redis";
import passport from "passport";
import { createServer } from "http";
import { config } from "dotenv";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import socketManager from "./utils/socket-io.js";
import redisService from "./utils/redis.js";
import authRoutes from "./routes/auth.route.js";
import {
  configureMorgan,
  requestIdMiddleware,
  userIdMiddleware,
} from "./utils/morgan.js";
import {
  errorHandler,
  notFound,
  validationErrorHandler,
  databaseErrorHandler,
  authErrorHandler,
} from "./middlewares/errorHandler.js";
import "./utils/passport.js";
import notificationRoutes from "./routes/notification.route.js";
import uploadRoutes from "./routes/upload.route.js";
import searchRoutes from "./routes/search.route.js";
import supportRoutes from "./routes/ticket.route.js";
config();

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL,
      process.env.INSTRUCTOR_URL,
    ].filter(Boolean);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "Cache-Control",
    "X-CSRF-Token",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
  ],
  exposedHeaders: [
    "set-cookie",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
  ],
  optionsSuccessStatus: 200,
};

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

console.log(`🚀 Starting Educademy Backend Server on port ${PORT}`);
console.log(`📦 Environment: ${process.env.NODE_ENV}`);
console.log(`🔧 Node.js Version: ${process.version}`);

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:"],
      },
    },
  })
);

app.use(compression());

// Add request ID middleware BEFORE Morgan
app.use(requestIdMiddleware);

// Configure Morgan logging properly
configureMorgan(app);

// Fixed global rate limit with proper error handling
const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Max 1000 requests per window

  message: {
    success: false,
    error: {
      message: "Too many requests from this IP",
      details: "Rate limit exceeded. Please try again later.",
      retryAfter: "15 minutes",
    },
    timestamp: new Date().toISOString(),
  },

  standardHeaders: true,
  legacyHeaders: false,

  skip: (req) => {
    const whitelist = ["127.0.0.1", "::1"];
    return process.env.NODE_ENV !== "production" && whitelist.includes(req.ip);
  },

  handler: (req, res) => {
    console.warn(
      `Rate limit exceeded for IP: ${req.ip}, URL: ${req.originalUrl}`
    );

    res.status(429).json({
      success: false,
      error: {
        message: "Too many requests from this IP",
        details: "Rate limit exceeded. Please try again later.",
        retryAfter: "15 minutes",
        limit: req.rateLimit.limit,
        remaining: req.rateLimit.remaining,
        resetTime: new Date(Date.now() + req.rateLimit.resetTime),
      },
      timestamp: new Date().toISOString(),
    });
  },
});

// Fixed auth rate limit with enhanced security logging
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Max 20 auth attempts per window

  message: {
    success: false,
    error: {
      message: "Too many authentication attempts",
      details:
        "Please try again later or contact support if you're having trouble logging in.",
      retryAfter: "15 minutes",
    },
    timestamp: new Date().toISOString(),
  },

  standardHeaders: true,
  legacyHeaders: false,

  handler: (req, res) => {
    console.error(
      `AUTH RATE LIMIT: IP ${req.ip} exceeded login attempts. URL: ${req.originalUrl}`
    );

    if (process.env.NODE_ENV === "production") {
      console.error(
        `SECURITY ALERT: Multiple failed auth attempts from ${req.ip}`
      );
    }

    res.status(429).json({
      success: false,
      error: {
        message: "Too many authentication attempts",
        details:
          "Account security measure activated. Please try again later or contact support.",
        retryAfter: "15 minutes",
        securityNote: "Multiple failed login attempts detected",
      },
      timestamp: new Date().toISOString(),
    });
  },
});

// Fixed express-slow-down configuration
const apiSlowDown = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // Start slowing after 100 requests
  delayMs: () => 500, // Add 500ms delay per request after limit
  maxDelayMs: 20000, // Maximum 20 second delay
});

app.use(cors(corsOptions));

app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const redisStore = new RedisStore({
  client: redisService.redis,
  prefix: "educademy:sess:",
  ttl: 24 * 60 * 60,
  touchAfter: 24 * 3600,
  disableTouch: false,
  disableTTL: false,
});

redisStore.on("error", (error) => {
  console.error("Redis session store error:", error);
});

redisStore.on("connect", () => {
  console.log("Redis session store connected");
});

redisStore.on("disconnect", () => {
  console.log("Redis session store disconnected");
});

app.use(
  session({
    store: redisStore,
    secret:
      process.env.SESSION_SECRET ||
      "educademy-session-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24,
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    },
    name: "educademy.sid",
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Add user ID middleware AFTER auth middleware
app.use(userIdMiddleware);

// Apply rate limiting and slow down middleware
app.use(globalRateLimit);
app.use(apiSlowDown);

const io = socketManager.init(server);

app.set("socketManager", socketManager);
app.set("redisService", redisService);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Educademy API Server is running",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    uptime: process.uptime(),
    connectedUsers: socketManager.getConnectedUsersCount(),
    redis: redisService.getConnectionStatus(),
  });
});

app.get("/health", async (req, res) => {
  const healthCheck = {
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: "1.0.0",
    services: {
      redis: redisService.getConnectionStatus(),
      database: "connected",
      socketio: {
        status: "connected",
        connectedUsers: socketManager.getConnectedUsersCount(),
        activeRooms: socketManager.getSystemStats().activeRooms,
      },
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + " MB",
      external:
        Math.round(process.memoryUsage().external / 1024 / 1024) + " MB",
    },
    cpu: process.cpuUsage(),
  };

  try {
    await redisService.healthCheck();
    res.status(200).json(healthCheck);
  } catch (error) {
    healthCheck.status = "ERROR";
    healthCheck.services.redis.isConnected = false;
    res.status(503).json(healthCheck);
  }
});

// Routes with authentication middleware
app.use("/api/auth", authRateLimit, authRoutes);
app.use("/api/notifications", authRateLimit, notificationRoutes);
app.use("/api/upload", authRateLimit, uploadRoutes);
app.use("/api/search", authRateLimit, searchRoutes);
app.use("/api/support", authRateLimit, supportRoutes);
// Payment webhook endpoint
app.post(
  "/api/webhook/payment",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const signature =
        req.headers["stripe-signature"] || req.headers["razorpay-signature"];

      if (!signature) {
        return res.status(400).send("Missing signature");
      }

      const event = req.body;

      switch (event.type) {
        case "payment_intent.succeeded":
        case "checkout.session.completed":
          socketManager.notifyPaymentSuccess(
            event.data.object.metadata.userId,
            {
              paymentId: event.data.object.id,
              amount: event.data.object.amount,
              currency: event.data.object.currency,
            }
          );
          break;
        case "payment_intent.payment_failed":
          socketManager.notifyPaymentFailed(event.data.object.metadata.userId, {
            paymentId: event.data.object.id,
            reason: event.data.object.last_payment_error?.message,
          });
          break;
      }

      res.json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(400).send(`Webhook Error: ${error.message}`);
    }
  }
);

// Middleware to attach services to request object
app.use((req, res, next) => {
  req.redisService = redisService;
  req.socketManager = socketManager;
  next();
});

// Additional security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Error handling middleware
app.use(validationErrorHandler);
app.use(databaseErrorHandler);
app.use(authErrorHandler);
app.use(notFound);
app.use(errorHandler);

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`🛑 ${signal} received, shutting down gracefully`);
  console.log(`⏱️  Uptime: ${process.uptime()}s`);
  console.log(`👥 Connected users: ${socketManager.getConnectedUsersCount()}`);

  server.close((err) => {
    if (err) {
      console.error("❌ Error during server shutdown:", err);
      process.exit(1);
    }

    io.close(async (err) => {
      if (err) {
        console.error("❌ Error closing Socket.IO:", err);
        process.exit(1);
      }

      try {
        console.log("🔄 Cleaning up Redis connections...");
        await redisService.flushall();
        console.log("✅ Redis cleanup completed");
      } catch (redisError) {
        console.error("❌ Redis cleanup error:", redisError);
      }

      console.log("✅ Server shutdown completed successfully");
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error("⏰ Forced shutdown after timeout");
    process.exit(1);
  }, 30000);
};

// Process event handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
  console.error(
    `👥 Connected users: ${socketManager.getConnectedUsersCount()}`
  );
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🚫 Unhandled Rejection:", reason);
  console.error(
    `👥 Connected users: ${socketManager.getConnectedUsersCount()}`
  );
  gracefulShutdown("UNHANDLED_REJECTION");
});

process.on("warning", (warning) => {
  console.warn("⚠️  Warning:", warning.name, warning.message);
});

process.on("exit", (code) => {
  console.log(`🏁 Process exited with code: ${code}`);
});

// Memory monitoring
const memoryUsageInterval = setInterval(() => {
  const used = process.memoryUsage();
  const memoryUsageMB = Math.round(used.heapUsed / 1024 / 1024);

  if (memoryUsageMB > 512) {
    console.warn(`⚠️  High memory usage: ${memoryUsageMB}MB`);
  }

  if (global.gc && memoryUsageMB > 300) {
    global.gc();
  }
}, 300000);

// Health check monitoring
const healthCheckInterval = setInterval(async () => {
  try {
    await redisService.healthCheck();

    const stats = socketManager.getSystemStats();
    if (stats.connectedUsers > 1000) {
      console.log(`📊 High connection count: ${stats.connectedUsers} users`);
    }
  } catch (error) {
    console.error("🔍 Health check failed:", error);
  }
}, 60000);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Educademy Server running on port ${PORT}`);
  console.log(`🕐 Started at: ${new Date().toISOString()}`);
  console.log(`🆔 Process ID: ${process.pid}`);
  console.log(`🔌 Socket.IO: enabled`);
  console.log(
    `🔗 CORS: ${process.env.FRONTEND_URL || "http://localhost:3000"}`
  );
  console.log(
    `💾 Redis: ${
      redisService.getConnectionStatus().isConnected
        ? "connected"
        : "disconnected"
    }`
  );
  console.log(`🛡️  Security: Helmet enabled`);
  console.log(`⚡ Compression: enabled`);
  console.log(`🚦 Rate limiting: enabled`);
  console.log("🔌 Socket.IO server ready for connections");
  console.log(`⚡ Ping timeout: 60000ms, interval: 25000ms`);

  if (process.env.NODE_ENV === "production") {
    console.log("🔒 Production security features enabled");
  } else {
    console.log("🛠️  Development mode - additional logging enabled");
  }
});

// Cleanup intervals on exit
process.on("beforeExit", () => {
  clearInterval(memoryUsageInterval);
  clearInterval(healthCheckInterval);
});

export default app;
export { socketManager, redisService };
