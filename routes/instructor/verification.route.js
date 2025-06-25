import express from "express";
import {
  isLoggedIn,
  requireAdmin,
  requireInstructor,
} from "../../middlewares/middleware.js";
import {
  requestVerification,
  getMyVerificationRequests,
  getVerificationRequest,
  updateVerificationRequest,
  cancelVerificationRequest,
  getAllVerificationRequests,
  reviewVerificationRequest,
  getVerificationStats,
} from "../../controllers/instructors/verification.controller.js";

const router = express.Router();

router.post("/request", requireInstructor, requestVerification);
router.get("/my-requests", requireInstructor, getMyVerificationRequests);
router.get("/admin/all", requireAdmin, getAllVerificationRequests);
router.get("/admin/stats", requireAdmin, getVerificationStats);
router.put("/admin/:requestId/review", requireAdmin, reviewVerificationRequest);
router.get("/:requestId", isLoggedIn, getVerificationRequest);
router.put("/:requestId", requireInstructor, updateVerificationRequest);
router.delete("/:requestId", requireInstructor, cancelVerificationRequest);

export default router;
