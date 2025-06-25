import express from "express";
import {
  addToCart,
  removeFromCart,
  getCart,
  clearCart,
  applyCoupon,
  removeCoupon,
  validateCartCoupon,
  getCartTotals,
  syncCart,
  moveToWishlist,
  getCartSummary,
  bulkAddToCart,
} from "../../controllers/student/cart.controller.js";
import { isLoggedIn } from "../../middlewares/middleware.js";

const router = express.Router();

router.use(isLoggedIn);

router.post("/add", addToCart);
router.delete("/clear", clearCart);
router.post("/bulk-add", bulkAddToCart);
router.delete("/:courseId", removeFromCart);
router.get("/", getCart);

router.post("/coupon", applyCoupon);
router.delete("/coupon", removeCoupon);
router.get("/coupon/validate", validateCartCoupon);

router.get("/totals", getCartTotals);
router.post("/sync", syncCart);
router.post("/move-to-wishlist", moveToWishlist);
router.get("/summary", getCartSummary);

export default router;
