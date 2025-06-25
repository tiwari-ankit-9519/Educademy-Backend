import express from "express";
import { requireAdmin } from "../../middlewares/middleware.js";
import {
  getSystemSettings,
  updateSystemSettings,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getAllCoupons,
  createSystemCoupon,
  createAnnouncement,
  getAllAnnouncements,
  getSystemHealth,
} from "../../controllers/admin/adminSystem.controller.js";

const router = express.Router();

router.get("/settings", requireAdmin, getSystemSettings);
router.put("/settings", requireAdmin, updateSystemSettings);

router.get("/categories", requireAdmin, getAllCategories);
router.post("/categories", requireAdmin, createCategory);
router.put("/categories/:categoryId", requireAdmin, updateCategory);
router.delete("/categories/:categoryId", requireAdmin, deleteCategory);

router.get("/coupons", requireAdmin, getAllCoupons);
router.post("/coupons", requireAdmin, createSystemCoupon);

router.post("/announcements", requireAdmin, createAnnouncement);
router.get("/announcements", requireAdmin, getAllAnnouncements);

router.get("/health", requireAdmin, getSystemHealth);

export default router;
