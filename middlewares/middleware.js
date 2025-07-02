import { config } from "dotenv";
config();
import jwt from "jsonwebtoken";
import getTokenFromHeader from "../utils/getTokenFromHeader.js";
import redisService from "../utils/redis.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const isTokenBlacklisted = async (token) => {
  try {
    return await redisService.exists(`blacklist:${token}`);
  } catch (error) {
    console.error("Error checking token blacklist:", error);
    return false;
  }
};

const isLoggedIn = async (req, res, next) => {
  const token = getTokenFromHeader(req);
  if (!token) {
    return res.status(403).json({
      success: false,
      message: "No token provided",
    });
  }

  try {
    const isBlacklisted = await isTokenBlacklisted(token);
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: "Token has been invalidated. Please login again.",
        code: "TOKEN_BLACKLISTED",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const sessionData = await redisService.getJSON(`session:${token}`);
    if (!sessionData) {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again.",
        code: "SESSION_EXPIRED",
      });
    }

    if (new Date(sessionData.expiresAt) < new Date()) {
      await redisService.del(`session:${token}`);
      const userSessionsKey = `user_sessions:${sessionData.userId}`;
      await redisService.srem(userSessionsKey, token);

      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again.",
        code: "SESSION_EXPIRED",
      });
    }

    const userCacheKey = `user:${decoded.id}`;
    let user = await redisService.getJSON(userCacheKey);

    if (!user) {
      user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          role: true,
          isActive: true,
          isVerified: true,
          adminProfile: {
            select: {
              id: true,
              permissions: true,
              department: true,
            },
          },
          instructorProfile: {
            select: {
              id: true,
              isVerified: true,
            },
          },
          studentProfile: {
            select: {
              id: true,
              skillLevel: true,
            },
          },
        },
      });

      if (user) {
        await redisService.setJSON(userCacheKey, user, { ex: 900 });
      }
    }

    if (!user) {
      await redisService.set(`blacklist:${token}`, "true", {
        ex: decoded.exp - Math.floor(Date.now() / 1000),
      });
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (!user.isActive) {
      await redisService.set(`blacklist:${token}`, "true", {
        ex: decoded.exp - Math.floor(Date.now() / 1000),
      });
      return res.status(403).json({
        success: false,
        message: "Account is deactivated. Contact support.",
        code: "ACCOUNT_DEACTIVATED",
      });
    }

    sessionData.lastActivity = new Date().toISOString();
    await redisService.setJSON(`session:${token}`, sessionData, {
      ex: 30 * 24 * 60 * 60,
    });

    req.userAuthId = user.id;
    req.userRole = user.role;
    req.userProfile = user;
    req.sessionToken = token;
    req.sessionData = sessionData;

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token has expired. Please login again.",
        code: "TOKEN_EXPIRED",
      });
    } else if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token format.",
        code: "INVALID_TOKEN",
      });
    }

    console.error("Authentication middleware error:", error);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      code: "AUTH_ERROR",
    });
  }
};

const isAdmin = async (req, res, next) => {
  try {
    if (!req.userAuthId || !req.userRole) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    next();
  } catch (error) {
    console.error("Admin authorization error:", error);
    return res.status(500).json({
      success: false,
      message: "Authorization verification failed",
      code: "AUTH_VERIFICATION_ERROR",
    });
  }
};

const isInstructor = async (req, res, next) => {
  try {
    if (!req.userAuthId || !req.userRole) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    if (req.userRole !== "INSTRUCTOR") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Instructor privileges required.",
        code: "INSUFFICIENT_PERMISSIONS",
      });
    }

    if (!req.userProfile?.instructorProfile) {
      return res.status(403).json({
        success: false,
        message:
          "Instructor profile not found. Complete your instructor setup.",
        code: "PROFILE_INCOMPLETE",
      });
    }

    const instructorProfile = await prisma.instructor.findUnique({
      where: { userId: req.userAuthId },
      select: {
        id: true,
        isVerified: true,
        user: {
          select: {
            isActive: true,
            isVerified: true,
          },
        },
      },
    });

    if (!instructorProfile) {
      return res.status(403).json({
        success: false,
        message:
          "Instructor profile not found. Complete your instructor application.",
        code: "PROFILE_NOT_FOUND",
      });
    }

    if (!instructorProfile.user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Account pending email verification.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    req.instructorProfile = instructorProfile;
    next();
  } catch (error) {
    console.error("Instructor authorization error:", error);
    return res.status(500).json({
      success: false,
      message: "Authorization verification failed",
      code: "AUTH_VERIFICATION_ERROR",
    });
  }
};

const isStudent = async (req, res, next) => {
  try {
    if (!req.userAuthId || !req.userRole) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    if (req.userRole !== "STUDENT") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Student privileges required.",
        code: "INSUFFICIENT_PERMISSIONS",
      });
    }

    if (!req.userProfile?.studentProfile) {
      return res.status(403).json({
        success: false,
        message: "Student profile not found. Complete your student setup.",
        code: "PROFILE_INCOMPLETE",
      });
    }

    const studentProfile = await prisma.student.findUnique({
      where: { userId: req.userAuthId },
      select: {
        id: true,
        skillLevel: true,
        totalLearningTime: true,
        user: {
          select: {
            isActive: true,
            isVerified: true,
          },
        },
      },
    });

    if (!studentProfile) {
      return res.status(403).json({
        success: false,
        message:
          "Student profile not found. Complete your student registration.",
        code: "PROFILE_NOT_FOUND",
      });
    }

    if (!studentProfile.user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Account pending email verification.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    req.studentProfile = studentProfile;
    next();
  } catch (error) {
    console.error("Student authorization error:", error);
    return res.status(500).json({
      success: false,
      message: "Authorization verification failed",
      code: "AUTH_VERIFICATION_ERROR",
    });
  }
};

const requireAdmin = [isLoggedIn, isAdmin];
const requireInstructor = [isLoggedIn, isInstructor];
const requireStudent = [isLoggedIn, isStudent];

export {
  isAdmin,
  isInstructor,
  isStudent,
  requireAdmin,
  requireInstructor,
  requireStudent,
  isTokenBlacklisted,
  isLoggedIn,
};
