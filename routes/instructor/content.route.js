import express from "express";
import {
  getCourseStructure,
  createSection,
  updateSection,
  deleteSection,
  reorderSections,
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  addQuizQuestions,
  updateQuizQuestion,
  deleteQuizQuestion,
  reorderQuizQuestions,
  submitQuizAttempt,
  getQuizResults,
  getQuizAttempts,
  getQuizDetails,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getContentStats,
  validateCourseContent,
  publishAllSections,
  exportCourseContent,
  importCourseContent,
  previewContent,
  searchCourseContent,
  getCourseSections,
  getSectionQuizzes,
  getSectionLessons,
  getQuizQuestions,
  getSingleLesson,
  getSingleQuiz,
  getAllAssignments,
} from "../../controllers/instructors/content.controller.js";
import { isLoggedIn, requireInstructor } from "../../middlewares/middleware.js";
import { uploadAssignmentResources } from "../../config/upload.js";

const router = express.Router();

router.get(
  "/course/:courseId/structure",
  requireInstructor,
  getCourseStructure
);
router.get("/course/:courseId/stats", requireInstructor, getContentStats);
router.get(
  "/course/:courseId/validate",
  requireInstructor,
  validateCourseContent
);
router.get("/course/:courseId/preview", requireInstructor, previewContent);
router.get("/course/:courseId/search", requireInstructor, searchCourseContent);
router.get("/course/:courseId/export", requireInstructor, exportCourseContent);

router.post("/course/:courseId/sections", requireInstructor, createSection);
router.put("/section/:sectionId", requireInstructor, updateSection);
router.delete("/section/:sectionId", requireInstructor, deleteSection);
router.put(
  "/course/:courseId/sections/reorder",
  requireInstructor,
  reorderSections
);

router.post("/section/:sectionId/lessons", requireInstructor, createLesson);
router.put("/lesson/:lessonId", requireInstructor, updateLesson);
router.delete("/lesson/:lessonId", requireInstructor, deleteLesson);
router.put(
  "/section/:sectionId/lessons/reorder",
  requireInstructor,
  reorderLessons
);

router.post("/section/:sectionId/quizzes", requireInstructor, createQuiz);
router.put("/quiz/:quizId", requireInstructor, updateQuiz);
router.delete("/quiz/:quizId", requireInstructor, deleteQuiz);
router.get("/quiz/:quizId", isLoggedIn, getQuizDetails); // For Student
router.get("/quiz/:quizId/attempts", requireInstructor, getQuizAttempts); // For Student

router.post("/quiz/:quizId/questions", requireInstructor, addQuizQuestions);
router.put("/question/:questionId", requireInstructor, updateQuizQuestion);
router.delete("/question/:questionId", requireInstructor, deleteQuizQuestion);
router.put(
  "/quiz/:quizId/questions/reorder",
  requireInstructor,
  reorderQuizQuestions
);

router.post("/quiz/:quizId/submit", isLoggedIn, submitQuizAttempt); // For Student
router.get("/quiz/attempt/:attemptId/results", isLoggedIn, getQuizResults); // For Student

router.post(
  "/section/:sectionId/assignments",
  requireInstructor,
  uploadAssignmentResources.array("resources", 10),
  createAssignment
);
router.get(
  "/section/:sectionId/assignments",
  requireInstructor,
  getAllAssignments
);
router.put("/assignment/:assignmentId", requireInstructor, updateAssignment);
router.delete("/assignment/:assignmentId", requireInstructor, deleteAssignment);

router.post(
  "/course/:courseId/publish-sections",
  requireInstructor,
  publishAllSections
);
router.post("/course/:courseId/import", requireInstructor, importCourseContent);

router.get("/course/:courseId/sections", requireInstructor, getCourseSections);
router.get("/section/:sectionId/quizzes", requireInstructor, getSectionQuizzes);
router.get("/section/:sectionId/lessons", requireInstructor, getSectionLessons);
router.get("/quizzes/:quizId/questions", requireInstructor, getQuizQuestions);
router.get("/lessons/:lessonId", requireInstructor, getSingleLesson);
router.get("/quizzes/:quizId", requireInstructor, getSingleQuiz);

export default router;
