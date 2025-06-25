/*
  Warnings:

  - You are about to drop the column `template` on the `Certificate` table. All the data in the column will be lost.
  - You are about to drop the column `studentId` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `studentId` on the `ReviewReply` table. All the data in the column will be lost.
  - You are about to drop the column `device` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `twitterProfile` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `UserActivity` table. All the data in the column will be lost.
  - You are about to drop the `Activity` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CourseAnalytics` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DeviceSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Discussion` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DiscussionReply` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MonthlyAnalytics` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `logs` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[authorId,courseId,type]` on the table `Review` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `authorId` to the `Review` table without a default value. This is not possible if the table is not empty.
  - Made the column `content` on table `Review` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "ReactivationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('REVIEW', 'DISCUSSION', 'QUESTION');

-- CreateEnum
CREATE TYPE "AnalyticsPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "AnalyticsScope" AS ENUM ('PLATFORM', 'COURSE', 'INSTRUCTOR', 'CATEGORY');

-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_userId_fkey";

-- DropForeignKey
ALTER TABLE "CourseAnalytics" DROP CONSTRAINT "CourseAnalytics_courseId_fkey";

-- DropForeignKey
ALTER TABLE "DeviceSession" DROP CONSTRAINT "DeviceSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "Discussion" DROP CONSTRAINT "Discussion_authorId_fkey";

-- DropForeignKey
ALTER TABLE "Discussion" DROP CONSTRAINT "Discussion_courseId_fkey";

-- DropForeignKey
ALTER TABLE "Discussion" DROP CONSTRAINT "Discussion_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "DiscussionReply" DROP CONSTRAINT "DiscussionReply_authorId_fkey";

-- DropForeignKey
ALTER TABLE "DiscussionReply" DROP CONSTRAINT "DiscussionReply_discussionId_fkey";

-- DropForeignKey
ALTER TABLE "DiscussionReply" DROP CONSTRAINT "DiscussionReply_parentReplyId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_studentId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_userId_fkey";

-- DropForeignKey
ALTER TABLE "ReviewReply" DROP CONSTRAINT "ReviewReply_studentId_fkey";

-- DropIndex
DROP INDEX "Review_studentId_courseId_key";

-- DropIndex
DROP INDEX "Review_studentId_idx";

-- AlterTable
ALTER TABLE "Analytics" ADD COLUMN     "ageGroups" JSONB,
ADD COLUMN     "avgTimeSpent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "completions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "countries" JSONB,
ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "dropOffPoints" JSONB,
ADD COLUMN     "engagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "period" "AnalyticsPeriod" NOT NULL DEFAULT 'DAILY',
ADD COLUMN     "refundRequests" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revenueGrowth" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "scope" "AnalyticsScope" NOT NULL DEFAULT 'PLATFORM',
ADD COLUMN     "scopeId" TEXT,
ADD COLUMN     "topCategories" JSONB,
ADD COLUMN     "topInstructors" JSONB,
ADD COLUMN     "totalViews" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "userRetentionRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Certificate" DROP COLUMN "template";

-- AlterTable
ALTER TABLE "Review" DROP COLUMN "studentId",
DROP COLUMN "userId",
ADD COLUMN     "authorId" TEXT NOT NULL,
ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "isFlagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sectionId" TEXT,
ADD COLUMN     "type" "ReviewType" NOT NULL DEFAULT 'REVIEW',
ADD COLUMN     "views" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "rating" DROP NOT NULL,
ALTER COLUMN "content" SET NOT NULL;

-- AlterTable
ALTER TABLE "ReviewReply" DROP COLUMN "studentId",
ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "isAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFlagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isInstructorReply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "likes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parentReplyId" TEXT;

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "device",
ADD COLUMN     "browser" TEXT,
ADD COLUMN     "deviceType" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "operatingSystem" TEXT,
ADD COLUMN     "sessionDuration" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "twitterProfile";

-- AlterTable
ALTER TABLE "UserActivity" DROP COLUMN "metadata",
ADD COLUMN     "details" JSONB,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- DropTable
DROP TABLE "Activity";

-- DropTable
DROP TABLE "CourseAnalytics";

-- DropTable
DROP TABLE "DeviceSession";

-- DropTable
DROP TABLE "Discussion";

-- DropTable
DROP TABLE "DiscussionReply";

-- DropTable
DROP TABLE "MonthlyAnalytics";

-- DropTable
DROP TABLE "logs";

-- DropEnum
DROP TYPE "LogCategory";

-- DropEnum
DROP TYPE "LogSeverity";

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
CREATE INDEX "Analytics_period_idx" ON "Analytics"("period");

-- CreateIndex
CREATE INDEX "Analytics_scope_idx" ON "Analytics"("scope");

-- CreateIndex
CREATE INDEX "Analytics_scopeId_idx" ON "Analytics"("scopeId");

-- CreateIndex
CREATE INDEX "Review_authorId_idx" ON "Review"("authorId");

-- CreateIndex
CREATE INDEX "Review_type_idx" ON "Review"("type");

-- CreateIndex
CREATE INDEX "Review_isFlagged_idx" ON "Review"("isFlagged");

-- CreateIndex
CREATE INDEX "Review_isPinned_idx" ON "Review"("isPinned");

-- CreateIndex
CREATE UNIQUE INDEX "Review_authorId_courseId_type_key" ON "Review"("authorId", "courseId", "type");

-- CreateIndex
CREATE INDEX "ReviewReply_parentReplyId_idx" ON "ReviewReply"("parentReplyId");

-- CreateIndex
CREATE INDEX "ReviewReply_isInstructorReply_idx" ON "ReviewReply"("isInstructorReply");

-- CreateIndex
CREATE INDEX "ReviewReply_isFlagged_idx" ON "ReviewReply"("isFlagged");

-- CreateIndex
CREATE INDEX "Session_isActive_idx" ON "Session"("isActive");

-- AddForeignKey
ALTER TABLE "ReactivationRequest" ADD CONSTRAINT "ReactivationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactivationRequest" ADD CONSTRAINT "ReactivationRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_parentReplyId_fkey" FOREIGN KEY ("parentReplyId") REFERENCES "ReviewReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
