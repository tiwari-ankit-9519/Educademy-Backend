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
  reportContent,
} from "../../controllers/student/community.controller.js";
import { isLoggedIn } from "../../middlewares/middleware.js";

const router = express.Router();

router.get("/courses/:courseId/reviews", getCourseReviews);

router.post("/courses/:courseId/reviews", isLoggedIn, createReview);

router.put("/reviews/:reviewId", isLoggedIn, updateReview);

router.delete("/reviews/:reviewId", isLoggedIn, deleteReview);

router.post("/reviews/:reviewId/replies", isLoggedIn, addReviewReply);

router.get("/courses/:courseId/qna", getCourseQnA);

router.post("/courses/:courseId/qna", isLoggedIn, askQuestion);

router.post("/questions/:questionId/views", isLoggedIn, incrementQuestionViews);

router.post("/report", isLoggedIn, reportContent);

export default router;
