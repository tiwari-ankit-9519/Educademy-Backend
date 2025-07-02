import express from "express";
import {
  getEnrolledCourses,
  getCourseContent,
  accessLesson,
  completeLesson,
  accessQuiz,
  startQuizAttempt,
  submitQuizAttempt,
  createNote,
  createBookmark,
  getCertificate,
  getLearningAnalytics,
  deleteNote,
  deleteBookmark,
} from "../../controllers/student/learning.controller.js";
import { requireStudent } from "../../middlewares/middleware.js";

const router = express.Router();

router.use(requireStudent);

router.get("/courses", getEnrolledCourses);
router.get("/courses/:courseId/content", getCourseContent);
router.get("/lessons/:lessonId", accessLesson);
router.post("/lessons/:lessonId/complete", completeLesson);
router.get("/quizzes/:quizId", accessQuiz);
router.post("/quizzes/:quizId/attempts", startQuizAttempt);
router.post("/quiz-attempts/:attemptId/submit", submitQuizAttempt);
router.post("/lessons/:lessonId/notes", createNote);
router.delete("/notes/:noteId", deleteNote);
router.post("/lessons/:lessonId/bookmarks", createBookmark);
router.delete("/bookmarks/:bookmarkId", deleteBookmark);
router.get("/courses/:courseId/certificate", getCertificate);
router.get("/analytics", getLearningAnalytics);

export default router;
