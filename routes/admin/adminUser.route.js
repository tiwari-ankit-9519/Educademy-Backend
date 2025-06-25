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
} from "../../controllers/admin/adminUser.controller.js";

const router = express.Router();

router.use(requireAdmin);

router.route("/users").get(getAllUsers);

router.route("/users/stats").get(getUserStats);

router.route("/users/bulk").patch(bulkUpdateUsers);

router
  .route("/users/:userId")
  .get(getUserDetails)
  .patch(updateUserStatus)
  .delete(deleteUser);

router.route("/categories").get(getAllCategories).post(createCategory);

router
  .route("/categories/:categoryId")
  .get(getSingleCategory)
  .patch(updateCategory)
  .delete(deleteCategory);

export default router;
