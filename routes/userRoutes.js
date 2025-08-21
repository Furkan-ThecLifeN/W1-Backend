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
  searchUsers
} = require("../controllers/userController");

// Kullanıcı profilini güncelleme (POST isteği, token ile korumalı)
router.post("/profile/update", verifyToken, updateProfile);

// ✅ Giriş yapılan cihazları kaydetme
router.post("/devices/save", verifyToken, saveLoginDevice);

// ✅ Giriş yapılan cihazları getirme
router.get("/devices", verifyToken, getLoginDevices);

// ✅ Eski gizlilik ayarını güncelleme (genel rota)
router.patch("/privacy", verifyToken, updatePrivacySettings);

// ✅ YENİ: Kullanıcının gizlilik ayarlarını çek
router.get("/:id/privacy", getPrivacySettings);

// ✅ YENİ: Mesaj izinlerini güncelle
router.patch("/privacy/messages", verifyToken, updateMessagesPrivacy);

// ✅ YENİ: Hikaye yanıt izinlerini güncelle
router.patch("/privacy/storyReplies", verifyToken, updateStoryRepliesPrivacy);

// ✅ YENİ: Beğenileri gizleme ayarını güncelleme
router.patch("/settings/hide-likes", verifyToken, updateHideLikesSetting);

// ✅ Yeni: Bildirim ayarlarını getirme ve güncelleme rotaları
router.get('/notifications/settings', verifyToken, getUserNotificationSettings);
router.patch('/notifications/settings', verifyToken, updateUserNotificationSettings);

// ✅ Yeni: Kullanıcı arama rotası
router.get("/search", verifyToken, searchUsers);

module.exports = router;
