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
  // ✅ Engelleme kontrolleri
  blockUser,
  unblockUser,
  getBlockedUsers,

  // ✅ Yakın Arkadaşlar
  getMutualFollows,
  addCloseFriend,
  removeCloseFriend,

  // ✅ YENİ EKLENDİ
  getFollowingWithCloseFriendStatus,
} = require("../controllers/userController");

// ===========================================
// 📌 Profil ve Hesap Ayarları
// ===========================================
router.patch("/profile/update", verifyToken, updateProfile);
router.get("/profile/:username", getProfileByUsername);
router.get("/profile/:targetUid/status", verifyToken, getFollowStatus);

// ===========================================
// 📱 Cihaz Yönetimi
// ===========================================
router.post("/devices/save", verifyToken, saveLoginDevice);
router.get("/devices", verifyToken, getLoginDevices);

// ===========================================
// 🔒 Gizlilik ve Ayarlar
// ===========================================
router.patch("/privacy", verifyToken, updatePrivacySettings);
router.get("/:id/privacy", getPrivacySettings);
router.patch("/privacy/messages", verifyToken, updateMessagesPrivacy);
router.patch("/privacy/storyReplies", verifyToken, updateStoryRepliesPrivacy);
router.patch("/settings/hide-likes", verifyToken, updateHideLikesSetting);

// ===========================================
// 🔔 Bildirimler
// ===========================================
router.get("/notifications/settings", verifyToken, getUserNotificationSettings);
router.patch("/notifications/settings", verifyToken, updateUserNotificationSettings);
router.get("/notifications", verifyToken, getNotifications);
router.patch("/notifications/read", verifyToken, markNotificationsAsRead);
router.get("/notifications/unread-count", verifyToken, getUnreadNotificationsCount);

// ===========================================
// 👥 Takip İşlemleri
// ===========================================
router.post("/follow", verifyToken, followUser);
router.delete("/unfollow/:targetUid", verifyToken, unfollowUser);
router.delete("/follow/request/retract/:targetUid", verifyToken, retractFollowRequest);
router.post("/follow/accept/:requesterUid", verifyToken, acceptFollowRequest);
router.post("/follow/reject/:requesterUid", verifyToken, rejectFollowRequest);
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

// ⚠️ ESKİ ROTA (artık CloseFriends.jsx tarafından kullanılmayacak, ama tutuldu)
router.get("/close-friends/mutuals", verifyToken, getMutualFollows);

// ✅ YENİ ROTA — CloseFriends.jsx artık bunu kullanıyor
router.get("/close-friends/list", verifyToken, getFollowingWithCloseFriendStatus);

// Ekleme ve çıkarma rotaları (bunlar aynı kalır)
router.post("/close-friends/add/:targetUid", verifyToken, addCloseFriend);
router.delete("/close-friends/remove/:targetUid", verifyToken, removeCloseFriend);

module.exports = router;
