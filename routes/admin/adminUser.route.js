import express from "express";
import { requireAdmin } from "../../middlewares/middleware.js";
import {
  getAllUsers,
  getUserDetails,
  updateUserStatus,
  bulkUpdateUsers,
  deleteUser,
  getUserStats,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getSingleCategory,
  getAllVerificationRequests,
  getVerificationStats,
  reviewVerificationRequest,
  getVerificationRequestById,
} from "../../controllers/admin/adminUser.controller.js";
import { uploadImage } from "../../config/upload.js";

const router = express.Router();

router.use(requireAdmin);

router.route("/users").get(getAllUsers);

router.route("/users/stats").get(getUserStats);

router.route("/users/bulk").patch(bulkUpdateUsers);

router.get("/admin/all", getAllVerificationRequests);
router.get("/admin/stats", getVerificationStats);
router.get("/admin/:requestId", getVerificationRequestById);
router.put("/admin/:requestId/review", reviewVerificationRequest);

router
  .route("/users/:userId")
  .get(getUserDetails)
  .patch(updateUserStatus)
  .delete(deleteUser);

router
  .route("/categories")
  .get(getAllCategories)
  .post(uploadImage.single("image"), createCategory);

router
  .route("/categories/:categoryId")
  .get(getSingleCategory)
  .patch(uploadImage.single("image"), updateCategory)
  .delete(deleteCategory);

export default router;
