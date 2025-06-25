import express from "express";
import { isLoggedIn, requireAdmin } from "../../middlewares/middleware.js";
import {
  createSupportTicket,
  getSupportTickets,
  getSupportTicket,
  addTicketResponse,
  updateTicketStatus,
  getSupportCategories,
  getSupportStats,
} from "../../controllers/common/ticket.controller.js";

const router = express.Router();

router.get("/categories", getSupportCategories);

router.use(isLoggedIn);

router.post("/tickets", createSupportTicket);
router.get("/tickets", getSupportTickets);
router.get("/tickets/:ticketId", getSupportTicket);
router.post("/tickets/:ticketId/responses", addTicketResponse);
router.get("/stats", getSupportStats);

router.put("/tickets/:ticketId/status", requireAdmin, updateTicketStatus);

export default router;
