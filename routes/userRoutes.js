// userRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middlewares/verifyToken");
const rateLimit = require("express-rate-limit");

const {
  updateProfile,
  saveLoginDevice,
  getLoginDevices,
  updatePrivacySettings,
  getPrivacySettings,
  updateMessagesPrivacy,
  updateStoryRepliesPrivacy,
  updateHideLikesSetting,
  getUserNotificationSettings,
  updateUserNotificationSettings,
  searchUsers,
  getProfileByUsername,
  getFollowStatus,
  followUser,
  unfollowUser,
  retractFollowRequest,
  acceptFollowRequest,
  rejectFollowRequest,
  sendMessage,
  getNotifications,
  getFollowers,
  getFollowing,
  getPendingRequests,
} = require("../controllers/userController");

// Configure the rate limiter for general API requests
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes."
});

// Profil ve Hesap Ayarları
router.post("/profile/update", verifyToken, apiLimiter, updateProfile);
router.get("/profile/:username", verifyToken, apiLimiter, getProfileByUsername);

// Cihaz Yönetimi
router.post("/devices/save", verifyToken, apiLimiter, saveLoginDevice);
router.get("/devices", verifyToken, apiLimiter, getLoginDevices);

// Gizlilik ve Ayarlar
router.patch("/privacy", verifyToken, apiLimiter, updatePrivacySettings);
router.get("/:id/privacy", apiLimiter, getPrivacySettings);
router.patch("/privacy/messages", verifyToken, apiLimiter, updateMessagesPrivacy);
router.patch("/privacy/storyReplies", verifyToken, apiLimiter, updateStoryRepliesPrivacy);
router.patch("/settings/hide-likes", verifyToken, apiLimiter, updateHideLikesSetting);

// Bildirimler
router.get("/notifications/settings", verifyToken, apiLimiter, getUserNotificationSettings);
router.patch("/notifications/settings", verifyToken, apiLimiter, updateUserNotificationSettings);
router.get("/notifications", verifyToken, apiLimiter, getNotifications);

// Takip İşlemleri
router.get("/profile/:targetUid/status", verifyToken, apiLimiter, getFollowStatus);
router.post("/follow", verifyToken, apiLimiter, followUser);
router.delete("/unfollow/:targetUid", verifyToken, apiLimiter, unfollowUser);
router.delete("/follow/request/retract", verifyToken, apiLimiter, retractFollowRequest);
router.post("/follow/accept/:requesterUid", verifyToken, apiLimiter, acceptFollowRequest);
router.post("/follow/reject/:requesterUid", verifyToken, apiLimiter, rejectFollowRequest);
router.get("/:targetUid/followers", verifyToken, apiLimiter, getFollowers);
router.get("/:targetUid/following", verifyToken, apiLimiter, getFollowing);
router.get("/requests/pending", verifyToken, apiLimiter, getPendingRequests);

// Mesajlaşma
router.post("/message", verifyToken, apiLimiter, sendMessage);

// Arama
router.get("/search", verifyToken, apiLimiter, searchUsers);

module.exports = router;