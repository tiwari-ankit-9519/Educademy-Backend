import Queue from "bull";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let courseCountQueue;

const initializeQueue = () => {
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    console.warn(
      "UPSTASH_REDIS_REST_URL not configured, background jobs disabled"
    );
    return null;
  }

  try {
    return new Queue(
      "course count updates",
      process.env.UPSTASH_REDIS_REST_URL
    );
  } catch (error) {
    console.warn("Failed to initialize background job queue:", error.message);
    return null;
  }
};

const recalculateCourseCountsJob = async (job) => {
  const { courseId, operation, entityType } = job.data;

  try {
    console.log(
      `Processing ${operation} for ${entityType} on course ${courseId}`
    );

    await prisma.$transaction(async (tx) => {
      const course = await tx.course.findUnique({
        where: { id: courseId },
        select: { id: true },
      });

      if (!course) {
        console.log(`Course ${courseId} not found, skipping count update`);
        return;
      }

      const [
        sectionsCount,
        publishedSectionsCount,
        enrollmentsCount,
        reviewsCount,
      ] = await Promise.all([
        tx.section.count({ where: { courseId } }),
        tx.section.count({ where: { courseId, isPublished: true } }),
        tx.enrollment.count({ where: { courseId } }),
        tx.review.count({ where: { courseId } }),
      ]);

      await tx.course.update({
        where: { id: courseId },
        data: {
          sectionsCount,
          publishedSectionsCount,
          enrollmentsCount,
          reviewsCount,
          updatedAt: new Date(),
        },
      });
    });

    console.log(`Successfully updated counts for course ${courseId}`);
  } catch (error) {
    console.error(`Error updating course counts for ${courseId}:`, error);
    throw error;
  }
};

const batchRecalculateAllCounts = async (job) => {
  const { batchSize = 50, offset = 0 } = job.data;

  try {
    console.log(`Processing batch: offset ${offset}, size ${batchSize}`);

    const courses = await prisma.course.findMany({
      select: { id: true },
      skip: offset,
      take: batchSize,
      orderBy: { createdAt: "asc" },
    });

    if (courses.length === 0) {
      console.log("No more courses to process");
      return;
    }

    for (const course of courses) {
      const [
        sectionsCount,
        publishedSectionsCount,
        enrollmentsCount,
        reviewsCount,
      ] = await Promise.all([
        prisma.section.count({ where: { courseId: course.id } }),
        prisma.section.count({
          where: { courseId: course.id, isPublished: true },
        }),
        prisma.enrollment.count({ where: { courseId: course.id } }),
        prisma.review.count({ where: { courseId: course.id } }),
      ]);

      await prisma.course.update({
        where: { id: course.id },
        data: {
          sectionsCount,
          publishedSectionsCount,
          enrollmentsCount,
          reviewsCount,
        },
      });
    }

    console.log(`Updated ${courses.length} courses in batch`);

    if (courses.length === batchSize && courseCountQueue) {
      await courseCountQueue.add(
        "batch-recalculate",
        {
          batchSize,
          offset: offset + batchSize,
        },
        {
          delay: 2000,
        }
      );
    }
  } catch (error) {
    console.error(`Error in batch recalculation at offset ${offset}:`, error);
    throw error;
  }
};

const addCourseCountUpdate = async (courseId, operation, entityType) => {
  if (!courseCountQueue) return;

  try {
    await courseCountQueue.add(
      "recalculate-single",
      {
        courseId,
        operation,
        entityType,
      },
      {
        delay: 5000,
        removeOnComplete: 10,
        removeOnFail: 5,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      }
    );
  } catch (error) {
    console.error("Failed to queue count update:", error);
  }
};

const startBatchRecalculation = async () => {
  if (!courseCountQueue) return;

  try {
    await courseCountQueue.add("batch-recalculate", {
      batchSize: 50,
      offset: 0,
    });
    console.log("Started batch recalculation job");
  } catch (error) {
    console.error("Failed to start batch recalculation:", error);
  }
};

const cleanupOldJobs = async () => {
  if (!courseCountQueue) return;

  try {
    await courseCountQueue.clean(24 * 60 * 60 * 1000, "completed");
    await courseCountQueue.clean(7 * 24 * 60 * 60 * 1000, "failed");
    console.log("Cleaned up old jobs");
  } catch (error) {
    console.error("Error cleaning up jobs:", error);
  }
};

const triggerCountUpdate = {
  onSectionChange: async (courseId) => {
    await addCourseCountUpdate(courseId, "section_change", "section");
  },

  onEnrollmentChange: async (courseId) => {
    await addCourseCountUpdate(courseId, "enrollment_change", "enrollment");
  },

  onReviewChange: async (courseId) => {
    await addCourseCountUpdate(courseId, "review_change", "review");
  },
};

const scheduleCountMaintenance = async () => {
  if (!courseCountQueue) return;

  const cron = await import("node-cron");

  cron.schedule("0 2 * * *", async () => {
    console.log("Starting daily course counts maintenance");
    await startBatchRecalculation();
  });

  cron.schedule("0 */6 * * *", async () => {
    console.log("Running job cleanup");
    await cleanupOldJobs();
  });
};

const getCourseCountStatus = async (courseId) => {
  const [currentCounts, actualCounts] = await Promise.all([
    prisma.course.findUnique({
      where: { id: courseId },
      select: {
        sectionsCount: true,
        publishedSectionsCount: true,
        enrollmentsCount: true,
        reviewsCount: true,
      },
    }),
    Promise.all([
      prisma.section.count({ where: { courseId } }),
      prisma.section.count({ where: { courseId, isPublished: true } }),
      prisma.enrollment.count({ where: { courseId } }),
      prisma.review.count({ where: { courseId } }),
    ]),
  ]);

  return {
    courseId,
    stored: currentCounts,
    actual: {
      sectionsCount: actualCounts[0],
      publishedSectionsCount: actualCounts[1],
      enrollmentsCount: actualCounts[2],
      reviewsCount: actualCounts[3],
    },
    needsUpdate:
      currentCounts.sectionsCount !== actualCounts[0] ||
      currentCounts.publishedSectionsCount !== actualCounts[1] ||
      currentCounts.enrollmentsCount !== actualCounts[2] ||
      currentCounts.reviewsCount !== actualCounts[3],
  };
};

const initializeBackgroundJobs = () => {
  console.log("Initializing course count background jobs...");

  courseCountQueue = initializeQueue();

  if (!courseCountQueue) {
    console.log("Background jobs disabled - Redis not available or configured");
    return;
  }

  courseCountQueue.process("recalculate-single", 1, recalculateCourseCountsJob);
  courseCountQueue.process("batch-recalculate", 1, batchRecalculateAllCounts);

  courseCountQueue.on("completed", (job) => {
    console.log(`Job ${job.id} completed`);
  });

  courseCountQueue.on("failed", (job, err) => {
    console.error(`Job ${job.id} failed:`, err);
  });

  scheduleCountMaintenance();

  console.log("Background jobs initialized");
};

export default initializeBackgroundJobs;

export {
  courseCountQueue,
  addCourseCountUpdate,
  startBatchRecalculation,
  triggerCountUpdate,
  scheduleCountMaintenance,
  getCourseCountStatus,
  cleanupOldJobs,
};
