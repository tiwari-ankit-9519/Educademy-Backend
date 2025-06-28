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
  deleteCourse,
  getCourseStats,
  getInstructorDashboard,
} from "../../controllers/instructors/instructorcourse.controller.js";
import { uploadImage } from "../../config/upload.js";

const router = express.Router();

router.use(requireInstructor);

router.get("/", getCourses);
router.post("/", uploadImage.single("thumbnail"), createCourse);
router.get("/dashboard", getInstructorDashboard);

router.get("/:courseId", getCourse);
router.put("/:courseId", uploadImage.single("thumbnail"), updateCourse);
router.delete("/:courseId", deleteCourse);
router.get("/:courseId/stats", getCourseStats);
router.post("/:courseId/submit", submitForReview);
router.get("/:courseId/validate", validateCourse);
router.post("/:courseId/publish", publishCourse);

export default router;
