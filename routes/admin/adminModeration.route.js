import express from "express";
import { requireAdmin, isLoggedIn } from "../../middlewares/middleware.js";
import {
  getContentReports,
  reviewContentReport,
  getUserViolations,
  moderateUser,
  getModerationStats,
  bulkModeratecontent,
  getCommunityStandards,
} from "../../controllers/admin/adminModeration.controller.js";

const router = express.Router();

router.get("/reports", requireAdmin, getContentReports);
router.put("/reports/:reportId/review", requireAdmin, reviewContentReport);
router.get("/users/:userId/violations", requireAdmin, getUserViolations);
router.put("/users/:userId/moderate", requireAdmin, moderateUser);
router.get("/stats", requireAdmin, getModerationStats);
router.put("/reports/bulk", requireAdmin, bulkModeratecontent);
router.get("/community-standards", isLoggedIn, getCommunityStandards);

export default router;
