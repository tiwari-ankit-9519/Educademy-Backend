import express from "express";
import { isLoggedIn } from "../../middlewares/middleware.js";
import {
  getNotifications,
  getUnreadCount,
  getNotificationStats,
  markNotificationsAsRead,
  deleteNotification,
  deleteAllReadNotifications,
  getNotificationSettings,
  updateNotificationSettings,
  sendTestNotification,
  getNotificationPreferences,
} from "../../controllers/common/notification.controller.js";

const router = express.Router();

router.use(isLoggedIn);

router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.get("/stats", getNotificationStats);
router.get("/settings", getNotificationSettings);
router.get("/preferences", getNotificationPreferences);

router.put("/mark-read", markNotificationsAsRead);
router.put("/settings", updateNotificationSettings);

router.delete("/:notificationId", deleteNotification);
router.delete("/read/all", deleteAllReadNotifications);

router.post("/test", sendTestNotification);

export default router;
