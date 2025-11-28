// userRoutes.js
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
  // ✅ YENİ FONKSİYON EKLENDİ
  getUserContent,
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
  removeFollower,
  removeFollowing,
  markNotificationsAsRead,
  getUnreadNotificationsCount,
  blockUser,
  unblockUser,
  getBlockedUsers,
  getMutualFollows,
  addCloseFriend,
  removeCloseFriend,
  getFollowingWithCloseFriendStatus,
} = require("../controllers/userController");

// ===========================================
// 📌 Profil ve Hesap Ayarları
// ===========================================
router.patch("/profile/update", verifyToken, updateProfile);
router.get("/profile/:username", getProfileByUsername);
router.get("/profile/:targetUid/status", verifyToken, getFollowStatus);

// ✅ YENİ: Başka bir kullanıcının profil içeriğini gizlilik filtreli getirme
router.get(
  "/profile/:username/content",
  verifyToken,
  getUserContent
);

// ===========================================
// 📱 Cihaz Yönetimi
// ===========================================
router.post("/devices/save", verifyToken, saveLoginDevice);
router.get("/devices", verifyToken, getLoginDevices);

// ===========================================
// 🔒 Gizlilik ve Ayarlar
// ===========================================
router.patch("/privacy", verifyToken, updatePrivacySettings);
router.patch("/privacy/messages", verifyToken, updateMessagesPrivacy);
router.patch("/privacy/storyReplies", verifyToken, updateStoryRepliesPrivacy);
router.patch("/settings/hide-likes", verifyToken, updateHideLikesSetting);

// ===========================================
// 🔔 Bildirimler
// ===========================================
router.get("/notifications/settings", verifyToken, getUserNotificationSettings);
router.patch(
  "/notifications/settings",
  verifyToken,
  updateUserNotificationSettings
);
router.get("/notifications", verifyToken, getNotifications);
router.patch("/notifications/read", verifyToken, markNotificationsAsRead);
router.get(
  "/notifications/unread-count",
  verifyToken,
  getUnreadNotificationsCount
);

// ===========================================
// 👥 Takip İşlemleri
// ===========================================
router.post("/follow", verifyToken, followUser);
router.delete("/unfollow/:targetUid", verifyToken, unfollowUser);
router.delete(
  "/follow/request/retract/:targetUid",
  verifyToken,
  retractFollowRequest
);
router.post(
  "/follow/accept/:requesterUid",
  verifyToken,
  acceptFollowRequest
);
router.post(
  "/follow/reject/:requesterUid",
  verifyToken,
  rejectFollowRequest
);
router.get("/:targetUid/followers", verifyToken, getFollowers);
router.get("/:targetUid/following", verifyToken, getFollowing);
router.get("/requests/pending", verifyToken, getPendingRequests);
router.delete("/remove-follower/:followerUid", verifyToken, removeFollower);
router.delete("/remove-following/:followingUid", verifyToken, removeFollowing);

// ===========================================
// 🚫 Engelleme
// ===========================================
router.post("/block/:targetUid", verifyToken, blockUser);
router.delete("/unblock/:targetUid", verifyToken, unblockUser);
router.get("/blocked-list", verifyToken, getBlockedUsers);

// ===========================================
// 💬 Mesajlaşma
// ===========================================
router.post("/message", verifyToken, sendMessage);

// ===========================================
// 🔍 Arama
// ===========================================
router.get("/search", verifyToken, searchUsers);

// ===========================================
// 🟢 Yakın Arkadaşlar (Close Friends)
// ===========================================
router.get("/close-friends/mutuals", verifyToken, getMutualFollows);
router.get(
  "/close-friends/list",
  verifyToken,
  getFollowingWithCloseFriendStatus
);
router.post("/close-friends/add/:targetUid", verifyToken, addCloseFriend);
router.delete(
  "/close-friends/remove/:targetUid",
  verifyToken,
  removeCloseFriend
);


router.get("/:id/privacy", getPrivacySettings);

module.exports = router;