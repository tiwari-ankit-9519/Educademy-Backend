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
  addQuizQuestion,
  updateQuizQuestion,
  deleteQuizQuestion,
  reorderQuizQuestions,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  addLessonAttachment,
  updateLessonAttachment,
  deleteLessonAttachment,
  getContentStats,
  validateCourseContent,
  publishAllSections,
  exportCourseContent,
  importCourseContent,
  previewContent,
  searchCourseContent,
} from "../../controllers/instructors/content.controller.js";
import { requireInstructor } from "../../middlewares/middleware.js";

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

router.post("/quiz/:quizId/questions", requireInstructor, addQuizQuestion);
router.put("/question/:questionId", requireInstructor, updateQuizQuestion);
router.delete("/question/:questionId", requireInstructor, deleteQuizQuestion);
router.put(
  "/quiz/:quizId/questions/reorder",
  requireInstructor,
  reorderQuizQuestions
);

router.post(
  "/section/:sectionId/assignments",
  requireInstructor,
  createAssignment
);
router.put("/assignment/:assignmentId", requireInstructor, updateAssignment);
router.delete("/assignment/:assignmentId", requireInstructor, deleteAssignment);

router.post(
  "/lesson/:lessonId/attachments",
  requireInstructor,
  addLessonAttachment
);
router.put(
  "/attachment/:attachmentId",
  requireInstructor,
  updateLessonAttachment
);
router.delete(
  "/attachment/:attachmentId",
  requireInstructor,
  deleteLessonAttachment
);

router.post(
  "/course/:courseId/publish-sections",
  requireInstructor,
  publishAllSections
);
router.post("/course/:courseId/import", requireInstructor, importCourseContent);

export default router;
