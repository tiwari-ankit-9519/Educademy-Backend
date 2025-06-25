import { PrismaClient } from "@prisma/client";
import emailTemplates from "./emailTemplates.js";

const prisma = new PrismaClient();

class NotificationService {
  constructor() {
    this.socketManager = null;
    this.emailService = null;
  }

  setSocketManager(socketManager) {
    this.socketManager = socketManager;
  }

  setEmailService(emailService) {
    this.emailService = emailService;
  }

  async createNotification({
    userId,
    type,
    title,
    message,
    priority = "NORMAL",
    data = null,
    actionUrl = null,
    sendEmail = null,
    sendSocket = true,
  }) {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId,
          type,
          title,
          message,
          priority,
          data,
          actionUrl,
          isDelivered: false,
        },
      });

      if (sendSocket && this.socketManager) {
        await this.socketManager.sendNotificationToUser(userId, {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          priority: notification.priority,
          data: notification.data,
          actionUrl: notification.actionUrl,
          createdAt: notification.createdAt,
        });

        if (this.socketManager.isUserOnline(userId)) {
          await this.markAsDelivered(notification.id);
        }
      }

      const shouldEmail =
        sendEmail !== null
          ? sendEmail
          : await this.shouldSendEmail(userId, type);
      if (shouldEmail && this.emailService) {
        await this.sendEmailNotification(userId, notification);
      }

      return notification;
    } catch (error) {
      console.error("Failed to create notification", error);
      throw error;
    }
  }

  async createBulkNotifications({
    userIds,
    type,
    title,
    message,
    priority = "NORMAL",
    data = null,
    actionUrl = null,
    sendEmail = null,
    sendSocket = true,
  }) {
    try {
      const notifications = [];

      for (const userId of userIds) {
        const notification = await prisma.notification.create({
          data: {
            userId,
            type,
            title,
            message,
            priority,
            data,
            actionUrl,
            isDelivered: false,
          },
        });
        notifications.push(notification);
      }

      if (sendSocket && this.socketManager) {
        const notificationPromises = notifications.map(async (notification) => {
          await this.socketManager.sendNotificationToUser(notification.userId, {
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            priority: notification.priority,
            data: notification.data,
            actionUrl: notification.actionUrl,
            createdAt: notification.createdAt,
          });

          if (this.socketManager.isUserOnline(notification.userId)) {
            await this.markAsDelivered(notification.id);
          }
        });

        await Promise.all(notificationPromises);
      }

      if (this.emailService) {
        const emailPromises = notifications.map(async (notification) => {
          const shouldEmail =
            sendEmail !== null
              ? sendEmail
              : await this.shouldSendEmail(notification.userId, type);
          if (shouldEmail) {
            await this.sendEmailNotification(notification.userId, notification);
          }
        });

        await Promise.all(emailPromises);
      }

      return notifications;
    } catch (error) {
      console.error("Failed to create bulk notifications", error);
      throw error;
    }
  }

  async markAsDelivered(notificationId) {
    try {
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          isDelivered: true,
          deliveredAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Failed to mark notification as delivered", error);
    }
  }

  async shouldSendEmail(userId, type) {
    try {
      const settings = await prisma.notificationSettings.findUnique({
        where: { userId },
      });

      if (!settings) return this.getDefaultEmailSetting(type);

      const highPriorityTypes = [
        "payment_confirmed",
        "payment_failed",
        "security_alert",
        "account_suspended",
        "course_approved",
        "course_rejected",
        "assignment_graded",
        "certificate_ready",
        "refund_processed",
        "payout_processed",
      ];

      const mediumPriorityTypes = [
        "new_student_enrolled",
        "course_completed",
        "support_ticket_resolved",
      ];

      if (highPriorityTypes.includes(type)) {
        return true;
      }

      if (mediumPriorityTypes.includes(type)) {
        return settings.email && settings.courseUpdates;
      }

      return false;
    } catch (error) {
      console.error("Failed to check email notification settings", error);
      return false;
    }
  }

  getDefaultEmailSetting(type) {
    const alwaysEmailTypes = [
      "payment_confirmed",
      "payment_failed",
      "security_alert",
      "account_suspended",
      "certificate_ready",
    ];
    return alwaysEmailTypes.includes(type);
  }

  async sendEmailNotification(userId, notification) {
    try {
      if (!this.emailService) return;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      });

      if (!user) return;

      const emailData = await this.prepareEmailData(notification, user);
      if (emailData) {
        await this.emailService.send({
          to: user.email,
          subject: emailData.subject,
          html: emailData.html,
        });
      }
    } catch (error) {
      console.error("Failed to send email notification", error);
    }
  }

  async prepareEmailData(notification, user) {
    const { type, title, message, data } = notification;

    switch (type) {
      case "payment_confirmed":
        return {
          subject: "Payment Confirmed - Educademy",
          html: emailTemplates.transactional({
            userName: user.firstName,
            title: "Payment Successful",
            subtitle: "Your course purchase has been confirmed",
            message:
              "Thank you for your purchase! You now have access to your course.",
            transactionType: "success",
            amount: data?.amount,
            currency: data?.currency || "INR",
            transactionId: data?.transactionId,
            actionButton: "Access Course",
            actionUrl: data?.courseUrl,
            details: data?.details || [],
          }),
        };

      case "payment_failed":
        return {
          subject: "Payment Failed - Educademy",
          html: emailTemplates.transactional({
            userName: user.firstName,
            title: "Payment Failed",
            subtitle: "Your payment could not be processed",
            message:
              "We were unable to process your payment. Please try again.",
            transactionType: "failed",
            amount: data?.amount,
            currency: data?.currency || "INR",
            actionButton: "Retry Payment",
            actionUrl: data?.retryUrl,
            details: data?.details || [],
          }),
        };

      case "security_alert":
        return {
          subject: "Security Alert - Educademy",
          html: emailTemplates.security({
            userName: user.firstName,
            title: "Security Alert",
            subtitle: "Unusual activity detected on your account",
            message: message,
            alertType: "warning",
            actionButton: "Secure Account",
            actionUrl: data?.securityUrl,
            details: data?.details || [],
            securityTips: data?.securityTips || [],
            footerNote:
              "If this wasn't you, please secure your account immediately.",
          }),
        };

      case "assignment_graded":
        return {
          subject: "Assignment Graded - Educademy",
          html: emailTemplates.communication({
            userName: user.firstName,
            title: "Assignment Graded",
            subtitle: "Your instructor has reviewed your work",
            message:
              "Your assignment has been graded and feedback is available.",
            communicationType: "graded",
            courseName: data?.courseName,
            senderName: data?.instructorName,
            grade: data?.grade,
            feedback: data?.feedback,
            actionButton: "View Details",
            actionUrl: data?.assignmentUrl,
          }),
        };

      case "certificate_ready":
        return {
          subject: "Certificate Ready - Educademy",
          html: emailTemplates.course({
            userName: user.firstName,
            title: "Certificate Ready!",
            subtitle: "Congratulations on completing your course",
            message:
              "Your course completion certificate is now available for download.",
            courseType: "completed",
            courseName: data?.courseName,
            certificateUrl: data?.certificateUrl,
            actionButton: "Download Certificate",
            actionUrl: data?.certificateUrl,
            achievements: data?.achievements || [],
          }),
        };

      case "course_approved":
        return {
          subject: "Course Approved - Educademy",
          html: emailTemplates.course({
            userName: user.firstName,
            title: "Course Approved!",
            subtitle: "Your course is now live on Educademy",
            message:
              "Congratulations! Your course has been reviewed and approved.",
            courseType: "published",
            courseName: data?.courseName,
            actionButton: "View Course",
            actionUrl: data?.courseUrl,
            achievements: data?.achievements || [],
          }),
        };

      case "course_rejected":
        return {
          subject: "Course Review Required - Educademy",
          html: emailTemplates.course({
            userName: user.firstName,
            title: "Course Under Review",
            subtitle: "Your course needs some improvements",
            message: "Please address the following items before resubmission.",
            courseType: "rejected",
            courseName: data?.courseName,
            actionButton: "Edit Course",
            actionUrl: data?.editUrl,
            suggestions: data?.suggestions || [],
          }),
        };

      case "new_student_enrolled":
        return {
          subject: "New Student Enrolled - Educademy",
          html: emailTemplates.course({
            userName: user.firstName,
            title: "New Student Enrolled",
            subtitle: "Someone just joined your course",
            message: "Great news! A new student has enrolled in your course.",
            courseType: "enrolled",
            courseName: data?.courseName,
            actionButton: "View Analytics",
            actionUrl: data?.analyticsUrl,
          }),
        };

      case "refund_processed":
        return {
          subject: "Refund Processed - Educademy",
          html: emailTemplates.transactional({
            userName: user.firstName,
            title: "Refund Processed",
            subtitle: "Your refund has been initiated",
            message: "Your refund request has been processed successfully.",
            transactionType: "refund",
            amount: data?.amount,
            currency: data?.currency || "INR",
            transactionId: data?.refundId,
            details: data?.details || [],
            footerNote: data?.deliveryNote,
          }),
        };

      case "payout_processed":
        return {
          subject: "Payout Processed - Educademy",
          html: emailTemplates.transactional({
            userName: user.firstName,
            title: "Payout Processed",
            subtitle: "Your earnings have been transferred",
            message:
              "Your earnings have been successfully transferred to your account.",
            transactionType: "success",
            amount: data?.amount,
            currency: data?.currency || "INR",
            transactionId: data?.payoutId,
            details: data?.details || [],
          }),
        };

      case "support_ticket_resolved":
        return {
          subject: "Support Ticket Resolved - Educademy",
          html: emailTemplates.system({
            userName: user.firstName,
            title: "Support Ticket Resolved",
            subtitle: "Your support request has been resolved",
            message:
              "We have resolved your support ticket. Please review the solution.",
            systemType: "support",
            ticketId: data?.ticketId,
            actionButton: "View Resolution",
            actionUrl: data?.ticketUrl,
            additionalInfo: data?.resolution ? [data.resolution] : [],
          }),
        };

      default:
        return null;
    }
  }

  async getUserNotifications(userId, options = {}) {
    const { page = 1, limit = 20, isRead, type, priority } = options;
    const skip = (page - 1) * limit;

    try {
      const where = { userId };

      if (isRead !== undefined) where.isRead = isRead;
      if (type) where.type = type;
      if (priority) where.priority = priority;

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.notification.count({ where }),
      ]);

      return {
        notifications,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("Failed to get user notifications", error);
      throw error;
    }
  }

  async markAsRead(notificationIds, userId) {
    try {
      await prisma.notification.updateMany({
        where: {
          id: { in: notificationIds },
          userId,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      if (this.socketManager) {
        this.socketManager.sendToUser(userId, "notifications_marked_read", {
          notificationIds,
        });
      }
    } catch (error) {
      console.error("Failed to mark notifications as read", error);
      throw error;
    }
  }

  async markAllAsRead(userId) {
    try {
      await prisma.notification.updateMany({
        where: {
          userId,
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      if (this.socketManager) {
        this.socketManager.sendToUser(userId, "all_notifications_read", {});
      }
    } catch (error) {
      console.error("Failed to mark all notifications as read", error);
      throw error;
    }
  }

  async deleteNotification(notificationId, userId) {
    try {
      await prisma.notification.delete({
        where: {
          id: notificationId,
          userId,
        },
      });

      if (this.socketManager) {
        this.socketManager.sendToUser(userId, "notification_deleted", {
          notificationId,
        });
      }
    } catch (error) {
      console.error("Failed to delete notification", error);
      throw error;
    }
  }

  async deleteAllRead(userId) {
    try {
      await prisma.notification.deleteMany({
        where: {
          userId,
          isRead: true,
        },
      });

      if (this.socketManager) {
        this.socketManager.sendToUser(userId, "read_notifications_deleted", {});
      }
    } catch (error) {
      console.error("Failed to delete read notifications", error);
      throw error;
    }
  }

  async getUnreadCount(userId) {
    try {
      return await prisma.notification.count({
        where: {
          userId,
          isRead: false,
        },
      });
    } catch (error) {
      console.error("Failed to get unread count", error);
      return 0;
    }
  }

  async getNotificationStats(userId) {
    try {
      const [total, unread, delivered, byPriority] = await Promise.all([
        prisma.notification.count({ where: { userId } }),
        prisma.notification.count({
          where: {
            userId,
            isRead: false,
          },
        }),
        prisma.notification.count({
          where: { userId, isDelivered: true },
        }),
        prisma.notification.groupBy({
          by: ["priority"],
          where: {
            userId,
            isRead: false,
          },
          _count: { priority: true },
        }),
      ]);

      return {
        total,
        unread,
        delivered,
        byPriority: byPriority.reduce((acc, item) => {
          acc[item.priority] = item._count.priority;
          return acc;
        }, {}),
      };
    } catch (error) {
      console.error("Failed to get notification stats", error);
      return { total: 0, unread: 0, delivered: 0, byPriority: {} };
    }
  }

  async cleanupExpiredNotifications() {
    try {
      // Since there's no expiresAt field, we can cleanup old read notifications
      // or implement a different cleanup strategy based on createdAt
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await prisma.notification.deleteMany({
        where: {
          isRead: true,
          readAt: {
            lt: thirtyDaysAgo,
          },
        },
      });

      console.log(`Cleaned up ${result.count} old read notifications`);
      return result.count;
    } catch (error) {
      console.error("Failed to cleanup old notifications", error);
      return 0;
    }
  }

  async updateNotificationSettings(userId, settings) {
    try {
      const updatedSettings = await prisma.notificationSettings.upsert({
        where: { userId },
        update: settings,
        create: {
          userId,
          ...settings,
        },
      });

      if (this.socketManager) {
        this.socketManager.sendToUser(userId, "notification_settings_updated", {
          settings: updatedSettings,
        });
      }

      return updatedSettings;
    } catch (error) {
      console.error("Failed to update notification settings", error);
      throw error;
    }
  }

  async getNotificationSettings(userId) {
    try {
      const settings = await prisma.notificationSettings.findUnique({
        where: { userId },
      });

      return (
        settings || {
          email: true,
          inApp: true,
          courseUpdates: true,
          assignmentUpdates: true,
          discussionUpdates: true,
          paymentUpdates: true,
          accountUpdates: true,
        }
      );
    } catch (error) {
      console.error("Failed to get notification settings", error);
      return null;
    }
  }
}

const notificationService = new NotificationService();

setInterval(() => {
  notificationService.cleanupExpiredNotifications();
}, 24 * 60 * 60 * 1000);

export default notificationService;
