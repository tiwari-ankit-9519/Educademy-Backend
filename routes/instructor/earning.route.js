import express from "express";
import {
  getEarningsOverview,
  getEarningsStats,
  getDetailedEarnings,
  getCourseEarnings,
  requestPayout,
  getPayoutHistory,
  getRevenueAnalytics,
  getPaymentBreakdown,
  generateFinancialReport,
  updatePaymentDetails,
  getFinancialDashboard,
} from "../../controllers/instructors/earning.controller.js";
import { requireInstructor } from "../../middlewares/middleware.js";
import {
  validatePayoutRequest,
  validatePaymentDetails,
  validateDateRange,
} from "../../helper/payoutHelperFunctions.js";

const router = express.Router();

router.use(requireInstructor);

router.get("/overview", getEarningsOverview);

router.get("/stats", getEarningsStats);

router.get("/detailed", getDetailedEarnings);

router.get("/course/:courseId", getCourseEarnings);

router.post("/payout/request", validatePayoutRequest, requestPayout);

router.get("/payout/history", getPayoutHistory);

router.get("/analytics/revenue", validateDateRange, getRevenueAnalytics);

router.get("/breakdown/payments", validateDateRange, getPaymentBreakdown);

router.get("/reports/financial", validateDateRange, generateFinancialReport);

router.put("/payment-details", validatePaymentDetails, updatePaymentDetails);

router.get("/dashboard", getFinancialDashboard);

export default router;
