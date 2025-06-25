import express from "express";
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  moveToCart,
  moveAllToCart,
  clearWishlist,
  checkWishlistStatus,
  getWishlistRecommendations,
  shareWishlist,
  getSharedWishlist,
} from "../../controllers/student/wishlist.controller.js";
import { isLoggedIn } from "../../middlewares/middleware.js";

const router = express.Router();

router.use(isLoggedIn);

router.delete("/courses/:courseId", removeFromWishlist);
router.post("/courses/:courseId/move-to-cart", moveToCart);
router.get("/recommendations", getWishlistRecommendations);
router.get("/shared/:shareToken", getSharedWishlist);

export default router;
