import express from "express";
import { isLoggedIn } from "../../middlewares/middleware.js";
import {
  getCoursesByCategory,
  getFilterOptions,
  getFeaturedCourses,
  getTrendingCourses,
  getBestsellerCourses,
  getCategories,
  getCategoryDetails,
  getCourseDetails,
  getRelatedCourses,
  getCourseReviews,
  getRecommendedCourses,
  getPopularCourses,
  getInstructorCourses,
  getCoursePlaceholder,
  getFreeCourses,
  getCatalogStats,
  getAllPublicCourses,
  getCourseById,
} from "../../controllers/student/catalog.controller.js";

const router = express.Router();

router.get("/courses", getAllPublicCourses);
router.get("/course/:courseId", getCourseById);
router.get("/filter-options", getFilterOptions);
router.get("/courses/featured", getFeaturedCourses);
router.get("/courses/trending", getTrendingCourses);
router.get("/courses/bestseller", getBestsellerCourses);
router.get("/courses/popular", getPopularCourses);
router.get("/courses/free", getFreeCourses);
router.get("/courses/recommendations", isLoggedIn, getRecommendedCourses);
router.get("/courses/placeholder", getCoursePlaceholder);
router.get("/courses/:courseSlug", getCourseDetails);
router.get("/courses/:courseSlug/related", getRelatedCourses);
router.get("/courses/:courseSlug/reviews", getCourseReviews);
router.get("/categories", getCategories);
router.get("/categories/:categorySlug", getCategoryDetails);
router.get("/categories/:categorySlug/courses", getCoursesByCategory);
router.get("/instructors/:instructorId/courses", getInstructorCourses);
router.get("/stats", getCatalogStats);

export default router;
