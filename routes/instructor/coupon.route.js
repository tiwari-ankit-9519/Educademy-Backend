import express from "express";
import {
  createCoupon,
  getCoupons,
  getCouponById,
  updateCoupon,
  deleteCoupon,
  applyCoupon,
  getCouponAnalytics,
  toggleCouponStatus,
  bulkUpdateCoupons,
  getExpiringSoonCoupons,
} from "../../controllers/instructors/coupon.controller.js";
import { isLoggedIn, requireInstructor } from "../../middlewares/middleware.js";

const router = express.Router();

router.post("/create", requireInstructor, createCoupon);
router.get("/all", isLoggedIn, getCoupons); // Common Controller
router.get("/analytics", requireInstructor, getCouponAnalytics);
router.get("/expiring-soon", requireInstructor, getExpiringSoonCoupons);
router.post("/apply", isLoggedIn, applyCoupon); // For Student
router.put("/bulk-update", requireInstructor, bulkUpdateCoupons);
router.get("/:couponId", isLoggedIn, getCouponById); // Common Controller
router.put("/:couponId", requireInstructor, updateCoupon);
router.delete("/:couponId", requireInstructor, deleteCoupon);
router.patch("/:couponId/toggle-status", requireInstructor, toggleCouponStatus);

export default router;
