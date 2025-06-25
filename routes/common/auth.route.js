import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  verifyUser,
  requestPasswordReset,
  resetPassword,
  resendOTP,
  checkOTPStatus,
  googleAuth,
  googleAuthCallback,
  gitHubAuth,
  gitHubAuthCallback,
  exchangeAuthCode,
  getUserProfile,
  updateProfileImage,
  updateUserProfile,
  getUserSessions,
  invalidateAllSessions,
  removeProfileImage,
  requestAccountReactivation,
  checkReactivationStatus,
  getAccountSummary,
  deleteAccount,
} from "../controllers/auth.controller.js";
import { isLoggedIn } from "../../middlewares/middleware.js";

const router = Router();

router.post("/register", registerUser);
router.post("/verify", verifyUser);
router.post("/login", loginUser);
router.post("/request-password-reset", requestPasswordReset);
router.post("/reset-password", resetPassword);
router.post("/resend-otp", resendOTP);
router.get("/otp-status/:email", checkOTPStatus);
router.post("/request-reactivation", requestAccountReactivation);
router.get("/reactivation-status/:userId", checkReactivationStatus);

// OAuth routes
router.get("/google", googleAuth);
router.get("/github", gitHubAuth);
router.get("/google/callback", googleAuthCallback);
router.get("/github/callback", gitHubAuthCallback);
router.post("/exchange-code", exchangeAuthCode);

// Protected routes - Authentication required
router.get("/profile", isLoggedIn, getUserProfile);
router.put("/profile", isLoggedIn, updateUserProfile);
router.post("/profile/image", isLoggedIn, updateProfileImage);
router.delete("/profile/image", isLoggedIn, removeProfileImage);
router.get("/sessions", isLoggedIn, getUserSessions);
router.delete("/sessions", isLoggedIn, invalidateAllSessions);
router.get("/account-summary", isLoggedIn, getAccountSummary);
router.delete("/account", isLoggedIn, deleteAccount);
router.post("/logout", isLoggedIn, logoutUser);

export default router;
