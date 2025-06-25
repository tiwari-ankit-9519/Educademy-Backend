import { config } from "dotenv";
import nodemailer from "nodemailer";
import emailTemplates from "./emailTemplates.js";

config();

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  async initializeTransporter() {
    try {
      const useTestService = process.env.USE_TEST_EMAIL === "true";

      if (useTestService && process.env.NODE_ENV === "development") {
        const testAccount = await nodemailer.createTestAccount();
        this.transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
      } else {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
          throw new Error(
            "EMAIL_USER and EMAIL_PASSWORD environment variables are required"
          );
        }

        this.transporter = nodemailer.createTransport({
          service: process.env.EMAIL_SERVICE || "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
          },
          secure: true,
          port: 465,
        });
      }

      await this.transporter.verify();
    } catch (error) {
      console.error("Failed to initialize email transporter", error);
      throw error;
    }
  }

  async send({ to, subject, html, text, template, templateData }) {
    try {
      if (template && templateData) {
        html = emailTemplates[template](templateData);
        text = this.htmlToText(html);
      }

      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "Educademy",
          address: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        },
        to,
        subject,
        html,
        text: text || this.htmlToText(html),
      };

      const result = await this.transporter.sendMail(mailOptions);

      const previewUrl =
        process.env.USE_TEST_EMAIL === "true"
          ? nodemailer.getTestMessageUrl(result)
          : null;

      return {
        success: true,
        messageId: result.messageId,
        previewUrl,
        deliveryInfo: {
          realEmail: process.env.USE_TEST_EMAIL !== "true",
          service: process.env.USE_TEST_EMAIL === "true" ? "ethereal" : "gmail",
          recipient: to,
        },
      };
    } catch (error) {
      console.error("Failed to send email", error);
      return {
        success: false,
        error: error.message,
        errorCode: error.code,
      };
    }
  }

  async sendOTPVerification({
    email,
    firstName,
    otp,
    expiresIn = 10,
    isRegistration = true,
    isEmailChange = false,
    actionUrl,
  }) {
    return await this.send({
      to: email,
      subject: "🔐 Verify Your Educademy Account - OTP Code Inside",
      html: emailTemplates.verification({
        userName: firstName,
        title: "Verify Your Email",
        subtitle: "Please confirm your email address to continue",
        message: isRegistration
          ? "Thank you for signing up with Educademy! To complete your registration and secure your account, please verify your email address using the code below."
          : isEmailChange
          ? "You've requested to change your email address on Educademy. To confirm this change and secure your account, please verify your new email address using the code below."
          : "Please verify your email address using the code below to continue with Educademy.",
        isSuccess: false,
        code: otp,
        codeLabel: "Verification Code",
        expirationMinutes: expiresIn,
        actionButton: "Verify Email",
        actionUrl: actionUrl,
      }),
    });
  }

  async sendWelcomeEmail({ email, firstName, lastName, userRole = "STUDENT" }) {
    return await this.send({
      to: email,
      subject: "🎉 Welcome to Educademy - Your Learning Journey Begins!",
      html: emailTemplates.verification({
        userName: firstName,
        title: "Welcome to Educademy!",
        subtitle: "Your learning journey starts here",
        message:
          "Welcome to Educademy! We're thrilled to have you join our community of learners. Whether you're here to advance your career, learn new skills, or pursue a passion, we're here to support your educational journey every step of the way.",
        isSuccess: true,
        actionButton:
          userRole === "STUDENT"
            ? "Browse Courses"
            : userRole === "INSTRUCTOR"
            ? "Create Your First Course"
            : "Go to Dashboard",
        actionUrl: `${process.env.FRONTEND_URL}/${
          userRole === "STUDENT"
            ? "courses"
            : userRole === "INSTRUCTOR"
            ? "instructor/courses/create"
            : "admin/dashboard"
        }`,
        features: [
          {
            icon: "🎯",
            title: "Expert-Led Courses",
            description:
              "Learn from industry professionals and certified instructors",
            bgColor: "#ddd6fe",
          },
          {
            icon: "📱",
            title: "Learn Anywhere",
            description: "Access courses on any device, anytime, anywhere",
            bgColor: "#dcfce7",
          },
          {
            icon: "🏆",
            title: "Certificates",
            description: "Earn recognized certificates upon completion",
            bgColor: "#fef3c7",
          },
        ],
        tips: [
          "Complete your profile to get personalized course recommendations",
          userRole === "STUDENT"
            ? "Browse our course catalog and start with a free course"
            : userRole === "INSTRUCTOR"
            ? "Upload your first course and reach thousands of students"
            : "Familiarize yourself with the admin dashboard",
          "Download our mobile app for learning on the go",
          "Join our community forum to connect with other learners",
        ],
      }),
    });
  }

  async sendPasswordResetOTP({
    email,
    firstName,
    otp,
    expiresIn = 15,
    ipAddress,
    requestTime,
  }) {
    return await this.send({
      to: email,
      subject: "🔒 Reset Your Educademy Password - OTP Code",
      html: emailTemplates.security({
        userName: firstName,
        title: "Reset Your Password",
        subtitle: "Use the code below to create a new password",
        message:
          "We received a request to reset your password for your Educademy account. Use the verification code below to proceed with resetting your password.",
        alertType: "critical",
        actionButton: "Reset Password",
        actionUrl: `${process.env.FRONTEND_URL}/reset-password`,
        details: [
          { label: "Time", value: requestTime },
          { label: "IP Address", value: ipAddress },
        ],
        securityTips: [
          "Choose a strong password with 8+ characters",
          "Use a mix of letters, numbers, and symbols",
          "Don't reuse passwords from other accounts",
          "Consider enabling two-factor authentication",
        ],
        footerNote:
          "If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged. However, if you're concerned about your account security, consider changing your password and enabling two-factor authentication.",
      }),
    });
  }

  async sendLoginAlert({
    email,
    firstName,
    loginTime,
    ipAddress,
    location,
    device,
    browser,
  }) {
    return await this.send({
      to: email,
      subject: "🔔 New Login to Your Educademy Account",
      html: emailTemplates.security({
        userName: firstName,
        title: "New Login Detected",
        subtitle: "We noticed a login from a new device or location",
        message:
          "We're writing to let you know that your Educademy account was just accessed from a new device or location. If this was you, you can safely ignore this email.",
        alertType: "warning",
        actionButton: "Secure My Account",
        actionUrl: `${process.env.FRONTEND_URL}/security`,
        details: [
          { label: "Time", value: loginTime },
          { label: "Location", value: location || "Unknown" },
          { label: "Device", value: device || "Unknown Device" },
          { label: "Browser", value: browser || "Unknown Browser" },
          { label: "IP Address", value: ipAddress },
        ],
        securityTips: [
          "Change your password immediately",
          "Review your account activity",
          "Enable two-factor authentication",
          "Contact our support team",
        ],
        footerNote: "If this wasn't you, secure your account immediately.",
      }),
    });
  }

  async sendAccountReactivationConfirmation({
    email,
    firstName,
    requestId,
    submittedAt,
  }) {
    return await this.send({
      to: email,
      subject: "📝 Account Reactivation Request Received",
      html: emailTemplates.verification({
        userName: firstName,
        title: "Reactivation Request Received",
        subtitle: "We're reviewing your account reactivation request",
        message:
          "Thank you for submitting your account reactivation request. We have received your request and will review it within 24-48 hours.",
        isSuccess: false,
        actionButton: "Check Status",
        actionUrl: `${process.env.FRONTEND_URL}/reactivation-status`,
        tips: [
          `Request ID: ${requestId}`,
          `Submitted: ${new Date(submittedAt).toLocaleDateString()}`,
          "You'll receive an email once the review is complete",
          "Contact support if you have questions about your request",
        ],
      }),
    });
  }

  async sendCourseSubmittedForReview({
    email,
    firstName,
    courseTitle,
    submissionDate,
  }) {
    return await this.send({
      to: email,
      subject: "📚 Course Submitted for Review - Educademy",
      html: emailTemplates.course({
        userName: firstName,
        title: "Course Submitted for Review",
        subtitle: "Your course is now under review",
        message:
          "Thank you for submitting your course for review. Our team will evaluate it according to our quality guidelines and get back to you within 3-5 business days.",
        courseType: "submitted",
        courseName: courseTitle,
        actionButton: "View Submission",
        actionUrl: `${process.env.FRONTEND_URL}/instructor/courses`,
        suggestions: [
          `Submitted on: ${new Date(submissionDate).toLocaleDateString()}`,
          "Review timeline: 3-5 business days",
          "You'll receive email updates on the review status",
          "Ensure your course meets our quality guidelines",
        ],
      }),
    });
  }

  async sendCourseApprovalEmail({
    email,
    firstName,
    courseTitle,
    courseId,
    feedback,
    courseUrl,
  }) {
    return await this.send({
      to: email,
      subject: "🎉 Course Approved - Your Course is Now Live!",
      html: emailTemplates.course({
        userName: firstName,
        title: "Course Published!",
        subtitle: "Your course is now live on Educademy",
        message:
          "Congratulations! Your course has been reviewed and published successfully. Students can now enroll and start learning from your expertise.",
        courseType: "published",
        courseName: courseTitle,
        actionButton: "View Course",
        actionUrl:
          courseUrl || `${process.env.FRONTEND_URL}/courses/${courseId}`,
        achievements: [
          "Course meets all quality standards",
          "Ready to reach thousands of students",
          "Eligible for promotional campaigns",
          feedback || "Excellent content quality and structure",
        ],
      }),
    });
  }

  async sendCourseRejectionEmail({
    email,
    firstName,
    courseTitle,
    courseId,
    rejectionReason,
    feedback,
  }) {
    return await this.send({
      to: email,
      subject: "📝 Course Review Update - Action Required",
      html: emailTemplates.course({
        userName: firstName,
        title: "Course Under Review",
        subtitle: "Your course needs some improvements",
        message:
          "We've reviewed your course submission. Please address the following items before resubmission to ensure it meets our quality standards.",
        courseType: "rejected",
        courseName: courseTitle,
        actionButton: "Edit Course",
        actionUrl: `${process.env.FRONTEND_URL}/instructor/courses/${courseId}/edit`,
        suggestions: [
          rejectionReason,
          feedback,
          "Review our course quality guidelines",
          "Resubmit once improvements are made",
        ].filter(Boolean),
      }),
    });
  }

  async sendPurchaseConfirmation({
    email,
    firstName,
    amount,
    currency = "INR",
    transactionId,
    courseName,
    courseUrl,
  }) {
    return await this.send({
      to: email,
      subject: "✅ Purchase Confirmed - Welcome to Your New Course!",
      html: emailTemplates.transactional({
        userName: firstName,
        title: "Purchase Successful",
        subtitle: "Your course purchase has been confirmed",
        message:
          "Thank you for your purchase! You now have lifetime access to your course. Start learning right away!",
        transactionType: "success",
        amount: amount,
        currency: currency,
        transactionId: transactionId,
        actionButton: "Access Course",
        actionUrl: courseUrl,
        details: [
          { label: "Course", value: courseName },
          { label: "Transaction ID", value: transactionId },
          { label: "Date", value: new Date().toLocaleDateString() },
          { label: "Access", value: "Lifetime" },
        ],
        footerNote:
          "You will receive a separate invoice via email within 24 hours.",
      }),
    });
  }

  async sendPaymentFailed({
    email,
    firstName,
    amount,
    currency = "INR",
    courseName,
    reason,
    retryUrl,
  }) {
    return await this.send({
      to: email,
      subject: "❌ Payment Failed - Please Try Again",
      html: emailTemplates.transactional({
        userName: firstName,
        title: "Payment Failed",
        subtitle: "Your payment could not be processed",
        message:
          "We were unable to process your payment. Please try again using a different payment method or contact your bank if the issue persists.",
        transactionType: "failed",
        amount: amount,
        currency: currency,
        actionButton: "Retry Payment",
        actionUrl: retryUrl,
        details: [
          { label: "Course", value: courseName },
          { label: "Amount", value: `${currency} ${amount}` },
          { label: "Error", value: reason },
          { label: "Date", value: new Date().toLocaleDateString() },
        ],
      }),
    });
  }

  async sendRefundProcessed({
    email,
    firstName,
    amount,
    currency = "INR",
    refundId,
    courseName,
    reason,
  }) {
    return await this.send({
      to: email,
      subject: "↩️ Refund Processed - Educademy",
      html: emailTemplates.transactional({
        userName: firstName,
        title: "Refund Processed",
        subtitle: "Your refund has been initiated",
        message:
          "Your refund request has been processed successfully. The amount will be credited to your original payment method within 5-7 business days.",
        transactionType: "refund",
        amount: amount,
        currency: currency,
        transactionId: refundId,
        details: [
          { label: "Course", value: courseName },
          { label: "Refund ID", value: refundId },
          { label: "Reason", value: reason },
          { label: "Processing Time", value: "5-7 business days" },
        ],
        footerNote:
          "The refund will appear in your original payment method within 5-7 business days.",
      }),
    });
  }

  async sendInstructorPayout({
    email,
    firstName,
    amount,
    currency = "INR",
    payoutId,
    period,
    studentCount,
  }) {
    return await this.send({
      to: email,
      subject: "💰 Instructor Payout Processed - Educademy",
      html: emailTemplates.transactional({
        userName: firstName,
        title: "Payout Processed",
        subtitle: "Your earnings have been transferred",
        message:
          "Your monthly earnings have been successfully transferred to your registered bank account. Thank you for being a valued instructor!",
        transactionType: "success",
        amount: amount,
        currency: currency,
        transactionId: payoutId,
        details: [
          { label: "Period", value: period },
          { label: "Students Taught", value: studentCount },
          { label: "Payout ID", value: payoutId },
          { label: "Transfer Date", value: new Date().toLocaleDateString() },
        ],
      }),
    });
  }

  async sendAssignmentGraded({
    email,
    firstName,
    courseName,
    assignmentTitle,
    grade,
    feedback,
    instructorName,
  }) {
    return await this.send({
      to: email,
      subject: "📝 Assignment Graded - Your Results Are Ready",
      html: emailTemplates.communication({
        userName: firstName,
        title: "Assignment Graded",
        subtitle: "Your instructor has reviewed your work",
        message:
          "Your assignment has been graded and feedback is available. Check out your results and instructor comments below.",
        communicationType: "graded",
        courseName: courseName,
        senderName: instructorName,
        grade: grade,
        feedback: feedback,
        actionButton: "View Assignment",
        actionUrl: `${process.env.FRONTEND_URL}/courses/${courseName}/assignments`,
      }),
    });
  }

  async sendCertificateIssued({
    email,
    firstName,
    courseName,
    certificateUrl,
    completionDate,
  }) {
    return await this.send({
      to: email,
      subject: "🏆 Certificate Ready - Congratulations!",
      html: emailTemplates.course({
        userName: firstName,
        title: "Certificate Ready!",
        subtitle: "Congratulations on completing your course",
        message:
          "You've successfully completed the entire course. Your certificate is now ready for download and sharing!",
        courseType: "completed",
        courseName: courseName,
        progress: 100,
        certificateUrl: certificateUrl,
        actionButton: "Download Certificate",
        actionUrl: certificateUrl,
        achievements: [
          "Completed all course materials",
          "Demonstrated mastery of key concepts",
          "Earned industry-recognized certificate",
          `Completed on: ${new Date(completionDate).toLocaleDateString()}`,
        ],
      }),
    });
  }

  async sendSystemMaintenance({
    email,
    firstName,
    maintenanceWindow,
    description,
  }) {
    return await this.send({
      to: email,
      subject: "🔧 Scheduled Maintenance - Educademy",
      html: emailTemplates.system({
        userName: firstName,
        title: "Scheduled Maintenance",
        subtitle: "Platform will be temporarily unavailable",
        message:
          "We'll be performing scheduled maintenance to improve your learning experience. During this time, the platform will be temporarily unavailable.",
        systemType: "maintenance",
        maintenanceWindow: maintenanceWindow,
        actionButton: "View Status Page",
        actionUrl: `${process.env.FRONTEND_URL}/status`,
        additionalInfo: [
          "All courses and progress will be saved automatically",
          "Mobile app will also be affected during this time",
          "We'll send another notification when maintenance is complete",
          description,
        ].filter(Boolean),
      }),
    });
  }

  async sendDataExportReady({ email, firstName, downloadUrl, expiryDate }) {
    return await this.send({
      to: email,
      subject: "📄 Data Export Ready - Download Now",
      html: emailTemplates.system({
        userName: firstName,
        title: "Data Export Ready",
        subtitle: "Your personal data export is available",
        message:
          "As requested, we've prepared your personal data export. Please download it within 7 days as the link will expire for security reasons.",
        systemType: "export",
        downloadUrl: downloadUrl,
        expiryDate: expiryDate,
        actionButton: "Download Data",
        actionUrl: downloadUrl,
        additionalInfo: [
          "File includes your profile, course progress, and certificates",
          "Data is encrypted and password-protected",
          "Link expires automatically after 7 days for security",
          "Contact support if you need assistance",
        ],
      }),
    });
  }

  async sendTestEmail(toEmail) {
    if (process.env.NODE_ENV === "production") {
      return { success: false, error: "Test emails not allowed in production" };
    }

    return await this.send({
      to: toEmail,
      subject: "🧪 Educademy Email Test",
      html: emailTemplates.verification({
        userName: "Test User",
        title: "Email Test Successful",
        subtitle: "Your email configuration is working correctly",
        message:
          "This is a test email to verify that your email configuration is working properly.",
        isSuccess: true,
        code: "123456",
        codeLabel: "Test Code",
        expirationMinutes: 10,
        actionButton: "Return to Dashboard",
        actionUrl: `${process.env.FRONTEND_URL}/dashboard`,
      }),
    });
  }

  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  getServiceInfo() {
    return {
      service: process.env.USE_TEST_EMAIL === "true" ? "ethereal" : "gmail",
      environment: process.env.NODE_ENV,
      realEmails: process.env.USE_TEST_EMAIL !== "true",
      configured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD),
      supportedTemplates: [
        "security",
        "verification",
        "transactional",
        "course",
        "communication",
        "system",
      ],
    };
  }
}

const emailService = new EmailService();
export default emailService;
