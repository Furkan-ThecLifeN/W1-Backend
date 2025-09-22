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

// GENEL API İÇİN ORTA DÜZEY RATE LIMITER
const standardApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes."
});

// TAKİP, MESAJ GİBİ SIK YAPILABİLECEK VE KRİTİK İŞLEMLER İÇİN SIKI RATE LIMITER
const highFrequencyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many actions. Please wait a minute and try again."
});

// Profil ve Hesap Ayarları
// Public endpoint: Herkesin profilin temel bilgilerini görebilmesi için 'verifyToken' kaldırıldı.
router.get("/profile/:username", standardApiLimiter, getProfileByUsername); 

// Takip durumu ve istatistikleri için kimlik doğrulaması gerektiren endpoint.
router.get("/profile/:targetUid/status", verifyToken, standardApiLimiter, getFollowStatus);

// Cihaz Yönetimi
router.post("/devices/save", verifyToken, standardApiLimiter, saveLoginDevice);
router.get("/devices", verifyToken, standardApiLimiter, getLoginDevices);

// Gizlilik ve Ayarlar
router.patch("/privacy", verifyToken, standardApiLimiter, updatePrivacySettings);
router.get("/:id/privacy", standardApiLimiter, getPrivacySettings);
router.patch("/privacy/messages", verifyToken, standardApiLimiter, updateMessagesPrivacy);
router.patch("/privacy/storyReplies", verifyToken, standardApiLimiter, updateStoryRepliesPrivacy);
router.patch("/settings/hide-likes", verifyToken, standardApiLimiter, updateHideLikesSetting);

// Bildirimler
router.get("/notifications/settings", verifyToken, standardApiLimiter, getUserNotificationSettings);
router.patch("/notifications/settings", verifyToken, standardApiLimiter, updateUserNotificationSettings);
router.get("/notifications", verifyToken, standardApiLimiter, getNotifications);

// Takip İşlemleri
router.post("/follow", verifyToken, highFrequencyLimiter, followUser);
router.delete("/unfollow/:targetUid", verifyToken, highFrequencyLimiter, unfollowUser);
router.delete("/follow/request/retract", verifyToken, highFrequencyLimiter, retractFollowRequest);
router.post("/follow/accept/:requesterUid", verifyToken, highFrequencyLimiter, acceptFollowRequest);
router.post("/follow/reject/:requesterUid", verifyToken, highFrequencyLimiter, rejectFollowRequest);
router.get("/:targetUid/followers", verifyToken, standardApiLimiter, getFollowers);
router.get("/:targetUid/following", verifyToken, standardApiLimiter, getFollowing);
router.get("/requests/pending", verifyToken, standardApiLimiter, getPendingRequests);

// Mesajlaşma
router.post("/message", verifyToken, highFrequencyLimiter, sendMessage);

// Arama
router.get("/search", verifyToken, highFrequencyLimiter, searchUsers);

module.exports = router;