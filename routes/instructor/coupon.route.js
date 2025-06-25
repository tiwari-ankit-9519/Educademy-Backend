import express from "express";
import {
  createCoupon,
  getCoupons,
  getCouponById,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
  applyCoupon,
  getCouponAnalytics,
  getCouponUsageHistory,
  toggleCouponStatus,
  bulkUpdateCoupons,
  getCouponPerformanceReport,
  getExpiringSoonCoupons,
} from "../../controllers/instructors/coupon.controller.js";
import { isLoggedIn, requireInstructor } from "../../middlewares/middleware.js";

const router = express.Router();

router.post("/create", requireInstructor, createCoupon);
router.get("/", isLoggedIn, getCoupons);
router.get("/analytics", isLoggedIn, getCouponAnalytics);
router.get("/performance-report", isLoggedIn, getCouponPerformanceReport);
router.get("/expiring-soon", isLoggedIn, getExpiringSoonCoupons);
router.post("/validate", isLoggedIn, validateCoupon);
router.post("/apply", isLoggedIn, applyCoupon);
router.put("/bulk-update", requireInstructor, bulkUpdateCoupons);
router.get("/:couponId", isLoggedIn, getCouponById);
router.put("/:couponId", requireInstructor, updateCoupon);
router.delete("/:couponId", requireInstructor, deleteCoupon);
router.patch("/:couponId/toggle-status", requireInstructor, toggleCouponStatus);
router.get("/:couponId/usage-history", isLoggedIn, getCouponUsageHistory);

export default router;
