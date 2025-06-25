import express from "express";
import { requireAdmin } from "../../middlewares/middleware.js";
import {
  getAllTransactions,
  getTransactionDetails,
  processRefund,
  getAllPayouts,
  processPayout,
  getRevenueOverview,
  getFinancialAnalytics,
  getPaymentStats,
} from "../../controllers/admin/adminPayment.controller.js";

const router = express.Router();

router.use(requireAdmin);

router.get("/transactions", getAllTransactions);
router.get("/transactions/:transactionId", getTransactionDetails);
router.post("/transactions/:transactionId/refund", processRefund);

router.get("/payouts", getAllPayouts);
router.post("/payouts/:payoutId/process", processPayout);

router.get("/revenue/overview", getRevenueOverview);
router.get("/analytics", getFinancialAnalytics);
router.get("/stats", getPaymentStats);

export default router;
