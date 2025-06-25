import express from "express";
import { isLoggedIn } from "../../middlewares/middleware.js";
import {
  uploadImages,
  uploadVideos,
  uploadAudioFiles,
  uploadDocuments,
  uploadCourseContent,
  getUploadedFiles,
  deleteUploadedFile,
  getUploadLimitsInfo,
  getUploadStats,
} from "../../controllers/common/upload.controller.js";

const router = express.Router();

router.use(isLoggedIn);

router.post("/images", uploadImages);
router.post("/videos", uploadVideos);
router.post("/audio", uploadAudioFiles);
router.post("/documents", uploadDocuments);
router.post("/course-content", uploadCourseContent);

router.get("/files", getUploadedFiles);
router.get("/limits", getUploadLimitsInfo);
router.get("/stats", getUploadStats);

router.delete("/files/:fileId", deleteUploadedFile);

export default router;
