// W1-Backend/routes/userRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middlewares/verifyToken");

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
} = require("../controllers/userController");

// Profil ve Hesap Ayarları
router.post("/profile/update", verifyToken, updateProfile);
router.get("/profile/:username", verifyToken, getProfileByUsername);

// Cihaz Yönetimi
router.post("/devices/save", verifyToken, saveLoginDevice);
router.get("/devices", verifyToken, getLoginDevices);

// Gizlilik ve Ayarlar
router.patch("/privacy", verifyToken, updatePrivacySettings);
router.get("/:id/privacy", getPrivacySettings);
router.patch("/privacy/messages", verifyToken, updateMessagesPrivacy);
router.patch("/privacy/storyReplies", verifyToken, updateStoryRepliesPrivacy);
router.patch("/settings/hide-likes", verifyToken, updateHideLikesSetting);

// Bildirimler
router.get("/notifications/settings", verifyToken, getUserNotificationSettings);
router.patch("/notifications/settings", verifyToken, updateUserNotificationSettings);
router.get("/notifications", verifyToken, getNotifications);

// Takip İşlemleri
router.get("/profile/:targetUid/status", verifyToken, getFollowStatus);
router.post("/follow", verifyToken, followUser);
router.delete("/unfollow/:targetUid", verifyToken, unfollowUser);
router.delete("/follow/request/retract", verifyToken, retractFollowRequest);
// ✅ Düzeltildi: Rota yolu /follow/accept olarak değiştirildi
router.post("/follow/accept/:requesterUid", verifyToken, acceptFollowRequest);
// ✅ Düzeltildi: Rota yolu /follow/reject olarak değiştirildi
router.post("/follow/reject/:requesterUid", verifyToken, rejectFollowRequest);

// Mesajlaşma
router.post("/message", verifyToken, sendMessage);

// Arama
router.get("/search", verifyToken, searchUsers);

module.exports = router;