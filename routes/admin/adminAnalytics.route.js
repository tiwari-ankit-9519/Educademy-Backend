import express from "express";
import { requireAdmin } from "../../middlewares/middleware.js";
import {
  getDashboardOverview,
  getUserAnalytics,
  getCourseAnalytics,
  getRevenueAnalytics,
  getEngagementAnalytics,
  getComparativeAnalytics,
  getRealtimeStats,
  exportAnalyticsData,
  downloadExportedData,
} from "../../controllers/admin/adminAnalytics.controller.js";

const router = express.Router();

router.get("/dashboard", requireAdmin, getDashboardOverview);
router.get("/users", requireAdmin, getUserAnalytics);
router.get("/courses", requireAdmin, getCourseAnalytics);
router.get("/revenue", requireAdmin, getRevenueAnalytics);
router.get("/engagement", requireAdmin, getEngagementAnalytics);
router.get("/comparative", requireAdmin, getComparativeAnalytics);
router.get("/realtime", requireAdmin, getRealtimeStats);
router.post("/export", requireAdmin, exportAnalyticsData);
router.get("/download/:exportId", requireAdmin, downloadExportedData);

export default router;
