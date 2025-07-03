-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'INSTRUCTOR', 'ADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "ReactivationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('GENERAL', 'TECHNICAL', 'PAYMENT', 'COURSE_CONTENT', 'ACCOUNT', 'REFUND', 'BUG_REPORT', 'FEATURE_REQUEST');

-- CreateEnum
CREATE TYPE "ContentReportStatus" AS ENUM ('PENDING', 'REVIEWED', 'APPROVED', 'REJECTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReportContentType" AS ENUM ('REVIEW', 'REVIEW_REPLY', 'QNA_QUESTION', 'QNA_ANSWER', 'COURSE_CONTENT', 'MESSAGE');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CourseLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('LESSON', 'QUIZ', 'ASSIGNMENT', 'RESOURCE', 'LIVE_SESSION');

-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('VIDEO', 'TEXT', 'AUDIO', 'INTERACTIVE', 'DOCUMENT', 'PRESENTATION');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'SINGLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY', 'FILL_IN_BLANK', 'MATCHING', 'DRAG_DROP', 'CODE_CHALLENGE');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "QuizAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'GRADED', 'RESUBMIT_REQUESTED', 'LATE_SUBMITTED');

-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('TEXT', 'FILE', 'URL', 'MIXED', 'CODE');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'REFUNDED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'NET_BANKING', 'WALLET', 'EMI', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('RAZORPAY', 'STRIPE', 'CASHFREE', 'PAYU', 'PAYPAL');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSIGNMENT_SUBMITTED', 'ASSIGNMENT_GRADED', 'QUIZ_COMPLETED', 'QUIZ_GRADED', 'COURSE_PUBLISHED', 'NEW_ENROLLMENT', 'PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'REFUND_PROCESSED', 'SYSTEM_ANNOUNCEMENT', 'MESSAGE_RECEIVED', 'COURSE_UPDATED', 'NEW_REVIEW', 'REVIEW_REPLY', 'QNA_QUESTION', 'QNA_ANSWER', 'CERTIFICATE_ISSUED', 'COUPON_EXPIRING', 'ACHIEVEMENT_UNLOCKED', 'SUPPORT_TICKET_CREATED', 'SUPPORT_TICKET_UPDATED', 'CONTENT_REPORTED', 'ACCOUNT_BANNED', 'ACCOUNT_REACTIVATED');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "ApplicableTo" AS ENUM ('ALL_COURSES', 'SPECIFIC_COURSES', 'CATEGORY', 'INSTRUCTOR');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('DIRECT', 'ANNOUNCEMENT', 'SYSTEM', 'SUPPORT');

-- CreateEnum
CREATE TYPE "MessagePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AchievementType" AS ENUM ('COURSE_COMPLETION', 'STREAK', 'RATING', 'PARTICIPATION', 'SKILL_MASTERY', 'TIME_SPENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "salt" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "profileImage" TEXT,
    "bio" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "bannedAt" TIMESTAMP(3),
    "bannedBy" TEXT,
    "banReason" TEXT,
    "lastLogin" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "language" TEXT NOT NULL DEFAULT 'en',
    "country" TEXT,
    "phoneNumber" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "website" TEXT,
    "linkedinProfile" TEXT,
    "twitterProfile" TEXT,
    "githubProfile" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialLogin" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SocialLogin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "deviceType" TEXT,
    "operatingSystem" TEXT,
    "browser" TEXT,
    "ipAddress" TEXT,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionDuration" INTEGER,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "learningGoals" TEXT[],
    "interests" TEXT[],
    "skillLevel" "SkillLevel" NOT NULL DEFAULT 'BEGINNER',
    "totalLearningTime" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instructor" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "expertise" TEXT[],
    "rating" DOUBLE PRECISION,
    "totalStudents" INTEGER NOT NULL DEFAULT 0,
    "totalCourses" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "yearsExperience" INTEGER,
    "education" TEXT,
    "certifications" TEXT[],
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationBadge" TEXT,
    "biography" TEXT,
    "paymentDetails" JSONB,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Instructor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "permissions" TEXT[],
    "resolvedLogs" TEXT[],
    "department" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReactivationRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "additionalInfo" TEXT,
    "status" "ReactivationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "adminNotes" TEXT,
    "rejectionReason" TEXT,
    "userId" TEXT NOT NULL,
    "reviewedById" TEXT,

    CONSTRAINT "ReactivationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "category" "SupportTicketCategory" NOT NULL DEFAULT 'GENERAL',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketResponse" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "isStaffResponse" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB,
    "supportTicketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SupportTicketResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" "ContentReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "actionTaken" TEXT,
    "contentType" "ReportContentType" NOT NULL,
    "contentId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "gatewayId" TEXT,
    "gatewayResponse" JSONB,
    "instructorId" TEXT NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "thumbnail" TEXT,
    "previewVideo" TEXT,
    "introVideo" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "discountPrice" DECIMAL(10,2),
    "discountPercentage" DOUBLE PRECISION,
    "originalPrice" DECIMAL(10,2),
    "duration" INTEGER NOT NULL,
    "totalLessons" INTEGER NOT NULL DEFAULT 0,
    "totalQuizzes" INTEGER NOT NULL DEFAULT 0,
    "totalAssignments" INTEGER NOT NULL DEFAULT 0,
    "level" "CourseLevel" NOT NULL,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "bestseller" BOOLEAN NOT NULL DEFAULT false,
    "trending" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "language" TEXT NOT NULL DEFAULT 'English',
    "subtitles" TEXT[],
    "requirements" TEXT[],
    "tags" TEXT[],
    "keyPoints" TEXT[],
    "learningOutcomes" TEXT[],
    "targetAudience" TEXT[],
    "lastUpdated" TIMESTAMP(3),
    "reviewSubmittedAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "reviewerFeedback" TEXT,
    "rejectionReason" TEXT,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRatings" INTEGER NOT NULL DEFAULT 0,
    "ratingDistribution" JSONB,
    "totalEnrollments" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "completionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "instructorId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "sectionsCount" INTEGER NOT NULL DEFAULT 0,
    "publishedSectionsCount" INTEGER NOT NULL DEFAULT 0,
    "enrollmentsCount" INTEGER NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QnAQuestion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT,

    CONSTRAINT "QnAQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QnAAnswer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "isAccepted" BOOLEAN NOT NULL DEFAULT false,
    "instructorId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,

    CONSTRAINT "QnAAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "rating" SMALLINT NOT NULL,
    "pros" TEXT[],
    "cons" TEXT[],
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isHelpful" BOOLEAN NOT NULL DEFAULT false,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "authorId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewReply" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "reviewId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentReplyId" TEXT,

    CONSTRAINT "ReviewReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "estimatedTime" INTEGER,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "itemType" "ContentType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "duration" INTEGER,
    "sectionId" TEXT NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCompletion" (
    "id" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CompletionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "timeSpent" INTEGER,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "studentId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,

    CONSTRAINT "ContentCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "duration" INTEGER NOT NULL,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "isPreview" BOOLEAN NOT NULL DEFAULT false,
    "type" "LessonType" NOT NULL,
    "content" TEXT,
    "videoUrl" TEXT,
    "videoQuality" JSONB,
    "captions" JSONB,
    "transcript" TEXT,
    "resources" JSONB,
    "postLessonQuizId" TEXT,
    "sectionId" TEXT NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "duration" INTEGER NOT NULL,
    "passingScore" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isRandomized" BOOLEAN NOT NULL DEFAULT false,
    "showResults" BOOLEAN NOT NULL DEFAULT true,
    "allowReview" BOOLEAN NOT NULL DEFAULT true,
    "sectionId" TEXT,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL,
    "options" JSONB,
    "correctAnswer" TEXT,
    "explanation" TEXT,
    "hints" TEXT[],
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "tags" TEXT[],
    "quizId" TEXT NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "points" INTEGER,
    "feedback" TEXT,
    "timeSpent" INTEGER,
    "questionId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "score" INTEGER,
    "percentage" DOUBLE PRECISION,
    "isPassed" BOOLEAN,
    "attemptNumber" INTEGER NOT NULL,
    "attemptsRemaining" INTEGER,
    "timeSpent" INTEGER,
    "completedQuestions" INTEGER NOT NULL DEFAULT 0,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "status" "QuizAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "gradedAt" TIMESTAMP(3),
    "gradedBy" TEXT,
    "feedback" TEXT,
    "quizId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "totalPoints" INTEGER NOT NULL,
    "order" INTEGER,
    "instructions" TEXT NOT NULL,
    "resources" JSONB,
    "rubric" JSONB,
    "allowLateSubmission" BOOLEAN NOT NULL DEFAULT false,
    "latePenalty" DOUBLE PRECISION,
    "sectionId" TEXT NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" TEXT,
    "attachments" JSONB,
    "grade" INTEGER,
    "feedback" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "timeSpent" INTEGER,
    "submissionType" "SubmissionType" NOT NULL DEFAULT 'TEXT',
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "gradedAt" TIMESTAMP(3),
    "gradedBy" TEXT,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileType" TEXT NOT NULL,
    "isDownloadable" BOOLEAN NOT NULL DEFAULT true,
    "lessonId" TEXT NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonCompletion" (
    "id" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeSpent" INTEGER,
    "watchTime" INTEGER,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,

    CONSTRAINT "LessonCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "lessonsCompleted" INTEGER NOT NULL DEFAULT 0,
    "quizzesCompleted" INTEGER NOT NULL DEFAULT 0,
    "assignmentsCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalContentItems" INTEGER NOT NULL DEFAULT 0,
    "totalTimeSpent" INTEGER NOT NULL DEFAULT 0,
    "enrollmentSource" TEXT,
    "discountApplied" DECIMAL(10,2),
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseProgress" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "totalContentItems" INTEGER NOT NULL,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "progressPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "lessonWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "quizWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "assignmentWeight" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "currentSectionId" TEXT,
    "currentLessonId" TEXT,
    "estimatedTimeLeft" INTEGER,
    "enrollmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "CourseProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "originalAmount" DECIMAL(10,2),
    "discountAmount" DECIMAL(10,2),
    "tax" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'RAZORPAY',
    "transactionId" TEXT,
    "gatewayResponse" JSONB,
    "metadata" JSONB,
    "refundAmount" DECIMAL(10,2),
    "refundReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "invoiceUrl" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Earning" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "commission" DECIMAL(10,2) NOT NULL,
    "platformFee" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "instructorId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,

    CONSTRAINT "Earning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "templateId" TEXT,
    "enrollmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "isDelivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "data" JSONB,
    "actionUrl" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "sms" BOOLEAN NOT NULL DEFAULT false,
    "assignmentUpdates" BOOLEAN NOT NULL DEFAULT true,
    "courseUpdates" BOOLEAN NOT NULL DEFAULT true,
    "accountUpdates" BOOLEAN NOT NULL DEFAULT true,
    "marketingUpdates" BOOLEAN NOT NULL DEFAULT false,
    "discussionUpdates" BOOLEAN NOT NULL DEFAULT true,
    "reviewUpdates" BOOLEAN NOT NULL DEFAULT true,
    "paymentUpdates" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivity" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "location" TEXT,
    "sessionId" TEXT,
    "sessionTime" INTEGER,
    "page" TEXT,
    "referrer" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSettings" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowDiscussions" BOOLEAN NOT NULL DEFAULT true,
    "allowReviews" BOOLEAN NOT NULL DEFAULT true,
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "certificateEnabled" BOOLEAN NOT NULL DEFAULT true,
    "downloadable" BOOLEAN NOT NULL DEFAULT false,
    "allowPreview" BOOLEAN NOT NULL DEFAULT true,
    "autoEnrollmentEmail" BOOLEAN NOT NULL DEFAULT true,
    "sequentialProgress" BOOLEAN NOT NULL DEFAULT true,
    "passingGrade" INTEGER NOT NULL DEFAULT 70,
    "certificateTemplate" TEXT,
    "drip" BOOLEAN NOT NULL DEFAULT false,
    "dripSchedule" JSONB,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "CourseSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "CouponType" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "minimumAmount" DECIMAL(10,2),
    "maximumDiscount" DECIMAL(10,2),
    "usageLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "applicableTo" "ApplicableTo" NOT NULL DEFAULT 'ALL_COURSES',
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponUsage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discount" DECIMAL(10,2) NOT NULL,
    "couponId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CouponUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "messageType" "MessageType" NOT NULL DEFAULT 'DIRECT',
    "priority" "MessagePriority" NOT NULL DEFAULT 'NORMAL',
    "attachments" JSONB,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "note" TEXT,
    "timestamp" INTEGER,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" INTEGER,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPlan" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" TIMESTAMP(3),
    "hoursPerWeek" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "type" "AchievementType" NOT NULL,
    "criteria" JSONB NOT NULL,
    "isUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "unlockedAt" TIMESTAMP(3),
    "studentId" TEXT NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FAQ" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "FAQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CouponToCourse" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CouponToCourse_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_isBanned_idx" ON "User"("isBanned");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "SocialLogin_userId_idx" ON "SocialLogin"("userId");

-- CreateIndex
CREATE INDEX "SocialLogin_provider_idx" ON "SocialLogin"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "SocialLogin_provider_providerId_key" ON "SocialLogin"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_isActive_idx" ON "Session"("isActive");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE INDEX "Student_userId_idx" ON "Student"("userId");

-- CreateIndex
CREATE INDEX "Student_skillLevel_idx" ON "Student"("skillLevel");

-- CreateIndex
CREATE INDEX "Student_createdAt_idx" ON "Student"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Instructor_userId_key" ON "Instructor"("userId");

-- CreateIndex
CREATE INDEX "Instructor_userId_idx" ON "Instructor"("userId");

-- CreateIndex
CREATE INDEX "Instructor_rating_idx" ON "Instructor"("rating");

-- CreateIndex
CREATE INDEX "Instructor_isVerified_idx" ON "Instructor"("isVerified");

-- CreateIndex
CREATE INDEX "Instructor_totalStudents_idx" ON "Instructor"("totalStudents");

-- CreateIndex
CREATE INDEX "Instructor_totalCourses_idx" ON "Instructor"("totalCourses");

-- CreateIndex
CREATE INDEX "Instructor_createdAt_idx" ON "Instructor"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_userId_key" ON "Admin"("userId");

-- CreateIndex
CREATE INDEX "Admin_userId_idx" ON "Admin"("userId");

-- CreateIndex
CREATE INDEX "ReactivationRequest_userId_idx" ON "ReactivationRequest"("userId");

-- CreateIndex
CREATE INDEX "ReactivationRequest_reviewedById_idx" ON "ReactivationRequest"("reviewedById");

-- CreateIndex
CREATE INDEX "ReactivationRequest_status_idx" ON "ReactivationRequest"("status");

-- CreateIndex
CREATE INDEX "ReactivationRequest_createdAt_idx" ON "ReactivationRequest"("createdAt");

-- CreateIndex
CREATE INDEX "ReactivationRequest_userEmail_idx" ON "ReactivationRequest"("userEmail");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX "SupportTicket_priority_idx" ON "SupportTicket"("priority");

-- CreateIndex
CREATE INDEX "SupportTicket_category_idx" ON "SupportTicket"("category");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_idx" ON "SupportTicket"("status", "priority");

-- CreateIndex
CREATE INDEX "SupportTicketResponse_supportTicketId_idx" ON "SupportTicketResponse"("supportTicketId");

-- CreateIndex
CREATE INDEX "SupportTicketResponse_userId_idx" ON "SupportTicketResponse"("userId");

-- CreateIndex
CREATE INDEX "SupportTicketResponse_isStaffResponse_idx" ON "SupportTicketResponse"("isStaffResponse");

-- CreateIndex
CREATE INDEX "SupportTicketResponse_createdAt_idx" ON "SupportTicketResponse"("createdAt");

-- CreateIndex
CREATE INDEX "ContentReport_reportedById_idx" ON "ContentReport"("reportedById");

-- CreateIndex
CREATE INDEX "ContentReport_status_idx" ON "ContentReport"("status");

-- CreateIndex
CREATE INDEX "ContentReport_contentType_idx" ON "ContentReport"("contentType");

-- CreateIndex
CREATE INDEX "ContentReport_contentId_idx" ON "ContentReport"("contentId");

-- CreateIndex
CREATE INDEX "ContentReport_createdAt_idx" ON "ContentReport"("createdAt");

-- CreateIndex
CREATE INDEX "ContentReport_contentType_contentId_idx" ON "ContentReport"("contentType", "contentId");

-- CreateIndex
CREATE INDEX "Payout_instructorId_idx" ON "Payout"("instructorId");

-- CreateIndex
CREATE INDEX "Payout_status_idx" ON "Payout"("status");

-- CreateIndex
CREATE INDEX "Payout_requestedAt_idx" ON "Payout"("requestedAt");

-- CreateIndex
CREATE INDEX "Payout_processedAt_idx" ON "Payout"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");

-- CreateIndex
CREATE INDEX "Course_sectionsCount_idx" ON "Course"("sectionsCount");

-- CreateIndex
CREATE INDEX "Course_publishedSectionsCount_idx" ON "Course"("publishedSectionsCount");

-- CreateIndex
CREATE INDEX "Course_enrollmentsCount_idx" ON "Course"("enrollmentsCount");

-- CreateIndex
CREATE INDEX "Course_reviewsCount_idx" ON "Course"("reviewsCount");

-- CreateIndex
CREATE INDEX "Course_instructorId_idx" ON "Course"("instructorId");

-- CreateIndex
CREATE INDEX "Course_categoryId_idx" ON "Course"("categoryId");

-- CreateIndex
CREATE INDEX "Course_subcategoryId_idx" ON "Course"("subcategoryId");

-- CreateIndex
CREATE INDEX "Course_status_idx" ON "Course"("status");

-- CreateIndex
CREATE INDEX "Course_slug_idx" ON "Course"("slug");

-- CreateIndex
CREATE INDEX "Course_averageRating_idx" ON "Course"("averageRating");

-- CreateIndex
CREATE INDEX "Course_totalRatings_idx" ON "Course"("totalRatings");

-- CreateIndex
CREATE INDEX "Course_level_idx" ON "Course"("level");

-- CreateIndex
CREATE INDEX "Course_featured_idx" ON "Course"("featured");

-- CreateIndex
CREATE INDEX "Course_bestseller_idx" ON "Course"("bestseller");

-- CreateIndex
CREATE INDEX "Course_trending_idx" ON "Course"("trending");

-- CreateIndex
CREATE INDEX "Course_publishedAt_idx" ON "Course"("publishedAt");

-- CreateIndex
CREATE INDEX "Course_price_idx" ON "Course"("price");

-- CreateIndex
CREATE INDEX "Course_totalEnrollments_idx" ON "Course"("totalEnrollments");

-- CreateIndex
CREATE INDEX "Course_createdAt_idx" ON "Course"("createdAt");

-- CreateIndex
CREATE INDEX "Course_updatedAt_idx" ON "Course"("updatedAt");

-- CreateIndex
CREATE INDEX "Course_instructorId_status_idx" ON "Course"("instructorId", "status");

-- CreateIndex
CREATE INDEX "Course_instructorId_level_idx" ON "Course"("instructorId", "level");

-- CreateIndex
CREATE INDEX "Course_instructorId_categoryId_idx" ON "Course"("instructorId", "categoryId");

-- CreateIndex
CREATE INDEX "Course_instructorId_status_level_idx" ON "Course"("instructorId", "status", "level");

-- CreateIndex
CREATE INDEX "Course_instructorId_status_categoryId_idx" ON "Course"("instructorId", "status", "categoryId");

-- CreateIndex
CREATE INDEX "Course_instructorId_level_categoryId_idx" ON "Course"("instructorId", "level", "categoryId");

-- CreateIndex
CREATE INDEX "Course_instructorId_status_level_categoryId_idx" ON "Course"("instructorId", "status", "level", "categoryId");

-- CreateIndex
CREATE INDEX "Course_instructorId_updatedAt_idx" ON "Course"("instructorId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Course_instructorId_createdAt_idx" ON "Course"("instructorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Course_instructorId_publishedAt_idx" ON "Course"("instructorId", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Course_instructorId_averageRating_idx" ON "Course"("instructorId", "averageRating" DESC);

-- CreateIndex
CREATE INDEX "Course_instructorId_totalEnrollments_idx" ON "Course"("instructorId", "totalEnrollments" DESC);

-- CreateIndex
CREATE INDEX "Course_instructorId_price_idx" ON "Course"("instructorId", "price" DESC);

-- CreateIndex
CREATE INDEX "Course_instructorId_title_idx" ON "Course"("instructorId", "title");

-- CreateIndex
CREATE INDEX "Course_instructorId_status_updatedAt_idx" ON "Course"("instructorId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Course_instructorId_level_updatedAt_idx" ON "Course"("instructorId", "level", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Course_instructorId_categoryId_updatedAt_idx" ON "Course"("instructorId", "categoryId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Course_instructorId_status_level_categoryId_updatedAt_idx" ON "Course"("instructorId", "status", "level", "categoryId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Course_status_featured_bestseller_idx" ON "Course"("status", "featured", "bestseller");

-- CreateIndex
CREATE INDEX "Course_status_publishedAt_idx" ON "Course"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Course_status_averageRating_idx" ON "Course"("status", "averageRating" DESC);

-- CreateIndex
CREATE INDEX "Course_language_level_idx" ON "Course"("language", "level");

-- CreateIndex
CREATE INDEX "Course_price_discountPrice_idx" ON "Course"("price", "discountPrice");

-- CreateIndex
CREATE INDEX "QnAQuestion_studentId_idx" ON "QnAQuestion"("studentId");

-- CreateIndex
CREATE INDEX "QnAQuestion_courseId_idx" ON "QnAQuestion"("courseId");

-- CreateIndex
CREATE INDEX "QnAQuestion_lessonId_idx" ON "QnAQuestion"("lessonId");

-- CreateIndex
CREATE INDEX "QnAQuestion_isResolved_idx" ON "QnAQuestion"("isResolved");

-- CreateIndex
CREATE INDEX "QnAQuestion_createdAt_idx" ON "QnAQuestion"("createdAt");

-- CreateIndex
CREATE INDEX "QnAQuestion_courseId_isResolved_idx" ON "QnAQuestion"("courseId", "isResolved");

-- CreateIndex
CREATE INDEX "QnAQuestion_studentId_courseId_idx" ON "QnAQuestion"("studentId", "courseId");

-- CreateIndex
CREATE INDEX "QnAAnswer_instructorId_idx" ON "QnAAnswer"("instructorId");

-- CreateIndex
CREATE INDEX "QnAAnswer_questionId_idx" ON "QnAAnswer"("questionId");

-- CreateIndex
CREATE INDEX "QnAAnswer_isAccepted_idx" ON "QnAAnswer"("isAccepted");

-- CreateIndex
CREATE INDEX "QnAAnswer_createdAt_idx" ON "QnAAnswer"("createdAt");

-- CreateIndex
CREATE INDEX "Review_authorId_idx" ON "Review"("authorId");

-- CreateIndex
CREATE INDEX "Review_courseId_idx" ON "Review"("courseId");

-- CreateIndex
CREATE INDEX "Review_rating_idx" ON "Review"("rating");

-- CreateIndex
CREATE INDEX "Review_isVerified_idx" ON "Review"("isVerified");

-- CreateIndex
CREATE INDEX "Review_helpfulCount_idx" ON "Review"("helpfulCount");

-- CreateIndex
CREATE INDEX "Review_isFlagged_idx" ON "Review"("isFlagged");

-- CreateIndex
CREATE INDEX "Review_createdAt_idx" ON "Review"("createdAt");

-- CreateIndex
CREATE INDEX "Review_courseId_rating_idx" ON "Review"("courseId", "rating");

-- CreateIndex
CREATE INDEX "Review_courseId_isVerified_idx" ON "Review"("courseId", "isVerified");

-- CreateIndex
CREATE UNIQUE INDEX "Review_authorId_courseId_key" ON "Review"("authorId", "courseId");

-- CreateIndex
CREATE INDEX "ReviewReply_reviewId_idx" ON "ReviewReply"("reviewId");

-- CreateIndex
CREATE INDEX "ReviewReply_authorId_idx" ON "ReviewReply"("authorId");

-- CreateIndex
CREATE INDEX "ReviewReply_parentReplyId_idx" ON "ReviewReply"("parentReplyId");

-- CreateIndex
CREATE INDEX "ReviewReply_isFlagged_idx" ON "ReviewReply"("isFlagged");

-- CreateIndex
CREATE INDEX "ReviewReply_createdAt_idx" ON "ReviewReply"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "Category_slug_idx" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_isActive_idx" ON "Category"("isActive");

-- CreateIndex
CREATE INDEX "Category_order_idx" ON "Category"("order");

-- CreateIndex
CREATE INDEX "Category_name_idx" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Category_isActive_order_idx" ON "Category"("isActive", "order");

-- CreateIndex
CREATE INDEX "Section_courseId_idx" ON "Section"("courseId");

-- CreateIndex
CREATE INDEX "Section_isPublished_idx" ON "Section"("isPublished");

-- CreateIndex
CREATE INDEX "Section_courseId_isPublished_idx" ON "Section"("courseId", "isPublished");

-- CreateIndex
CREATE INDEX "Section_courseId_order_idx" ON "Section"("courseId", "order");

-- CreateIndex
CREATE INDEX "Section_courseId_isPublished_order_idx" ON "Section"("courseId", "isPublished", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Section_courseId_order_key" ON "Section"("courseId", "order");

-- CreateIndex
CREATE INDEX "ContentItem_sectionId_idx" ON "ContentItem"("sectionId");

-- CreateIndex
CREATE INDEX "ContentItem_itemType_idx" ON "ContentItem"("itemType");

-- CreateIndex
CREATE INDEX "ContentItem_sectionId_order_idx" ON "ContentItem"("sectionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_sectionId_order_key" ON "ContentItem"("sectionId", "order");

-- CreateIndex
CREATE INDEX "ContentCompletion_studentId_idx" ON "ContentCompletion"("studentId");

-- CreateIndex
CREATE INDEX "ContentCompletion_contentItemId_idx" ON "ContentCompletion"("contentItemId");

-- CreateIndex
CREATE INDEX "ContentCompletion_status_idx" ON "ContentCompletion"("status");

-- CreateIndex
CREATE INDEX "ContentCompletion_studentId_status_idx" ON "ContentCompletion"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentCompletion_studentId_contentItemId_key" ON "ContentCompletion"("studentId", "contentItemId");

-- CreateIndex
CREATE INDEX "Lesson_sectionId_idx" ON "Lesson"("sectionId");

-- CreateIndex
CREATE INDEX "Lesson_type_idx" ON "Lesson"("type");

-- CreateIndex
CREATE INDEX "Lesson_isFree_idx" ON "Lesson"("isFree");

-- CreateIndex
CREATE INDEX "Lesson_isPreview_idx" ON "Lesson"("isPreview");

-- CreateIndex
CREATE INDEX "Lesson_sectionId_order_idx" ON "Lesson"("sectionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_sectionId_order_key" ON "Lesson"("sectionId", "order");

-- CreateIndex
CREATE INDEX "Quiz_sectionId_idx" ON "Quiz"("sectionId");

-- CreateIndex
CREATE INDEX "Quiz_isRequired_idx" ON "Quiz"("isRequired");

-- CreateIndex
CREATE INDEX "Question_quizId_idx" ON "Question"("quizId");

-- CreateIndex
CREATE INDEX "Question_type_idx" ON "Question"("type");

-- CreateIndex
CREATE INDEX "Question_difficulty_idx" ON "Question"("difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "Question_quizId_order_key" ON "Question"("quizId", "order");

-- CreateIndex
CREATE INDEX "Answer_questionId_idx" ON "Answer"("questionId");

-- CreateIndex
CREATE INDEX "Answer_attemptId_idx" ON "Answer"("attemptId");

-- CreateIndex
CREATE INDEX "QuizAttempt_quizId_idx" ON "QuizAttempt"("quizId");

-- CreateIndex
CREATE INDEX "QuizAttempt_studentId_idx" ON "QuizAttempt"("studentId");

-- CreateIndex
CREATE INDEX "QuizAttempt_isPassed_idx" ON "QuizAttempt"("isPassed");

-- CreateIndex
CREATE INDEX "QuizAttempt_status_idx" ON "QuizAttempt"("status");

-- CreateIndex
CREATE INDEX "QuizAttempt_gradedBy_idx" ON "QuizAttempt"("gradedBy");

-- CreateIndex
CREATE INDEX "QuizAttempt_studentId_quizId_idx" ON "QuizAttempt"("studentId", "quizId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_quizId_studentId_attemptNumber_key" ON "QuizAttempt"("quizId", "studentId", "attemptNumber");

-- CreateIndex
CREATE INDEX "Assignment_sectionId_idx" ON "Assignment"("sectionId");

-- CreateIndex
CREATE INDEX "Assignment_dueDate_idx" ON "Assignment"("dueDate");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_assignmentId_idx" ON "AssignmentSubmission"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_studentId_idx" ON "AssignmentSubmission"("studentId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_status_idx" ON "AssignmentSubmission"("status");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_gradedBy_idx" ON "AssignmentSubmission"("gradedBy");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_isLate_idx" ON "AssignmentSubmission"("isLate");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_studentId_assignmentId_idx" ON "AssignmentSubmission"("studentId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_studentId_key" ON "AssignmentSubmission"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "Attachment_lessonId_idx" ON "Attachment"("lessonId");

-- CreateIndex
CREATE INDEX "Attachment_fileType_idx" ON "Attachment"("fileType");

-- CreateIndex
CREATE INDEX "LessonCompletion_studentId_idx" ON "LessonCompletion"("studentId");

-- CreateIndex
CREATE INDEX "LessonCompletion_lessonId_idx" ON "LessonCompletion"("lessonId");

-- CreateIndex
CREATE INDEX "LessonCompletion_completedAt_idx" ON "LessonCompletion"("completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LessonCompletion_studentId_lessonId_key" ON "LessonCompletion"("studentId", "lessonId");

-- CreateIndex
CREATE INDEX "Enrollment_studentId_idx" ON "Enrollment"("studentId");

-- CreateIndex
CREATE INDEX "Enrollment_courseId_idx" ON "Enrollment"("courseId");

-- CreateIndex
CREATE INDEX "Enrollment_paymentId_idx" ON "Enrollment"("paymentId");

-- CreateIndex
CREATE INDEX "Enrollment_status_idx" ON "Enrollment"("status");

-- CreateIndex
CREATE INDEX "Enrollment_createdAt_idx" ON "Enrollment"("createdAt");

-- CreateIndex
CREATE INDEX "Enrollment_courseId_status_idx" ON "Enrollment"("courseId", "status");

-- CreateIndex
CREATE INDEX "Enrollment_studentId_status_idx" ON "Enrollment"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_courseId_key" ON "Enrollment"("studentId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseProgress_enrollmentId_key" ON "CourseProgress"("enrollmentId");

-- CreateIndex
CREATE INDEX "CourseProgress_enrollmentId_idx" ON "CourseProgress"("enrollmentId");

-- CreateIndex
CREATE INDEX "CourseProgress_courseId_idx" ON "CourseProgress"("courseId");

-- CreateIndex
CREATE INDEX "CourseProgress_progressPercentage_idx" ON "CourseProgress"("progressPercentage");

-- CreateIndex
CREATE INDEX "CourseProgress_lastActivityAt_idx" ON "CourseProgress"("lastActivityAt");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_method_idx" ON "Payment"("method");

-- CreateIndex
CREATE INDEX "Payment_gateway_idx" ON "Payment"("gateway");

-- CreateIndex
CREATE INDEX "Payment_transactionId_idx" ON "Payment"("transactionId");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Earning_instructorId_idx" ON "Earning"("instructorId");

-- CreateIndex
CREATE INDEX "Earning_paymentId_idx" ON "Earning"("paymentId");

-- CreateIndex
CREATE INDEX "Earning_status_idx" ON "Earning"("status");

-- CreateIndex
CREATE INDEX "Earning_createdAt_idx" ON "Earning"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_certificateId_key" ON "Certificate"("certificateId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_enrollmentId_key" ON "Certificate"("enrollmentId");

-- CreateIndex
CREATE INDEX "Certificate_enrollmentId_idx" ON "Certificate"("enrollmentId");

-- CreateIndex
CREATE INDEX "Certificate_studentId_idx" ON "Certificate"("studentId");

-- CreateIndex
CREATE INDEX "Certificate_courseId_idx" ON "Certificate"("courseId");

-- CreateIndex
CREATE INDEX "Certificate_certificateId_idx" ON "Certificate"("certificateId");

-- CreateIndex
CREATE INDEX "Certificate_templateId_idx" ON "Certificate"("templateId");

-- CreateIndex
CREATE INDEX "Certificate_issueDate_idx" ON "Certificate"("issueDate");

-- CreateIndex
CREATE INDEX "CartItem_studentId_idx" ON "CartItem"("studentId");

-- CreateIndex
CREATE INDEX "CartItem_courseId_idx" ON "CartItem"("courseId");

-- CreateIndex
CREATE INDEX "CartItem_createdAt_idx" ON "CartItem"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_studentId_courseId_key" ON "CartItem"("studentId", "courseId");

-- CreateIndex
CREATE INDEX "WishlistItem_studentId_idx" ON "WishlistItem"("studentId");

-- CreateIndex
CREATE INDEX "WishlistItem_courseId_idx" ON "WishlistItem"("courseId");

-- CreateIndex
CREATE INDEX "WishlistItem_createdAt_idx" ON "WishlistItem"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_studentId_courseId_key" ON "WishlistItem"("studentId", "courseId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_priority_idx" ON "Notification"("priority");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_userId_key" ON "NotificationSettings"("userId");

-- CreateIndex
CREATE INDEX "UserActivity_userId_idx" ON "UserActivity"("userId");

-- CreateIndex
CREATE INDEX "UserActivity_action_idx" ON "UserActivity"("action");

-- CreateIndex
CREATE INDEX "UserActivity_createdAt_idx" ON "UserActivity"("createdAt");

-- CreateIndex
CREATE INDEX "UserActivity_userId_createdAt_idx" ON "UserActivity"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSettings_courseId_key" ON "CourseSettings"("courseId");

-- CreateIndex
CREATE INDEX "CourseSettings_courseId_idx" ON "CourseSettings"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_code_idx" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_isActive_idx" ON "Coupon"("isActive");

-- CreateIndex
CREATE INDEX "Coupon_validFrom_validUntil_idx" ON "Coupon"("validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "Coupon_createdById_idx" ON "Coupon"("createdById");

-- CreateIndex
CREATE INDEX "Coupon_isActive_validFrom_validUntil_idx" ON "Coupon"("isActive", "validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "CouponUsage_couponId_idx" ON "CouponUsage"("couponId");

-- CreateIndex
CREATE INDEX "CouponUsage_paymentId_idx" ON "CouponUsage"("paymentId");

-- CreateIndex
CREATE INDEX "CouponUsage_userId_idx" ON "CouponUsage"("userId");

-- CreateIndex
CREATE INDEX "CouponUsage_createdAt_idx" ON "CouponUsage"("createdAt");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Message_receiverId_idx" ON "Message"("receiverId");

-- CreateIndex
CREATE INDEX "Message_isRead_idx" ON "Message"("isRead");

-- CreateIndex
CREATE INDEX "Message_messageType_idx" ON "Message"("messageType");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "Message_receiverId_isRead_idx" ON "Message"("receiverId", "isRead");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "Bookmark_userId_idx" ON "Bookmark"("userId");

-- CreateIndex
CREATE INDEX "Bookmark_courseId_idx" ON "Bookmark"("courseId");

-- CreateIndex
CREATE INDEX "Bookmark_lessonId_idx" ON "Bookmark"("lessonId");

-- CreateIndex
CREATE INDEX "Bookmark_userId_courseId_idx" ON "Bookmark"("userId", "courseId");

-- CreateIndex
CREATE INDEX "Note_userId_idx" ON "Note"("userId");

-- CreateIndex
CREATE INDEX "Note_lessonId_idx" ON "Note"("lessonId");

-- CreateIndex
CREATE INDEX "Note_userId_lessonId_idx" ON "Note"("userId", "lessonId");

-- CreateIndex
CREATE INDEX "StudyPlan_studentId_idx" ON "StudyPlan"("studentId");

-- CreateIndex
CREATE INDEX "StudyPlan_isActive_idx" ON "StudyPlan"("isActive");

-- CreateIndex
CREATE INDEX "StudyPlan_studentId_isActive_idx" ON "StudyPlan"("studentId", "isActive");

-- CreateIndex
CREATE INDEX "Achievement_studentId_idx" ON "Achievement"("studentId");

-- CreateIndex
CREATE INDEX "Achievement_type_idx" ON "Achievement"("type");

-- CreateIndex
CREATE INDEX "Achievement_isUnlocked_idx" ON "Achievement"("isUnlocked");

-- CreateIndex
CREATE INDEX "Achievement_studentId_type_idx" ON "Achievement"("studentId", "type");

-- CreateIndex
CREATE INDEX "FAQ_courseId_idx" ON "FAQ"("courseId");

-- CreateIndex
CREATE INDEX "FAQ_isActive_idx" ON "FAQ"("isActive");

-- CreateIndex
CREATE INDEX "FAQ_order_idx" ON "FAQ"("order");

-- CreateIndex
CREATE INDEX "FAQ_courseId_isActive_order_idx" ON "FAQ"("courseId", "isActive", "order");

-- CreateIndex
CREATE INDEX "_CouponToCourse_B_index" ON "_CouponToCourse"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_bannedBy_fkey" FOREIGN KEY ("bannedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialLogin" ADD CONSTRAINT "SocialLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactivationRequest" ADD CONSTRAINT "ReactivationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactivationRequest" ADD CONSTRAINT "ReactivationRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketResponse" ADD CONSTRAINT "SupportTicketResponse_supportTicketId_fkey" FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketResponse" ADD CONSTRAINT "SupportTicketResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnAQuestion" ADD CONSTRAINT "QnAQuestion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnAQuestion" ADD CONSTRAINT "QnAQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnAQuestion" ADD CONSTRAINT "QnAQuestion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnAAnswer" ADD CONSTRAINT "QnAAnswer_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnAAnswer" ADD CONSTRAINT "QnAAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QnAQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_parentReplyId_fkey" FOREIGN KEY ("parentReplyId") REFERENCES "ReviewReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCompletion" ADD CONSTRAINT "ContentCompletion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCompletion" ADD CONSTRAINT "ContentCompletion_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_postLessonQuizId_fkey" FOREIGN KEY ("postLessonQuizId") REFERENCES "Quiz"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonCompletion" ADD CONSTRAINT "LessonCompletion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonCompletion" ADD CONSTRAINT "LessonCompletion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseProgress" ADD CONSTRAINT "CourseProgress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseProgress" ADD CONSTRAINT "CourseProgress_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Earning" ADD CONSTRAINT "Earning_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Earning" ADD CONSTRAINT "Earning_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivity" ADD CONSTRAINT "UserActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSettings" ADD CONSTRAINT "CourseSettings_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsage" ADD CONSTRAINT "CouponUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FAQ" ADD CONSTRAINT "FAQ_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CouponToCourse" ADD CONSTRAINT "_CouponToCourse_A_fkey" FOREIGN KEY ("A") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CouponToCourse" ADD CONSTRAINT "_CouponToCourse_B_fkey" FOREIGN KEY ("B") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Function to update course counts (with error handling)
CREATE OR REPLACE FUNCTION update_course_counts(course_id_param text)
RETURNS void AS $$
BEGIN
  UPDATE "Course"
  SET 
    "sectionsCount" = COALESCE((
      SELECT COUNT(*) FROM "Section" WHERE "courseId" = course_id_param
    ), 0),
    "publishedSectionsCount" = COALESCE((
      SELECT COUNT(*) FROM "Section" WHERE "courseId" = course_id_param AND "isPublished" = true
    ), 0),
    "enrollmentsCount" = COALESCE((
      SELECT COUNT(*) FROM "Enrollment" 
      WHERE "courseId" = course_id_param AND "status" IN ('ACTIVE', 'COMPLETED')
    ), 0),
    "reviewsCount" = COALESCE((
      SELECT COUNT(*) FROM "Review" WHERE "courseId" = course_id_param
    ), 0),
    "updatedAt" = NOW()
  WHERE id = course_id_param;
END;
$$ LANGUAGE plpgsql;

-- Initialize counts for ALL courses (including those without sections/enrollments/reviews)
UPDATE "Course" 
SET 
  "sectionsCount" = COALESCE(sections_data.sections_count, 0),
  "publishedSectionsCount" = COALESCE(sections_data.published_count, 0),
  "enrollmentsCount" = COALESCE(enrollments_data.enrollments_count, 0),
  "reviewsCount" = COALESCE(reviews_data.reviews_count, 0),
  "updatedAt" = NOW()
FROM (
  -- Get all courses first, then LEFT JOIN with counts
  SELECT DISTINCT id as course_id FROM "Course"
) all_courses
LEFT JOIN (
  SELECT 
    "courseId",
    COUNT(*) as sections_count,
    COUNT(CASE WHEN "isPublished" = true THEN 1 END) as published_count
  FROM "Section"
  GROUP BY "courseId"
) sections_data ON all_courses.course_id = sections_data."courseId"
LEFT JOIN (
  SELECT "courseId", COUNT(*) as enrollments_count
  FROM "Enrollment"
  WHERE "status" IN ('ACTIVE', 'COMPLETED')
  GROUP BY "courseId"
) enrollments_data ON all_courses.course_id = enrollments_data."courseId"
LEFT JOIN (
  SELECT "courseId", COUNT(*) as reviews_count
  FROM "Review"
  GROUP BY "courseId"
) reviews_data ON all_courses.course_id = reviews_data."courseId"
WHERE "Course".id = all_courses.course_id;

-- Improved trigger function for sections with bounds checking
CREATE OR REPLACE FUNCTION update_course_sections_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Course"
    SET 
      "sectionsCount" = GREATEST("sectionsCount" + 1, 0),
      "publishedSectionsCount" = GREATEST("publishedSectionsCount" + CASE WHEN NEW."isPublished" = true THEN 1 ELSE 0 END, 0),
      "updatedAt" = NOW()
    WHERE id = NEW."courseId";
    RETURN NEW;
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only update if publication status changed
    IF OLD."isPublished" != NEW."isPublished" THEN
      UPDATE "Course"
      SET 
        "publishedSectionsCount" = GREATEST("publishedSectionsCount" + 
          CASE WHEN NEW."isPublished" = true THEN 1 ELSE -1 END, 0),
        "updatedAt" = NOW()
      WHERE id = NEW."courseId";
    END IF;
    RETURN NEW;
    
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "Course"
    SET 
      "sectionsCount" = GREATEST("sectionsCount" - 1, 0),
      "publishedSectionsCount" = GREATEST("publishedSectionsCount" - CASE WHEN OLD."isPublished" = true THEN 1 ELSE 0 END, 0),
      "updatedAt" = NOW()
    WHERE id = OLD."courseId";
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Improved trigger function for enrollments with status filtering
CREATE OR REPLACE FUNCTION update_course_enrollments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only count ACTIVE and COMPLETED enrollments
    IF NEW."status" IN ('ACTIVE', 'COMPLETED') THEN
      UPDATE "Course" 
      SET 
        "enrollmentsCount" = GREATEST("enrollmentsCount" + 1, 0),
        "updatedAt" = NOW()
      WHERE id = NEW."courseId";
    END IF;
    RETURN NEW;
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Handle status changes
    IF OLD."status" != NEW."status" THEN
      IF OLD."status" IN ('ACTIVE', 'COMPLETED') AND NEW."status" NOT IN ('ACTIVE', 'COMPLETED') THEN
        -- Enrollment became inactive
        UPDATE "Course" 
        SET 
          "enrollmentsCount" = GREATEST("enrollmentsCount" - 1, 0),
          "updatedAt" = NOW()
        WHERE id = NEW."courseId";
      ELSIF OLD."status" NOT IN ('ACTIVE', 'COMPLETED') AND NEW."status" IN ('ACTIVE', 'COMPLETED') THEN
        -- Enrollment became active
        UPDATE "Course" 
        SET 
          "enrollmentsCount" = GREATEST("enrollmentsCount" + 1, 0),
          "updatedAt" = NOW()
        WHERE id = NEW."courseId";
      END IF;
    END IF;
    RETURN NEW;
    
  ELSIF TG_OP = 'DELETE' THEN
    -- Only decrease count if the deleted enrollment was active
    IF OLD."status" IN ('ACTIVE', 'COMPLETED') THEN
      UPDATE "Course" 
      SET 
        "enrollmentsCount" = GREATEST("enrollmentsCount" - 1, 0),
        "updatedAt" = NOW()
      WHERE id = OLD."courseId";
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Improved trigger function for reviews
CREATE OR REPLACE FUNCTION update_course_reviews_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Course" 
    SET 
      "reviewsCount" = GREATEST("reviewsCount" + 1, 0),
      "updatedAt" = NOW()
    WHERE id = NEW."courseId";
    RETURN NEW;
    
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "Course" 
    SET 
      "reviewsCount" = GREATEST("reviewsCount" - 1, 0),
      "updatedAt" = NOW()
    WHERE id = OLD."courseId";
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to update instructor stats
CREATE OR REPLACE FUNCTION update_instructor_stats(instructor_id_param text)
RETURNS void AS $$
BEGIN
  UPDATE "Instructor"
  SET 
    "totalCourses" = COALESCE((
      SELECT COUNT(*) FROM "Course" 
      WHERE "instructorId" = instructor_id_param AND "status" = 'PUBLISHED'
    ), 0),
    "totalStudents" = COALESCE((
      SELECT COUNT(DISTINCT "studentId") FROM "Enrollment" e
      JOIN "Course" c ON e."courseId" = c.id
      WHERE c."instructorId" = instructor_id_param 
      AND e."status" IN ('ACTIVE', 'COMPLETED')
    ), 0),
    "updatedAt" = NOW()
  WHERE id = instructor_id_param;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for instructor stats when courses change
CREATE OR REPLACE FUNCTION update_instructor_stats_on_course()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM update_instructor_stats(NEW."instructorId");
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM update_instructor_stats(OLD."instructorId");
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for instructor stats when enrollments change
CREATE OR REPLACE FUNCTION update_instructor_stats_on_enrollment()
RETURNS TRIGGER AS $$
DECLARE
  instructor_id_val text;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    SELECT "instructorId" INTO instructor_id_val 
    FROM "Course" WHERE id = NEW."courseId";
    PERFORM update_instructor_stats(instructor_id_val);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT "instructorId" INTO instructor_id_val 
    FROM "Course" WHERE id = OLD."courseId";
    PERFORM update_instructor_stats(instructor_id_val);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers
DROP TRIGGER IF EXISTS trigger_update_course_sections_count ON "Section";
DROP TRIGGER IF EXISTS trigger_update_course_enrollments_count ON "Enrollment";
DROP TRIGGER IF EXISTS trigger_update_course_reviews_count ON "Review";
DROP TRIGGER IF EXISTS trigger_update_instructor_stats_on_course ON "Course";
DROP TRIGGER IF EXISTS trigger_update_instructor_stats_on_enrollment ON "Enrollment";

-- Create triggers for course counts
CREATE TRIGGER trigger_update_course_sections_count
  AFTER INSERT OR UPDATE OR DELETE ON "Section"
  FOR EACH ROW EXECUTE FUNCTION update_course_sections_count();

CREATE TRIGGER trigger_update_course_enrollments_count
  AFTER INSERT OR UPDATE OR DELETE ON "Enrollment"
  FOR EACH ROW EXECUTE FUNCTION update_course_enrollments_count();

CREATE TRIGGER trigger_update_course_reviews_count
  AFTER INSERT OR DELETE ON "Review"
  FOR EACH ROW EXECUTE FUNCTION update_course_reviews_count();

-- Create triggers for instructor stats
CREATE TRIGGER trigger_update_instructor_stats_on_course
  AFTER INSERT OR UPDATE OF "status" OR DELETE ON "Course"
  FOR EACH ROW EXECUTE FUNCTION update_instructor_stats_on_course();

CREATE TRIGGER trigger_update_instructor_stats_on_enrollment
  AFTER INSERT OR UPDATE OF "status" OR DELETE ON "Enrollment"
  FOR EACH ROW EXECUTE FUNCTION update_instructor_stats_on_enrollment();

-- Initialize instructor stats for existing instructors
UPDATE "Instructor" 
SET 
  "totalCourses" = COALESCE(courses_data.courses_count, 0),
  "totalStudents" = COALESCE(students_data.students_count, 0),
  "updatedAt" = NOW()
FROM (
  SELECT 
    "instructorId",
    COUNT(*) as courses_count
  FROM "Course"
  WHERE "status" = 'PUBLISHED'
  GROUP BY "instructorId"
) courses_data
LEFT JOIN (
  SELECT 
    c."instructorId",
    COUNT(DISTINCT e."studentId") as students_count
  FROM "Enrollment" e
  JOIN "Course" c ON e."courseId" = c.id
  WHERE e."status" IN ('ACTIVE', 'COMPLETED')
  GROUP BY c."instructorId"
) students_data ON courses_data."instructorId" = students_data."instructorId"
WHERE "Instructor".id = courses_data."instructorId";

-- Handle instructors with no courses
UPDATE "Instructor" 
SET 
  "totalCourses" = 0,
  "totalStudents" = 0,
  "updatedAt" = NOW()
WHERE id NOT IN (
  SELECT DISTINCT "instructorId" FROM "Course" WHERE "status" = 'PUBLISHED'
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_section_course_published ON "Section" ("courseId", "isPublished");
CREATE INDEX IF NOT EXISTS idx_enrollment_course_status ON "Enrollment" ("courseId", "status");
CREATE INDEX IF NOT EXISTS idx_enrollment_student_status ON "Enrollment" ("studentId", "status");
CREATE INDEX IF NOT EXISTS idx_review_course ON "Review" ("courseId");
CREATE INDEX IF NOT EXISTS idx_course_instructor_status ON "Course" ("instructorId", "status");