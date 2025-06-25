import morgan from "morgan";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom morgan tokens for more detailed logging
morgan.token("id", (req) => req.headers["x-request-id"] || "no-id");
morgan.token("user-id", (req) => req.userAuthId || "anonymous");
morgan.token("real-ip", (req) => {
  return (
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip
  );
});
morgan.token("user-agent-short", (req) => {
  const ua = req.headers["user-agent"];
  if (!ua) return "unknown";

  const match = ua.match(
    /(Chrome|Firefox|Safari|Edge|Opera|Postman|Thunder|curl)\/?\d*/i
  );
  return match ? match[0] : ua.substring(0, 30);
});

// Custom format for development with colors and detailed info
const devFormat = morgan.compile(
  [
    ":method",
    ":url",
    ":status",
    ":response-time ms",
    "- :res[content-length]",
    ":real-ip",
    ":user-agent-short",
    "User: :user-id",
    "ID: :id",
  ].join(" ")
);

// Custom format for production with structured logging
const prodFormat = morgan.compile(
  [
    "[:date[iso]]",
    ":real-ip",
    ":method",
    ":url",
    "HTTP/:http-version",
    ":status",
    ":res[content-length]",
    ":response-time",
    '":referrer"',
    '":user-agent"',
    "user_id=:user-id",
    "request_id=:id",
  ].join(" ")
);

// Custom format for API monitoring (JSON format)
const jsonFormat = (tokens, req, res) => {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    status: parseInt(tokens.status(req, res)),
    responseTime: parseFloat(tokens["response-time"](req, res)),
    contentLength: tokens.res(req, res, "content-length"),
    ip: tokens["real-ip"](req, res),
    userAgent: tokens["user-agent"](req, res),
    userId: tokens["user-id"](req, res),
    requestId: tokens.id(req, res),
    referer: tokens.referrer(req, res),
    httpVersion: tokens["http-version"](req, res),
  });
};

// Configure Morgan based on environment
export const configureMorgan = (app) => {
  if (process.env.NODE_ENV === "production") {
    // Production: Log to files and console
    const accessLogStream = fs.createWriteStream(
      path.join(logsDir, "access.log"),
      { flags: "a" }
    );

    const errorLogStream = fs.createWriteStream(
      path.join(logsDir, "error.log"),
      { flags: "a" }
    );

    // Log ALL requests to access.log (successful and errors)
    app.use(
      morgan(prodFormat, {
        stream: accessLogStream,
        skip: () => false, // Don't skip any requests
      })
    );

    // Log ONLY errors to error.log
    app.use(
      morgan(prodFormat, {
        stream: errorLogStream,
        skip: (req, res) => res.statusCode < 400,
      })
    );

    // Also log to console (all requests)
    app.use(
      morgan("combined", {
        skip: () => false, // Log everything to console in production too
      })
    );
  } else {
    // Development: Detailed console logging for ALL requests
    app.use(
      morgan(devFormat, {
        skip: () => false, // Never skip any requests
      })
    );

    // Alternative simple format for debugging
    app.use(
      morgan(":method :url :status :response-time ms - :res[content-length]", {
        skip: () => false,
      })
    );
  }

  // JSON format for API monitoring (optional)
  if (process.env.ENABLE_JSON_LOGS === "true") {
    const jsonLogStream = fs.createWriteStream(path.join(logsDir, "api.json"), {
      flags: "a",
    });

    app.use(
      morgan(jsonFormat, {
        stream: jsonLogStream,
        skip: () => false, // Log all requests to JSON file
      })
    );
  }

  console.log(
    `📝 Morgan logging configured for ${
      process.env.NODE_ENV || "development"
    } environment`
  );
  console.log("✅ Logging ALL requests (success and errors)");
};

// Enhanced middleware to add request ID for better tracking
export const requestIdMiddleware = (req, res, next) => {
  req.headers["x-request-id"] =
    req.headers["x-request-id"] || Math.random().toString(36).substr(2, 9);
  next();
};

// Middleware to capture user ID for logging
export const userIdMiddleware = (req, res, next) => {
  // This should be placed after your auth middleware
  if (req.user) {
    req.userAuthId = req.user.id;
  }
  next();
};
