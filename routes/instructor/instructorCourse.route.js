import express from "express";
import { requireInstructor } from "../../middlewares/middleware.js";
import {
  createCourse,
  getCourses,
  getCourse,
  updateCourse,
  submitForReview,
  validateCourse,
  publishCourse,
  archiveCourse,
  deleteCourse,
  duplicateCourse,
  getCourseStats,
  getInstructorDashboard,
} from "../../controllers/instructors/instructorcourse.controller.js";

const router = express.Router();

router.use(requireInstructor);

router.get("/", getCourses);
router.post("/", createCourse);
router.get("/dashboard", getInstructorDashboard);

router.get("/:courseId", getCourse);
router.put("/:courseId", updateCourse);
router.delete("/:courseId", deleteCourse);
router.get("/:courseId/stats", getCourseStats);
router.post("/:courseId/submit", submitForReview);
router.get("/:courseId/validate", validateCourse);
router.post("/:courseId/publish", publishCourse);
router.post("/:courseId/archive", archiveCourse);
router.post("/:courseId/duplicate", duplicateCourse);

export default router;
