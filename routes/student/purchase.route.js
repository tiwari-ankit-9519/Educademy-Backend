import express from "express";
import {
  isLoggedIn,
  requireAdmin,
  requireStudent,
} from "../../middlewares/middleware.js";
import {
  initiateCheckout,
  verifyPayment,
  getPurchaseHistory,
  getPaymentDetails,
  requestRefund,
  processRefund,
  retryPayment,
  cancelPayment,
  getRefundRequests,
  getPaymentAnalytics,
} from "../../controllers/student/purchase.controller.js";

const router = express.Router();

router.post("/checkout", isLoggedIn, initiateCheckout);
router.post("/verify", isLoggedIn, verifyPayment);
router.get("/history", requireStudent, getPurchaseHistory);
router.get("/details/:paymentId", isLoggedIn, getPaymentDetails);
router.post("/refund/:paymentId", isLoggedIn, requestRefund);
router.put("/refund/:paymentId/process", requireAdmin, processRefund);
router.post("/retry/:paymentId", isLoggedIn, retryPayment);
router.patch("/cancel/:paymentId", isLoggedIn, cancelPayment);
router.get("/admin/refunds", requireAdmin, getRefundRequests); // For Admin
router.get("/admin/analytics", requireAdmin, getPaymentAnalytics); // For Admin

export default router;
