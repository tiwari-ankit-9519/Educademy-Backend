import express from "express";
import { isLoggedIn } from "../../middlewares/middleware.js";
import {
  searchCourses,
  searchInstructors,
  searchContent,
  getSearchSuggestions,
  getSearchHistory,
  clearSearchHistory,
  getPopularSearches,
  getSearchFilters,
} from "../controllers/search.controller.js";

const router = express.Router();

router.get("/courses", searchCourses);
router.get("/instructors", searchInstructors);
router.get("/suggestions", getSearchSuggestions);
router.get("/popular", getPopularSearches);
router.get("/filters", getSearchFilters);

router.use(isLoggedIn);

router.get("/content", searchContent);
router.get("/history", getSearchHistory);
router.delete("/history", clearSearchHistory);

export default router;
