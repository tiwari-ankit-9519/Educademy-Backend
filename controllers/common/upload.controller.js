import { config } from "dotenv";
config();

import asyncHandler from "express-async-handler";
import {
  uploadImage,
  uploadVideo,
  uploadAudio,
  uploadDocument,
  uploadCourseMedia,
  deleteFromCloudinary,
} from "../../config/upload.js";
import redisService from "../../utils/redis.js";
import { PrismaClient } from "@prisma/client";
import path from "path";
import crypto from "crypto";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const getUploadLimits = (userRole, uploadType) => {
  const limits = {
    STUDENT: {
      image: { maxSize: 5 * 1024 * 1024, maxFiles: 5, dailyLimit: 20 },
      document: { maxSize: 10 * 1024 * 1024, maxFiles: 3, dailyLimit: 10 },
      video: { maxSize: 50 * 1024 * 1024, maxFiles: 1, dailyLimit: 3 },
      audio: { maxSize: 25 * 1024 * 1024, maxFiles: 2, dailyLimit: 5 },
    },
    INSTRUCTOR: {
      image: { maxSize: 10 * 1024 * 1024, maxFiles: 20, dailyLimit: 100 },
      document: { maxSize: 50 * 1024 * 1024, maxFiles: 50, dailyLimit: 200 },
      video: { maxSize: 1024 * 1024 * 1024, maxFiles: 10, dailyLimit: 50 },
      audio: { maxSize: 100 * 1024 * 1024, maxFiles: 20, dailyLimit: 100 },
    },
    ADMIN: {
      image: { maxSize: 20 * 1024 * 1024, maxFiles: 100, dailyLimit: 500 },
      document: { maxSize: 100 * 1024 * 1024, maxFiles: 100, dailyLimit: 1000 },
      video: { maxSize: 2 * 1024 * 1024 * 1024, maxFiles: 50, dailyLimit: 200 },
      audio: { maxSize: 200 * 1024 * 1024, maxFiles: 50, dailyLimit: 200 },
    },
  };

  return limits[userRole]?.[uploadType] || limits.STUDENT[uploadType];
};

const validateFileType = (file, allowedTypes) => {
  const fileExtension = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();

  return allowedTypes.some((type) => {
    if (type.startsWith(".")) {
      return fileExtension === type;
    }
    return mimeType.startsWith(type);
  });
};

const validateUploadRequest = (files, uploadType, userRole) => {
  const errors = [];
  const limits = getUploadLimits(userRole, uploadType);

  if (!files || files.length === 0) {
    errors.push("No files provided for upload");
    return { isValid: false, errors };
  }

  if (files.length > limits.maxFiles) {
    errors.push(`Maximum ${limits.maxFiles} files allowed per upload`);
  }

  const allowedTypes = {
    image: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"],
    video: [".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".mkv", ".m4v"],
    audio: [".mp3", ".wav", ".aac", ".ogg", ".flac", ".m4a"],
    document: [
      ".pdf",
      ".doc",
      ".docx",
      ".txt",
      ".rtf",
      ".ppt",
      ".pptx",
      ".xls",
      ".xlsx",
    ],
  };

  files.forEach((file, index) => {
    if (file.size > limits.maxSize) {
      errors.push(
        `File ${index + 1}: Size exceeds limit of ${Math.round(
          limits.maxSize / 1024 / 1024
        )}MB`
      );
    }

    if (!validateFileType(file, allowedTypes[uploadType])) {
      errors.push(
        `File ${index + 1}: Invalid file type for ${uploadType} upload`
      );
    }

    if (!file.originalname || file.originalname.length > 255) {
      errors.push(`File ${index + 1}: Invalid filename`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    limits,
  };
};

const checkDailyUploadLimit = async (userId, uploadType) => {
  const today = new Date().toISOString().split("T")[0];
  const key = `uploads:${userId}:${uploadType}:${today}`;
  const currentCount = (await redisService.get(key)) || 0;
  return parseInt(currentCount);
};

const incrementDailyUploadCount = async (userId, uploadType, count = 1) => {
  const today = new Date().toISOString().split("T")[0];
  const key = `uploads:${userId}:${uploadType}:${today}`;
  const ttl = 24 * 60 * 60;

  const current = (await redisService.get(key)) || 0;
  const newCount = parseInt(current) + count;
  await redisService.setex(key, ttl, newCount.toString());
  return newCount;
};

const processUploadedFile = (file) => {
  return {
    id: crypto.randomUUID(),
    originalName: file.originalname,
    filename: file.filename,
    path: file.path,
    size: file.size,
    mimetype: file.mimetype,
    uploadedAt: new Date().toISOString(),
    url: file.path,
  };
};

const cleanupFailedUploads = async (files) => {
  if (!files || files.length === 0) return;

  const cleanupPromises = files.map(async (file) => {
    try {
      if (file.path) {
        const publicId = file.path.split("/").pop().split(".")[0];
        await deleteFromCloudinary(publicId);
      }
    } catch (error) {
      console.warn(`Failed to cleanup file: ${file.originalname}`, error);
    }
  });

  await Promise.allSettled(cleanupPromises);
};

export const uploadImages = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  uploadImage.array("images", 20)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    try {
      const rateLimitResult = await redisService.rateLimitCheck(
        `upload_images:${req.userAuthId}`,
        50,
        3600
      );

      if (!rateLimitResult.allowed) {
        await cleanupFailedUploads(req.files);
        return res.status(429).json({
          success: false,
          message: "Too many upload requests. Please try again later.",
          retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
          code: "RATE_LIMIT_EXCEEDED",
        });
      }

      const validationResult = validateUploadRequest(
        req.files,
        "image",
        req.userRole
      );
      if (!validationResult.isValid) {
        await cleanupFailedUploads(req.files);
        return res.status(400).json({
          success: false,
          message: "Upload validation failed",
          errors: validationResult.errors,
          code: "VALIDATION_ERROR",
        });
      }

      const dailyCount = await checkDailyUploadLimit(req.userAuthId, "image");
      if (dailyCount + req.files.length > validationResult.limits.dailyLimit) {
        await cleanupFailedUploads(req.files);
        return res.status(429).json({
          success: false,
          message: `Daily upload limit exceeded. Limit: ${validationResult.limits.dailyLimit}`,
          code: "DAILY_LIMIT_EXCEEDED",
        });
      }

      const uploadedFiles = req.files.map(processUploadedFile);

      await incrementDailyUploadCount(
        req.userAuthId,
        "image",
        req.files.length
      );

      const uploadRecord = await prisma.fileUpload.createMany({
        data: uploadedFiles.map((file) => ({
          id: file.id,
          userId: req.userAuthId,
          originalName: file.originalName,
          filename: file.filename,
          path: file.path,
          size: file.size,
          mimetype: file.mimetype,
          uploadType: "IMAGE",
          status: "COMPLETED",
        })),
      });

      const executionTime = performance.now() - startTime;

      res.status(201).json({
        success: true,
        message: `${uploadedFiles.length} images uploaded successfully`,
        data: {
          files: uploadedFiles,
          uploadType: "image",
          totalSize: uploadedFiles.reduce((sum, file) => sum + file.size, 0),
          dailyUploadsRemaining:
            validationResult.limits.dailyLimit -
            (dailyCount + req.files.length),
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      await cleanupFailedUploads(req.files);

      console.error(`UPLOAD_IMAGES_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        userId: req.userAuthId,
        fileCount: req.files?.length || 0,
        ip: req.ip,
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Failed to upload images",
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

export const uploadVideos = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  uploadVideo.array("videos", 10)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    try {
      const rateLimitResult = await redisService.rateLimitCheck(
        `upload_videos:${req.userAuthId}`,
        20,
        3600
      );

      if (!rateLimitResult.allowed) {
        await cleanupFailedUploads(req.files);
        return res.status(429).json({
          success: false,
          message: "Too many upload requests. Please try again later.",
          retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
          code: "RATE_LIMIT_EXCEEDED",
        });
      }

      const validationResult = validateUploadRequest(
        req.files,
        "video",
        req.userRole
      );
      if (!validationResult.isValid) {
        await cleanupFailedUploads(req.files);
        return res.status(400).json({
          success: false,
          message: "Upload validation failed",
          errors: validationResult.errors,
          code: "VALIDATION_ERROR",
        });
      }

      const dailyCount = await checkDailyUploadLimit(req.userAuthId, "video");
      if (dailyCount + req.files.length > validationResult.limits.dailyLimit) {
        await cleanupFailedUploads(req.files);
        return res.status(429).json({
          success: false,
          message: `Daily upload limit exceeded. Limit: ${validationResult.limits.dailyLimit}`,
          code: "DAILY_LIMIT_EXCEEDED",
        });
      }

      const uploadedFiles = req.files.map(processUploadedFile);

      await incrementDailyUploadCount(
        req.userAuthId,
        "video",
        req.files.length
      );

      await prisma.fileUpload.createMany({
        data: uploadedFiles.map((file) => ({
          id: file.id,
          userId: req.userAuthId,
          originalName: file.originalName,
          filename: file.filename,
          path: file.path,
          size: file.size,
          mimetype: file.mimetype,
          uploadType: "VIDEO",
          status: "PROCESSING",
        })),
      });

      const executionTime = performance.now() - startTime;

      res.status(201).json({
        success: true,
        message: `${uploadedFiles.length} videos uploaded successfully`,
        data: {
          files: uploadedFiles,
          uploadType: "video",
          totalSize: uploadedFiles.reduce((sum, file) => sum + file.size, 0),
          dailyUploadsRemaining:
            validationResult.limits.dailyLimit -
            (dailyCount + req.files.length),
          processingNote:
            "Videos are being processed and will be available shortly",
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      await cleanupFailedUploads(req.files);

      console.error(`UPLOAD_VIDEOS_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        userId: req.userAuthId,
        fileCount: req.files?.length || 0,
        ip: req.ip,
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Failed to upload videos",
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

export const uploadAudioFiles = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  uploadAudio.array("audio", 20)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    try {
      const rateLimitResult = await redisService.rateLimitCheck(
        `upload_audio:${req.userAuthId}`,
        30,
        3600
      );

      if (!rateLimitResult.allowed) {
        await cleanupFailedUploads(req.files);
        return res.status(429).json({
          success: false,
          message: "Too many upload requests. Please try again later.",
          retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
          code: "RATE_LIMIT_EXCEEDED",
        });
      }

      const validationResult = validateUploadRequest(
        req.files,
        "audio",
        req.userRole
      );
      if (!validationResult.isValid) {
        await cleanupFailedUploads(req.files);
        return res.status(400).json({
          success: false,
          message: "Upload validation failed",
          errors: validationResult.errors,
          code: "VALIDATION_ERROR",
        });
      }

      const dailyCount = await checkDailyUploadLimit(req.userAuthId, "audio");
      if (dailyCount + req.files.length > validationResult.limits.dailyLimit) {
        await cleanupFailedUploads(req.files);
        return res.status(429).json({
          success: false,
          message: `Daily upload limit exceeded. Limit: ${validationResult.limits.dailyLimit}`,
          code: "DAILY_LIMIT_EXCEEDED",
        });
      }

      const uploadedFiles = req.files.map(processUploadedFile);

      await incrementDailyUploadCount(
        req.userAuthId,
        "audio",
        req.files.length
      );

      await prisma.fileUpload.createMany({
        data: uploadedFiles.map((file) => ({
          id: file.id,
          userId: req.userAuthId,
          originalName: file.originalName,
          filename: file.filename,
          path: file.path,
          size: file.size,
          mimetype: file.mimetype,
          uploadType: "AUDIO",
          status: "COMPLETED",
        })),
      });

      const executionTime = performance.now() - startTime;

      res.status(201).json({
        success: true,
        message: `${uploadedFiles.length} audio files uploaded successfully`,
        data: {
          files: uploadedFiles,
          uploadType: "audio",
          totalSize: uploadedFiles.reduce((sum, file) => sum + file.size, 0),
          dailyUploadsRemaining:
            validationResult.limits.dailyLimit -
            (dailyCount + req.files.length),
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      await cleanupFailedUploads(req.files);

      console.error(`UPLOAD_AUDIO_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        userId: req.userAuthId,
        fileCount: req.files?.length || 0,
        ip: req.ip,
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Failed to upload audio files",
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

export const uploadDocuments = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  uploadDocument.array("documents", 50)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    try {
      const rateLimitResult = await redisService.rateLimitCheck(
        `upload_documents:${req.userAuthId}`,
        100,
        3600
      );

      if (!rateLimitResult.allowed) {
        await cleanupFailedUploads(req.files);
        return res.status(429).json({
          success: false,
          message: "Too many upload requests. Please try again later.",
          retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
          code: "RATE_LIMIT_EXCEEDED",
        });
      }

      const validationResult = validateUploadRequest(
        req.files,
        "document",
        req.userRole
      );
      if (!validationResult.isValid) {
        await cleanupFailedUploads(req.files);
        return res.status(400).json({
          success: false,
          message: "Upload validation failed",
          errors: validationResult.errors,
          code: "VALIDATION_ERROR",
        });
      }

      const dailyCount = await checkDailyUploadLimit(
        req.userAuthId,
        "document"
      );
      if (dailyCount + req.files.length > validationResult.limits.dailyLimit) {
        await cleanupFailedUploads(req.files);
        return res.status(429).json({
          success: false,
          message: `Daily upload limit exceeded. Limit: ${validationResult.limits.dailyLimit}`,
          code: "DAILY_LIMIT_EXCEEDED",
        });
      }

      const uploadedFiles = req.files.map(processUploadedFile);

      await incrementDailyUploadCount(
        req.userAuthId,
        "document",
        req.files.length
      );

      await prisma.fileUpload.createMany({
        data: uploadedFiles.map((file) => ({
          id: file.id,
          userId: req.userAuthId,
          originalName: file.originalName,
          filename: file.filename,
          path: file.path,
          size: file.size,
          mimetype: file.mimetype,
          uploadType: "DOCUMENT",
          status: "COMPLETED",
        })),
      });

      const executionTime = performance.now() - startTime;

      res.status(201).json({
        success: true,
        message: `${uploadedFiles.length} documents uploaded successfully`,
        data: {
          files: uploadedFiles,
          uploadType: "document",
          totalSize: uploadedFiles.reduce((sum, file) => sum + file.size, 0),
          dailyUploadsRemaining:
            validationResult.limits.dailyLimit -
            (dailyCount + req.files.length),
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      await cleanupFailedUploads(req.files);

      console.error(`UPLOAD_DOCUMENTS_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        userId: req.userAuthId,
        fileCount: req.files?.length || 0,
        ip: req.ip,
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Failed to upload documents",
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

export const uploadCourseContent = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  if (req.userRole !== "INSTRUCTOR" && req.userRole !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Only instructors and admins can upload course content",
      code: "INSUFFICIENT_PERMISSIONS",
    });
  }

  uploadCourseMedia.array("courseFiles", 100)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
        code: "FILE_UPLOAD_ERROR",
      });
    }

    try {
      const rateLimitResult = await redisService.rateLimitCheck(
        `upload_course:${req.userAuthId}`,
        200,
        3600
      );

      if (!rateLimitResult.allowed) {
        await cleanupFailedUploads(req.files);
        return res.status(429).json({
          success: false,
          message: "Too many upload requests. Please try again later.",
          retryAfter: Math.ceil(rateLimitResult.resetTime / 60),
          code: "RATE_LIMIT_EXCEEDED",
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No files provided for upload",
          code: "NO_FILES_PROVIDED",
        });
      }

      const { courseId, sectionId, lessonId } = req.body;

      if (courseId) {
        const course = await prisma.course.findFirst({
          where: {
            id: courseId,
            instructorId: req.userAuthId,
          },
        });

        if (!course && req.userRole !== "ADMIN") {
          await cleanupFailedUploads(req.files);
          return res.status(403).json({
            success: false,
            message:
              "You don't have permission to upload files for this course",
            code: "COURSE_ACCESS_DENIED",
          });
        }
      }

      const uploadedFiles = req.files.map((file) => ({
        ...processUploadedFile(file),
        courseId: courseId || null,
        sectionId: sectionId || null,
        lessonId: lessonId || null,
      }));

      await prisma.fileUpload.createMany({
        data: uploadedFiles.map((file) => ({
          id: file.id,
          userId: req.userAuthId,
          originalName: file.originalName,
          filename: file.filename,
          path: file.path,
          size: file.size,
          mimetype: file.mimetype,
          uploadType: "COURSE_CONTENT",
          status: "COMPLETED",
          courseId: file.courseId,
        })),
      });

      const executionTime = performance.now() - startTime;

      res.status(201).json({
        success: true,
        message: `${uploadedFiles.length} course files uploaded successfully`,
        data: {
          files: uploadedFiles,
          uploadType: "course_content",
          totalSize: uploadedFiles.reduce((sum, file) => sum + file.size, 0),
          courseId,
          sectionId,
          lessonId,
        },
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      await cleanupFailedUploads(req.files);

      console.error(`UPLOAD_COURSE_CONTENT_ERROR [${requestId}]:`, {
        error: error.message,
        stack: error.stack,
        userId: req.userAuthId,
        fileCount: req.files?.length || 0,
        courseId: req.body?.courseId,
        ip: req.ip,
      });

      const executionTime = performance.now() - startTime;

      res.status(500).json({
        success: false,
        message: "Failed to upload course content",
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

export const getUploadedFiles = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { page = 1, limit = 20, uploadType, status, courseId } = req.query;

    const rateLimitResult = await redisService.rateLimitCheck(
      `get_uploads:${req.userAuthId}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const where = { userId: req.userAuthId };

    if (uploadType) where.uploadType = uploadType.toUpperCase();
    if (status) where.status = status.toUpperCase();
    if (courseId) where.courseId = courseId;

    const [files, total] = await Promise.all([
      prisma.fileUpload.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          originalName: true,
          filename: true,
          path: true,
          size: true,
          mimetype: true,
          uploadType: true,
          status: true,
          courseId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.fileUpload.count({ where }),
    ]);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Files retrieved successfully",
      data: {
        files,
        pagination: {
          page: pageNumber,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
          hasNext: skip + pageSize < total,
          hasPrev: pageNumber > 1,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_UPLOADED_FILES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      query: req.query,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve uploaded files",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteUploadedFile = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res.status(400).json({
        success: false,
        message: "File ID is required",
        code: "MISSING_FILE_ID",
      });
    }

    const rateLimitResult = await redisService.rateLimitCheck(
      `delete_upload:${req.userAuthId}`,
      50,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many delete requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const file = await prisma.fileUpload.findFirst({
      where: {
        id: fileId,
        userId: req.userAuthId,
      },
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: "File not found or you don't have permission to delete it",
        code: "FILE_NOT_FOUND",
      });
    }

    await prisma.fileUpload.delete({
      where: { id: fileId },
    });

    try {
      if (file.path) {
        const publicId = file.path.split("/").pop().split(".")[0];
        await deleteFromCloudinary(publicId);
      }
    } catch (cloudinaryError) {
      console.warn(
        `Failed to delete file from Cloudinary: ${file.path}`,
        cloudinaryError
      );
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "File deleted successfully",
      data: {
        deletedFileId: fileId,
        filename: file.originalName,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_UPLOADED_FILE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      fileId: req.params.fileId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete file",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getUploadLimitsInfo = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const rateLimitResult = await redisService.rateLimitCheck(
      `upload_limits:${req.userAuthId}`,
      100,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const uploadTypes = ["image", "video", "audio", "document"];
    const limits = {};
    const dailyUsage = {};

    for (const type of uploadTypes) {
      limits[type] = getUploadLimits(req.userRole, type);
      dailyUsage[type] = await checkDailyUploadLimit(req.userAuthId, type);
    }

    const totalStorageUsed = await prisma.fileUpload.aggregate({
      where: { userId: req.userAuthId },
      _sum: { size: true },
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Upload limits retrieved successfully",
      data: {
        userRole: req.userRole,
        limits,
        dailyUsage,
        totalStorageUsed: totalStorageUsed._sum.size || 0,
        supportedFormats: {
          image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"],
          video: ["mp4", "avi", "mov", "wmv", "flv", "webm", "mkv", "m4v"],
          audio: ["mp3", "wav", "aac", "ogg", "flac", "m4a"],
          document: [
            "pdf",
            "doc",
            "docx",
            "txt",
            "rtf",
            "ppt",
            "pptx",
            "xls",
            "xlsx",
          ],
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_UPLOAD_LIMITS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve upload limits",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getUploadStats = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const rateLimitResult = await redisService.rateLimitCheck(
      `upload_stats:${req.userAuthId}`,
      50,
      3600
    );

    if (!rateLimitResult.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        code: "RATE_LIMIT_EXCEEDED",
      });
    }

    const [totalFiles, totalSize, filesByType, recentUploads] =
      await Promise.all([
        prisma.fileUpload.count({
          where: { userId: req.userAuthId },
        }),
        prisma.fileUpload.aggregate({
          where: { userId: req.userAuthId },
          _sum: { size: true },
        }),
        prisma.fileUpload.groupBy({
          by: ["uploadType"],
          where: { userId: req.userAuthId },
          _count: { uploadType: true },
          _sum: { size: true },
        }),
        prisma.fileUpload.findMany({
          where: {
            userId: req.userAuthId,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
          select: {
            uploadType: true,
            createdAt: true,
          },
        }),
      ]);

    const stats = {
      totalFiles,
      totalSize: totalSize._sum.size || 0,
      filesByType: filesByType.reduce((acc, item) => {
        acc[item.uploadType.toLowerCase()] = {
          count: item._count.uploadType,
          size: item._sum.size || 0,
        };
        return acc;
      }, {}),
      recentActivity: {
        last7Days: recentUploads.length,
        dailyBreakdown: recentUploads.reduce((acc, upload) => {
          const date = upload.createdAt.toISOString().split("T")[0];
          acc[date] = (acc[date] || 0) + 1;
          return acc;
        }, {}),
      },
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Upload statistics retrieved successfully",
      data: stats,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_UPLOAD_STATS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      ip: req.ip,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve upload statistics",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
