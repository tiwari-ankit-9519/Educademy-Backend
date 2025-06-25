import express from "express";
import { requireInstructor } from "../../middlewares/middleware.js";
import {
  getEnrolledStudents,
  getStudentDetails,
  gradeAssignment,
  gradeQuiz,
  bulkGradeAssignments,
  getPendingGrading,
  getStudentProgress,
  getStudentAnalytics,
  sendMessageToStudent,
  announceToStudents,
  updateStudentStatus,
  issueCertificate,
  exportStudentData,
  getStudentEngagement,
  getStudentPerformance,
  getStudentCommunication,
  generateProgressReport,
  clearStudentCache,
} from "../../controllers/instructors/instructorStudent.controller.js";

const router = express.Router();

router.use(requireInstructor);

router.get("/", getEnrolledStudents);
router.get("/analytics", getStudentAnalytics);
router.get("/engagement", getStudentEngagement);
router.get("/pending-grading", getPendingGrading);
router.get("/export", exportStudentData);
router.post("/announcements", announceToStudents);
router.post("/bulk-grade", bulkGradeAssignments);
router.delete("/cache", clearStudentCache);

router.get("/:studentId/courses/:courseId", getStudentDetails);
router.get("/:studentId/courses/:courseId/progress", getStudentProgress);
router.get("/:studentId/courses/:courseId/performance", getStudentPerformance);
router.get(
  "/:studentId/courses/:courseId/communication",
  getStudentCommunication
);
router.get("/:studentId/courses/:courseId/report", generateProgressReport);
router.post("/:studentId/message", sendMessageToStudent);
router.put("/:studentId/courses/:courseId/status", updateStudentStatus);
router.post("/:studentId/courses/:courseId/certificate", issueCertificate);

router.post("/assignments/:submissionId/grade", gradeAssignment);
router.post("/quizzes/:attemptId/grade", gradeQuiz);

export default router;
