import { PrismaClient } from "@prisma/client";
import redisService from "../utils/redis.js";
import emailService from "../utils/emailService.js";
import notificationService from "../utils/notificationservice.js";
import otpService from "../utils/otpService.js";
import { deleteFromCloudinary } from "../config/upload.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

export const createUserProfile = async (userId, role, tx) => {
  if (role === "STUDENT") {
    return await tx.student.create({
      data: {
        userId,
        learningGoals: [],
        interests: [],
        skillLevel: "BEGINNER",
        totalLearningTime: 0,
      },
    });
  } else if (role === "INSTRUCTOR") {
    return await tx.instructor.create({
      data: {
        userId,
        expertise: [],
        rating: 0,
        totalStudents: 0,
        totalCourses: 0,
        totalRevenue: 0,
        commissionRate: 0.7,
        isVerified: false,
      },
    });
  } else if (role === "ADMIN") {
    return await tx.admin.create({
      data: {
        userId,
        permissions: [],
        resolvedLogs: [],
      },
    });
  }
};

export const validateRegistrationInput = (data) => {
  const errors = [];
  const { firstName, lastName, email, password, role } = data;

  if (!firstName?.trim()) {
    errors.push("First name is required");
  } else if (firstName.trim().length < 2) {
    errors.push("First name must be at least 2 characters");
  } else if (firstName.trim().length > 50) {
    errors.push("First name must be less than 50 characters");
  }

  if (!lastName?.trim()) {
    errors.push("Last name is required");
  } else if (lastName.trim().length < 2) {
    errors.push("Last name must be at least 2 characters");
  } else if (lastName.trim().length > 50) {
    errors.push("Last name must be less than 50 characters");
  }

  if (!email?.trim()) {
    errors.push("Email is required");
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      errors.push("Please provide a valid email address");
    }
  }

  if (!password) {
    errors.push("Password is required");
  } else if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    errors.push(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    );
  }

  if (role && !["STUDENT", "INSTRUCTOR", "ADMIN"].includes(role)) {
    errors.push("Invalid role specified");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const handleFileCleanup = async (filename) => {
  if (!filename) return;
  try {
    const publicId = filename.replace(/\.[^/.]+$/, "");
    await deleteFromCloudinary(`educademy/profiles/${publicId}`);
  } catch (error) {
    console.warn("File cleanup warning:", error);
  }
};

export const generateRequestId = () => {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const createSessionData = async ({
  token,
  userId,
  deviceType,
  ipAddress,
  userAgent,
}) => {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return {
    token,
    userId,
    deviceType: deviceType || "unknown",
    operatingSystem: getOS(userAgent),
    browser: getBrowser(userAgent),
    ipAddress: ipAddress || "127.0.0.1",
    isActive: true,
    lastActivity: new Date(),
    expiresAt,
  };
};

export const cacheUserData = async (user) => {
  const cacheKey = `user:${user.email}`;
  await redisService.setJSON(cacheKey, user, { ex: 900 });
  await redisService.setJSON(`user:${user.id}`, user, { ex: 3600 });
};

export const sendWelcomeNotifications = ({ user, isNewUser }) => {
  const promises = [];

  if (isNewUser) {
    promises.push(
      emailService.sendWelcomeEmail({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userRole: user.role,
      })
    );

    promises.push(
      notificationService.createNotification({
        userId: user.id,
        type: "SYSTEM_ANNOUNCEMENT",
        title: "Welcome to Educademy!",
        message:
          "Your account has been verified successfully. Start exploring courses now!",
        priority: "NORMAL",
        sendEmail: false,
        sendSocket: true,
      })
    );
  }

  return promises;
};

export const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

export const storeVerificationToken = async (
  token,
  email,
  expiresInMinutes
) => {
  const key = `verification_token:${token}`;
  const data = {
    email,
    expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
    createdAt: new Date(),
  };
  await redisService.setJSON(key, data, { ex: expiresInMinutes * 60 });
};

export const verifyByToken = async (token) => {
  const key = `verification_token:${token}`;
  const data = await redisService.getJSON(key);

  if (!data) {
    throw new Error("Invalid or expired verification token");
  }

  if (new Date() > new Date(data.expiresAt)) {
    await redisService.del(key);
    throw new Error("Verification token has expired");
  }

  return { success: true, email: data.email };
};

export const validateLoginInput = (data) => {
  const errors = [];
  const { email, password } = data;

  if (!email?.trim()) {
    errors.push("Email is required");
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      errors.push("Please provide a valid email address");
    }
  }

  if (!password) {
    errors.push("Password is required");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const checkAccountStatus = (user) => {
  if (!user.isVerified) {
    return {
      isValid: false,
      statusCode: 403,
      message: "Please verify your email address before logging in",
      code: "EMAIL_NOT_VERIFIED",
    };
  }

  if (!user.isActive) {
    return {
      isValid: false,
      statusCode: 403,
      message: "Your account has been deactivated. Please contact support.",
      code: "ACCOUNT_DEACTIVATED",
    };
  }

  if (user.isBanned) {
    return {
      isValid: false,
      statusCode: 403,
      message: "Your account has been suspended. Please contact support.",
      code: "ACCOUNT_BANNED",
      additionalData: {
        bannedAt: user.bannedAt,
        banReason: user.banReason,
      },
    };
  }

  return { isValid: true };
};

export const handleLoginSecurity = async ({
  user,
  session,
  ipAddress,
  userAgent,
  location,
}) => {
  const recentSessions = await prisma.session.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const currentDevice = getDeviceType(userAgent);
  const currentOS = getOS(userAgent);

  const isSuspicious = !recentSessions.some(
    (s) => s.deviceType === currentDevice && s.ipAddress === ipAddress
  );

  if (isSuspicious) {
    await emailService.sendLoginAlert({
      email: user.email,
      firstName: user.firstName,
      loginTime: session.createdAt.toLocaleString(),
      ipAddress,
      location,
      device: currentDevice,
      browser: getBrowser(userAgent),
    });
  }
};

export const validatePasswordResetInput = (data) => {
  const errors = [];
  const { email } = data;

  if (!email?.trim()) {
    errors.push("Email is required");
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      errors.push("Please provide a valid email address");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const validateNewPasswordInput = (data) => {
  const errors = [];
  const { email, otp, newPassword } = data;

  if (!email?.trim()) {
    errors.push("Email is required");
  }

  if (!otp?.trim()) {
    errors.push("Verification code is required");
  } else if (!/^\d{6}$/.test(otp.trim())) {
    errors.push("Verification code must be a 6-digit number");
  }

  if (!newPassword) {
    errors.push("New password is required");
  } else if (newPassword.length < 8) {
    errors.push("Password must be at least 8 characters long");
  } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
    errors.push(
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const clearUserCaches = async (email, userId) => {
  const promises = [
    redisService.del(`user:${email}`),
    redisService.del(`user_profile:${userId}`),
  ];

  if (userId) {
    promises.push(redisService.del(`user:${userId}`));
    promises.push(redisService.del(`account_summary:${userId}`));
  }

  await Promise.all(promises);
};

export const invalidateUserSessions = async (userId, excludeToken = null) => {
  const userSessionsKey = `user_sessions:${userId}`;
  const tokens = await redisService.smembers(userSessionsKey);

  const promises = [];
  let invalidatedCount = 0;
  let tokensBlacklisted = 0;

  for (const token of tokens) {
    if (excludeToken && token === excludeToken) {
      continue;
    }

    const decoded = jwt.decode(token);
    if (decoded?.exp) {
      const expiryTime = decoded.exp - Math.floor(Date.now() / 1000);
      if (expiryTime > 0) {
        promises.push(
          redisService.set(`blacklist:${token}`, "true", { ex: expiryTime })
        );
        tokensBlacklisted++;
      }
    }

    promises.push(redisService.del(`session:${token}`));
    promises.push(redisService.srem(userSessionsKey, token));
    invalidatedCount++;
  }

  promises.push(
    prisma.session.updateMany({
      where: {
        userId,
        ...(excludeToken ? { token: { not: excludeToken } } : {}),
      },
      data: { isActive: false },
    })
  );

  await Promise.all(promises);

  return { invalidatedCount, tokensBlacklisted };
};

export const sendPasswordResetNotification = async ({
  user,
  requestInfo,
  otpExpiry,
}) => {
  return notificationService.createNotification({
    userId: user.id,
    type: "SYSTEM_ANNOUNCEMENT",
    title: "Password Reset Request",
    message: `A password reset was requested for your account. The code expires in ${otpExpiry} minutes.`,
    priority: "HIGH",
    data: {
      ipAddress: requestInfo.ipAddress,
      timestamp: requestInfo.timestamp,
      expiresIn: otpExpiry,
    },
    sendEmail: false,
    sendSocket: true,
  });
};

export const validateOTPRequestInput = (data) => {
  const errors = [];
  const { email } = data;

  if (!email?.trim()) {
    errors.push("Email is required");
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      errors.push("Please provide a valid email address");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const checkOTPRateLimit = async (email, type) => {
  const key = `otp_rate_${type}:${email}`;
  const current = await redisService.get(key);
  const maxAttempts = 5;
  const windowSeconds = 3600;

  if (!current) {
    await redisService.setex(key, windowSeconds, "1");
    return { allowed: true, remainingAttempts: maxAttempts - 1 };
  }

  const count = parseInt(current);
  if (count >= maxAttempts) {
    const ttl = await redisService.ttl(key);
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfter: Math.ceil(ttl / 60),
      message: `Too many OTP requests. Try again in ${Math.ceil(
        ttl / 60
      )} minutes.`,
    };
  }

  await redisService.incr(key);
  return { allowed: true, remainingAttempts: maxAttempts - count - 1 };
};

export const generateAndStoreOTP = async (email, type) => {
  const otp = otpService.generateOTP();
  const expiresIn = type === "password_reset" ? 15 : 10;
  await otpService.storeOTP(email, otp, expiresIn);
  return { otp, expiresIn };
};

export const validateResendOTPInput = (data) => {
  const errors = [];
  const { email, type } = data;

  if (!email?.trim()) {
    errors.push("Email is required");
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      errors.push("Please provide a valid email address");
    }
  }

  if (type && !["verification", "password_reset"].includes(type)) {
    errors.push("Invalid OTP type");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const handleOAuthProfileImage = async (imageUrl, userId) => {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return imageUrl;

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = response.headers.get("content-type") || "image/jpeg";

    return imageUrl;
  } catch (error) {
    console.warn("OAuth profile image handling failed:", error);
    return imageUrl;
  }
};

export const createTempAuthCode = async (userId) => {
  const code = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.session.create({
    data: {
      token: code,
      userId,
      deviceType: "temp_auth_code",
      expiresAt,
      isActive: true,
      lastActivity: new Date(),
    },
  });

  await redisService.setJSON(
    `auth_code:${code}`,
    { userId, expiresAt },
    { ex: 300 }
  );

  return code;
};

export const validateImageUpload = (file) => {
  const errors = [];

  if (!file) {
    errors.push("Image file is required");
    return { isValid: false, errors };
  }

  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  if (!allowedTypes.includes(file.mimetype)) {
    errors.push(
      "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed"
    );
  }

  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    errors.push("File size too large. Maximum size is 10MB");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const updateUserCaches = async (userId, user) => {
  const promises = [
    redisService.setJSON(`user:${userId}`, user, { ex: 3600 }),
    redisService.setJSON(`user_profile:${userId}`, user, { ex: 1800 }),
    redisService.del(`account_summary:${userId}`),
  ];

  if (user.email) {
    promises.push(
      redisService.setJSON(`user:${user.email}`, user, { ex: 900 })
    );
  }

  await Promise.all(promises);
};

export const validateCompleteProfileInput = (data) => {
  const errors = [];
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
  } = data;

  if (firstName !== undefined) {
    if (!firstName?.trim()) {
      errors.push("First name cannot be empty");
    } else if (firstName.trim().length < 2 || firstName.trim().length > 50) {
      errors.push("First name must be between 2 and 50 characters");
    }
  }

  if (lastName !== undefined) {
    if (!lastName?.trim()) {
      errors.push("Last name cannot be empty");
    } else if (lastName.trim().length < 2 || lastName.trim().length > 50) {
      errors.push("Last name must be between 2 and 50 characters");
    }
  }

  if (bio !== undefined && bio && bio.length > 500) {
    errors.push("Bio must be less than 500 characters");
  }

  if (phoneNumber !== undefined && phoneNumber) {
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,15}$/;
    if (!phoneRegex.test(phoneNumber)) {
      errors.push("Please provide a valid phone number");
    }
  }

  if (dateOfBirth !== undefined && dateOfBirth) {
    const birthDate = new Date(dateOfBirth);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    if (age < 13 || age > 120) {
      errors.push("Please provide a valid date of birth");
    }
  }

  if (website !== undefined && website) {
    try {
      new URL(website);
    } catch {
      errors.push("Please provide a valid website URL");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const buildProfileUpdateData = ({
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
  newImagePath,
}) => {
  const updateData = { userUpdate: {} };
  let profileImageUpdated = false;
  let imageAction = "none";
  let oldImageCleanup = null;

  if (firstName !== undefined && firstName !== currentUser.firstName) {
    updateData.userUpdate.firstName = firstName.trim();
  }

  if (lastName !== undefined && lastName !== currentUser.lastName) {
    updateData.userUpdate.lastName = lastName.trim();
  }

  if (bio !== undefined && bio !== currentUser.bio) {
    updateData.userUpdate.bio = bio?.trim() || null;
  }

  if (timezone !== undefined && timezone !== currentUser.timezone) {
    updateData.userUpdate.timezone = timezone;
  }

  if (language !== undefined && language !== currentUser.language) {
    updateData.userUpdate.language = language;
  }

  if (country !== undefined && country !== currentUser.country) {
    updateData.userUpdate.country = country;
  }

  if (phoneNumber !== undefined && phoneNumber !== currentUser.phoneNumber) {
    updateData.userUpdate.phoneNumber = phoneNumber?.trim() || null;
  }

  if (dateOfBirth !== undefined && dateOfBirth !== currentUser.dateOfBirth) {
    updateData.userUpdate.dateOfBirth = dateOfBirth
      ? new Date(dateOfBirth)
      : null;
  }

  if (website !== undefined && website !== currentUser.website) {
    updateData.userUpdate.website = website?.trim() || null;
  }

  if (
    linkedinProfile !== undefined &&
    linkedinProfile !== currentUser.linkedinProfile
  ) {
    updateData.userUpdate.linkedinProfile = linkedinProfile?.trim() || null;
  }

  if (
    twitterProfile !== undefined &&
    twitterProfile !== currentUser.twitterProfile
  ) {
    updateData.userUpdate.twitterProfile = twitterProfile?.trim() || null;
  }

  if (
    githubProfile !== undefined &&
    githubProfile !== currentUser.githubProfile
  ) {
    updateData.userUpdate.githubProfile = githubProfile?.trim() || null;
  }

  if (hasNewProfileImage) {
    updateData.userUpdate.profileImage = newImagePath;
    profileImageUpdated = true;
    imageAction = "uploaded";
    if (currentUser.profileImage) {
      oldImageCleanup = currentUser.profileImage;
    }
  } else if (shouldRemoveImage && currentUser.profileImage) {
    updateData.userUpdate.profileImage = null;
    profileImageUpdated = true;
    imageAction = "removed";
    oldImageCleanup = currentUser.profileImage;
  }

  return {
    userUpdate: updateData.userUpdate,
    profileImageUpdated,
    imageAction,
    oldImageCleanup,
  };
};

export const updateRoleSpecificProfile = async ({
  userId,
  userRole,
  profileData,
  tx,
}) => {
  if (userRole === "STUDENT") {
    return await tx.student.update({
      where: { userId },
      data: profileData,
    });
  } else if (userRole === "INSTRUCTOR") {
    return await tx.instructor.update({
      where: { userId },
      data: profileData,
    });
  } else if (userRole === "ADMIN") {
    return await tx.admin.update({
      where: { userId },
      data: profileData,
    });
  }
  return null;
};

export const cleanupOldProfileImage = async (imagePath) => {
  try {
    if (imagePath && imagePath.includes("cloudinary")) {
      const publicId = imagePath.split("/").pop().split(".")[0];
      await deleteFromCloudinary(`educademy/profiles/${publicId}`);
    }
  } catch (error) {
    console.warn("Failed to cleanup old profile image:", error);
  }
};

export const calculateSessionAge = (createdAt) => {
  if (!createdAt) return 0;
  return Math.floor((new Date() - new Date(createdAt)) / (1000 * 60 * 60 * 24));
};

export const calculateSessionStats = (sessions) => {
  const activeCount = sessions.filter((s) => s.isActive && !s.isExpired).length;
  const totalCount = sessions.length;
  const expiredCount = sessions.filter((s) => s.isExpired).length;
  const devicesCount = new Set(sessions.map((s) => s.deviceType)).size;

  return {
    activeCount,
    totalCount,
    expiredCount,
    devicesCount,
    currentSessionIndex: sessions.findIndex((s) => s.isCurrent),
  };
};

export const canRequestReactivationAfterBan = (bannedAt) => {
  if (!bannedAt) return true;
  const daysSinceBan =
    (new Date() - new Date(bannedAt)) / (1000 * 60 * 60 * 24);
  return daysSinceBan >= 30;
};

export const calculateReactivationEligibilityDate = (bannedAt) => {
  if (!bannedAt) return new Date();
  const eligibilityDate = new Date(bannedAt);
  eligibilityDate.setDate(eligibilityDate.getDate() + 30);
  return eligibilityDate;
};

export const notifyAdminsOfReactivationRequest = async ({ user, request }) => {
  const adminUsers = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "MODERATOR"] } },
    select: { id: true },
  });

  const notifications = adminUsers.map((admin) =>
    notificationService.createNotification({
      userId: admin.id,
      type: "ACCOUNT_REACTIVATED",
      title: "New Account Reactivation Request",
      message: `${user.firstName} ${user.lastName} has requested account reactivation.`,
      priority: "NORMAL",
      data: {
        requestId: request.id,
        userEmail: user.email,
        userName: `${user.firstName} ${user.lastName}`,
        reason: request.reason,
      },
      actionUrl: `/admin/reactivation-requests/${request.id}`,
      sendEmail: false,
      sendSocket: true,
    })
  );

  return Promise.all(notifications);
};

export const buildReactivationStatusInfo = ({ request, user, userId }) => {
  return {
    requestId: request.id,
    status: request.status,
    submittedAt: request.createdAt,
    reviewedAt: request.reviewedAt,
    rejectionReason: request.rejectionReason,
    adminNotes: request.adminNotes,
    reviewedBy: request.reviewedBy
      ? `${request.reviewedBy.firstName} ${request.reviewedBy.lastName}`
      : null,
    accountStatus: {
      isActive: user?.isActive || false,
      isBanned: user?.isBanned || false,
      bannedAt: user?.bannedAt,
    },
    nextSteps: getReactivationNextSteps(request.status, user),
  };
};

export const getSessionStatistics = async (userId) => {
  const sessions = await prisma.session.findMany({
    where: { userId },
    select: {
      isActive: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  const now = new Date();
  const activeCount = sessions.filter(
    (s) => s.isActive && new Date(s.expiresAt) > now
  ).length;
  const totalCount = sessions.length;

  return { activeCount, totalCount };
};

export const getSecurityInformation = async (userId) => {
  const recentActivity = await prisma.userActivity.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const hasRecentActivity =
    recentActivity &&
    new Date() - new Date(recentActivity.createdAt) < 7 * 24 * 60 * 60 * 1000;

  return {
    lastPasswordChange: null,
    hasRecentActivity,
  };
};

export const getActivityMetrics = async (userId, role) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentActivities = await prisma.userActivity.findMany({
    where: {
      userId,
      createdAt: { gte: weekAgo },
    },
    select: {
      action: true,
      createdAt: true,
    },
  });

  const loginCount = recentActivities.filter(
    (a) => a.action === "login"
  ).length;
  const totalActivities = recentActivities.length;

  return {
    weeklyLogins: loginCount,
    totalActivities,
    lastActivityAt: recentActivities[0]?.createdAt || null,
    activityScore: Math.min(100, totalActivities * 5),
  };
};

export const buildProfileSummary = (user) => {
  const profileData =
    user.role === "STUDENT"
      ? user.studentProfile
      : user.role === "INSTRUCTOR"
      ? user.instructorProfile
      : user.adminProfile;

  const completionFields = [
    user.bio,
    user.profileImage,
    user.phoneNumber,
    user.country,
    user.website,
  ].filter(Boolean);

  const profileCompletion = Math.round((completionFields.length / 5) * 100);

  return {
    completion: profileCompletion,
    hasProfileImage: !!user.profileImage,
    hasBio: !!user.bio,
    hasContactInfo: !!(user.phoneNumber || user.website),
    roleSpecificData: profileData,
  };
};

export const calculateAccountAge = (createdAt) => {
  const days = Math.floor(
    (new Date() - new Date(createdAt)) / (1000 * 60 * 60 * 24)
  );
  return {
    days,
    months: Math.floor(days / 30),
    years: Math.floor(days / 365),
  };
};

export const calculateSecurityScore = ({
  isVerified,
  activeSessions,
  connectedAccounts,
  hasRecentActivity,
}) => {
  let score = 0;

  if (isVerified) score += 30;
  if (activeSessions <= 3) score += 20;
  if (connectedAccounts > 0) score += 20;
  if (hasRecentActivity) score += 15;
  if (activeSessions === 1) score += 15;

  return Math.min(100, score);
};

export const getDefaultNotificationSettings = () => {
  return {
    email: true,
    push: true,
    inApp: true,
    sms: false,
    assignmentUpdates: true,
    courseUpdates: true,
    accountUpdates: true,
    marketingUpdates: false,
    discussionUpdates: true,
    reviewUpdates: true,
    paymentUpdates: true,
  };
};

export const getRoleSpecificStatistics = async (userId, role) => {
  if (role === "STUDENT") {
    const student = await prisma.student.findUnique({
      where: { userId },
      include: {
        enrollments: {
          include: {
            course: {
              select: {
                title: true,
                level: true,
              },
            },
          },
        },
        certificates: true,
        achievements: true,
      },
    });

    return {
      enrolledCourses: student?.enrollments?.length || 0,
      completedCourses:
        student?.enrollments?.filter((e) => e.status === "COMPLETED")?.length ||
        0,
      certificates: student?.certificates?.length || 0,
      totalLearningTime: student?.totalLearningTime || 0,
      achievements: student?.achievements?.length || 0,
    };
  } else if (role === "INSTRUCTOR") {
    const instructor = await prisma.instructor.findUnique({
      where: { userId },
      include: {
        courses: {
          select: {
            status: true,
            totalEnrollments: true,
          },
        },
      },
    });

    return {
      totalCourses: instructor?.totalCourses || 0,
      publishedCourses:
        instructor?.courses?.filter((c) => c.status === "PUBLISHED")?.length ||
        0,
      totalStudents: instructor?.totalStudents || 0,
      totalRevenue: instructor?.totalRevenue || 0,
      rating: instructor?.rating || 0,
    };
  }

  return {};
};

export const validateAccountDeletion = (data) => {
  const errors = [];
  const { password, reason, confirmDeletion } = data;

  if (!password) {
    errors.push("Password is required to delete account");
  }

  if (!reason?.trim()) {
    errors.push("Deletion reason is required");
  } else if (reason.trim().length < 10) {
    errors.push("Please provide a detailed reason (at least 10 characters)");
  }

  if (confirmDeletion !== "DELETE_MY_ACCOUNT") {
    errors.push("Please type 'DELETE_MY_ACCOUNT' to confirm deletion");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const executeAccountDeletion = async ({ user, reason, requestInfo }) => {
  const deletionRecord = await prisma.accountDeletion.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      userName: `${user.firstName} ${user.lastName}`,
      reason,
      deletedAt: new Date(),
      requestInfo,
      recoveryExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isActive: false,
      email: `deleted_${Date.now()}_${user.email}`,
      firstName: "Deleted",
      lastName: "User",
      profileImage: null,
    },
  });

  return {
    deletionId: deletionRecord.id,
    dataCleared: true,
    sessionsInvalidated: true,
    recoveryPeriod: 30,
  };
};

export const clearAllUserData = async (userId) => {
  const patterns = [
    `user:${userId}`,
    `user_profile:${userId}`,
    `user_sessions:${userId}`,
    `account_summary:${userId}`,
  ];

  const promises = patterns.map((pattern) => redisService.del(pattern));
  await Promise.all(promises);
};

const getDeviceType = (userAgent) => {
  if (!userAgent) return "unknown";
  if (/mobile/i.test(userAgent)) return "mobile";
  if (/tablet/i.test(userAgent)) return "tablet";
  return "desktop";
};

const getOS = (userAgent) => {
  if (!userAgent) return "unknown";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/macintosh|mac os/i.test(userAgent)) return "macOS";
  if (/linux/i.test(userAgent)) return "Linux";
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad/i.test(userAgent)) return "iOS";
  return "Unknown";
};

const getBrowser = (userAgent) => {
  if (!userAgent) return "unknown";
  if (/chrome/i.test(userAgent)) return "Chrome";
  if (/firefox/i.test(userAgent)) return "Firefox";
  if (/safari/i.test(userAgent)) return "Safari";
  if (/edge/i.test(userAgent)) return "Edge";
  return "Unknown";
};

const getReactivationNextSteps = (status, user) => {
  switch (status) {
    case "PENDING":
      return "Your request is being reviewed by our team. You will be notified once a decision is made.";
    case "APPROVED":
      return user?.isActive
        ? "Your account has been reactivated. You can now log in normally."
        : "Your reactivation was approved but account activation is still pending.";
    case "REJECTED":
      return "Your reactivation request was rejected. You can submit a new request after 30 days.";
    default:
      return "Status unknown. Please contact support.";
  }
};
