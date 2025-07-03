import express from "express";
import {
  getCourseReviews,
  createReview,
  updateReview,
  deleteReview,
  addReviewReply,
  getCourseQnA,
  askQuestion,
  incrementQuestionViews,
  rateCourse,
} from "../../controllers/student/community.controller.js";
import { isLoggedIn, requireStudent } from "../../middlewares/middleware.js";

const router = express.Router();

router.get("/courses/:courseId/reviews", getCourseReviews); // Common

router.post("/courses/:courseId/reviews", requireStudent, createReview);

router.put("/reviews/:reviewId", isLoggedIn, updateReview);

router.delete("/reviews/:reviewId", isLoggedIn, deleteReview);

router.post("/reviews/:reviewId/replies", isLoggedIn, addReviewReply);

router.get("/courses/:courseId/qna", getCourseQnA);

router.post("/courses/:courseId/qna", requireStudent, askQuestion);

router.post("/questions/:questionId/views", incrementQuestionViews);

router.post("/courses/:courseId/rating", requireStudent, rateCourse);

export default router;
