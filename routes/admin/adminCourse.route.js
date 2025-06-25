import express from "express";
import { requireAdmin } from "../../middlewares/middleware.js";
import {
  getPendingCourses,
  getCourseReviewDetails,
  reviewCourse,
  updateCourseStatus,
  getCourseStats,
  bulkCourseActions,
  getCourseReviewHistory,
} from "../../controllers/admin/adminCourse.controller.js";

const router = express.Router();

router.get("/pending", requireAdmin, getPendingCourses);
router.get("/stats", requireAdmin, getCourseStats);
router.get("/:courseId/review", requireAdmin, getCourseReviewDetails);
router.get("/:courseId/history", requireAdmin, getCourseReviewHistory);
router.post("/:courseId/review", requireAdmin, reviewCourse);
router.put("/:courseId/status", requireAdmin, updateCourseStatus);
router.post("/bulk-actions", requireAdmin, bulkCourseActions);

export default router;
