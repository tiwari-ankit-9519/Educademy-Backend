import express from "express";
import { isLoggedIn, requireInstructor } from "../../middlewares/middleware.js";
import {
  requestVerification,
  getMyVerificationRequests,
  getVerificationRequest,
  updateVerificationRequest,
  cancelVerificationRequest,
} from "../../controllers/instructors/verification.controller.js";
import { uploadDocument } from "../../config/upload.js";

const router = express.Router();

router.post(
  "/request",
  requireInstructor,
  uploadDocument.array("documents", 10),
  requestVerification
);
router.get("/my-requests", requireInstructor, getMyVerificationRequests);
router.get("/:requestId", isLoggedIn, getVerificationRequest);
router.put("/:requestId", requireInstructor, updateVerificationRequest);
router.delete("/:requestId", requireInstructor, cancelVerificationRequest);

export default router;
