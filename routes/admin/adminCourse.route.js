import express from "express";
import { requireAdmin } from "../../middlewares/middleware.js";
import {
  getPendingCourses,
  getCourseReviewDetails,
  reviewCourse,
  getCourseStats,
  bulkCourseActions,
  getCourseReviewHistory,
} from "../../controllers/admin/adminCourse.controller.js";

const router = express.Router();

router.use(requireAdmin);

router.get("/pending", getPendingCourses);
router.get("/stats", getCourseStats);
router.get("/:courseId/review", getCourseReviewDetails);
router.get("/:courseId/history", getCourseReviewHistory);
router.post("/:courseId/review", reviewCourse);
router.post("/bulk-actions", bulkCourseActions);

export default router;
