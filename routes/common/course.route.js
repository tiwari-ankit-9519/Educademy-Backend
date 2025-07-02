import { Router } from "express";
import {
  getAllPublicCourses,
  getCourseById,
} from "../../controllers/common/course.controller.js";

const router = Router();

router.get("/all-courses", getAllPublicCourses);
router.get("/course/:courseId", getCourseById);

export default router;
