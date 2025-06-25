/*
  Warnings:

  - The values [DISCUSSION_REPLY] on the enum `NotificationType` will be removed. If these variants are still used in the database, this will fail.
  - The values [PAYPAL,STRIPE,CRYPTOCURRENCY] on the enum `PaymentMethod` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `isLocked` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `isPinned` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `sectionId` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `views` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `isAccepted` on the `ReviewReply` table. All the data in the column will be lost.
  - You are about to drop the column `isInstructorReply` on the `ReviewReply` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[authorId,courseId]` on the table `Review` will be added. If there are existing duplicate values, this will fail.
  - Made the column `rating` on table `Review` required. This step will fail if there are existing NULL values in that column.

*/
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
CREATE TYPE "QuizAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('RAZORPAY', 'STRIPE', 'CASHFREE', 'PAYU', 'PAYPAL');

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('ASSIGNMENT_SUBMITTED', 'ASSIGNMENT_GRADED', 'QUIZ_COMPLETED', 'QUIZ_GRADED', 'COURSE_PUBLISHED', 'NEW_ENROLLMENT', 'PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'REFUND_PROCESSED', 'SYSTEM_ANNOUNCEMENT', 'MESSAGE_RECEIVED', 'COURSE_UPDATED', 'NEW_REVIEW', 'REVIEW_REPLY', 'QNA_QUESTION', 'QNA_ANSWER', 'CERTIFICATE_ISSUED', 'COUPON_EXPIRING', 'ACHIEVEMENT_UNLOCKED', 'SUPPORT_TICKET_CREATED', 'SUPPORT_TICKET_UPDATED', 'CONTENT_REPORTED', 'ACCOUNT_BANNED', 'ACCOUNT_REACTIVATED');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethod_new" AS ENUM ('CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'NET_BANKING', 'WALLET', 'EMI', 'BANK_TRANSFER');
ALTER TABLE "Payment" ALTER COLUMN "method" TYPE "PaymentMethod_new" USING ("method"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "PaymentMethod_old";
COMMIT;

-- DropIndex
DROP INDEX "Enrollment_progress_idx";

-- DropIndex
DROP INDEX "Review_authorId_courseId_type_key";

-- DropIndex
DROP INDEX "Review_isPinned_idx";

-- DropIndex
DROP INDEX "Review_type_idx";

-- DropIndex
DROP INDEX "ReviewReply_isInstructorReply_idx";

-- AlterTable
ALTER TABLE "AssignmentSubmission" ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "gradedBy" TEXT;

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Earning" ALTER COLUMN "currency" SET DEFAULT 'INR';

-- AlterTable
ALTER TABLE "NotificationSettings" ADD COLUMN     "paymentUpdates" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "gateway" "PaymentGateway" NOT NULL DEFAULT 'RAZORPAY',
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ALTER COLUMN "currency" SET DEFAULT 'INR';

-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "feedback" TEXT,
ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "gradedBy" TEXT,
ADD COLUMN     "status" "QuizAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "Review" DROP COLUMN "isLocked",
DROP COLUMN "isPinned",
DROP COLUMN "sectionId",
DROP COLUMN "type",
DROP COLUMN "views",
ALTER COLUMN "rating" SET NOT NULL;

-- AlterTable
ALTER TABLE "ReviewReply" DROP COLUMN "isAccepted",
DROP COLUMN "isInstructorReply";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "bannedBy" TEXT,
ADD COLUMN     "isBanned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twitterProfile" TEXT;

-- DropEnum
DROP TYPE "ReviewType";

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
CREATE INDEX "SupportTicketResponse_supportTicketId_idx" ON "SupportTicketResponse"("supportTicketId");

-- CreateIndex
CREATE INDEX "SupportTicketResponse_userId_idx" ON "SupportTicketResponse"("userId");

-- CreateIndex
CREATE INDEX "SupportTicketResponse_isStaffResponse_idx" ON "SupportTicketResponse"("isStaffResponse");

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
CREATE INDEX "Payout_instructorId_idx" ON "Payout"("instructorId");

-- CreateIndex
CREATE INDEX "Payout_status_idx" ON "Payout"("status");

-- CreateIndex
CREATE INDEX "Payout_requestedAt_idx" ON "Payout"("requestedAt");

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
CREATE INDEX "QnAAnswer_instructorId_idx" ON "QnAAnswer"("instructorId");

-- CreateIndex
CREATE INDEX "QnAAnswer_questionId_idx" ON "QnAAnswer"("questionId");

-- CreateIndex
CREATE INDEX "QnAAnswer_isAccepted_idx" ON "QnAAnswer"("isAccepted");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_gradedBy_idx" ON "AssignmentSubmission"("gradedBy");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_isLate_idx" ON "AssignmentSubmission"("isLate");

-- CreateIndex
CREATE INDEX "Certificate_templateId_idx" ON "Certificate"("templateId");

-- CreateIndex
CREATE INDEX "Course_price_idx" ON "Course"("price");

-- CreateIndex
CREATE INDEX "Payment_gateway_idx" ON "Payment"("gateway");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE INDEX "QuizAttempt_status_idx" ON "QuizAttempt"("status");

-- CreateIndex
CREATE INDEX "QuizAttempt_gradedBy_idx" ON "QuizAttempt"("gradedBy");

-- CreateIndex
CREATE UNIQUE INDEX "Review_authorId_courseId_key" ON "Review"("authorId", "courseId");

-- CreateIndex
CREATE INDEX "User_isBanned_idx" ON "User"("isBanned");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_bannedBy_fkey" FOREIGN KEY ("bannedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "QnAQuestion" ADD CONSTRAINT "QnAQuestion_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnAQuestion" ADD CONSTRAINT "QnAQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnAQuestion" ADD CONSTRAINT "QnAQuestion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnAAnswer" ADD CONSTRAINT "QnAAnswer_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QnAAnswer" ADD CONSTRAINT "QnAAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QnAQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
