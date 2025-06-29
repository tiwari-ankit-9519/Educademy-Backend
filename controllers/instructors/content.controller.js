import { PrismaClient } from "@prisma/client";
import asyncHandler from "express-async-handler";
import redisService from "../../utils/redis.js";
import { v2 as cloudinary } from "cloudinary";

const prisma = new PrismaClient();

const generateRequestId = () => {
  return `content_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const validateCourseOwnership = async (courseId, instructorId) => {
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      instructorId: instructorId,
    },
  });
  return !!course;
};

const clearContentCache = async (courseId) => {
  try {
    await redisService.delPattern(`course_content:${courseId}*`);
    await redisService.delPattern(`course_structure:${courseId}*`);
    await redisService.del(`course:${courseId}`);
  } catch (error) {
    console.error("Failed to clear content cache:", error);
  }
};

export const getCourseStructure = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const instructorId = req.instructorProfile.id;

    const hasAccess = await validateCourseOwnership(courseId, instructorId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const cacheKey = `course_structure:${courseId}`;
    let courseStructure = await redisService.getJSON(cacheKey);

    if (!courseStructure) {
      courseStructure = await prisma.course.findUnique({
        where: { id: courseId },
        include: {
          sections: {
            orderBy: { order: "asc" },
            include: {
              lessons: {
                orderBy: { order: "asc" },
                include: {
                  attachments: true,
                  postLessonQuiz: {
                    include: {
                      questions: {
                        orderBy: { order: "asc" },
                      },
                    },
                  },
                },
              },
              quizzes: {
                orderBy: { order: "asc" },
                include: {
                  questions: {
                    orderBy: { order: "asc" },
                  },
                },
              },
              assignments: {
                orderBy: { order: "asc" },
              },
              contentItems: {
                orderBy: { order: "asc" },
              },
            },
          },
        },
      });

      if (courseStructure) {
        await redisService.setJSON(cacheKey, courseStructure, { ex: 1800 });
      }
    }

    if (!courseStructure) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    const contentStats = {
      totalSections: courseStructure.sections.length,
      totalLessons: courseStructure.sections.reduce(
        (acc, section) => acc + section.lessons.length,
        0
      ),
      totalQuizzes: courseStructure.sections.reduce(
        (acc, section) => acc + section.quizzes.length,
        0
      ),
      totalAssignments: courseStructure.sections.reduce(
        (acc, section) => acc + section.assignments.length,
        0
      ),
      totalDuration: courseStructure.sections.reduce(
        (acc, section) =>
          acc +
          section.lessons.reduce(
            (lessonAcc, lesson) => lessonAcc + lesson.duration,
            0
          ),
        0
      ),
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course structure retrieved successfully",
      data: {
        course: courseStructure,
        stats: contentStats,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`COURSE_STRUCTURE_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course structure",
      code: "COURSE_STRUCTURE_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createSection = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { title, description, isPublished = false, estimatedTime } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Section title is required",
        code: "VALIDATION_ERROR",
      });
    }

    const parsedEstimatedTime = estimatedTime ? parseInt(estimatedTime) : null;
    if (
      estimatedTime &&
      (isNaN(parsedEstimatedTime) || parsedEstimatedTime < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Estimated time must be a valid positive number in minutes",
        code: "VALIDATION_ERROR",
      });
    }

    const [course, lastSection] = await Promise.all([
      prisma.course.findUnique({
        where: { id: courseId, instructorId },
        select: { id: true, sectionsCount: true },
      }),
      prisma.section.findFirst({
        where: { courseId },
        orderBy: { order: "desc" },
        select: { order: true },
      }),
    ]);

    if (!course) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const newOrder = lastSection ? lastSection.order + 1 : 1;

    const [section, updatedCourse] = await Promise.all([
      prisma.section.create({
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          order: newOrder,
          isPublished,
          estimatedTime: parsedEstimatedTime,
          courseId,
        },
        select: {
          id: true,
          title: true,
          description: true,
          order: true,
          isPublished: true,
          estimatedTime: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.course.update({
        where: { id: courseId },
        data: {
          sectionsCount: (course.sectionsCount || 0) + 1,
          lastUpdated: new Date(),
        },
        select: { sectionsCount: true },
      }),
    ]);

    setImmediate(async () => {
      try {
        await Promise.all([
          clearContentCache(courseId),
          redisService.delPattern(`course:${courseId}*`),
          redisService.delPattern(`sections:${courseId}*`),
        ]);
      } catch (cacheError) {
        console.warn("Cache cleanup failed:", cacheError);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Section created successfully",
      data: {
        section: {
          id: section.id,
          title: section.title,
          description: section.description,
          order: section.order,
          isPublished: section.isPublished,
          estimatedTimeMinutes: section.estimatedTime,
          estimatedTime: section.estimatedTime
            ? {
                value: section.estimatedTime,
                unit: "minutes",
                display: `${section.estimatedTime} minutes`,
                formatted: formatDuration(section.estimatedTime),
              }
            : null,
          createdAt: section.createdAt,
          updatedAt: section.updatedAt,
          courseId,
        },
        course: {
          sectionsCount: updatedCourse.sectionsCount,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CREATE_SECTION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to create section",
      code: "CREATE_SECTION_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const formatDuration = (minutes) => {
  if (!minutes || minutes === 0) return "0 minutes";

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;
  } else if (remainingMinutes === 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  } else {
    return `${hours} hour${hours !== 1 ? "s" : ""} ${remainingMinutes} minute${
      remainingMinutes !== 1 ? "s" : ""
    }`;
  }
};

export const updateSection = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { sectionId } = req.params;
    const { title, description, isPublished, estimatedTime } = req.body;
    const instructorId = req.instructorProfile.id;

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      select: {
        id: true,
        courseId: true,
        course: {
          select: {
            id: true,
            instructorId: true,
          },
        },
      },
    });

    if (!section) {
      return res.status(404).json({
        success: false,
        message: "Section not found",
        code: "SECTION_NOT_FOUND",
      });
    }

    if (section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const updateData = {};

    if (title !== undefined) {
      if (!title || title.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Section title cannot be empty",
          code: "VALIDATION_ERROR",
        });
      }
      updateData.title = title.trim();
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    if (isPublished !== undefined) {
      updateData.isPublished = Boolean(isPublished);
    }

    if (estimatedTime !== undefined) {
      if (estimatedTime === null || estimatedTime === "") {
        updateData.estimatedTime = null;
      } else {
        const parsedEstimatedTime = parseInt(estimatedTime);
        if (isNaN(parsedEstimatedTime) || parsedEstimatedTime < 0) {
          return res.status(400).json({
            success: false,
            message:
              "Estimated time must be a valid positive number in minutes",
            code: "VALIDATION_ERROR",
          });
        }
        updateData.estimatedTime = parsedEstimatedTime;
      }
    }

    const updatedSection = await prisma.section.update({
      where: { id: sectionId },
      data: updateData,
      select: {
        id: true,
        title: true,
        description: true,
        order: true,
        isPublished: true,
        estimatedTime: true,
        courseId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    setImmediate(async () => {
      try {
        await Promise.all([
          clearContentCache(section.courseId),
          redisService.delPattern(`course:${section.courseId}*`),
          redisService.delPattern(`sections:${section.courseId}*`),
          redisService.delPattern(`section:${sectionId}*`),
        ]);
      } catch (cacheError) {
        console.warn("Cache cleanup failed:", cacheError);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Section updated successfully",
      data: {
        section: {
          id: updatedSection.id,
          title: updatedSection.title,
          description: updatedSection.description,
          order: updatedSection.order,
          isPublished: updatedSection.isPublished,
          estimatedTimeMinutes: updatedSection.estimatedTime,
          estimatedTime: updatedSection.estimatedTime
            ? {
                value: updatedSection.estimatedTime,
                unit: "minutes",
                display: `${updatedSection.estimatedTime} minutes`,
                formatted: formatDuration(updatedSection.estimatedTime),
              }
            : null,
          courseId: updatedSection.courseId,
          createdAt: updatedSection.createdAt,
          updatedAt: updatedSection.updatedAt,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_SECTION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      sectionId: req.params.sectionId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update section",
      code: "UPDATE_SECTION_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteSection = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { sectionId } = req.params;
    const instructorId = req.instructorProfile.id;

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: {
        course: true,
        lessons: true,
        quizzes: true,
        assignments: true,
      },
    });

    if (!section) {
      return res.status(404).json({
        success: false,
        message: "Section not found",
        code: "SECTION_NOT_FOUND",
      });
    }

    if (section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const hasContent =
      section.lessons.length > 0 ||
      section.quizzes.length > 0 ||
      section.assignments.length > 0;

    if (hasContent) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete section with content. Please remove all lessons, quizzes, and assignments first.",
        code: "SECTION_HAS_CONTENT",
      });
    }

    await prisma.section.delete({
      where: { id: sectionId },
    });

    const sectionsToUpdate = await prisma.section.findMany({
      where: {
        courseId: section.courseId,
        order: { gt: section.order },
      },
    });

    if (sectionsToUpdate.length > 0) {
      const updatePromises = sectionsToUpdate.map((s) =>
        prisma.section.update({
          where: { id: s.id },
          data: { order: s.order - 1 },
        })
      );
      await Promise.all(updatePromises);
    }

    await clearContentCache(section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Section deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_SECTION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      sectionId: req.params.sectionId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete section",
      code: "DELETE_SECTION_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const reorderSections = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { sectionIds } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!Array.isArray(sectionIds) || sectionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Section IDs array is required",
        code: "VALIDATION_ERROR",
      });
    }

    const hasAccess = await validateCourseOwnership(courseId, instructorId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const existingSections = await prisma.section.findMany({
      where: { courseId },
      select: { id: true },
    });

    const existingIds = existingSections.map((s) => s.id);
    const isValidReorder = sectionIds.every((id) => existingIds.includes(id));

    if (!isValidReorder || sectionIds.length !== existingIds.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid section IDs provided",
        code: "INVALID_SECTION_IDS",
      });
    }

    const updatePromises = sectionIds.map((sectionId, index) =>
      prisma.section.update({
        where: { id: sectionId },
        data: { order: index + 1 },
      })
    );

    await Promise.all(updatePromises);

    await clearContentCache(courseId);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Sections reordered successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REORDER_SECTIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to reorder sections",
      code: "REORDER_SECTIONS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createLesson = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { sectionId } = req.params;
    const {
      title,
      description,
      duration,
      type,
      content,
      videoUrl,
      isFree = false,
      isPreview = false,
      transcript,
      resources,
    } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!title || !duration || !type) {
      if (req.file?.path) {
        setImmediate(async () => {
          try {
            const publicId = req.file.path
              .split("/")
              .slice(-2)
              .join("/")
              .split(".")[0];
            await deleteFromCloudinary(publicId, "video");
          } catch (cleanupError) {
            console.error("File cleanup failed:", cleanupError);
          }
        });
      }
      return res.status(400).json({
        success: false,
        message: "Title, duration, and type are required",
        code: "VALIDATION_ERROR",
      });
    }

    const [section, lastLesson] = await Promise.all([
      prisma.section.findUnique({
        where: { id: sectionId },
        select: {
          id: true,
          course: {
            select: {
              id: true,
              instructorId: true,
            },
          },
        },
      }),
      prisma.lesson.findFirst({
        where: { sectionId },
        select: { order: true },
        orderBy: { order: "desc" },
      }),
    ]);

    if (!section) {
      if (req.file?.path) {
        setImmediate(async () => {
          try {
            const publicId = req.file.path
              .split("/")
              .slice(-2)
              .join("/")
              .split(".")[0];
            await deleteFromCloudinary(publicId, "video");
          } catch (cleanupError) {
            console.error("File cleanup failed:", cleanupError);
          }
        });
      }
      return res.status(404).json({
        success: false,
        message: "Section not found",
        code: "SECTION_NOT_FOUND",
      });
    }

    if (section.course.instructorId !== instructorId) {
      if (req.file?.path) {
        setImmediate(async () => {
          try {
            const publicId = req.file.path
              .split("/")
              .slice(-2)
              .join("/")
              .split(".")[0];
            await deleteFromCloudinary(publicId, "video");
          } catch (cleanupError) {
            console.error("File cleanup failed:", cleanupError);
          }
        });
      }
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const newOrder = lastLesson ? lastLesson.order + 1 : 1;
    const uploadedVideoUrl = req.file ? req.file.path : null;
    const providedVideoUrl = videoUrl?.trim() || null;
    const finalVideoUrl = uploadedVideoUrl || providedVideoUrl;

    const lessonData = {
      title: title.trim(),
      description: description?.trim(),
      duration: parseInt(duration),
      type,
      content: content?.trim(),
      videoUrl: finalVideoUrl,
      isFree,
      isPreview,
      transcript: transcript?.trim(),
      resources: resources || null,
      order: newOrder,
      sectionId,
    };

    const lesson = await prisma.lesson.create({
      data: lessonData,
      select: {
        id: true,
        title: true,
        description: true,
        duration: true,
        type: true,
        content: true,
        videoUrl: true,
        isFree: true,
        isPreview: true,
        transcript: true,
        resources: true,
        order: true,
        createdAt: true,
        updatedAt: true,
        sectionId: true,
      },
    });

    setImmediate(async () => {
      try {
        await Promise.all([
          clearContentCache(section.course.id),
          redisService.delPattern(`section:${sectionId}*`),
          redisService.delPattern(`course:${section.course.id}*`),
          redisService.delPattern(`lessons:${sectionId}*`),
        ]);

        if (finalVideoUrl && type === "VIDEO") {
          await processVideoInBackground(
            lesson.id,
            finalVideoUrl,
            uploadedVideoUrl ? "upload" : "url"
          );
        }
      } catch (error) {
        console.error("Background operations failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Lesson created successfully",
      data: {
        lesson: {
          ...lesson,
          uploadStatus: uploadedVideoUrl ? "PROCESSING" : "COMPLETED",
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (req.file?.path) {
      setImmediate(async () => {
        try {
          const publicId = req.file.path
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "video");
        } catch (cleanupError) {
          console.error("File cleanup failed:", cleanupError);
        }
      });
    }

    console.error(`CREATE_LESSON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      sectionId: req.params.sectionId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to create lesson",
      code: "CREATE_LESSON_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

const processVideoInBackground = async (lessonId, videoUrl, source = "url") => {
  try {
    console.log(
      `Processing video for lesson ${lessonId}:`,
      videoUrl,
      `(${source})`
    );

    const videoMetadata = await extractVideoMetadata(videoUrl, source);

    if (videoMetadata) {
      await prisma.lesson.update({
        where: { id: lessonId },
        data: {
          videoQuality: videoMetadata.quality,
          duration: videoMetadata.duration || undefined,
        },
      });

      await redisService.setJSON(
        `lesson_video_status:${lessonId}`,
        {
          status: "COMPLETED",
          metadata: videoMetadata,
          processedAt: new Date(),
        },
        { ex: 3600 }
      );
    }

    console.log(`Video processing completed for lesson ${lessonId}`);
  } catch (error) {
    console.error(`Video processing failed for lesson ${lessonId}:`, error);

    await redisService.setJSON(
      `lesson_video_status:${lessonId}`,
      {
        status: "FAILED",
        error: error.message,
        failedAt: new Date(),
      },
      { ex: 3600 }
    );
  }
};

export const updateLesson = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { lessonId } = req.params;
    const {
      title,
      description,
      duration,
      type,
      content,
      videoUrl,
      isFree,
      isPreview,
      transcript,
      resources,
    } = req.body;
    const instructorId = req.instructorProfile.id;

    const [lesson, section] = await Promise.all([
      prisma.lesson.findUnique({
        where: { id: lessonId },
        select: {
          id: true,
          sectionId: true,
          videoUrl: true,
        },
      }),
      prisma.lesson.findUnique({
        where: { id: lessonId },
        select: {
          section: {
            select: {
              course: {
                select: {
                  instructorId: true,
                  id: true,
                },
              },
            },
          },
        },
      }),
    ]);

    if (!lesson || !section) {
      if (req.file?.path) {
        setImmediate(async () => {
          try {
            const publicId = req.file.path
              .split("/")
              .slice(-2)
              .join("/")
              .split(".")[0];
            await deleteFromCloudinary(publicId, "video");
          } catch (cleanupError) {
            console.error("File cleanup failed:", cleanupError);
          }
        });
      }
      return res.status(404).json({
        success: false,
        message: "Lesson not found",
        code: "LESSON_NOT_FOUND",
      });
    }

    if (section.section.course.instructorId !== instructorId) {
      if (req.file?.path) {
        setImmediate(async () => {
          try {
            const publicId = req.file.path
              .split("/")
              .slice(-2)
              .join("/")
              .split(".")[0];
            await deleteFromCloudinary(publicId, "video");
          } catch (cleanupError) {
            console.error("File cleanup failed:", cleanupError);
          }
        });
      }
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const uploadedVideoUrl = req.file ? req.file.path : null;
    const providedVideoUrl = videoUrl?.trim() || null;
    const finalVideoUrl =
      uploadedVideoUrl || providedVideoUrl || lesson.videoUrl;

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description?.trim();
    if (duration !== undefined) updateData.duration = parseInt(duration);
    if (type !== undefined) updateData.type = type;
    if (content !== undefined) updateData.content = content?.trim();
    if (finalVideoUrl !== lesson.videoUrl) updateData.videoUrl = finalVideoUrl;
    if (isFree !== undefined) updateData.isFree = isFree;
    if (isPreview !== undefined) updateData.isPreview = isPreview;
    if (transcript !== undefined) updateData.transcript = transcript?.trim();
    if (resources !== undefined) updateData.resources = resources || null;

    const updatedLesson = await prisma.lesson.update({
      where: { id: lessonId },
      data: updateData,
      select: {
        id: true,
        title: true,
        description: true,
        duration: true,
        type: true,
        content: true,
        videoUrl: true,
        isFree: true,
        isPreview: true,
        transcript: true,
        resources: true,
        order: true,
        updatedAt: true,
        sectionId: true,
      },
    });

    setImmediate(async () => {
      try {
        if (
          lesson.videoUrl &&
          lesson.videoUrl !== finalVideoUrl &&
          lesson.videoUrl.includes("cloudinary.com")
        ) {
          try {
            const oldPublicId = lesson.videoUrl
              .split("/")
              .slice(-2)
              .join("/")
              .split(".")[0];
            await deleteFromCloudinary(oldPublicId, "video");
          } catch (deleteError) {
            console.error("Failed to delete old video:", deleteError);
          }
        }

        await Promise.all([
          clearContentCache(section.section.course.id),
          redisService.delPattern(`section:${lesson.sectionId}*`),
          redisService.delPattern(`course:${section.section.course.id}*`),
          redisService.delPattern(`lessons:${lesson.sectionId}*`),
          redisService.del(`lesson:${lessonId}`),
        ]);

        if (uploadedVideoUrl && type === "VIDEO") {
          await processVideoInBackground(lessonId, uploadedVideoUrl, "upload");
        }
      } catch (error) {
        console.error("Background operations failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Lesson updated successfully",
      data: {
        lesson: {
          ...updatedLesson,
          uploadStatus: uploadedVideoUrl ? "PROCESSING" : "COMPLETED",
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (req.file?.path) {
      setImmediate(async () => {
        try {
          const publicId = req.file.path
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await deleteFromCloudinary(publicId, "video");
        } catch (cleanupError) {
          console.error("File cleanup failed:", cleanupError);
        }
      });
    }

    console.error(`UPDATE_LESSON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      lessonId: req.params.lessonId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update lesson",
      code: "UPDATE_LESSON_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteLesson = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { lessonId } = req.params;
    const instructorId = req.instructorProfile.id;

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        section: {
          include: { course: true },
        },
        attachments: true,
        completions: true,
      },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found",
        code: "LESSON_NOT_FOUND",
      });
    }

    if (lesson.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    if (lesson.completions.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete lesson with student completions. Consider archiving instead.",
        code: "LESSON_HAS_COMPLETIONS",
      });
    }

    if (lesson.attachments.length > 0) {
      const deleteAttachmentPromises = lesson.attachments.map(
        async (attachment) => {
          try {
            if (attachment.fileUrl.includes("cloudinary.com")) {
              const publicId = attachment.fileUrl
                .split("/")
                .pop()
                .split(".")[0];
              await cloudinary.uploader.destroy(publicId);
            }
          } catch (error) {
            console.error(
              "Failed to delete attachment from cloudinary:",
              error
            );
          }
        }
      );
      await Promise.all(deleteAttachmentPromises);
    }

    await prisma.lesson.delete({
      where: { id: lessonId },
    });

    const lessonsToUpdate = await prisma.lesson.findMany({
      where: {
        sectionId: lesson.sectionId,
        order: { gt: lesson.order },
      },
    });

    if (lessonsToUpdate.length > 0) {
      const updatePromises = lessonsToUpdate.map((l) =>
        prisma.lesson.update({
          where: { id: l.id },
          data: { order: l.order - 1 },
        })
      );
      await Promise.all(updatePromises);
    }

    await clearContentCache(lesson.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Lesson deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_LESSON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      lessonId: req.params.lessonId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete lesson",
      code: "DELETE_LESSON_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const reorderLessons = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { sectionId } = req.params;
    const { lessonIds } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!Array.isArray(lessonIds) || lessonIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Lesson IDs array is required",
        code: "VALIDATION_ERROR",
      });
    }

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: {
        course: true,
        lessons: { select: { id: true } },
      },
    });

    if (!section) {
      return res.status(404).json({
        success: false,
        message: "Section not found",
        code: "SECTION_NOT_FOUND",
      });
    }

    if (section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const existingIds = section.lessons.map((l) => l.id);
    const isValidReorder = lessonIds.every((id) => existingIds.includes(id));

    if (!isValidReorder || lessonIds.length !== existingIds.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid lesson IDs provided",
        code: "INVALID_LESSON_IDS",
      });
    }

    const updatePromises = lessonIds.map((lessonId, index) =>
      prisma.lesson.update({
        where: { id: lessonId },
        data: { order: index + 1 },
      })
    );

    await Promise.all(updatePromises);

    await clearContentCache(section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Lessons reordered successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REORDER_LESSONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      sectionId: req.params.sectionId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to reorder lessons",
      code: "REORDER_LESSONS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createQuiz = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { sectionId } = req.params;
    const {
      title,
      description,
      instructions,
      duration,
      passingScore,
      maxAttempts = 1,
      isRequired = true,
      isRandomized = false,
      showResults = true,
      allowReview = true,
    } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!title || !duration || !passingScore) {
      return res.status(400).json({
        success: false,
        message: "Title, duration, and passing score are required",
        code: "VALIDATION_ERROR",
      });
    }

    const durationInt = parseInt(duration);
    const passingScoreInt = parseInt(passingScore);
    const maxAttemptsInt = parseInt(maxAttempts);

    if (durationInt <= 0 || passingScoreInt <= 0 || passingScoreInt > 100) {
      return res.status(400).json({
        success: false,
        message: "Invalid duration or passing score (must be 1-100%)",
        code: "INVALID_VALUES",
      });
    }

    const [section, lastQuiz] = await Promise.all([
      prisma.section.findUnique({
        where: { id: sectionId },
        select: {
          id: true,
          courseId: true,
          course: {
            select: {
              id: true,
              instructorId: true,
            },
          },
        },
      }),
      prisma.quiz.findFirst({
        where: { sectionId },
        select: { order: true },
        orderBy: { order: "desc" },
      }),
    ]);

    if (!section) {
      return res.status(404).json({
        success: false,
        message: "Section not found",
        code: "SECTION_NOT_FOUND",
      });
    }

    if (section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const newOrder = lastQuiz ? lastQuiz.order + 1 : 1;

    const quiz = await prisma.quiz.create({
      data: {
        title: title.trim(),
        description: description?.trim(),
        instructions: instructions?.trim(),
        duration: durationInt,
        passingScore: passingScoreInt,
        maxAttempts: maxAttemptsInt,
        order: newOrder,
        isRequired,
        isRandomized,
        showResults,
        allowReview,
        sectionId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        instructions: true,
        duration: true,
        passingScore: true,
        maxAttempts: true,
        order: true,
        isRequired: true,
        isRandomized: true,
        showResults: true,
        allowReview: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    setImmediate(async () => {
      try {
        await clearContentCache(section.course.id);
      } catch (error) {
        console.warn("Cache cleanup failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Quiz created successfully",
      data: {
        quiz: {
          ...quiz,
          passingScoreInfo: {
            percentage: passingScoreInt,
            description: `Students need ${passingScoreInt}% to pass this quiz`,
          },
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CREATE_QUIZ_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      sectionId: req.params.sectionId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to create quiz",
      code: "CREATE_QUIZ_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateQuiz = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const {
      title,
      description,
      instructions,
      duration,
      passingScore,
      maxAttempts,
      isRequired,
      isRandomized,
      showResults,
      allowReview,
    } = req.body;
    const instructorId = req.instructorProfile.id;

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        section: {
          include: { course: true },
        },
        attempts: true,
      },
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
        code: "QUIZ_NOT_FOUND",
      });
    }

    if (quiz.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    if (quiz.attempts.length > 0) {
      const restrictedFields = ["passingScore", "maxAttempts", "duration"];
      const hasRestrictedChanges = restrictedFields.some(
        (field) =>
          req.body[field] !== undefined && req.body[field] !== quiz[field]
      );

      if (hasRestrictedChanges) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot modify scoring criteria for quiz with existing attempts",
          code: "QUIZ_HAS_ATTEMPTS",
        });
      }
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description?.trim();
    if (instructions !== undefined)
      updateData.instructions = instructions?.trim();
    if (duration !== undefined) updateData.duration = parseInt(duration);
    if (passingScore !== undefined)
      updateData.passingScore = parseInt(passingScore);
    if (maxAttempts !== undefined)
      updateData.maxAttempts = parseInt(maxAttempts);
    if (isRequired !== undefined) updateData.isRequired = isRequired;
    if (isRandomized !== undefined) updateData.isRandomized = isRandomized;
    if (showResults !== undefined) updateData.showResults = showResults;
    if (allowReview !== undefined) updateData.allowReview = allowReview;

    const updatedQuiz = await prisma.quiz.update({
      where: { id: quizId },
      data: updateData,
    });

    await clearContentCache(quiz.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Quiz updated successfully",
      data: { quiz: updatedQuiz },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_QUIZ_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      quizId: req.params.quizId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update quiz",
      code: "UPDATE_QUIZ_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteQuiz = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const instructorId = req.instructorProfile.id;

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        section: {
          include: { course: true },
        },
        attempts: true,
        questions: true,
      },
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
        code: "QUIZ_NOT_FOUND",
      });
    }

    if (quiz.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    if (quiz.attempts.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete quiz with student attempts. Consider archiving instead.",
        code: "QUIZ_HAS_ATTEMPTS",
      });
    }

    await prisma.quiz.delete({
      where: { id: quizId },
    });

    const quizzesToUpdate = await prisma.quiz.findMany({
      where: {
        sectionId: quiz.sectionId,
        order: { gt: quiz.order || 0 },
      },
    });

    if (quizzesToUpdate.length > 0) {
      const updatePromises = quizzesToUpdate.map((q) =>
        prisma.quiz.update({
          where: { id: q.id },
          data: { order: (q.order || 1) - 1 },
        })
      );
      await Promise.all(updatePromises);
    }

    await clearContentCache(quiz.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Quiz deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_QUIZ_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      quizId: req.params.quizId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete quiz",
      code: "DELETE_QUIZ_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const addQuizQuestions = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const { questions } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Questions array is required and must not be empty",
        code: "VALIDATION_ERROR",
      });
    }

    if (questions.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Cannot add more than 50 questions at once",
        code: "TOO_MANY_QUESTIONS",
      });
    }

    const [quiz, existingQuestionCount] = await Promise.all([
      prisma.quiz.findUnique({
        where: { id: quizId },
        select: {
          id: true,
          passingScore: true,
          section: {
            select: {
              courseId: true,
              course: {
                select: {
                  id: true,
                  instructorId: true,
                },
              },
            },
          },
        },
      }),
      prisma.question.count({
        where: { quizId },
      }),
    ]);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
        code: "QUIZ_NOT_FOUND",
      });
    }

    if (quiz.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const validationErrors = [];
    const processedQuestions = [];

    questions.forEach((question, index) => {
      const errors = [];

      if (!question.content?.trim()) {
        errors.push(`Question ${index + 1}: Content is required`);
      }

      if (!question.type) {
        errors.push(`Question ${index + 1}: Type is required`);
      }

      const points = parseInt(question.points) || 1;
      if (points <= 0) {
        errors.push(`Question ${index + 1}: Points must be greater than 0`);
      }

      if (
        question.type === "single-choice" ||
        question.type === "multiple-choice"
      ) {
        if (!Array.isArray(question.options) || question.options.length < 2) {
          errors.push(
            `Question ${
              index + 1
            }: Multiple choice questions need at least 2 options`
          );
        }
        if (!question.correctAnswer) {
          errors.push(`Question ${index + 1}: Correct answer is required`);
        }
      }

      if (errors.length === 0) {
        processedQuestions.push({
          content: question.content.trim(),
          type: question.type,
          points,
          order: existingQuestionCount + index + 1,
          options: question.options || null,
          correctAnswer: question.correctAnswer?.trim() || null,
          explanation: question.explanation?.trim() || null,
          hints: Array.isArray(question.hints) ? question.hints : [],
          difficulty: question.difficulty || "MEDIUM",
          tags: Array.isArray(question.tags) ? question.tags : [],
          quizId,
        });
      } else {
        validationErrors.push(...errors);
      }
    });

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation errors found",
        errors: validationErrors,
        code: "VALIDATION_FAILED",
      });
    }

    const createdQuestions = await prisma.$transaction(async (tx) => {
      const results = [];

      for (const questionData of processedQuestions) {
        const question = await tx.question.create({
          data: questionData,
          select: {
            id: true,
            content: true,
            type: true,
            points: true,
            order: true,
            options: true,
            correctAnswer: true,
            explanation: true,
            hints: true,
            difficulty: true,
            tags: true,
            createdAt: true,
          },
        });
        results.push(question);
      }

      return results;
    });

    const totalPointsAfterAdd = await prisma.question.aggregate({
      where: { quizId },
      _sum: { points: true },
    });

    const totalPoints = totalPointsAfterAdd._sum.points || 0;
    const totalQuestions = existingQuestionCount + processedQuestions.length;
    const passingPoints = Math.ceil((quiz.passingScore / 100) * totalPoints);

    setImmediate(async () => {
      try {
        await clearContentCache(quiz.section.course.id);
      } catch (error) {
        console.warn("Cache cleanup failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: `${createdQuestions.length} questions added successfully`,
      data: {
        questions: createdQuestions,
        quizStats: {
          totalQuestions,
          totalPoints,
          passingPercentage: quiz.passingScore,
          passingPoints,
          questionsAdded: createdQuestions.length,
          description: `Students need ${passingPoints}/${totalPoints} points (${quiz.passingScore}%) to pass`,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`ADD_QUESTIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      quizId: req.params.quizId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to add questions",
      code: "ADD_QUESTIONS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const addQuizQuestion = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const {
      content,
      type,
      points = 1,
      options,
      correctAnswer,
      explanation,
      hints = [],
      difficulty = "MEDIUM",
      tags = [],
    } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!content || !type) {
      return res.status(400).json({
        success: false,
        message: "Question content and type are required",
        code: "VALIDATION_ERROR",
      });
    }

    const pointsInt = parseInt(points);
    if (pointsInt <= 0) {
      return res.status(400).json({
        success: false,
        message: "Points must be greater than 0",
        code: "INVALID_POINTS",
      });
    }

    const [quiz, questionCount] = await Promise.all([
      prisma.quiz.findUnique({
        where: { id: quizId },
        select: {
          id: true,
          passingScore: true,
          section: {
            select: {
              courseId: true,
              course: {
                select: {
                  id: true,
                  instructorId: true,
                },
              },
            },
          },
        },
      }),
      prisma.question.count({
        where: { quizId },
      }),
    ]);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
        code: "QUIZ_NOT_FOUND",
      });
    }

    if (quiz.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const newOrder = questionCount + 1;

    const question = await prisma.question.create({
      data: {
        content: content.trim(),
        type,
        points: pointsInt,
        order: newOrder,
        options: options || null,
        correctAnswer: correctAnswer?.trim(),
        explanation: explanation?.trim(),
        hints: Array.isArray(hints) ? hints : [],
        difficulty,
        tags: Array.isArray(tags) ? tags : [],
        quizId,
      },
      select: {
        id: true,
        content: true,
        type: true,
        points: true,
        order: true,
        options: true,
        correctAnswer: true,
        explanation: true,
        hints: true,
        difficulty: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const totalPointsAfterAdd = await prisma.question.aggregate({
      where: { quizId },
      _sum: { points: true },
    });

    const totalPoints = totalPointsAfterAdd._sum.points || 0;
    const passingPoints = Math.ceil((quiz.passingScore / 100) * totalPoints);

    setImmediate(async () => {
      try {
        await clearContentCache(quiz.section.course.id);
      } catch (error) {
        console.warn("Cache cleanup failed:", error);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Question added successfully",
      data: {
        question,
        quizStats: {
          totalQuestions: newOrder,
          totalPoints,
          passingPercentage: quiz.passingScore,
          passingPoints,
          description: `Students need ${passingPoints}/${totalPoints} points (${quiz.passingScore}%) to pass`,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`ADD_QUESTION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      quizId: req.params.quizId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to add question",
      code: "ADD_QUESTION_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateQuizQuestion = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { questionId } = req.params;
    const {
      content,
      type,
      points,
      options,
      correctAnswer,
      explanation,
      hints,
      difficulty,
      tags,
    } = req.body;
    const instructorId = req.instructorProfile.id;

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: {
          include: {
            section: {
              include: { course: true },
            },
            attempts: true,
          },
        },
      },
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        code: "QUESTION_NOT_FOUND",
      });
    }

    if (question.quiz.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    if (question.quiz.attempts.length > 0) {
      const restrictedFields = ["correctAnswer", "points", "type"];
      const hasRestrictedChanges = restrictedFields.some(
        (field) =>
          req.body[field] !== undefined && req.body[field] !== question[field]
      );

      if (hasRestrictedChanges) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot modify scoring-related fields for questions with existing attempts",
          code: "QUESTION_HAS_ATTEMPTS",
        });
      }
    }

    const updateData = {};
    if (content !== undefined) updateData.content = content.trim();
    if (type !== undefined) updateData.type = type;
    if (points !== undefined) updateData.points = parseInt(points);
    if (options !== undefined) updateData.options = options;
    if (correctAnswer !== undefined)
      updateData.correctAnswer = correctAnswer?.trim();
    if (explanation !== undefined) updateData.explanation = explanation?.trim();
    if (hints !== undefined) updateData.hints = hints;
    if (difficulty !== undefined) updateData.difficulty = difficulty;
    if (tags !== undefined) updateData.tags = tags;

    const updatedQuestion = await prisma.question.update({
      where: { id: questionId },
      data: updateData,
    });

    await clearContentCache(question.quiz.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Question updated successfully",
      data: { question: updatedQuestion },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_QUESTION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      questionId: req.params.questionId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update question",
      code: "UPDATE_QUESTION_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteQuizQuestion = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { questionId } = req.params;
    const instructorId = req.instructorProfile.id;

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        quiz: {
          include: {
            section: {
              include: { course: true },
            },
            attempts: true,
          },
        },
        answers: true,
      },
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        code: "QUESTION_NOT_FOUND",
      });
    }

    if (question.quiz.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    if (question.answers.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete question with student answers. Consider archiving instead.",
        code: "QUESTION_HAS_ANSWERS",
      });
    }

    await prisma.question.delete({
      where: { id: questionId },
    });

    const questionsToUpdate = await prisma.question.findMany({
      where: {
        quizId: question.quizId,
        order: { gt: question.order },
      },
    });

    if (questionsToUpdate.length > 0) {
      const updatePromises = questionsToUpdate.map((q) =>
        prisma.question.update({
          where: { id: q.id },
          data: { order: q.order - 1 },
        })
      );
      await Promise.all(updatePromises);
    }

    await clearContentCache(question.quiz.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Question deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_QUESTION_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      questionId: req.params.questionId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete question",
      code: "DELETE_QUESTION_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const reorderQuizQuestions = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const { questionIds } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Question IDs array is required",
        code: "VALIDATION_ERROR",
      });
    }

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        section: {
          include: { course: true },
        },
        questions: { select: { id: true } },
      },
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
        code: "QUIZ_NOT_FOUND",
      });
    }

    if (quiz.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const existingIds = quiz.questions.map((q) => q.id);
    const isValidReorder = questionIds.every((id) => existingIds.includes(id));

    if (!isValidReorder || questionIds.length !== existingIds.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid question IDs provided",
        code: "INVALID_QUESTION_IDS",
      });
    }

    const updatePromises = questionIds.map((questionId, index) =>
      prisma.question.update({
        where: { id: questionId },
        data: { order: index + 1 },
      })
    );

    await Promise.all(updatePromises);

    await clearContentCache(quiz.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Questions reordered successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`REORDER_QUESTIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      quizId: req.params.quizId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to reorder questions",
      code: "REORDER_QUESTIONS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const createAssignment = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { sectionId } = req.params;
    const {
      title,
      description,
      instructions,
      dueDate,
      totalPoints,
      resources,
      rubric,
      allowLateSubmission = false,
      latePenalty,
    } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!title || !description || !instructions || !totalPoints) {
      return res.status(400).json({
        success: false,
        message:
          "Title, description, instructions, and total points are required",
        code: "VALIDATION_ERROR",
      });
    }

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { course: true },
    });

    if (!section) {
      return res.status(404).json({
        success: false,
        message: "Section not found",
        code: "SECTION_NOT_FOUND",
      });
    }

    if (section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const lastAssignment = await prisma.assignment.findFirst({
      where: { sectionId },
      orderBy: { order: "desc" },
    });

    const newOrder = lastAssignment ? lastAssignment.order + 1 : 1;

    const assignment = await prisma.assignment.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        totalPoints: parseInt(totalPoints),
        order: newOrder,
        resources: resources || null,
        rubric: rubric || null,
        allowLateSubmission,
        latePenalty: latePenalty ? parseFloat(latePenalty) : null,
        sectionId,
      },
    });

    await clearContentCache(section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Assignment created successfully",
      data: { assignment },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CREATE_ASSIGNMENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      sectionId: req.params.sectionId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to create assignment",
      code: "CREATE_ASSIGNMENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { assignmentId } = req.params;
    const {
      title,
      description,
      instructions,
      dueDate,
      totalPoints,
      resources,
      rubric,
      allowLateSubmission,
      latePenalty,
    } = req.body;
    const instructorId = req.instructorProfile.id;

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        section: {
          include: { course: true },
        },
        submissions: true,
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found",
        code: "ASSIGNMENT_NOT_FOUND",
      });
    }

    if (assignment.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    if (assignment.submissions.length > 0) {
      const restrictedFields = ["totalPoints", "dueDate"];
      const hasRestrictedChanges = restrictedFields.some((field) => {
        if (field === "dueDate") {
          const newDate = dueDate ? new Date(dueDate) : null;
          const oldDate = assignment.dueDate;
          return newDate && oldDate && newDate.getTime() !== oldDate.getTime();
        }
        return (
          req.body[field] !== undefined && req.body[field] !== assignment[field]
        );
      });

      if (hasRestrictedChanges) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot modify scoring criteria or due date for assignment with submissions",
          code: "ASSIGNMENT_HAS_SUBMISSIONS",
        });
      }
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (instructions !== undefined)
      updateData.instructions = instructions.trim();
    if (dueDate !== undefined)
      updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (totalPoints !== undefined)
      updateData.totalPoints = parseInt(totalPoints);
    if (resources !== undefined) updateData.resources = resources;
    if (rubric !== undefined) updateData.rubric = rubric;
    if (allowLateSubmission !== undefined)
      updateData.allowLateSubmission = allowLateSubmission;
    if (latePenalty !== undefined)
      updateData.latePenalty = latePenalty ? parseFloat(latePenalty) : null;

    const updatedAssignment = await prisma.assignment.update({
      where: { id: assignmentId },
      data: updateData,
    });

    await clearContentCache(assignment.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Assignment updated successfully",
      data: { assignment: updatedAssignment },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_ASSIGNMENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      assignmentId: req.params.assignmentId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update assignment",
      code: "UPDATE_ASSIGNMENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { assignmentId } = req.params;
    const instructorId = req.instructorProfile.id;

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        section: {
          include: { course: true },
        },
        submissions: true,
      },
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found",
        code: "ASSIGNMENT_NOT_FOUND",
      });
    }

    if (assignment.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    if (assignment.submissions.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete assignment with student submissions. Consider archiving instead.",
        code: "ASSIGNMENT_HAS_SUBMISSIONS",
      });
    }

    await prisma.assignment.delete({
      where: { id: assignmentId },
    });

    const assignmentsToUpdate = await prisma.assignment.findMany({
      where: {
        sectionId: assignment.sectionId,
        order: { gt: assignment.order || 0 },
      },
    });

    if (assignmentsToUpdate.length > 0) {
      const updatePromises = assignmentsToUpdate.map((a) =>
        prisma.assignment.update({
          where: { id: a.id },
          data: { order: (a.order || 1) - 1 },
        })
      );
      await Promise.all(updatePromises);
    }

    await clearContentCache(assignment.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Assignment deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_ASSIGNMENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      assignmentId: req.params.assignmentId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete assignment",
      code: "DELETE_ASSIGNMENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const addLessonAttachment = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { lessonId } = req.params;
    const {
      name,
      fileUrl,
      fileSize,
      fileType,
      isDownloadable = true,
    } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!name || !fileUrl || !fileSize || !fileType) {
      return res.status(400).json({
        success: false,
        message: "Name, file URL, file size, and file type are required",
        code: "VALIDATION_ERROR",
      });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        section: {
          include: { course: true },
        },
      },
    });

    if (!lesson) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found",
        code: "LESSON_NOT_FOUND",
      });
    }

    if (lesson.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const attachment = await prisma.attachment.create({
      data: {
        name: name.trim(),
        fileUrl: fileUrl.trim(),
        fileSize: parseInt(fileSize),
        fileType: fileType.trim(),
        isDownloadable,
        lessonId,
      },
    });

    await clearContentCache(lesson.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(201).json({
      success: true,
      message: "Attachment added successfully",
      data: { attachment },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`ADD_ATTACHMENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      lessonId: req.params.lessonId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to add attachment",
      code: "ADD_ATTACHMENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const updateLessonAttachment = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { attachmentId } = req.params;
    const { name, isDownloadable } = req.body;
    const instructorId = req.instructorProfile.id;

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        lesson: {
          include: {
            section: {
              include: { course: true },
            },
          },
        },
      },
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
        code: "ATTACHMENT_NOT_FOUND",
      });
    }

    if (attachment.lesson.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (isDownloadable !== undefined)
      updateData.isDownloadable = isDownloadable;

    const updatedAttachment = await prisma.attachment.update({
      where: { id: attachmentId },
      data: updateData,
    });

    await clearContentCache(attachment.lesson.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Attachment updated successfully",
      data: { attachment: updatedAttachment },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`UPDATE_ATTACHMENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      attachmentId: req.params.attachmentId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to update attachment",
      code: "UPDATE_ATTACHMENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const deleteLessonAttachment = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { attachmentId } = req.params;
    const instructorId = req.instructorProfile.id;

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        lesson: {
          include: {
            section: {
              include: { course: true },
            },
          },
        },
      },
    });

    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: "Attachment not found",
        code: "ATTACHMENT_NOT_FOUND",
      });
    }

    if (attachment.lesson.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    try {
      if (attachment.fileUrl.includes("cloudinary.com")) {
        const publicId = attachment.fileUrl.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(publicId);
      }
    } catch (cloudinaryError) {
      console.error("Failed to delete file from cloudinary:", cloudinaryError);
    }

    await prisma.attachment.delete({
      where: { id: attachmentId },
    });

    await clearContentCache(attachment.lesson.section.course.id);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Attachment deleted successfully",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`DELETE_ATTACHMENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      attachmentId: req.params.attachmentId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to delete attachment",
      code: "DELETE_ATTACHMENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getContentStats = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const instructorId = req.instructorProfile.id;

    const hasAccess = await validateCourseOwnership(courseId, instructorId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const cacheKey = `content_stats:${courseId}`;
    let stats = await redisService.getJSON(cacheKey);

    if (!stats) {
      const [
        sectionsCount,
        lessonsCount,
        quizzesCount,
        assignmentsCount,
        totalDuration,
        publishedSections,
        freeLessons,
      ] = await Promise.all([
        prisma.section.count({ where: { courseId } }),
        prisma.lesson.count({
          where: { section: { courseId } },
        }),
        prisma.quiz.count({
          where: { section: { courseId } },
        }),
        prisma.assignment.count({
          where: { section: { courseId } },
        }),
        prisma.lesson.aggregate({
          where: { section: { courseId } },
          _sum: { duration: true },
        }),
        prisma.section.count({
          where: { courseId, isPublished: true },
        }),
        prisma.lesson.count({
          where: { section: { courseId }, isFree: true },
        }),
      ]);

      stats = {
        sections: {
          total: sectionsCount,
          published: publishedSections,
          draft: sectionsCount - publishedSections,
        },
        lessons: {
          total: lessonsCount,
          free: freeLessons,
          paid: lessonsCount - freeLessons,
        },
        quizzes: {
          total: quizzesCount,
        },
        assignments: {
          total: assignmentsCount,
        },
        duration: {
          totalMinutes: totalDuration._sum.duration || 0,
          totalHours: Math.round((totalDuration._sum.duration || 0) / 60),
        },
        completeness: {
          hasContent: sectionsCount > 0 && lessonsCount > 0,
          hasAssessments: quizzesCount > 0 || assignmentsCount > 0,
          readyForPublish: publishedSections > 0 && lessonsCount > 0,
        },
      };

      await redisService.setJSON(cacheKey, stats, { ex: 600 });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Content statistics retrieved successfully",
      data: { stats },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`CONTENT_STATS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve content statistics",
      code: "CONTENT_STATS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const validateCourseContent = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const instructorId = req.instructorProfile.id;

    const cacheKey = `course_content_validation:${courseId}`;
    const cachedResult = await redisService.getJSON(cacheKey);

    if (cachedResult) {
      const executionTime = performance.now() - startTime;
      return res.status(200).json({
        success: true,
        message: "Content validation completed",
        data: cachedResult,
        meta: {
          requestId,
          executionTime: Math.round(executionTime),
          timestamp: new Date().toISOString(),
          cached: true,
        },
      });
    }

    const hasAccess = await validateCourseOwnership(courseId, instructorId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const [
      sectionsData,
      lessonsData,
      quizzesData,
      questionsData,
      assignmentsData,
    ] = await Promise.all([
      prisma.section.findMany({
        where: { courseId },
        select: {
          id: true,
          title: true,
          isPublished: true,
          order: true,
        },
        orderBy: { order: "asc" },
      }),
      prisma.lesson.findMany({
        where: { section: { courseId } },
        select: {
          id: true,
          title: true,
          type: true,
          videoUrl: true,
          duration: true,
          isFree: true,
          isPreview: true,
          sectionId: true,
          order: true,
        },
        orderBy: [{ sectionId: "asc" }, { order: "asc" }],
      }),
      prisma.quiz.findMany({
        where: { section: { courseId } },
        select: {
          id: true,
          title: true,
          passingScore: true,
          sectionId: true,
          order: true,
        },
        orderBy: [{ sectionId: "asc" }, { order: "asc" }],
      }),
      prisma.question.findMany({
        where: { quiz: { section: { courseId } } },
        select: {
          id: true,
          type: true,
          options: true,
          correctAnswer: true,
          quizId: true,
          order: true,
        },
        orderBy: [{ quizId: "asc" }, { order: "asc" }],
      }),
      prisma.assignment.findMany({
        where: { section: { courseId } },
        select: {
          id: true,
          title: true,
          instructions: true,
          totalPoints: true,
          sectionId: true,
          order: true,
        },
        orderBy: [{ sectionId: "asc" }, { order: "asc" }],
      }),
    ]);

    const validationResults = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
    };

    if (sectionsData.length === 0) {
      validationResults.errors.push("Course must have at least one section");
      validationResults.isValid = false;
    }

    let totalLessons = lessonsData.length;
    let totalDuration = lessonsData.reduce(
      (sum, lesson) => sum + (lesson.duration || 0),
      0
    );
    let hasPublishedSection = sectionsData.some(
      (section) => section.isPublished
    );

    const sectionMap = new Map();
    sectionsData.forEach((section, index) => {
      sectionMap.set(section.id, {
        ...section,
        index: index + 1,
        lessons: [],
        quizzes: [],
        assignments: [],
      });
    });

    lessonsData.forEach((lesson) => {
      const section = sectionMap.get(lesson.sectionId);
      if (section) {
        section.lessons.push(lesson);
      }
    });

    quizzesData.forEach((quiz) => {
      const section = sectionMap.get(quiz.sectionId);
      if (section) {
        section.quizzes.push({ ...quiz, questions: [] });
      }
    });

    assignmentsData.forEach((assignment) => {
      const section = sectionMap.get(assignment.sectionId);
      if (section) {
        section.assignments.push(assignment);
      }
    });

    const quizMap = new Map();
    sectionMap.forEach((section) => {
      section.quizzes.forEach((quiz) => {
        quizMap.set(quiz.id, quiz);
      });
    });

    questionsData.forEach((question) => {
      const quiz = quizMap.get(question.quizId);
      if (quiz) {
        quiz.questions.push(question);
      }
    });

    sectionMap.forEach((section) => {
      if (section.lessons.length === 0) {
        validationResults.warnings.push(
          `Section "${section.title}" has no lessons`
        );
      }

      section.lessons.forEach((lesson, lessonIndex) => {
        if (!lesson.title || lesson.title.trim().length === 0) {
          validationResults.errors.push(
            `Section ${section.index}, Lesson ${lessonIndex + 1}: Missing title`
          );
          validationResults.isValid = false;
        }

        if (lesson.type === "VIDEO" && !lesson.videoUrl) {
          validationResults.errors.push(
            `Section ${section.index}, Lesson "${lesson.title}": Video lessons must have video URL`
          );
          validationResults.isValid = false;
        }

        if (lesson.duration && lesson.duration < 60) {
          validationResults.warnings.push(
            `Section ${section.index}, Lesson "${lesson.title}": Very short duration (${lesson.duration}s)`
          );
        }
      });

      section.quizzes.forEach((quiz) => {
        if (quiz.questions.length === 0) {
          validationResults.errors.push(
            `Section ${section.index}, Quiz "${quiz.title}": Must have at least one question`
          );
          validationResults.isValid = false;
        }

        if (quiz.passingScore > 100) {
          validationResults.errors.push(
            `Section ${section.index}, Quiz "${quiz.title}": Passing score cannot exceed 100%`
          );
          validationResults.isValid = false;
        }

        quiz.questions.forEach((question, questionIndex) => {
          if (question.type === "MULTIPLE_CHOICE" && !question.options) {
            validationResults.errors.push(
              `Section ${section.index}, Quiz "${quiz.title}", Question ${
                questionIndex + 1
              }: Multiple choice questions must have options`
            );
            validationResults.isValid = false;
          }

          if (!question.correctAnswer) {
            validationResults.errors.push(
              `Section ${section.index}, Quiz "${quiz.title}", Question ${
                questionIndex + 1
              }: Must have correct answer`
            );
            validationResults.isValid = false;
          }
        });
      });

      section.assignments.forEach((assignment) => {
        if (
          !assignment.instructions ||
          assignment.instructions.trim().length < 50
        ) {
          validationResults.warnings.push(
            `Section ${section.index}, Assignment "${assignment.title}": Instructions should be more detailed`
          );
        }

        if (assignment.totalPoints <= 0) {
          validationResults.errors.push(
            `Section ${section.index}, Assignment "${assignment.title}": Must have positive total points`
          );
          validationResults.isValid = false;
        }
      });
    });

    if (totalLessons === 0) {
      validationResults.errors.push("Course must have at least one lesson");
      validationResults.isValid = false;
    }

    if (!hasPublishedSection) {
      validationResults.warnings.push("No sections are published yet");
    }

    if (totalDuration < 1800) {
      validationResults.warnings.push(
        "Course is very short (less than 30 minutes total)"
      );
    }

    if (totalLessons < 5) {
      validationResults.suggestions.push(
        "Consider adding more lessons for better learning experience"
      );
    }

    const hasFreeContent = lessonsData.some(
      (lesson) => lesson.isFree || lesson.isPreview
    );

    if (!hasFreeContent) {
      validationResults.suggestions.push(
        "Consider making some lessons free or preview to attract students"
      );
    }

    const validationSummary = {
      totalSections: sectionsData.length,
      totalLessons,
      totalDuration: Math.round(totalDuration / 60),
      publishedSections: sectionsData.filter((s) => s.isPublished).length,
      readyForReview: validationResults.isValid && hasPublishedSection,
    };

    const result = {
      validation: validationResults,
      summary: validationSummary,
    };

    setImmediate(async () => {
      try {
        await redisService.setJSON(cacheKey, result, { ex: 900 });
      } catch (cacheError) {
        console.warn("Failed to cache validation result:", cacheError);
      }
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Content validation completed",
      data: result,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
        cached: false,
      },
    });
  } catch (error) {
    console.error(`VALIDATE_CONTENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to validate course content",
      code: "VALIDATE_CONTENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const invalidateCourseValidationCache = async (courseId) => {
  try {
    const patterns = [
      `course_content_validation:${courseId}`,
      `course_validation:${courseId}`,
      `course:${courseId}:*`,
    ];

    await Promise.all(
      patterns.map((pattern) => redisService.delPattern(pattern))
    );
  } catch (error) {
    console.warn("Cache invalidation failed:", error);
  }
};

export const publishAllSections = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const instructorId = req.instructorProfile.id;

    const hasAccess = await validateCourseOwnership(courseId, instructorId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { status: true },
    });

    if (course.status === "PUBLISHED") {
      return res.status(400).json({
        success: false,
        message: "Cannot modify content of published course",
        code: "COURSE_ALREADY_PUBLISHED",
      });
    }

    const sections = await prisma.section.findMany({
      where: { courseId },
      include: {
        lessons: true,
        quizzes: {
          include: { questions: true },
        },
        assignments: true,
      },
    });

    const sectionsWithContent = sections.filter(
      (section) =>
        section.lessons.length > 0 ||
        section.quizzes.some((quiz) => quiz.questions.length > 0) ||
        section.assignments.length > 0
    );

    if (sectionsWithContent.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No sections with content found to publish",
        code: "NO_CONTENT_TO_PUBLISH",
      });
    }

    await prisma.section.updateMany({
      where: {
        id: { in: sectionsWithContent.map((s) => s.id) },
      },
      data: { isPublished: true },
    });

    await clearContentCache(courseId);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: `Published ${sectionsWithContent.length} sections successfully`,
      data: {
        publishedSections: sectionsWithContent.length,
        totalSections: sections.length,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`PUBLISH_SECTIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to publish sections",
      code: "PUBLISH_SECTIONS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const exportCourseContent = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const instructorId = req.instructorProfile.id;
    const { format } = req.query;

    const hasAccess = await validateCourseOwnership(courseId, instructorId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const courseContent = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        sections: {
          orderBy: { order: "asc" },
          include: {
            lessons: {
              orderBy: { order: "asc" },
              include: {
                attachments: true,
              },
            },
            quizzes: {
              orderBy: { order: "asc" },
              include: {
                questions: {
                  orderBy: { order: "asc" },
                },
              },
            },
            assignments: {
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    if (format === "csv") {
      const csvRows = [
        "Section Title,Lesson Title,Lesson Type,Lesson Duration,Is Free,Is Preview",
      ];

      courseContent.sections.forEach((section) => {
        section.lessons.forEach((lesson) => {
          csvRows.push(
            [
              `"${section.title.replace(/"/g, '""')}"`,
              `"${lesson.title.replace(/"/g, '""')}"`,
              lesson.type,
              lesson.duration,
              lesson.isFree,
              lesson.isPreview,
            ].join(",")
          );
        });
      });

      const csvString = csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="course_${courseId}_export.csv"`
      );
      return res.send(csvString);
    }

    const exportData = {
      exportVersion: "1.0",
      exportDate: new Date().toISOString(),
      course: {
        title: courseContent.title,
        description: courseContent.description,
        shortDescription: courseContent.shortDescription,
        level: courseContent.level,
        language: courseContent.language,
        requirements: courseContent.requirements,
        learningOutcomes: courseContent.learningOutcomes,
        targetAudience: courseContent.targetAudience,
        keyPoints: courseContent.keyPoints,
        tags: courseContent.tags,
      },
      sections: courseContent.sections.map((section) => ({
        title: section.title,
        description: section.description,
        order: section.order,
        estimatedTime: section.estimatedTime,
        lessons: section.lessons.map((lesson) => ({
          title: lesson.title,
          description: lesson.description,
          type: lesson.type,
          duration: lesson.duration,
          content: lesson.content,
          transcript: lesson.transcript,
          resources: lesson.resources,
          isFree: lesson.isFree,
          isPreview: lesson.isPreview,
          order: lesson.order,
          attachments: lesson.attachments.map((a) => ({
            name: a.name,
            fileType: a.fileType,
            fileSize: a.fileSize,
            isDownloadable: a.isDownloadable,
          })),
        })),
        quizzes: section.quizzes.map((quiz) => ({
          title: quiz.title,
          description: quiz.description,
          instructions: quiz.instructions,
          duration: quiz.duration,
          passingScore: quiz.passingScore,
          maxAttempts: quiz.maxAttempts,
          isRequired: quiz.isRequired,
          isRandomized: quiz.isRandomized,
          showResults: quiz.showResults,
          allowReview: quiz.allowReview,
          order: quiz.order,
          questions: quiz.questions.map((question) => ({
            content: question.content,
            type: question.type,
            points: question.points,
            options: question.options,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
            hints: question.hints,
            difficulty: question.difficulty,
            tags: question.tags,
            order: question.order,
          })),
        })),
        assignments: section.assignments.map((assignment) => ({
          title: assignment.title,
          description: assignment.description,
          instructions: assignment.instructions,
          totalPoints: assignment.totalPoints,
          resources: assignment.resources,
          rubric: assignment.rubric,
          allowLateSubmission: assignment.allowLateSubmission,
          latePenalty: assignment.latePenalty,
          order: assignment.order,
        })),
      })),
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course content exported successfully",
      data: { exportData },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`EXPORT_CONTENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to export course content",
      code: "EXPORT_CONTENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const importCourseContent = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { importData, replaceExisting = false } = req.body;
    const instructorId = req.instructorProfile.id;

    if (!importData || !importData.sections) {
      return res.status(400).json({
        success: false,
        message: "Invalid import data format",
        code: "INVALID_IMPORT_DATA",
      });
    }

    const hasAccess = await validateCourseOwnership(courseId, instructorId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { status: true },
    });

    if (course.status === "PUBLISHED") {
      return res.status(400).json({
        success: false,
        message: "Cannot import content to published course",
        code: "COURSE_ALREADY_PUBLISHED",
      });
    }

    if (replaceExisting) {
      await prisma.section.deleteMany({
        where: { courseId },
      });
    }

    const existingSections = await prisma.section.findMany({
      where: { courseId },
      orderBy: { order: "desc" },
      take: 1,
    });

    let currentOrder =
      existingSections.length > 0 ? existingSections[0].order : 0;

    let importedSections = 0;
    let importedLessons = 0;
    let importedQuizzes = 0;
    let importedAssignments = 0;

    for (const sectionData of importData.sections) {
      currentOrder++;

      const section = await prisma.section.create({
        data: {
          title: sectionData.title,
          description: sectionData.description,
          order: currentOrder,
          estimatedTime: sectionData.estimatedTime,
          isPublished: false,
          courseId,
        },
      });

      importedSections++;

      if (sectionData.lessons) {
        for (let i = 0; i < sectionData.lessons.length; i++) {
          const lessonData = sectionData.lessons[i];
          await prisma.lesson.create({
            data: {
              title: lessonData.title,
              description: lessonData.description,
              type: lessonData.type,
              duration: lessonData.duration,
              content: lessonData.content,
              transcript: lessonData.transcript,
              resources: lessonData.resources,
              isFree: lessonData.isFree || false,
              isPreview: lessonData.isPreview || false,
              order: i + 1,
              sectionId: section.id,
            },
          });
          importedLessons++;
        }
      }

      if (sectionData.quizzes) {
        for (let i = 0; i < sectionData.quizzes.length; i++) {
          const quizData = sectionData.quizzes[i];
          const quiz = await prisma.quiz.create({
            data: {
              title: quizData.title,
              description: quizData.description,
              instructions: quizData.instructions,
              duration: quizData.duration,
              passingScore: quizData.passingScore,
              maxAttempts: quizData.maxAttempts || 1,
              isRequired: quizData.isRequired !== false,
              isRandomized: quizData.isRandomized || false,
              showResults: quizData.showResults !== false,
              allowReview: quizData.allowReview !== false,
              order: i + 1,
              sectionId: section.id,
            },
          });

          if (quizData.questions) {
            for (let j = 0; j < quizData.questions.length; j++) {
              const questionData = quizData.questions[j];
              await prisma.question.create({
                data: {
                  content: questionData.content,
                  type: questionData.type,
                  points: questionData.points || 1,
                  options: questionData.options,
                  correctAnswer: questionData.correctAnswer,
                  explanation: questionData.explanation,
                  hints: questionData.hints || [],
                  difficulty: questionData.difficulty || "MEDIUM",
                  tags: questionData.tags || [],
                  order: j + 1,
                  quizId: quiz.id,
                },
              });
            }
          }
          importedQuizzes++;
        }
      }

      if (sectionData.assignments) {
        for (let i = 0; i < sectionData.assignments.length; i++) {
          const assignmentData = sectionData.assignments[i];
          await prisma.assignment.create({
            data: {
              title: assignmentData.title,
              description: assignmentData.description,
              instructions: assignmentData.instructions,
              totalPoints: assignmentData.totalPoints,
              resources: assignmentData.resources,
              rubric: assignmentData.rubric,
              allowLateSubmission: assignmentData.allowLateSubmission || false,
              latePenalty: assignmentData.latePenalty,
              order: i + 1,
              sectionId: section.id,
            },
          });
          importedAssignments++;
        }
      }
    }

    await clearContentCache(courseId);

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course content imported successfully",
      data: {
        imported: {
          sections: importedSections,
          lessons: importedLessons,
          quizzes: importedQuizzes,
          assignments: importedAssignments,
        },
        replaceExisting,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`IMPORT_CONTENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to import course content",
      code: "IMPORT_CONTENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const previewContent = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const instructorId = req.instructorProfile.id;

    const hasAccess = await validateCourseOwnership(courseId, instructorId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const coursePreview = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        sections: {
          where: { isPublished: true },
          orderBy: { order: "asc" },
          include: {
            lessons: {
              where: {
                OR: [{ isFree: true }, { isPreview: true }],
              },
              orderBy: { order: "asc" },
              select: {
                id: true,
                title: true,
                description: true,
                type: true,
                duration: true,
                isFree: true,
                isPreview: true,
                videoUrl: true,
                order: true,
              },
            },
          },
        },
        instructor: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                profileImage: true,
              },
            },
          },
        },
      },
    });

    if (!coursePreview) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
        code: "COURSE_NOT_FOUND",
      });
    }

    const previewData = {
      course: {
        id: coursePreview.id,
        title: coursePreview.title,
        description: coursePreview.description,
        shortDescription: coursePreview.shortDescription,
        thumbnail: coursePreview.thumbnail,
        previewVideo: coursePreview.previewVideo,
        price: coursePreview.price,
        discountPrice: coursePreview.discountPrice,
        level: coursePreview.level,
        duration: coursePreview.duration,
        language: coursePreview.language,
        requirements: coursePreview.requirements,
        learningOutcomes: coursePreview.learningOutcomes,
        targetAudience: coursePreview.targetAudience,
        keyPoints: coursePreview.keyPoints,
        tags: coursePreview.tags,
        averageRating: coursePreview.averageRating,
        totalRatings: coursePreview.totalRatings,
        totalEnrollments: coursePreview.totalEnrollments,
        instructor: {
          name: `${coursePreview.instructor.user.firstName} ${coursePreview.instructor.user.lastName}`,
          profileImage: coursePreview.instructor.user.profileImage,
          rating: coursePreview.instructor.rating,
          totalStudents: coursePreview.instructor.totalStudents,
          expertise: coursePreview.instructor.expertise,
        },
      },
      previewSections: coursePreview.sections.map((section) => ({
        id: section.id,
        title: section.title,
        description: section.description,
        estimatedTime: section.estimatedTime,
        lessons: section.lessons,
      })),
      stats: {
        totalSections: coursePreview.sections.length,
        totalPreviewLessons: coursePreview.sections.reduce(
          (acc, section) => acc + section.lessons.length,
          0
        ),
        totalPreviewDuration: coursePreview.sections.reduce(
          (acc, section) =>
            acc +
            section.lessons.reduce(
              (lessonAcc, lesson) => lessonAcc + lesson.duration,
              0
            ),
          0
        ),
      },
    };

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course preview generated successfully",
      data: previewData,
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`PREVIEW_CONTENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to generate course preview",
      code: "PREVIEW_CONTENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const searchCourseContent = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const { q: searchTerm, type, sectionId } = req.query;
    const instructorId = req.instructorProfile.id;

    if (!searchTerm || searchTerm.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search term must be at least 2 characters long",
        code: "INVALID_SEARCH_TERM",
      });
    }

    const hasAccess = await validateCourseOwnership(courseId, instructorId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    const searchFilter = {
      section: { courseId },
    };

    if (sectionId) {
      searchFilter.section = sectionId;
    }

    const searchResults = {
      lessons: [],
      quizzes: [],
      assignments: [],
      questions: [],
    };

    if (!type || type === "lessons") {
      searchResults.lessons = await prisma.lesson.findMany({
        where: {
          ...searchFilter,
          OR: [
            { title: { contains: searchTerm, mode: "insensitive" } },
            { description: { contains: searchTerm, mode: "insensitive" } },
            { content: { contains: searchTerm, mode: "insensitive" } },
            { transcript: { contains: searchTerm, mode: "insensitive" } },
          ],
        },
        include: {
          section: {
            select: { title: true },
          },
        },
        orderBy: { order: "asc" },
      });
    }

    if (!type || type === "quizzes") {
      searchResults.quizzes = await prisma.quiz.findMany({
        where: {
          ...searchFilter,
          OR: [
            { title: { contains: searchTerm, mode: "insensitive" } },
            { description: { contains: searchTerm, mode: "insensitive" } },
            { instructions: { contains: searchTerm, mode: "insensitive" } },
          ],
        },
        include: {
          section: {
            select: { title: true },
          },
          questions: true,
        },
        orderBy: { order: "asc" },
      });
    }

    if (!type || type === "assignments") {
      searchResults.assignments = await prisma.assignment.findMany({
        where: {
          ...searchFilter,
          OR: [
            { title: { contains: searchTerm, mode: "insensitive" } },
            { description: { contains: searchTerm, mode: "insensitive" } },
            { instructions: { contains: searchTerm, mode: "insensitive" } },
          ],
        },
        include: {
          section: {
            select: { title: true },
          },
        },
        orderBy: { order: "asc" },
      });
    }

    if (!type || type === "questions") {
      searchResults.questions = await prisma.question.findMany({
        where: {
          quiz: searchFilter,
          OR: [
            { content: { contains: searchTerm, mode: "insensitive" } },
            { explanation: { contains: searchTerm, mode: "insensitive" } },
            { tags: { hasSome: [searchTerm] } },
          ],
        },
        include: {
          quiz: {
            select: {
              title: true,
              section: {
                select: { title: true },
              },
            },
          },
        },
        orderBy: { order: "asc" },
      });
    }

    const totalResults =
      searchResults.lessons.length +
      searchResults.quizzes.length +
      searchResults.assignments.length +
      searchResults.questions.length;

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Content search completed successfully",
      data: {
        searchTerm,
        results: searchResults,
        summary: {
          totalResults,
          lessons: searchResults.lessons.length,
          quizzes: searchResults.quizzes.length,
          assignments: searchResults.assignments.length,
          questions: searchResults.questions.length,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SEARCH_CONTENT_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      courseId: req.params.courseId,
      searchTerm: req.query.q,
      instructorId: req.instructorProfile?.id,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to search course content",
      code: "SEARCH_CONTENT_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const submitQuizAttempt = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const { answers } = req.body;
    const studentId = req.userAuthId;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "Answers are required",
        code: "MISSING_ANSWERS",
      });
    }

    const [quiz, student, existingAttempt] = await Promise.all([
      prisma.quiz.findUnique({
        where: { id: quizId },
        select: {
          id: true,
          title: true,
          passingScore: true,
          maxAttempts: true,
          duration: true,
          questions: {
            select: {
              id: true,
              content: true,
              type: true,
              points: true,
              correctAnswer: true,
              options: true,
            },
            orderBy: { order: "asc" },
          },
        },
      }),
      prisma.student.findUnique({
        where: { userId: studentId },
        select: { id: true },
      }),
      prisma.quizAttempt.findFirst({
        where: { quizId, studentId },
        orderBy: { attemptNumber: "desc" },
        select: { attemptNumber: true },
      }),
    ]);

    if (!quiz || !student) {
      return res.status(404).json({
        success: false,
        message: "Quiz or student not found",
        code: "NOT_FOUND",
      });
    }

    const attemptNumber = existingAttempt
      ? existingAttempt.attemptNumber + 1
      : 1;

    if (attemptNumber > quiz.maxAttempts) {
      return res.status(400).json({
        success: false,
        message: `Maximum attempts (${quiz.maxAttempts}) exceeded`,
        code: "MAX_ATTEMPTS_EXCEEDED",
      });
    }

    const processedAnswers = answers
      .map((answer) => {
        const question = quiz.questions.find((q) => q.id === answer.questionId);
        if (!question) return null;

        let isCorrect = false;
        let points = 0;

        switch (question.type) {
          case "MULTIPLE_CHOICE":
          case "SINGLE_CHOICE":
            isCorrect = answer.selectedOption === question.correctAnswer;
            break;
          case "TRUE_FALSE":
            isCorrect =
              answer.answer?.toLowerCase() ===
              question.correctAnswer?.toLowerCase();
            break;
          case "SHORT_ANSWER":
            isCorrect =
              answer.answer?.toLowerCase().trim() ===
              question.correctAnswer?.toLowerCase().trim();
            break;
          case "FILL_IN_BLANK":
            isCorrect =
              answer.answer?.toLowerCase().trim() ===
              question.correctAnswer?.toLowerCase().trim();
            break;
          default:
            isCorrect = false;
        }

        if (isCorrect) {
          points = question.points;
        }

        return {
          questionId: question.id,
          studentAnswer: answer.answer || answer.selectedOption,
          correctAnswer: question.correctAnswer,
          isCorrect,
          points,
          timeSpent: answer.timeSpent || 0,
        };
      })
      .filter(Boolean);

    const scoreResult = calculateQuizScore(
      processedAnswers,
      quiz.questions,
      quiz.passingScore
    );

    const quizAttempt = await prisma.$transaction(async (tx) => {
      const attempt = await tx.quizAttempt.create({
        data: {
          quizId,
          studentId: student.id,
          attemptNumber,
          startedAt: new Date(),
          submittedAt: new Date(),
          score: scoreResult.earnedPoints,
          percentage: scoreResult.percentage,
          isPassed: scoreResult.isPassed,
          attemptsRemaining: quiz.maxAttempts - attemptNumber,
          timeSpent: processedAnswers.reduce(
            (total, ans) => total + (ans.timeSpent || 0),
            0
          ),
          completedQuestions: processedAnswers.length,
          totalQuestions: quiz.questions.length,
          status: "SUBMITTED",
        },
      });

      const answerPromises = processedAnswers.map((answerData) =>
        tx.answer.create({
          data: {
            content: answerData.studentAnswer,
            isCorrect: answerData.isCorrect,
            points: answerData.points,
            timeSpent: answerData.timeSpent,
            questionId: answerData.questionId,
            attemptId: attempt.id,
          },
        })
      );

      await Promise.all(answerPromises);

      return attempt;
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: `Quiz ${
        scoreResult.isPassed ? "passed" : "failed"
      } successfully`,
      data: {
        attempt: {
          id: quizAttempt.id,
          attemptNumber: quizAttempt.attemptNumber,
          submittedAt: quizAttempt.submittedAt,
          timeSpent: quizAttempt.timeSpent,
        },
        score: {
          earnedPoints: scoreResult.earnedPoints,
          totalPoints: scoreResult.totalPoints,
          percentage: scoreResult.percentage,
          passingPercentage: scoreResult.passingPercentage,
          passingPoints: scoreResult.passingPoints,
          isPassed: scoreResult.isPassed,
          grade: scoreResult.isPassed ? "PASS" : "FAIL",
        },
        questions: {
          total: quiz.questions.length,
          completed: processedAnswers.length,
          correct: processedAnswers.filter((ans) => ans.isCorrect).length,
        },
        attempts: {
          current: attemptNumber,
          maximum: quiz.maxAttempts,
          remaining: quiz.maxAttempts - attemptNumber,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`SUBMIT_QUIZ_ERROR [${requestId}]:`, error);

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to submit quiz",
      code: "SUBMIT_QUIZ_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getQuizResults = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { attemptId } = req.params;
    const studentId = req.userAuthId;

    const quizAttempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          select: {
            id: true,
            title: true,
            passingScore: true,
            showResults: true,
            allowReview: true,
            questions: {
              select: {
                id: true,
                content: true,
                type: true,
                points: true,
                correctAnswer: true,
                explanation: true,
                options: true,
              },
              orderBy: { order: "asc" },
            },
          },
        },
        answers: {
          select: {
            id: true,
            content: true,
            isCorrect: true,
            points: true,
            timeSpent: true,
            questionId: true,
          },
        },
        student: {
          select: { userId: true },
        },
      },
    });

    if (!quizAttempt || quizAttempt.student.userId !== studentId) {
      return res.status(404).json({
        success: false,
        message: "Quiz attempt not found",
        code: "ATTEMPT_NOT_FOUND",
      });
    }

    if (!quizAttempt.quiz.showResults) {
      return res.status(403).json({
        success: false,
        message: "Results are not available for this quiz",
        code: "RESULTS_HIDDEN",
      });
    }

    const scoreResult = calculateQuizScore(
      quizAttempt.answers,
      quizAttempt.quiz.questions,
      quizAttempt.quiz.passingScore
    );

    const detailedResults = quizAttempt.quiz.questions.map((question) => {
      const studentAnswer = quizAttempt.answers.find(
        (ans) => ans.questionId === question.id
      );

      return {
        questionId: question.id,
        content: question.content,
        type: question.type,
        points: question.points,
        studentAnswer: studentAnswer?.content || null,
        correctAnswer: quizAttempt.quiz.allowReview
          ? question.correctAnswer
          : null,
        isCorrect: studentAnswer?.isCorrect || false,
        pointsEarned: studentAnswer?.points || 0,
        explanation: quizAttempt.quiz.allowReview ? question.explanation : null,
        timeSpent: studentAnswer?.timeSpent || 0,
      };
    });

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Quiz results retrieved successfully",
      data: {
        attempt: {
          id: quizAttempt.id,
          attemptNumber: quizAttempt.attemptNumber,
          submittedAt: quizAttempt.submittedAt,
          timeSpent: quizAttempt.timeSpent,
          status: quizAttempt.status,
        },
        quiz: {
          id: quizAttempt.quiz.id,
          title: quizAttempt.quiz.title,
        },
        score: {
          earnedPoints: scoreResult.earnedPoints,
          totalPoints: scoreResult.totalPoints,
          percentage: scoreResult.percentage,
          passingPercentage: scoreResult.passingPercentage,
          passingPoints: scoreResult.passingPoints,
          isPassed: scoreResult.isPassed,
          grade: scoreResult.isPassed ? "PASS" : "FAIL",
        },
        questions: detailedResults,
        summary: {
          totalQuestions: quizAttempt.quiz.questions.length,
          correctAnswers: detailedResults.filter((q) => q.isCorrect).length,
          incorrectAnswers: detailedResults.filter((q) => !q.isCorrect).length,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_QUIZ_RESULTS_ERROR [${requestId}]:`, error);

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to get quiz results",
      code: "GET_RESULTS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const calculateQuizScore = (
  studentAnswers,
  questions,
  passingPercentage
) => {
  let totalPoints = 0;
  let earnedPoints = 0;

  questions.forEach((question) => {
    totalPoints += question.points;

    const studentAnswer = studentAnswers.find(
      (answer) => answer.questionId === question.id
    );
    if (studentAnswer && studentAnswer.isCorrect) {
      earnedPoints += question.points;
    }
  });

  const percentage = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
  const passingPoints = Math.ceil((passingPercentage / 100) * totalPoints);
  const isPassed = earnedPoints >= passingPoints;

  return {
    totalPoints,
    earnedPoints,
    percentage: Math.round(percentage * 100) / 100,
    passingPercentage,
    passingPoints,
    isPassed,
  };
};

export const getQuizDetails = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const studentId = req.userAuthId;

    const [quiz, student, previousAttempts] = await Promise.all([
      prisma.quiz.findUnique({
        where: { id: quizId },
        select: {
          id: true,
          title: true,
          description: true,
          instructions: true,
          duration: true,
          passingScore: true,
          maxAttempts: true,
          isRequired: true,
          isRandomized: true,
          showResults: true,
          allowReview: true,
          questions: {
            select: {
              id: true,
              content: true,
              type: true,
              points: true,
              options: true,
              hints: true,
              difficulty: true,
              order: true,
            },
            orderBy: { order: "asc" },
          },
          section: {
            select: {
              id: true,
              title: true,
              course: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
        },
      }),
      prisma.student.findUnique({
        where: { userId: studentId },
        select: { id: true },
      }),
      prisma.quizAttempt.findMany({
        where: { quizId, studentId },
        select: {
          id: true,
          attemptNumber: true,
          score: true,
          percentage: true,
          isPassed: true,
          submittedAt: true,
          status: true,
        },
        orderBy: { attemptNumber: "desc" },
      }),
    ]);

    if (!quiz || !student) {
      return res.status(404).json({
        success: false,
        message: "Quiz or student not found",
        code: "NOT_FOUND",
      });
    }

    const totalPoints = quiz.questions.reduce((sum, q) => sum + q.points, 0);
    const passingPoints = Math.ceil((quiz.passingScore / 100) * totalPoints);
    const attemptsUsed = previousAttempts.length;
    const canAttempt = attemptsUsed < quiz.maxAttempts;
    const bestAttempt =
      previousAttempts.length > 0
        ? previousAttempts.reduce((best, current) =>
            current.percentage > best.percentage ? current : best
          )
        : null;

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Quiz details retrieved successfully",
      data: {
        quiz: {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          instructions: quiz.instructions,
          duration: quiz.duration,
          passingScore: quiz.passingScore,
          maxAttempts: quiz.maxAttempts,
          isRequired: quiz.isRequired,
          isRandomized: quiz.isRandomized,
          showResults: quiz.showResults,
          allowReview: quiz.allowReview,
        },
        questions: quiz.questions.map((q) => ({
          id: q.id,
          content: q.content,
          type: q.type,
          points: q.points,
          options: q.options,
          hints: q.hints,
          difficulty: q.difficulty,
          order: q.order,
        })),
        scoring: {
          totalQuestions: quiz.questions.length,
          totalPoints,
          passingPoints,
          passingPercentage: quiz.passingScore,
        },
        attempts: {
          used: attemptsUsed,
          maximum: quiz.maxAttempts,
          remaining: quiz.maxAttempts - attemptsUsed,
          canAttempt,
        },
        previousAttempts,
        bestAttempt,
        section: quiz.section,
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_QUIZ_DETAILS_ERROR [${requestId}]:`, error);

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to get quiz details",
      code: "GET_QUIZ_DETAILS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getQuizAttempts = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const {
      page = 1,
      limit = 20,
      status,
      sortBy = "submittedAt",
      sortOrder = "desc",
    } = req.query;
    const instructorId = req.instructorProfile.id;

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: {
        id: true,
        title: true,
        section: {
          select: {
            course: {
              select: {
                instructorId: true,
              },
            },
          },
        },
      },
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
        code: "QUIZ_NOT_FOUND",
      });
    }

    if (quiz.section.course.instructorId !== instructorId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You don't own this course.",
        code: "COURSE_ACCESS_DENIED",
      });
    }

    let whereClause = { quizId };
    if (status) whereClause.status = status;

    const orderBy = {};
    const validSortFields = [
      "submittedAt",
      "score",
      "percentage",
      "attemptNumber",
    ];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "submittedAt";
    orderBy[sortField] = sortOrder === "asc" ? "asc" : "desc";

    const [attempts, total, stats] = await Promise.all([
      prisma.quizAttempt.findMany({
        where: whereClause,
        include: {
          student: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  profileImage: true,
                },
              },
            },
          },
          answers: {
            select: {
              isCorrect: true,
              points: true,
            },
          },
        },
        orderBy,
        skip,
        take: pageSize,
      }),
      prisma.quizAttempt.count({ where: whereClause }),
      prisma.quizAttempt.aggregate({
        where: whereClause,
        _avg: { percentage: true, score: true },
        _max: { percentage: true, score: true },
        _min: { percentage: true, score: true },
      }),
    ]);

    const passedCount = attempts.filter((attempt) => attempt.isPassed).length;
    const failedCount = attempts.filter((attempt) => !attempt.isPassed).length;

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Quiz attempts retrieved successfully",
      data: {
        quiz: {
          id: quiz.id,
          title: quiz.title,
        },
        attempts: attempts.map((attempt) => ({
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          student: {
            id: attempt.student.id,
            name: `${attempt.student.user.firstName} ${attempt.student.user.lastName}`,
            email: attempt.student.user.email,
            profileImage: attempt.student.user.profileImage,
          },
          score: attempt.score,
          percentage: attempt.percentage,
          isPassed: attempt.isPassed,
          status: attempt.status,
          submittedAt: attempt.submittedAt,
          timeSpent: attempt.timeSpent,
          correctAnswers: attempt.answers.filter((ans) => ans.isCorrect).length,
          totalQuestions: attempt.answers.length,
        })),
        pagination: {
          page: pageNumber,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
          hasNext: skip + pageSize < total,
          hasPrev: pageNumber > 1,
        },
        statistics: {
          totalAttempts: total,
          passedAttempts: passedCount,
          failedAttempts: failedCount,
          passRate: total > 0 ? Math.round((passedCount / total) * 100) : 0,
          averageScore: stats._avg.score
            ? Math.round(stats._avg.score * 100) / 100
            : 0,
          averagePercentage: stats._avg.percentage
            ? Math.round(stats._avg.percentage * 100) / 100
            : 0,
          highestScore: stats._max.score || 0,
          lowestScore: stats._min.score || 0,
          highestPercentage: stats._max.percentage || 0,
          lowestPercentage: stats._min.percentage || 0,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_QUIZ_ATTEMPTS_ERROR [${requestId}]:`, error);

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to get quiz attempts",
      code: "GET_QUIZ_ATTEMPTS_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getCourseSections = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { courseId } = req.params;
    const {
      page = 1,
      limit = 50,
      sortBy = "order",
      sortOrder = "asc",
    } = req.query;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
        code: "MISSING_COURSE_ID",
      });
    }

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const [instructor, course, sections, total] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      }),
      prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, instructorId: true, title: true },
      }),
      prisma.section.findMany({
        where: { courseId },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
        select: {
          id: true,
          title: true,
          description: true,
          order: true,
          isPublished: true,
          isRequired: true,
          isFree: true,
          estimatedTime: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              lessons: true,
              quizzes: true,
              assignments: true,
              contentItems: true,
            },
          },
        },
      }),
      prisma.section.count({ where: { courseId } }),
    ]);

    if (!instructor || !course || course.instructorId !== instructor.id) {
      return res.status(404).json({
        success: false,
        message: "Course not found or you don't have permission to access it",
        code: "COURSE_NOT_FOUND",
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Course sections retrieved successfully",
      data: {
        course: {
          id: course.id,
          title: course.title,
        },
        sections: sections.map((section) => ({
          id: section.id,
          title: section.title,
          description: section.description,
          order: section.order,
          isPublished: section.isPublished,
          isRequired: section.isRequired,
          isFree: section.isFree,
          estimatedTime: section.estimatedTime,
          createdAt: section.createdAt,
          updatedAt: section.updatedAt,
          stats: {
            lessonsCount: section._count.lessons,
            quizzesCount: section._count.quizzes,
            assignmentsCount: section._count.assignments,
            contentItemsCount: section._count.contentItems,
          },
        })),
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
    console.error(`GET_COURSE_SECTIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      courseId: req.params.courseId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve course sections",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSectionQuizzes = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { sectionId } = req.params;
    const {
      page = 1,
      limit = 50,
      sortBy = "order",
      sortOrder = "asc",
    } = req.query;

    if (!sectionId) {
      return res.status(400).json({
        success: false,
        message: "Section ID is required",
        code: "MISSING_SECTION_ID",
      });
    }

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const [instructor, section, quizzes, total] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      }),
      prisma.section.findUnique({
        where: { id: sectionId },
        select: {
          id: true,
          title: true,
          course: {
            select: { id: true, title: true, instructorId: true },
          },
        },
      }),
      prisma.quiz.findMany({
        where: { sectionId },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
        select: {
          id: true,
          title: true,
          description: true,
          instructions: true,
          duration: true,
          passingScore: true,
          maxAttempts: true,
          order: true,
          isRequired: true,
          isRandomized: true,
          showResults: true,
          allowReview: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              questions: true,
              attempts: true,
            },
          },
        },
      }),
      prisma.quiz.count({ where: { sectionId } }),
    ]);

    if (
      !instructor ||
      !section ||
      section.course.instructorId !== instructor.id
    ) {
      return res.status(404).json({
        success: false,
        message: "Section not found or you don't have permission to access it",
        code: "SECTION_NOT_FOUND",
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Section quizzes retrieved successfully",
      data: {
        section: {
          id: section.id,
          title: section.title,
        },
        course: {
          id: section.course.id,
          title: section.course.title,
        },
        quizzes: quizzes.map((quiz) => ({
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          instructions: quiz.instructions,
          duration: quiz.duration,
          passingScore: quiz.passingScore,
          maxAttempts: quiz.maxAttempts,
          order: quiz.order,
          isRequired: quiz.isRequired,
          isRandomized: quiz.isRandomized,
          showResults: quiz.showResults,
          allowReview: quiz.allowReview,
          createdAt: quiz.createdAt,
          updatedAt: quiz.updatedAt,
          stats: {
            questionsCount: quiz._count.questions,
            attemptsCount: quiz._count.attempts,
          },
        })),
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
    console.error(`GET_SECTION_QUIZZES_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      sectionId: req.params.sectionId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve section quizzes",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSectionLessons = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { sectionId } = req.params;
    const {
      page = 1,
      limit = 50,
      sortBy = "order",
      sortOrder = "asc",
    } = req.query;

    if (!sectionId) {
      return res.status(400).json({
        success: false,
        message: "Section ID is required",
        code: "MISSING_SECTION_ID",
      });
    }

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const [instructor, section, lessons, total] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      }),
      prisma.section.findUnique({
        where: { id: sectionId },
        select: {
          id: true,
          title: true,
          course: {
            select: { id: true, title: true, instructorId: true },
          },
        },
      }),
      prisma.lesson.findMany({
        where: { sectionId },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
        select: {
          id: true,
          title: true,
          description: true,
          order: true,
          duration: true,
          isFree: true,
          isPreview: true,
          type: true,
          videoUrl: true,
          transcript: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              attachments: true,
              completions: true,
              notes: true,
              bookmarks: true,
            },
          },
        },
      }),
      prisma.lesson.count({ where: { sectionId } }),
    ]);

    if (
      !instructor ||
      !section ||
      section.course.instructorId !== instructor.id
    ) {
      return res.status(404).json({
        success: false,
        message: "Section not found or you don't have permission to access it",
        code: "SECTION_NOT_FOUND",
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Section lessons retrieved successfully",
      data: {
        section: {
          id: section.id,
          title: section.title,
        },
        course: {
          id: section.course.id,
          title: section.course.title,
        },
        lessons: lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          order: lesson.order,
          duration: lesson.duration,
          isFree: lesson.isFree,
          isPreview: lesson.isPreview,
          type: lesson.type,
          hasVideo: !!lesson.videoUrl,
          hasTranscript: !!lesson.transcript,
          createdAt: lesson.createdAt,
          updatedAt: lesson.updatedAt,
          stats: {
            attachmentsCount: lesson._count.attachments,
            completionsCount: lesson._count.completions,
            notesCount: lesson._count.notes,
            bookmarksCount: lesson._count.bookmarks,
          },
        })),
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
    console.error(`GET_SECTION_LESSONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      sectionId: req.params.sectionId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve section lessons",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getQuizQuestions = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const {
      page = 1,
      limit = 50,
      sortBy = "order",
      sortOrder = "asc",
    } = req.query;

    if (!quizId) {
      return res.status(400).json({
        success: false,
        message: "Quiz ID is required",
        code: "MISSING_QUIZ_ID",
      });
    }

    const pageSize = Math.min(parseInt(limit), 100);
    const pageNumber = Math.max(parseInt(page), 1);
    const skip = (pageNumber - 1) * pageSize;

    const [instructor, quiz, questions, total] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      }),
      prisma.quiz.findUnique({
        where: { id: quizId },
        select: {
          id: true,
          title: true,
          description: true,
          duration: true,
          passingScore: true,
          section: {
            select: {
              id: true,
              title: true,
              course: {
                select: { id: true, title: true, instructorId: true },
              },
            },
          },
        },
      }),
      prisma.question.findMany({
        where: { quizId },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
        select: {
          id: true,
          content: true,
          type: true,
          points: true,
          order: true,
          options: true,
          correctAnswer: true,
          explanation: true,
          hints: true,
          difficulty: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              answers: true,
            },
          },
        },
      }),
      prisma.question.count({ where: { quizId } }),
    ]);

    if (
      !instructor ||
      !quiz ||
      quiz.section.course.instructorId !== instructor.id
    ) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found or you don't have permission to access it",
        code: "QUIZ_NOT_FOUND",
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Quiz questions retrieved successfully",
      data: {
        quiz: {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          duration: quiz.duration,
          passingScore: quiz.passingScore,
        },
        section: {
          id: quiz.section.id,
          title: quiz.section.title,
        },
        course: {
          id: quiz.section.course.id,
          title: quiz.section.course.title,
        },
        questions: questions.map((question) => ({
          id: question.id,
          content: question.content,
          type: question.type,
          points: question.points,
          order: question.order,
          options: question.options,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          hints: question.hints,
          difficulty: question.difficulty,
          tags: question.tags,
          createdAt: question.createdAt,
          updatedAt: question.updatedAt,
          stats: {
            answersCount: question._count.answers,
          },
        })),
        pagination: {
          page: pageNumber,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
          hasNext: skip + pageSize < total,
          hasPrev: pageNumber > 1,
        },
        summary: {
          totalQuestions: total,
          totalPoints: questions.reduce((sum, q) => sum + q.points, 0),
          difficultyDistribution: questions.reduce((acc, q) => {
            acc[q.difficulty] = (acc[q.difficulty] || 0) + 1;
            return acc;
          }, {}),
          questionTypes: questions.reduce((acc, q) => {
            acc[q.type] = (acc[q.type] || 0) + 1;
            return acc;
          }, {}),
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_QUIZ_QUESTIONS_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      quizId: req.params.quizId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve quiz questions",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSingleLesson = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { lessonId } = req.params;

    if (!lessonId) {
      return res.status(400).json({
        success: false,
        message: "Lesson ID is required",
        code: "MISSING_LESSON_ID",
      });
    }

    const [instructor, lesson] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      }),
      prisma.lesson.findUnique({
        where: { id: lessonId },
        select: {
          id: true,
          title: true,
          description: true,
          order: true,
          duration: true,
          isFree: true,
          isPreview: true,
          type: true,
          content: true,
          videoUrl: true,
          videoQuality: true,
          captions: true,
          transcript: true,
          resources: true,
          createdAt: true,
          updatedAt: true,
          section: {
            select: {
              id: true,
              title: true,
              course: {
                select: {
                  id: true,
                  title: true,
                  instructorId: true,
                },
              },
            },
          },
          attachments: {
            select: {
              id: true,
              name: true,
              fileUrl: true,
              fileSize: true,
              fileType: true,
              isDownloadable: true,
              createdAt: true,
            },
          },
          postLessonQuiz: {
            select: {
              id: true,
              title: true,
              duration: true,
              passingScore: true,
              maxAttempts: true,
            },
          },
          _count: {
            select: {
              completions: true,
              notes: true,
              bookmarks: true,
            },
          },
        },
      }),
    ]);

    if (
      !instructor ||
      !lesson ||
      lesson.section.course.instructorId !== instructor.id
    ) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found or you don't have permission to access it",
        code: "LESSON_NOT_FOUND",
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Lesson retrieved successfully",
      data: {
        lesson: {
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          order: lesson.order,
          duration: lesson.duration,
          isFree: lesson.isFree,
          isPreview: lesson.isPreview,
          type: lesson.type,
          content: lesson.content,
          videoUrl: lesson.videoUrl,
          videoQuality: lesson.videoQuality,
          captions: lesson.captions,
          transcript: lesson.transcript,
          resources: lesson.resources,
          createdAt: lesson.createdAt,
          updatedAt: lesson.updatedAt,
          attachments: lesson.attachments,
          postLessonQuiz: lesson.postLessonQuiz,
          stats: {
            completionsCount: lesson._count.completions,
            notesCount: lesson._count.notes,
            bookmarksCount: lesson._count.bookmarks,
          },
        },
        section: {
          id: lesson.section.id,
          title: lesson.section.title,
        },
        course: {
          id: lesson.section.course.id,
          title: lesson.section.course.title,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_SINGLE_LESSON_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      lessonId: req.params.lessonId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve lesson",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export const getSingleQuiz = asyncHandler(async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const { quizId } = req.params;
    const { includeQuestions = "false" } = req.query;

    if (!quizId) {
      return res.status(400).json({
        success: false,
        message: "Quiz ID is required",
        code: "MISSING_QUIZ_ID",
      });
    }

    const shouldIncludeQuestions = includeQuestions === "true";

    const [instructor, quiz] = await Promise.all([
      prisma.instructor.findUnique({
        where: { userId: req.userAuthId },
        select: { id: true },
      }),
      prisma.quiz.findUnique({
        where: { id: quizId },
        select: {
          id: true,
          title: true,
          description: true,
          instructions: true,
          duration: true,
          passingScore: true,
          maxAttempts: true,
          order: true,
          isRequired: true,
          isRandomized: true,
          showResults: true,
          allowReview: true,
          createdAt: true,
          updatedAt: true,
          section: {
            select: {
              id: true,
              title: true,
              course: {
                select: {
                  id: true,
                  title: true,
                  instructorId: true,
                },
              },
            },
          },
          questions: shouldIncludeQuestions
            ? {
                select: {
                  id: true,
                  content: true,
                  type: true,
                  points: true,
                  order: true,
                  options: true,
                  correctAnswer: true,
                  explanation: true,
                  hints: true,
                  difficulty: true,
                  tags: true,
                  createdAt: true,
                  updatedAt: true,
                },
                orderBy: { order: "asc" },
              }
            : false,
          _count: {
            select: {
              questions: true,
              attempts: true,
            },
          },
        },
      }),
    ]);

    if (
      !instructor ||
      !quiz ||
      quiz.section.course.instructorId !== instructor.id
    ) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found or you don't have permission to access it",
        code: "QUIZ_NOT_FOUND",
      });
    }

    const executionTime = performance.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Quiz retrieved successfully",
      data: {
        quiz: {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          instructions: quiz.instructions,
          duration: quiz.duration,
          passingScore: quiz.passingScore,
          maxAttempts: quiz.maxAttempts,
          order: quiz.order,
          isRequired: quiz.isRequired,
          isRandomized: quiz.isRandomized,
          showResults: quiz.showResults,
          allowReview: quiz.allowReview,
          createdAt: quiz.createdAt,
          updatedAt: quiz.updatedAt,
          questions: shouldIncludeQuestions ? quiz.questions : undefined,
          stats: {
            questionsCount: quiz._count.questions,
            attemptsCount: quiz._count.attempts,
          },
        },
        section: {
          id: quiz.section.id,
          title: quiz.section.title,
        },
        course: {
          id: quiz.section.course.id,
          title: quiz.section.course.title,
        },
      },
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`GET_SINGLE_QUIZ_ERROR [${requestId}]:`, {
      error: error.message,
      stack: error.stack,
      userId: req.userAuthId,
      quizId: req.params.quizId,
    });

    const executionTime = performance.now() - startTime;

    res.status(500).json({
      success: false,
      message: "Failed to retrieve quiz",
      code: "INTERNAL_SERVER_ERROR",
      meta: {
        requestId,
        executionTime: Math.round(executionTime),
        timestamp: new Date().toISOString(),
      },
    });
  }
});
