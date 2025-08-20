// W1-Backend/routes/userRoutes.js

const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/verifyToken');

const {
    updateProfile,
    saveLoginDevice,
    getLoginDevices,
    // Eski gizlilik ayarı güncelleme fonksiyonu
    updatePrivacySettings, 
    // Yeni gizlilik ayarı çekme fonksiyonu
    getPrivacySettings,
    // Yeni spesifik güncelleme fonksiyonları
    updateMessagesPrivacy,
    updateStoryRepliesPrivacy
} = require('../controllers/userController');

// Kullanıcı profilini güncelleme (POST isteği, token ile korumalı)
router.post('/profile/update', verifyToken, updateProfile);

// ✅ Giriş yapılan cihazları kaydetme
router.post('/devices/save', verifyToken, saveLoginDevice);

// ✅ Giriş yapılan cihazları getirme
router.get('/devices', verifyToken, getLoginDevices);

// ✅ Eski gizlilik ayarını güncelleme (genel rota)
router.patch('/privacy', verifyToken, updatePrivacySettings);

// ✅ YENİ: Kullanıcının gizlilik ayarlarını çek
router.get('/:id/privacy', getPrivacySettings);

// ✅ YENİ: Mesaj izinlerini güncelle
router.patch('/privacy/messages', verifyToken, updateMessagesPrivacy);

// ✅ YENİ: Hikaye yanıt izinlerini güncelle
router.patch('/privacy/storyReplies', verifyToken, updateStoryRepliesPrivacy);

module.exports = router;