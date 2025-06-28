import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";
import generateToken from "../../utils/generateToken.js";
import asyncHandler from "express-async-handler";
import bcrypt from "bcryptjs";
import emailService from "../../utils/emailService.js";
import otpService from "../../utils/otpService.js";
import redisService from "../../utils/redis.js";
import notificationService from "../../utils/notificationservice.js";
import { uploadImage } from "../../config/upload.js";
import getTokenFromHeader from "../../utils/getTokenFromHeader.js";

import {
  createUserProfile,
  validateRegistrationInput,
  handleFileCleanup,
  generateRequestId,
  createSessionData,
  sendWelcomeNotifications,
  generateVerificationToken,
  storeVerificationToken,
  verifyByToken,
  validateLoginInput,
  checkAccountStatus,
  handleLoginSecurity,
  validatePasswordResetInput,
  validateNewPasswordInput,
  clearUserCaches,
  invalidateUserSessions,
  sendPasswordResetNotification,
  validateOTPRequestInput,
  checkOTPRateLimit,
  generateAndStoreOTP,
  validateResendOTPInput,
} from "../../helper/helperFunctions.js";

const prisma = new PrismaClient();

export const registerUser = asyncHandler(async (req, res) => {
  uploadImage.single("profileImage")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    const requestId = generateRequestId();
    const startTime = performance.now();

    try {
      const {
        firstName,
        lastName,
        email,
        password,
        role = "STUDENT",
      } = req.body;
      const profileImagePath = req.file?.path || null;
      const profileImageFilename = req.file?.filename || null;

      const validationResult = validateRegistrationInput({
        firstName,
        lastName,
        email,
        password,
        role,
      });

      if (!validationResult.isValid) {
        await handleFileCleanup(profileImageFilename);
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: validationResult.errors,
          code: "VALIDATION_ERROR",
        });
      }

      const normalizedEmail = email.toLowerCase().trim();

      const [rateLimitResult, existingUser] = await Promise.all([
        redisService.rateLimitCheck(`register:${req.ip}`, 5, 3600),
        redisService.getJSON(`user:${normalizedEmail}`),
      ]);

      if (!rateLimitResult.allowed) {
        await handleFileCleanup(profileImageFilename);
        return res.status(429).json({
          success: false,
          message: "Too many registration attempts. Please try again later.",
          retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
          code: "RATE_LIMIT_EXCEEDED",
        });
      }

      let userExists = existingUser;

      if (!userExists) {
        userExists = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isVerified: true,
            isActive: true,
            createdAt: true,
          },
        });

        if (userExists) {
          await redisService.setJSON(`user:${normalizedEmail}`, userExists, {
            ex: 900,
          });
        }
      }

      if (userExists) {
        await handleFileCleanup(profileImageFilename);

        if (userExists.isVerified) {
          return res.status(409).json({
            success: false,
            message:
              "An account with this email already exists. Please login instead.",
            code: "USER_ALREADY_EXISTS",
          });
        }

        const otpResult = await otpService.rateLimitCheck(
          normalizedEmail,
          60,
          3
        );
        if (!otpResult.allowed) {
          return res.status(429).json({
            success: false,
            message: "Too many OTP requests. Please try again later.",
            retryAfter: otpResult.resetIn,
            code: "OTP_RATE_LIMIT",
          });
        }

        const newOtp = otpService.generateOTP();
        const newVerificationToken = generateVerificationToken();

        await Promise.all([
          otpService.storeOTP(normalizedEmail, newOtp, 10),
          storeVerificationToken(newVerificationToken, normalizedEmail, 30),
          emailService.sendOTPVerification({
            email: normalizedEmail,
            firstName: userExists.firstName,
            otp: newOtp,
            expiresIn: 10,
            isRegistration: true,
            actionUrl: `${process.env.FRONTEND_URL}/verify-email?token=${newVerificationToken}`,
          }),
        ]);

        return res.status(200).json({
          success: true,
          message:
            "Account exists but not verified. New verification code sent to your email.",
          userId: userExists.id,
          needsVerification: true,
          code: "ACCOUNT_EXISTS_UNVERIFIED",
        });
      }

      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      const userData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizedEmail,
        passwordHash: hashedPassword,
        salt,
        role,
        profileImage: profileImagePath,
        isVerified: false,
        isActive: true,
      };

      const result = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: userData,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            profileImage: true,
            isVerified: true,
            isActive: true,
            createdAt: true,
          },
        });

        await createUserProfile(newUser.id, role, tx);
        return newUser;
      });

      const otp = otpService.generateOTP();
      const verificationToken = generateVerificationToken();

      await Promise.all([
        otpService.storeOTP(normalizedEmail, otp, 10),
        storeVerificationToken(verificationToken, normalizedEmail, 30),
        redisService.setJSON(`user:${normalizedEmail}`, result, { ex: 900 }),
        redisService.del(`user:${normalizedEmail}:cache`),
        emailService.sendOTPVerification({
          email: normalizedEmail,
          firstName: result.firstName,
          otp,
          expiresIn: 10,
          isRegistration: true,
          actionUrl: `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`,
        }),
        notificationService.createNotification({
          userId: result.id,
          type: "SYSTEM_ANNOUNCEMENT",
          title: "Welcome to Educademy",
          message: "Please verify your email to complete registration.",
          priority: "HIGH",
          sendEmail: false,
          sendSocket: false,
        }),
      ]);

      const executionTime = performance.now() - startTime;

      res.status(201).json({
        success: true,
        message:
          "Registration successful! Please check your email for verification code.",
        data: {
          userId: result.id,
          email: result.email,
          firstName: result.firstName,
          lastName: result.lastName,
          role: result.role,
          profileImage: result.profileImage,
          needsVerification: true,
          verificationCodeSent: true,
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      await handleFileCleanup(req.file?.filename);

      console.error(`REGISTRATION_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        email: req.body?.email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Registration failed. Please try again.",
        code: "INTERNAL_SERVER_ERROR",
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    }
  });
});

export const loginUser = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { email, password } = req.body;

    console.time(`LOGIN_STEP_1_VALIDATION_${requestId}`);
    const validationResult = validateLoginInput({ email, password });
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }
    console.timeEnd(`LOGIN_STEP_1_VALIDATION_${requestId}`);

    const normalizedEmail = email.toLowerCase().trim();

    console.time(`LOGIN_STEP_2_TOKEN_CHECK_${requestId}`);
    const existingToken = getTokenFromHeader(req);
    if (existingToken) {
      const existingSession = await redisService.getJSON(
        `session:${existingToken}`
      );
      if (existingSession) {
        return res.status(400).json({
          success: false,
          message: "Already logged in. Please logout first.",
          code: "ALREADY_AUTHENTICATED",
        });
      }
    }
    console.timeEnd(`LOGIN_STEP_2_TOKEN_CHECK_${requestId}`);

    console.time(`LOGIN_STEP_3_PARALLEL_CHECKS_${requestId}`);
    const [rateLimitResult, cachedUser] = await Promise.all([
      redisService.rateLimitCheck(`login:${req.ip}`, 10, 3600),
      redisService.getJSON(`user:${normalizedEmail}`),
    ]);
    console.timeEnd(`LOGIN_STEP_3_PARALLEL_CHECKS_${requestId}`);

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many login attempts. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    let user = cachedUser;

    if (!user) {
      console.time(`LOGIN_STEP_4_DB_USER_LOOKUP_${requestId}`);
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          passwordHash: true,
          role: true,
          profileImage: true,
          isVerified: true,
          isActive: true,
          isBanned: true,
          bannedAt: true,
          banReason: true,
        },
      });
      console.timeEnd(`LOGIN_STEP_4_DB_USER_LOOKUP_${requestId}`);

      if (user) {
        setImmediate(async () => {
          try {
            await redisService.setJSON(`user:${normalizedEmail}`, user, {
              ex: 900,
            });
          } catch (error) {
            console.warn("Cache set failed:", error);
          }
        });
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
    }

    console.time(`LOGIN_STEP_5_PASSWORD_CHECK_${requestId}`);
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    console.timeEnd(`LOGIN_STEP_5_PASSWORD_CHECK_${requestId}`);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
    }

    console.time(`LOGIN_STEP_6_ACCOUNT_STATUS_${requestId}`);
    const accountStatusCheck = checkAccountStatus(user);
    if (!accountStatusCheck.isValid) {
      return res.status(accountStatusCheck.statusCode).json({
        success: false,
        message: accountStatusCheck.message,
        code: accountStatusCheck.code,
        ...accountStatusCheck.additionalData,
      });
    }
    console.timeEnd(`LOGIN_STEP_6_ACCOUNT_STATUS_${requestId}`);

    console.time(`LOGIN_STEP_7_TOKEN_GENERATION_${requestId}`);
    const token = generateToken(user.id);
    console.timeEnd(`LOGIN_STEP_7_TOKEN_GENERATION_${requestId}`);

    console.time(`LOGIN_STEP_8_SESSION_DATA_${requestId}`);
    const sessionData = await createSessionData({
      token,
      userId: user.id,
      deviceType: req.get("User-Agent")?.substring(0, 255) || "unknown",
      ipAddress: req.ip || "127.0.0.1",
      userAgent: req.get("User-Agent"),
    });
    console.timeEnd(`LOGIN_STEP_8_SESSION_DATA_${requestId}`);

    console.time(`LOGIN_STEP_9_DB_TRANSACTION_${requestId}`);
    const session = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      return await tx.session.create({
        data: sessionData,
        select: {
          id: true,
          expiresAt: true,
          deviceType: true,
          ipAddress: true,
          createdAt: true,
        },
      });
    });
    console.timeEnd(`LOGIN_STEP_9_DB_TRANSACTION_${requestId}`);

    console.time(`LOGIN_STEP_10_REDIS_OPERATIONS_${requestId}`);
    await Promise.all([
      redisService.setJSON(
        `session:${token}`,
        {
          userId: user.id,
          sessionId: session.id,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          deviceType: session.deviceType,
          ipAddress: session.ipAddress,
          lastActivity: new Date(),
        },
        { ex: 30 * 24 * 60 * 60 }
      ),
      redisService.sadd(`user_sessions:${user.id}`, token),
      redisService.expire(`user_sessions:${user.id}`, 30 * 24 * 60 * 60),
      redisService.del(`user:${normalizedEmail}`),
    ]);
    console.timeEnd(`LOGIN_STEP_10_REDIS_OPERATIONS_${requestId}`);

    setImmediate(async () => {
      try {
        console.time(`LOGIN_STEP_11_SECURITY_BACKGROUND_${requestId}`);
        await handleLoginSecurity({
          user: { id: user.id, email: user.email, firstName: user.firstName },
          session: session,
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
          location: req.get("CF-IPCountry") || "Unknown",
        });
        console.timeEnd(`LOGIN_STEP_11_SECURITY_BACKGROUND_${requestId}`);
      } catch (error) {
        console.warn("Security handling failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          profileImage: user.profileImage,
          isVerified: user.isVerified,
          isActive: user.isActive,
        },
        sessionInfo: {
          expiresAt: session.expiresAt,
          deviceType: session.deviceType,
          ipAddress: session.ipAddress,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        loginMethod: "email_password",
      },
    });
  } catch (error) {
    console.error(`LOGIN_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      email: req.body?.email,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const logoutUser = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const token = getTokenFromHeader(req);
    let tokensInvalidated = 0;
    let sessionsDeleted = 0;

    if (token) {
      const sessionCacheKey = `session:${token}`;
      const sessionData = await redisService.getJSON(sessionCacheKey);

      const tokenExpiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      await redisService.set(`blacklist:${token}`, "true", { ex: tokenExpiry });
      tokensInvalidated = 1;

      await redisService.del(sessionCacheKey);

      if (sessionData) {
        const userSessionsKey = `user_sessions:${sessionData.userId}`;
        await redisService.srem(userSessionsKey, token);

        if (req.userAuthId) {
          await Promise.all([
            redisService.del(`user:${req.userAuthId}`),
            redisService.del(`user_profile:${req.userAuthId}`),
            redisService.del(`user:${sessionData.userId}`),
          ]);
        }
      }

      const deletedSessions = await prisma.session.deleteMany({
        where: {
          token,
          userId: req.userAuthId,
        },
      });

      sessionsDeleted = deletedSessions.count;
    }

    if (req.session) {
      await new Promise((resolve, reject) => {
        req.session.destroy((err) => {
          if (err) {
            console.warn(`Session destruction warning [${requestId}]:`, err);
          }
          resolve();
        });
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
      data: {
        tokenBlacklisted: tokensInvalidated > 0,
        sessionsTerminated: sessionsDeleted,
        httpSessionDestroyed: true,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`LOGOUT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Logout failed. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const verifyUser = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { email, otp, token } = req.body;

    if (!token && (!email || !otp)) {
      return res.status(400).json({
        success: false,
        message: "Either provide a verification token, or both email and OTP",
        code: "MISSING_REQUIRED_FIELDS",
        details: {
          requiredCombinations: ["token only", "email + otp"],
        },
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `verify:${req.ip}`,
      15,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many verification attempts. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    let verificationResult;
    let userEmail;

    if (token) {
      try {
        verificationResult = await verifyByToken(token);
        userEmail = verificationResult.email;
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired verification token",
          code: "INVALID_TOKEN",
        });
      }
    } else {
      const normalizedEmail = email.toLowerCase().trim();

      if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid verification code format. Please enter a 6-digit code.",
          code: "INVALID_OTP_FORMAT",
        });
      }

      try {
        const otpResult = await otpService.verifyOTP(normalizedEmail, otp);

        if (!otpResult || !otpResult.success) {
          return res.status(400).json({
            success: false,
            message:
              otpResult?.message || "Invalid or expired verification code",
            code: "OTP_VERIFICATION_FAILED",
            details: otpResult,
          });
        }

        verificationResult = { success: true, email: normalizedEmail };
        userEmail = normalizedEmail;
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: "OTP verification service error",
          code: "OTP_SERVICE_ERROR",
          details:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    }

    if (!verificationResult || !verificationResult.success) {
      return res.status(400).json({
        success: false,
        message: verificationResult?.message || "Verification failed",
        code: "VERIFICATION_FAILED",
      });
    }

    let existingUser = await redisService.getJSON(`user:${userEmail}`);

    if (!existingUser) {
      existingUser = await prisma.user.findUnique({
        where: { email: userEmail },
        select: { id: true, isVerified: true, isActive: true },
      });

      if (existingUser) {
        await redisService.setJSON(`user:${userEmail}`, existingUser, {
          ex: 900,
        });
      }
    }

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (existingUser.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
        code: "ALREADY_VERIFIED",
      });
    }

    if (!existingUser.isActive) {
      return res.status(400).json({
        success: false,
        message: "Account is inactive. Please contact support.",
        code: "ACCOUNT_INACTIVE",
      });
    }

    const authToken = generateToken(existingUser.id);
    const sessionData = await createSessionData({
      token: authToken,
      userId: existingUser.id,
      deviceType: token ? "email_link_verification" : "otp_verification",
      ipAddress: req.ip || "127.0.0.1",
      userAgent: req.get("User-Agent"),
    });

    const userResult = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { email: userEmail },
        data: {
          isVerified: true,
          lastLogin: new Date(),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          profileImage: true,
          bio: true,
          isVerified: true,
          isActive: true,
          timezone: true,
          language: true,
          country: true,
          phoneNumber: true,
          dateOfBirth: true,
          website: true,
          linkedinProfile: true,
          twitterProfile: true,
          githubProfile: true,
          lastLogin: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const session = await tx.session.create({
        data: sessionData,
      });

      return { user: updatedUser, session };
    });

    const cleanupPromises = [
      redisService.del(`user:${userEmail}`),
      redisService.del(`user:${userResult.user.id}:cache`),
      redisService.setJSON(
        `session:${authToken}`,
        {
          userId: userResult.user.id,
          sessionId: userResult.session.id,
          createdAt: userResult.session.createdAt,
          expiresAt: userResult.session.expiresAt,
          deviceType: userResult.session.deviceType,
          ipAddress: userResult.session.ipAddress,
          lastActivity: new Date(),
        },
        { ex: 30 * 24 * 60 * 60 }
      ),
      redisService.sadd(`user_sessions:${userResult.user.id}`, authToken),
      redisService.expire(
        `user_sessions:${userResult.user.id}`,
        30 * 24 * 60 * 60
      ),
    ];

    if (token) {
      cleanupPromises.push(redisService.del(`verification_token:${token}`));
    } else {
      cleanupPromises.push(otpService.clearOTP(userEmail));
    }

    await Promise.all([
      ...cleanupPromises,
      ...sendWelcomeNotifications({
        user: userResult.user,
        isNewUser: true,
      }),
    ]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Email verified successfully! Welcome to Educademy.",
      data: {
        token: authToken,
        sessionInfo: {
          expiresAt: userResult.session.expiresAt,
          deviceType: userResult.session.deviceType,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        isNewUser: true,
        autoLogin: true,
        verificationMethod: token ? "email_link" : "otp",
      },
    });
  } catch (error) {
    console.error(`VERIFICATION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      email: req.body?.email,
      token: req.body?.token ? "***" : undefined,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Verification failed. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const requestPasswordReset = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { email } = req.body;

    const validationResult = validatePasswordResetInput({ email });
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const rateLimitResult = await redisService.rateLimitCheck(
      `password_reset:${req.ip}`,
      5,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many password reset attempts. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const emailRateLimitResult = await redisService.rateLimitCheck(
      `password_reset_email:${normalizedEmail}`,
      3,
      3600
    );

    if (!emailRateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message:
          "Too many password reset requests for this email. Please try again later.",
        retryAfter: Math.ceil(emailRateLimitResult.resetTime / 60),
        code: "EMAIL_RATE_LIMIT_EXCEEDED",
      });
    }

    const userCacheKey = `user:${normalizedEmail}`;
    let user = await redisService.getJSON(userCacheKey);

    if (!user) {
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          isActive: true,
          isVerified: true,
          isBanned: true,
        },
      });

      if (user) {
        await redisService.setJSON(userCacheKey, user, { ex: 900 });
      }
    }

    if (!user) {
      return res.status(200).json({
        success: true,
        message:
          "If an account with this email exists, you will receive a password reset email.",
        code: "PASSWORD_RESET_INITIATED",
      });
    }

    if (!user.isActive || user.isBanned) {
      return res.status(200).json({
        success: true,
        message:
          "If an account with this email exists, you will receive a password reset email.",
        code: "PASSWORD_RESET_INITIATED",
      });
    }

    const otp = otpService.generateOTP();
    await otpService.storeOTP(normalizedEmail, otp, 15);

    const requestInfo = {
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      timestamp: new Date().toISOString(),
      location: req.get("CF-IPCountry") || "Unknown",
    };

    const emailPromise = emailService.sendPasswordResetOTP({
      email: normalizedEmail,
      firstName: user.firstName,
      otp,
      expiresIn: 15,
      ipAddress: requestInfo.ipAddress,
      requestTime: new Date().toLocaleString(),
    });

    const notificationPromise = sendPasswordResetNotification({
      user,
      requestInfo,
      otpExpiry: 15,
    });

    await Promise.allSettled([emailPromise, notificationPromise]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Password reset instructions have been sent to your email.",
      data: {
        emailSent: true,
        expiresIn: 15,
        requestId,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`PASSWORD_RESET_REQUEST_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      email: req.body?.email,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to process password reset request.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const resetPassword = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { email, otp, newPassword } = req.body;

    const validationResult = validateNewPasswordInput({
      email,
      otp,
      newPassword,
    });
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const rateLimitResult = await redisService.rateLimitCheck(
      `password_reset_verify:${req.ip}`,
      10,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many password reset attempts. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const otpResult = await otpService.verifyOTP(normalizedEmail, otp);
    if (!otpResult.success) {
      return res.status(400).json({
        success: false,
        message: otpResult.message,
        code: "OTP_VERIFICATION_FAILED",
      });
    }

    const userCacheKey = `user:${normalizedEmail}`;
    let user = await redisService.getJSON(userCacheKey);

    if (!user) {
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          isActive: true,
          isVerified: true,
          isBanned: true,
        },
      });

      if (user) {
        await redisService.setJSON(userCacheKey, user, { ex: 900 });
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (!user.isActive || user.isBanned) {
      return res.status(403).json({
        success: false,
        message: "Account is not accessible for password reset",
        code: "ACCOUNT_INACCESSIBLE",
      });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    const updateResult = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashedPassword,
          salt,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      });

      return updatedUser;
    });

    await Promise.all([
      invalidateUserSessions(user.id),
      clearUserCaches(normalizedEmail, user.id),
      redisService.del(`password_reset:${req.ip}`),
      redisService.del(`password_reset_email:${normalizedEmail}`),
    ]);

    const securityNotificationPromise = notificationService.createNotification({
      userId: user.id,
      type: "SYSTEM_ANNOUNCEMENT",
      title: "Password Changed Successfully",
      message:
        "Your password has been changed. All existing sessions have been terminated for security.",
      priority: "HIGH",
      data: {
        changedAt: new Date().toISOString(),
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      },
      sendEmail: true,
      sendSocket: false,
    });

    await Promise.allSettled([securityNotificationPromise]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message:
        "Password has been reset successfully. You can now login with your new password.",
      data: {
        passwordChanged: true,
        sessionsInvalidated: true,
        securityNotificationSent: true,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`PASSWORD_RESET_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      email: req.body?.email,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to reset password. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const resendOTP = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { email, type = "verification" } = req.body;

    const validationResult = validateResendOTPInput({ email, type });
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const rateLimitCheck = await checkOTPRateLimit(normalizedEmail, type);
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: rateLimitCheck.message,
        retryAfter: rateLimitCheck.retryAfter,
        code: "OTP_RATE_LIMIT_EXCEEDED",
      });
    }

    const userCacheKey = `user:${normalizedEmail}`;
    let user = await redisService.getJSON(userCacheKey);

    if (!user) {
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          isActive: true,
          isVerified: true,
          isBanned: true,
        },
      });

      if (user) {
        await redisService.setJSON(userCacheKey, user, { ex: 900 });
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found with this email address",
        code: "USER_NOT_FOUND",
      });
    }

    if (!user.isActive || user.isBanned) {
      return res.status(403).json({
        success: false,
        message: "Account is not accessible for OTP requests",
        code: "ACCOUNT_INACCESSIBLE",
      });
    }

    if (type === "verification" && user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Account is already verified",
        code: "ALREADY_VERIFIED",
      });
    }

    const otpData = await generateAndStoreOTP(normalizedEmail, type);

    let emailPromise;
    const expiresIn = type === "password_reset" ? 15 : 10;

    if (type === "verification") {
      emailPromise = emailService.sendOTPVerification({
        email: normalizedEmail,
        firstName: user.firstName,
        otp: otpData.otp,
        expiresIn,
        isRegistration: !user.isVerified,
      });
    } else if (type === "password_reset") {
      emailPromise = emailService.sendPasswordResetOTP({
        email: normalizedEmail,
        firstName: user.firstName,
        otp: otpData.otp,
        expiresIn,
        ipAddress: req.ip,
        requestTime: new Date().toLocaleString(),
      });
    }

    const notificationPromise = notificationService.createNotification({
      userId: user.id,
      type: "SYSTEM_ANNOUNCEMENT",
      title: "New Verification Code Sent",
      message: `A new ${
        type === "password_reset" ? "password reset" : "verification"
      } code has been sent to your email.`,
      priority: "NORMAL",
      sendEmail: false,
      sendSocket: true,
    });

    await Promise.allSettled([emailPromise, notificationPromise]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: `New ${
        type === "password_reset" ? "password reset" : "verification"
      } code has been sent to your email.`,
      data: {
        emailSent: true,
        expiresIn,
        otpType: type,
        remainingAttempts: rateLimitCheck.remainingAttempts,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`RESEND_OTP_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      email: req.body?.email,
      type: req.body?.type,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to resend verification code.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const checkOTPStatus = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { email } = req.params;

    const validationResult = validateOTPRequestInput({ email });
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const rateLimitResult = await redisService.rateLimitCheck(
      `otp_status:${req.ip}`,
      20,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many OTP status requests. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const otpStatus = await otpService.getOTPStatus(normalizedEmail);

    if (!otpStatus) {
      return res.status(404).json({
        success: false,
        message: "No verification code found for this email",
        code: "OTP_NOT_FOUND",
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "OTP status retrieved successfully",
      data: {
        exists: otpStatus.exists,
        expired: otpStatus.expired,
        attempts: otpStatus.attempts,
        remainingAttempts: otpStatus.remainingAttempts,
        expiresAt: otpStatus.expiresAt,
        canResend: otpStatus.expired || otpStatus.remainingAttempts === 0,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`OTP_STATUS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      email: req.params?.email,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to check OTP status.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const googleAuth = asyncHandler(async (req, res, next) => {
  const { role = "STUDENT" } = req.query;
  const validRoles = ["STUDENT", "INSTRUCTOR"];
  const userRole = validRoles.includes(role) ? role : "STUDENT";

  req.session.pendingRole = userRole;

  passport.authenticate("google", {
    scope: ["profile", "email"],
  })(req, res, next);
});

export const googleAuthCallback = asyncHandler(async (req, res, next) => {
  passport.authenticate("google", async (err, profile) => {
    const requestId = generateRequestId();
    const startTime = performance.now();
    const userRole = req.session.pendingRole || "STUDENT";
    delete req.session.pendingRole;

    try {
      if (err) {
        console.error(`GOOGLE_AUTH_ERROR [${requestId}]:`, err);
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=auth_failed&requestId=${requestId}`
        );
      }

      if (!profile) {
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=auth_cancelled&requestId=${requestId}`
        );
      }

      const normalizedEmail = profile.emails[0].value.toLowerCase();
      const cacheKey = `user:${normalizedEmail}`;
      let user = await redisService.getJSON(cacheKey);

      if (!user) {
        user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          include: {
            socialLogins: true,
            studentProfile: true,
            instructorProfile: true,
            adminProfile: true,
          },
        });

        if (user) {
          await redisService.setJSON(cacheKey, user, { ex: 900 });
        }
      }

      if (user) {
        const existingGoogleLogin = user.socialLogins?.find(
          (login) =>
            login.provider === "google" && login.providerId === profile.id
        );

        const updateData = {};
        let profileImageUrl = user.profileImage;

        if (!existingGoogleLogin) {
          await prisma.socialLogin.create({
            data: {
              provider: "google",
              providerId: profile.id,
              userId: user.id,
            },
          });
        }

        if (!profileImageUrl && profile.photos?.[0]?.value) {
          profileImageUrl = await handleOAuthProfileImage(
            profile.photos[0].value,
            user.id
          );

          if (profileImageUrl !== profile.photos[0].value) {
            updateData.profileImage = profileImageUrl;
          }
        }

        if (!user.isVerified) {
          updateData.isVerified = true;
        }

        updateData.lastLogin = new Date();

        if (Object.keys(updateData).length > 0) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: updateData,
            include: {
              studentProfile: true,
              instructorProfile: true,
              adminProfile: true,
            },
          });
        }

        if (updateData.isVerified) {
          const welcomePromise = emailService.sendWelcomeEmail({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            userRole: user.role,
          });

          await Promise.allSettled([welcomePromise]);
        }

        await clearUserCaches(normalizedEmail, user.id);
      } else {
        const profileImageUrl = profile.photos?.[0]?.value
          ? await handleOAuthProfileImage(
              profile.photos[0].value,
              `temp_${Date.now()}`
            )
          : null;

        const result = await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              firstName: profile.name.givenName || "Google",
              lastName: profile.name.familyName || "User",
              email: normalizedEmail,
              profileImage: profileImageUrl,
              role: userRole,
              isVerified: true,
              isActive: true,
              lastLogin: new Date(),
            },
          });

          await tx.socialLogin.create({
            data: {
              provider: "google",
              providerId: profile.id,
              userId: newUser.id,
            },
          });

          await createUserProfile(newUser.id, userRole, tx);

          return newUser;
        });

        user = await prisma.user.findUnique({
          where: { id: result.id },
          include: {
            studentProfile: true,
            instructorProfile: true,
            adminProfile: true,
          },
        });

        const welcomePromises = sendWelcomeNotifications({
          user,
          isNewUser: true,
        });

        await Promise.allSettled(welcomePromises);
        await redisService.setJSON(`user:${user.id}`, user, { ex: 3600 });
      }

      const authCode = await createTempAuthCode(user.id);
      const executionTime = performance.now() - startTime;

      res.redirect(
        `${process.env.FRONTEND_URL}/auth/callback?code=${authCode}&success=true&provider=google`
      );
    } catch (error) {
      console.error(`GOOGLE_AUTH_CALLBACK_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        profileId: profile?.id,
        email: profile?.emails?.[0]?.value,
      });

      res.redirect(
        `${process.env.FRONTEND_URL}/login?error=auth_failed&requestId=${requestId}`
      );
    }
  })(req, res, next);
});

export const gitHubAuth = asyncHandler(async (req, res, next) => {
  const { role = "STUDENT" } = req.query;
  const validRoles = ["STUDENT", "INSTRUCTOR"];
  const userRole = validRoles.includes(role) ? role : "STUDENT";

  req.session.pendingRole = userRole;

  passport.authenticate("github", {
    scope: ["user:email"],
  })(req, res, next);
});

export const gitHubAuthCallback = asyncHandler(async (req, res, next) => {
  passport.authenticate("github", async (err, profile) => {
    const requestId = generateRequestId();
    const startTime = performance.now();
    const userRole = req.session.pendingRole || "STUDENT";
    delete req.session.pendingRole;

    try {
      if (err) {
        console.error(`GITHUB_AUTH_ERROR [${requestId}]:`, err);
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=auth_failed&requestId=${requestId}`
        );
      }

      if (!profile) {
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=auth_cancelled&requestId=${requestId}`
        );
      }

      const normalizedEmail = profile.emails[0].value.toLowerCase();
      const cacheKey = `user:${normalizedEmail}`;
      let user = await redisService.getJSON(cacheKey);

      if (!user) {
        user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          include: {
            socialLogins: true,
            studentProfile: true,
            instructorProfile: true,
            adminProfile: true,
          },
        });

        if (user) {
          await redisService.setJSON(cacheKey, user, { ex: 900 });
        }
      }

      if (user) {
        const existingGithubLogin = user.socialLogins?.find(
          (login) =>
            login.provider === "github" && login.providerId === profile.id
        );

        const updateData = {};
        let profileImageUrl = user.profileImage;

        if (!existingGithubLogin) {
          await prisma.socialLogin.create({
            data: {
              provider: "github",
              providerId: profile.id,
              userId: user.id,
            },
          });
        }

        if (!profileImageUrl && profile.photos?.[0]?.value) {
          profileImageUrl = await handleOAuthProfileImage(
            profile.photos[0].value,
            user.id
          );

          if (profileImageUrl !== profile.photos[0].value) {
            updateData.profileImage = profileImageUrl;
          }
        }

        if (!user.isVerified) {
          updateData.isVerified = true;
        }

        updateData.lastLogin = new Date();

        if (Object.keys(updateData).length > 0) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: updateData,
            include: {
              studentProfile: true,
              instructorProfile: true,
              adminProfile: true,
            },
          });
        }

        if (updateData.isVerified) {
          const welcomePromise = emailService.sendWelcomeEmail({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            userRole: user.role,
          });

          await Promise.allSettled([welcomePromise]);
        }

        await clearUserCaches(normalizedEmail, user.id);
      } else {
        const profileImageUrl = profile.photos?.[0]?.value
          ? await handleOAuthProfileImage(
              profile.photos[0].value,
              `temp_${Date.now()}`
            )
          : null;

        const result = await prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              firstName:
                profile.displayName?.split(" ")[0] ||
                profile.username ||
                "GitHub",
              lastName:
                profile.displayName?.split(" ").slice(1).join(" ") || "User",
              email: normalizedEmail,
              profileImage: profileImageUrl,
              role: userRole,
              isVerified: true,
              isActive: true,
              lastLogin: new Date(),
            },
          });

          await tx.socialLogin.create({
            data: {
              provider: "github",
              providerId: profile.id,
              userId: newUser.id,
            },
          });

          await createUserProfile(newUser.id, userRole, tx);

          return newUser;
        });

        user = await prisma.user.findUnique({
          where: { id: result.id },
          include: {
            studentProfile: true,
            instructorProfile: true,
            adminProfile: true,
          },
        });

        const welcomePromises = sendWelcomeNotifications({
          user,
          isNewUser: true,
        });

        await Promise.allSettled(welcomePromises);
        await redisService.setJSON(`user:${user.id}`, user, { ex: 3600 });
      }

      const authCode = await createTempAuthCode(user.id);
      const executionTime = performance.now() - startTime;

      res.redirect(
        `${process.env.FRONTEND_URL}/auth/callback?code=${authCode}&success=true&provider=github`
      );
    } catch (error) {
      console.error(`GITHUB_AUTH_CALLBACK_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        profileId: profile?.id,
        email: profile?.emails?.[0]?.value,
      });

      res.redirect(
        `${process.env.FRONTEND_URL}/login?error=auth_failed&requestId=${requestId}`
      );
    }
  })(req, res, next);
});

export const exchangeAuthCode = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authorization code is required",
        code: "MISSING_AUTH_CODE",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `auth_code_exchange:${req.ip}`,
      10,
      600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message:
          "Too many auth code exchange attempts. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const cacheKey = `auth_code:${code}`;
    let authSession = await redisService.getJSON(cacheKey);

    if (!authSession) {
      authSession = await prisma.session.findFirst({
        where: {
          token: code,
          deviceType: "temp_auth_code",
          expiresAt: { gt: new Date() },
        },
        include: {
          user: {
            include: {
              studentProfile: true,
              instructorProfile: true,
              adminProfile: true,
            },
          },
        },
      });

      if (authSession) {
        await redisService.setJSON(cacheKey, authSession, { ex: 300 });
      }
    }

    if (!authSession) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired authorization code",
        code: "INVALID_AUTH_CODE",
      });
    }

    await Promise.all([
      redisService.del(cacheKey),
      prisma.session.delete({ where: { id: authSession.id } }),
    ]);

    const token = generateToken(authSession.userId);

    const sessionData = await createSessionData({
      token,
      userId: authSession.userId,
      deviceType: req.get("User-Agent")?.substring(0, 255) || "oauth_exchange",
      ipAddress: req.ip || "127.0.0.1",
      userAgent: req.get("User-Agent"),
    });

    const newSession = await prisma.session.create({
      data: sessionData,
    });

    await Promise.all([
      redisService.setJSON(
        `session:${token}`,
        {
          userId: authSession.userId,
          sessionId: newSession.id,
          createdAt: newSession.createdAt,
          expiresAt: newSession.expiresAt,
          deviceType: newSession.deviceType,
          ipAddress: newSession.ipAddress,
          lastActivity: new Date(),
        },
        { ex: 30 * 24 * 60 * 60 }
      ),
      redisService.sadd(`user_sessions:${authSession.userId}`, token),
      redisService.expire(
        `user_sessions:${authSession.userId}`,
        30 * 24 * 60 * 60
      ),
    ]);

    const user = authSession.user;
    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Authorization successful",
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          profileImage: user.profileImage,
          isVerified: user.isVerified,
          profile:
            user.role === "STUDENT"
              ? user.studentProfile
              : user.role === "INSTRUCTOR"
              ? user.instructorProfile
              : user.adminProfile,
        },
        token,
        sessionInfo: {
          expiresAt: newSession.expiresAt,
          deviceType: newSession.deviceType,
          ipAddress: newSession.ipAddress,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        authMethod: "oauth_code_exchange",
      },
    });
  } catch (error) {
    console.error(`AUTH_CODE_EXCHANGE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      code: req.body?.code ? "***" : undefined,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to exchange authorization code",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getUserProfile = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const token = getTokenFromHeader(req);
    const cacheKey = `user_profile:${req.userAuthId}`;
    let user = await redisService.getJSON(cacheKey);

    if (!user) {
      user = await prisma.user.findUnique({
        where: { id: req.userAuthId },
        include: {
          studentProfile: true,
          instructorProfile: true,
          adminProfile: true,
          notificationSettings: true,
          socialLogins: {
            select: {
              provider: true,
              createdAt: true,
            },
          },
        },
      });

      if (user) {
        await redisService.setJSON(cacheKey, user, { ex: 1800 });
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (token) {
      const sessionKey = `session:${token}`;
      const sessionData = await redisService.getJSON(sessionKey);

      if (sessionData) {
        sessionData.lastActivity = new Date().toISOString();
        await redisService.setJSON(sessionKey, sessionData, {
          ex: 30 * 24 * 60 * 60,
        });

        prisma.session
          .update({
            where: { token },
            data: { lastActivity: new Date() },
          })
          .catch(() => {});
      }
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Profile retrieved successfully",
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          profileImage: user.profileImage,
          bio: user.bio,
          isVerified: user.isVerified,
          isActive: user.isActive,
          timezone: user.timezone,
          language: user.language,
          country: user.country,
          phoneNumber: user.phoneNumber,
          dateOfBirth: user.dateOfBirth,
          website: user.website,
          linkedinProfile: user.linkedinProfile,
          twitterProfile: user.twitterProfile,
          githubProfile: user.githubProfile,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          profile:
            user.role === "STUDENT"
              ? user.studentProfile
              : user.role === "INSTRUCTOR"
              ? user.instructorProfile
              : user.adminProfile,
          notificationSettings: user.notificationSettings,
          connectedAccounts: user.socialLogins || [],
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: !!(await redisService.getJSON(cacheKey)),
      },
    });
  } catch (error) {
    console.error(`GET_PROFILE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve profile",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateProfileImage = asyncHandler(async (req, res) => {
  uploadImage.single("profileImage")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    const requestId = generateRequestId();
    const startTime = performance.now();

    try {
      const imageValidation = validateImageUpload(req.file);
      if (!imageValidation.isValid) {
        await handleFileCleanup(req.file?.filename);
        return res.status(400).json({
          success: false,
          message: "Image validation failed",
          errors: imageValidation.errors,
          code: "IMAGE_VALIDATION_ERROR",
        });
      }

      const token = getTokenFromHeader(req);
      const cacheKey = `user:${req.userAuthId}`;
      let user = await redisService.getJSON(cacheKey);

      if (!user) {
        user = await prisma.user.findUnique({
          where: { id: req.userAuthId },
          select: {
            id: true,
            profileImage: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        });

        if (user) {
          await redisService.setJSON(cacheKey, user, { ex: 900 });
        }
      }

      if (!user) {
        await handleFileCleanup(req.file?.filename);
        return res.status(404).json({
          success: false,
          message: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      const oldProfileImage = user.profileImage;

      const updatedUser = await prisma.user.update({
        where: { id: req.userAuthId },
        data: { profileImage: req.file.path },
        include: {
          studentProfile: true,
          instructorProfile: true,
          adminProfile: true,
          notificationSettings: true,
        },
      });

      if (oldProfileImage && oldProfileImage !== req.file.path) {
        try {
          const publicId = oldProfileImage.split("/").pop().split(".")[0];
          await deleteFromCloudinary(`educademy/profiles/${publicId}`);
        } catch (deleteError) {
          console.warn(
            `Failed to delete old profile image [${requestId}]:`,
            deleteError
          );
        }
      }

      await updateUserCaches(req.userAuthId, updatedUser);

      if (token) {
        const sessionKey = `session:${token}`;
        const sessionData = await redisService.getJSON(sessionKey);
        if (sessionData) {
          sessionData.lastActivity = new Date();
          await redisService.setJSON(sessionKey, sessionData, {
            ex: 30 * 24 * 60 * 60,
          });
        }
      }

      const executionTime = performance.now() - startTime;

      res.status(200).json({
        success: true,
        message: "Profile image updated successfully",
        data: {
          profileImage: updatedUser.profileImage,
          user: {
            id: updatedUser.id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            email: updatedUser.email,
            role: updatedUser.role,
            profileImage: updatedUser.profileImage,
            bio: updatedUser.bio,
            isVerified: updatedUser.isVerified,
            isActive: updatedUser.isActive,
            timezone: updatedUser.timezone,
            language: updatedUser.language,
            country: updatedUser.country,
            phoneNumber: updatedUser.phoneNumber,
            dateOfBirth: updatedUser.dateOfBirth,
            website: updatedUser.website,
            linkedinProfile: updatedUser.linkedinProfile,
            twitterProfile: updatedUser.twitterProfile,
            githubProfile: updatedUser.githubProfile,
            lastLogin: updatedUser.lastLogin,
            createdAt: updatedUser.createdAt,
            updatedAt: updatedUser.updatedAt,
            profile:
              updatedUser.role === "STUDENT"
                ? updatedUser.studentProfile
                : updatedUser.role === "INSTRUCTOR"
                ? updatedUser.instructorProfile
                : updatedUser.adminProfile,
            notificationSettings: updatedUser.notificationSettings,
          },
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          oldImageDeleted: !!oldProfileImage,
        },
      });
    } catch (error) {
      if (req.file?.filename) {
        await handleFileCleanup(req.file.filename);
      }

      console.error(`PROFILE_IMAGE_UPDATE_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        userId: req.userAuthId,
        ip: req.ip,
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Failed to update profile image",
        code: "INTERNAL_SERVER_ERROR",
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    }
  });
});

export const updateUserProfile = asyncHandler(async (req, res) => {
  uploadImage.single("profileImage")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    const requestId = generateRequestId();
    const startTime = performance.now();

    try {
      const token = getTokenFromHeader(req);
      const {
        firstName,
        lastName,
        bio,
        timezone,
        language,
        country,
        phoneNumber,
        dateOfBirth,
        website,
        linkedinProfile,
        twitterProfile,
        githubProfile,
        removeProfileImage,
        profileData,
      } = req.body;

      const hasNewProfileImage = !!req.file;
      const shouldRemoveImage =
        removeProfileImage === "true" || removeProfileImage === true;

      const validationResult = validateCompleteProfileInput({
        firstName,
        lastName,
        bio,
        timezone,
        language,
        country,
        phoneNumber,
        dateOfBirth,
        website,
        linkedinProfile,
        twitterProfile,
        githubProfile,
        profileData,
        hasNewProfileImage,
        shouldRemoveImage,
      });

      if (!validationResult.isValid) {
        if (req.file?.filename) {
          await handleFileCleanup(req.file.filename);
        }
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: validationResult.errors,
          code: "VALIDATION_ERROR",
        });
      }

      const cacheKey = `user_profile:${req.userAuthId}`;
      let currentUser = await redisService.getJSON(cacheKey);

      if (!currentUser) {
        currentUser = await prisma.user.findUnique({
          where: { id: req.userAuthId },
          include: {
            studentProfile: true,
            instructorProfile: true,
            adminProfile: true,
          },
        });

        if (currentUser) {
          await redisService.setJSON(cacheKey, currentUser, { ex: 1800 });
        }
      }

      if (!currentUser) {
        if (req.file?.filename) {
          await handleFileCleanup(req.file.filename);
        }
        return res.status(404).json({
          success: false,
          message: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      const updateData = buildProfileUpdateData({
        firstName,
        lastName,
        bio,
        timezone,
        language,
        country,
        phoneNumber,
        dateOfBirth,
        website,
        linkedinProfile,
        twitterProfile,
        githubProfile,
        hasNewProfileImage,
        shouldRemoveImage,
        currentUser,
        newImagePath: req.file?.path,
      });

      const fieldsToUpdate = Object.keys(updateData.userUpdate);

      if (fieldsToUpdate.length === 0 && !profileData) {
        if (req.file?.filename) {
          await handleFileCleanup(req.file.filename);
        }
        return res.status(400).json({
          success: false,
          message: "No fields provided for update",
          code: "NO_UPDATES_PROVIDED",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        let updatedUser = currentUser;
        let profileUpdateResult = null;

        if (fieldsToUpdate.length > 0) {
          updatedUser = await tx.user.update({
            where: { id: req.userAuthId },
            data: updateData.userUpdate,
            include: {
              studentProfile: true,
              instructorProfile: true,
              adminProfile: true,
              notificationSettings: true,
            },
          });
        }

        if (profileData && typeof profileData === "object") {
          profileUpdateResult = await updateRoleSpecificProfile({
            userId: req.userAuthId,
            userRole: currentUser.role,
            profileData,
            tx,
          });
        }

        return { user: updatedUser, profileUpdate: profileUpdateResult };
      });

      if (updateData.oldImageCleanup) {
        await cleanupOldProfileImage(updateData.oldImageCleanup);
      }

      const finalUser = await prisma.user.findUnique({
        where: { id: req.userAuthId },
        include: {
          studentProfile: true,
          instructorProfile: true,
          adminProfile: true,
          notificationSettings: true,
        },
      });

      await updateUserCaches(req.userAuthId, finalUser);

      if (token) {
        const sessionKey = `session:${token}`;
        const sessionData = await redisService.getJSON(sessionKey);
        if (sessionData) {
          sessionData.lastActivity = new Date();
          await redisService.setJSON(sessionKey, sessionData, {
            ex: 30 * 24 * 60 * 60,
          });
        }
      }

      const executionTime = performance.now() - startTime;

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: {
          user: {
            id: finalUser.id,
            firstName: finalUser.firstName,
            lastName: finalUser.lastName,
            email: finalUser.email,
            role: finalUser.role,
            profileImage: finalUser.profileImage,
            bio: finalUser.bio,
            isVerified: finalUser.isVerified,
            isActive: finalUser.isActive,
            timezone: finalUser.timezone,
            language: finalUser.language,
            country: finalUser.country,
            phoneNumber: finalUser.phoneNumber,
            dateOfBirth: finalUser.dateOfBirth,
            website: finalUser.website,
            linkedinProfile: finalUser.linkedinProfile,
            twitterProfile: finalUser.twitterProfile,
            githubProfile: finalUser.githubProfile,
            lastLogin: finalUser.lastLogin,
            createdAt: finalUser.createdAt,
            updatedAt: finalUser.updatedAt,
            profile:
              finalUser.role === "STUDENT"
                ? finalUser.studentProfile
                : finalUser.role === "INSTRUCTOR"
                ? finalUser.instructorProfile
                : finalUser.adminProfile,
            notificationSettings: finalUser.notificationSettings,
          },
          updatedFields: fieldsToUpdate,
          profileDataUpdated: !!result.profileUpdate,
          profileImageUpdated: updateData.profileImageUpdated,
          imageAction: updateData.imageAction,
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      if (req.file?.filename) {
        await handleFileCleanup(req.file.filename);
      }

      console.error(`PROFILE_UPDATE_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        userId: req.userAuthId,
        ip: req.ip,
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Failed to update profile",
        code: "INTERNAL_SERVER_ERROR",
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    }
  });
});

export const getUserSessions = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const token = getTokenFromHeader(req);
    const { page = 1, limit = 10, includeExpired = false } = req.query;

    const rateLimitResult = await redisService.rateLimitCheck(
      `get_sessions:${req.userAuthId}`,
      20,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many session requests. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const userSessionsKey = `user_sessions:${req.userAuthId}`;
    const activeTokens = await redisService.smembers(userSessionsKey);

    const sessionPromises = activeTokens.map(async (sessionToken) => {
      const sessionData = await redisService.getJSON(`session:${sessionToken}`);
      if (sessionData) {
        return {
          token: sessionToken.substring(0, 10) + "...",
          fullToken: sessionToken,
          ...sessionData,
          isCurrent: token && sessionToken === token,
          isActive: new Date(sessionData.expiresAt) > new Date(),
        };
      }
      return null;
    });

    let sessions = (await Promise.all(sessionPromises)).filter(Boolean);

    if (!includeExpired) {
      sessions = sessions.filter((session) => session.isActive);
    }

    const dbSessions = await prisma.session.findMany({
      where: {
        userId: req.userAuthId,
        ...(includeExpired ? {} : { expiresAt: { gt: new Date() } }),
      },
      orderBy: { lastActivity: "desc" },
      select: {
        id: true,
        token: true,
        deviceType: true,
        operatingSystem: true,
        browser: true,
        ipAddress: true,
        location: true,
        isActive: true,
        createdAt: true,
        lastActivity: true,
        expiresAt: true,
      },
    });

    const enrichedSessions = sessions.map((session) => {
      const dbSession = dbSessions.find((db) => db.token === session.fullToken);
      return {
        token: session.token,
        deviceType: session.deviceType || dbSession?.deviceType,
        operatingSystem: dbSession?.operatingSystem,
        browser: dbSession?.browser,
        ipAddress: session.ipAddress || dbSession?.ipAddress,
        location: dbSession?.location,
        isActive: session.isActive && dbSession?.isActive,
        isCurrent: session.isCurrent,
        createdAt: session.createdAt || dbSession?.createdAt,
        lastActivity: session.lastActivity || dbSession?.lastActivity,
        expiresAt: session.expiresAt || dbSession?.expiresAt,
        sessionAge: calculateSessionAge(
          session.createdAt || dbSession?.createdAt
        ),
        isExpired:
          new Date() > new Date(session.expiresAt || dbSession?.expiresAt),
      };
    });

    const pageSize = Math.min(parseInt(limit), 50);
    const pageNumber = Math.max(parseInt(page), 1);
    const startIndex = (pageNumber - 1) * pageSize;
    const endIndex = startIndex + pageSize;

    const paginatedSessions = enrichedSessions
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
      .slice(startIndex, endIndex);

    const stats = calculateSessionStats(enrichedSessions);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Sessions retrieved successfully",
      data: {
        sessions: paginatedSessions,
        pagination: {
          page: pageNumber,
          limit: pageSize,
          total: enrichedSessions.length,
          totalPages: Math.ceil(enrichedSessions.length / pageSize),
          hasNext: endIndex < enrichedSessions.length,
          hasPrev: pageNumber > 1,
        },
        stats,
        currentSessionToken: token ? token.substring(0, 10) + "..." : null,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_SESSIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve sessions",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const invalidateAllSessions = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const token = getTokenFromHeader(req);
    const { keepCurrent = false, reason = "user_request" } = req.body;

    const rateLimitResult = await redisService.rateLimitCheck(
      `invalidate_sessions:${req.userAuthId}`,
      5,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message:
          "Too many session invalidation requests. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const excludeToken = keepCurrent ? token : null;
    const invalidationResult = await invalidateUserSessions(
      req.userAuthId,
      excludeToken
    );

    const securityLog = {
      userId: req.userAuthId,
      action: "bulk_session_invalidation",
      reason,
      keepCurrent,
      sessionCount: invalidationResult.invalidatedCount,
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      timestamp: new Date().toISOString(),
    };

    await notificationService.createNotification({
      userId: req.userAuthId,
      type: "SYSTEM_ANNOUNCEMENT",
      title: "Sessions Terminated",
      message: `${invalidationResult.invalidatedCount} sessions have been terminated for security.`,
      priority: "HIGH",
      data: securityLog,
      sendEmail: false,
      sendSocket: true,
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: keepCurrent
        ? "All other sessions have been invalidated successfully"
        : "All sessions have been invalidated successfully",
      data: {
        sessionsInvalidated: invalidationResult.invalidatedCount,
        tokensBlacklisted: invalidationResult.tokensBlacklisted,
        currentSessionKept: keepCurrent,
        securityNotificationSent: true,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`INVALIDATE_SESSIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to invalidate sessions",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const removeProfileImage = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const token = getTokenFromHeader(req);
    const cacheKey = `user:${req.userAuthId}`;
    let user = await redisService.getJSON(cacheKey);

    if (!user) {
      user = await prisma.user.findUnique({
        where: { id: req.userAuthId },
        select: {
          id: true,
          profileImage: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      });

      if (user) {
        await redisService.setJSON(cacheKey, user, { ex: 900 });
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (!user.profileImage) {
      return res.status(400).json({
        success: false,
        message: "No profile image to remove",
        code: "NO_PROFILE_IMAGE",
      });
    }

    const oldProfileImage = user.profileImage;

    await prisma.user.update({
      where: { id: req.userAuthId },
      data: { profileImage: null },
    });

    if (oldProfileImage) {
      await cleanupOldProfileImage(oldProfileImage);
    }

    await clearUserCaches(user.email, req.userAuthId);

    if (token) {
      const sessionKey = `session:${token}`;
      const sessionData = await redisService.getJSON(sessionKey);
      if (sessionData) {
        sessionData.lastActivity = new Date();
        await redisService.setJSON(sessionKey, sessionData, {
          ex: 30 * 24 * 60 * 60,
        });
      }
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Profile image removed successfully",
      data: {
        profileImage: null,
        oldImageDeleted: true,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REMOVE_PROFILE_IMAGE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to remove profile image",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const requestAccountReactivation = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { userId, reason, additionalInfo } = req.body;

    const validationResult = validateReactivationRequest({
      userId,
      reason,
      additionalInfo,
    });

    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `reactivation_request:${req.ip}`,
      3,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many reactivation requests. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const cacheKey = `user:${userId}`;
    let user = await redisService.getJSON(cacheKey);

    if (!user) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
          isVerified: true,
          isBanned: true,
          bannedAt: true,
          banReason: true,
        },
      });

      if (user) {
        await redisService.setJSON(cacheKey, user, { ex: 900 });
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (user.isActive) {
      return res.status(400).json({
        success: false,
        message: "Account is already active",
        code: "ACCOUNT_ALREADY_ACTIVE",
      });
    }

    if (user.isBanned && !canRequestReactivationAfterBan(user.bannedAt)) {
      return res.status(403).json({
        success: false,
        message:
          "Cannot request reactivation yet. Please wait before submitting a new request.",
        code: "REACTIVATION_COOLDOWN_ACTIVE",
        additionalData: {
          bannedAt: user.bannedAt,
          canRequestAfter: calculateReactivationEligibilityDate(user.bannedAt),
        },
      });
    }

    const existingRequestKey = `reactivation_request:${userId}`;
    const existingRequest = await redisService.getJSON(existingRequestKey);

    if (existingRequest) {
      return res.status(409).json({
        success: false,
        message: "A reactivation request is already pending for this account",
        code: "REQUEST_ALREADY_EXISTS",
        additionalData: {
          existingRequest: {
            id: existingRequest.id,
            submittedAt: existingRequest.createdAt,
            status: existingRequest.status,
          },
        },
      });
    }

    const reactivationData = {
      userId,
      userEmail: user.email,
      userName: `${user.firstName} ${user.lastName}`,
      reason: reason.trim(),
      additionalInfo: additionalInfo?.trim() || null,
      requestMetadata: {
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
        location: req.get("CF-IPCountry") || "Unknown",
      },
    };

    const reactivationRequest = await prisma.reactivationRequest.create({
      data: reactivationData,
    });

    await redisService.setJSON(existingRequestKey, reactivationRequest, {
      ex: 7 * 24 * 60 * 60,
    });

    const emailPromise = emailService.sendAccountReactivationConfirmation({
      email: user.email,
      firstName: user.firstName,
      requestId: reactivationRequest.id,
      submittedAt: reactivationRequest.createdAt,
    });

    const adminNotificationPromise = notifyAdminsOfReactivationRequest({
      user,
      request: reactivationRequest,
    });

    await Promise.allSettled([emailPromise, adminNotificationPromise]);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message:
        "Reactivation request submitted successfully. You will be notified once reviewed.",
      data: {
        requestId: reactivationRequest.id,
        status: reactivationRequest.status,
        submittedAt: reactivationRequest.createdAt,
        expectedReviewTime: "1-3 business days",
        confirmationEmailSent: true,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REACTIVATION_REQUEST_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.body?.userId,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to submit reactivation request",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const checkReactivationStatus = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
        code: "MISSING_USER_ID",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `reactivation_status:${req.ip}`,
      10,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many status check requests. Please try again later.",
        retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const cacheKey = `reactivation_request:${userId}`;
    let reactivationRequest = await redisService.getJSON(cacheKey);

    if (!reactivationRequest) {
      reactivationRequest = await prisma.reactivationRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          rejectionReason: true,
          adminNotes: true,
          reviewedBy: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (reactivationRequest) {
        await redisService.setJSON(cacheKey, reactivationRequest, { ex: 3600 });
      }
    }

    if (!reactivationRequest) {
      return res.status(404).json({
        success: false,
        message: "No reactivation request found for this user",
        code: "REQUEST_NOT_FOUND",
      });
    }

    const userCacheKey = `user:${userId}`;
    let user = await redisService.getJSON(userCacheKey);

    if (!user) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          isActive: true,
          firstName: true,
          lastName: true,
          email: true,
          isBanned: true,
          bannedAt: true,
        },
      });

      if (user) {
        await redisService.setJSON(userCacheKey, user, { ex: 900 });
      }
    }

    const statusInfo = buildReactivationStatusInfo({
      request: reactivationRequest,
      user,
      userId,
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Reactivation status retrieved successfully",
      data: statusInfo,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REACTIVATION_STATUS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.params?.userId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to check reactivation status",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getAccountSummary = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const token = getTokenFromHeader(req);

    const cacheKey = `account_summary:${req.userAuthId}`;
    let cachedSummary = await redisService.getJSON(cacheKey);

    if (cachedSummary) {
      if (token) {
        const sessionKey = `session:${token}`;
        const sessionData = await redisService.getJSON(sessionKey);
        if (sessionData) {
          sessionData.lastActivity = new Date();
          await redisService.setJSON(sessionKey, sessionData, {
            ex: 30 * 24 * 60 * 60,
          });
        }
      }

      const executionTime = performance.now() - startTime;

      return res.status(200).json({
        success: true,
        message: "Account summary retrieved successfully",
        data: cachedSummary,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cacheHit: true,
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userAuthId },
      include: {
        studentProfile: true,
        instructorProfile: true,
        adminProfile: true,
        notificationSettings: true,
        socialLogins: {
          select: {
            provider: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found",
        code: "USER_NOT_FOUND",
      });
    }

    const [sessionStats, securityInfo, activityMetrics] = await Promise.all([
      getSessionStatistics(req.userAuthId),
      getSecurityInformation(req.userAuthId),
      getActivityMetrics(req.userAuthId, user.role),
    ]);

    const accountSummary = {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        profileImage: user.profileImage,
        isVerified: user.isVerified,
        isActive: user.isActive,
        memberSince: user.createdAt,
        lastLogin: user.lastLogin,
        timezone: user.timezone,
        language: user.language,
        country: user.country,
      },
      profile: buildProfileSummary(user),
      security: {
        emailVerified: user.isVerified,
        activeSessions: sessionStats.activeCount,
        totalSessions: sessionStats.totalCount,
        lastPasswordChange: securityInfo.lastPasswordChange,
        connectedAccounts: user.socialLogins?.length || 0,
        accountAge: calculateAccountAge(user.createdAt),
        securityScore: calculateSecurityScore({
          isVerified: user.isVerified,
          activeSessions: sessionStats.activeCount,
          connectedAccounts: user.socialLogins?.length || 0,
          hasRecentActivity: securityInfo.hasRecentActivity,
        }),
      },
      activity: activityMetrics,
      settings: user.notificationSettings || getDefaultNotificationSettings(),
      statistics: await getRoleSpecificStatistics(req.userAuthId, user.role),
    };

    await redisService.setJSON(cacheKey, accountSummary, { ex: 1800 });

    if (token) {
      const sessionKey = `session:${token}`;
      const sessionData = await redisService.getJSON(sessionKey);
      if (sessionData) {
        sessionData.lastActivity = new Date();
        await redisService.setJSON(sessionKey, sessionData, {
          ex: 30 * 24 * 60 * 60,
        });
      }
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Account summary retrieved successfully",
      data: accountSummary,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cacheHit: false,
      },
    });
  } catch (error) {
    console.error(`ACCOUNT_SUMMARY_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve account summary",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteAccount = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { password, reason, confirmDeletion } = req.body;

    if (confirmDeletion !== "DELETE_MY_ACCOUNT") {
      return res.status(400).json({
        success: false,
        message: "Account deletion confirmation required",
        code: "DELETION_NOT_CONFIRMED",
      });
    }

    const validationResult = validateAccountDeletion({
      password,
      reason,
      confirmDeletion,
    });

    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.errors,
        code: "VALIDATION_ERROR",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `account_deletion:${req.userAuthId}`,
      2,
      86400
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many deletion attempts. Please contact support.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userAuthId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        passwordHash: true,
        role: true,
        profileImage: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found",
        code: "USER_NOT_FOUND",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid password provided",
        code: "INVALID_PASSWORD",
      });
    }

    const deletionData = await executeAccountDeletion({
      user,
      reason,
      requestInfo: {
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      },
    });

    await Promise.all([
      invalidateUserSessions(req.userAuthId),
      clearAllUserData(req.userAuthId),
      user.profileImage
        ? cleanupOldProfileImage(user.profileImage)
        : Promise.resolve(),
    ]);

    const confirmationPromise = emailService.sendAccountDeletionConfirmation({
      email: user.email,
      firstName: user.firstName,
      deletedAt: new Date(),
      recoveryPeriod: 30,
    });

    await Promise.allSettled([confirmationPromise]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message:
        "Account has been successfully deleted. We're sorry to see you go.",
      data: {
        accountDeleted: true,
        dataCleared: deletionData.dataCleared,
        sessionsInvalidated: deletionData.sessionsInvalidated,
        recoveryPeriod: 30,
        confirmationEmailSent: true,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`ACCOUNT_DELETION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete account. Please contact support.",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
