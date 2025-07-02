import express from "express";
import { requireInstructor } from "../../middlewares/middleware.js";
import {
  getQnAQuestions,
  answerQuestion,
  updateAnswer,
  deleteAnswer,
  getCourseReviews,
  replyToReview,
  updateReply,
  deleteReply,
  getCommunityOverview,
  bulkAnswerQuestions,
  markQuestionAsResolved,
} from "../../controllers/instructors/instructorCommunity.controller.js";

const router = express.Router();

router.use(requireInstructor);

router.get("/overview", getCommunityOverview);

router.get("/qna/questions", getQnAQuestions);
router.post("/qna/questions/:questionId/answer", answerQuestion);
router.put("/qna/answers/:answerId", updateAnswer);
router.delete("/qna/answers/:answerId", deleteAnswer);
router.patch("/qna/questions/:questionId/resolve", markQuestionAsResolved);
router.post("/qna/bulk-answer", bulkAnswerQuestions);

router.get("/reviews", getCourseReviews);
router.post("/reviews/:reviewId/reply", replyToReview);
router.put("/reviews/replies/:replyId", updateReply);
router.delete("/reviews/replies/:replyId", deleteReply);

export default router;
