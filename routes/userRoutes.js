// W1-Backend/routes/userRoutes.js

const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/verifyToken');
const {
    updateProfile,
    saveLoginDevice,
    getLoginDevices,
    updatePrivacySettings 
} = require('../controllers/userController');

// Kullanıcı profilini güncelleme (POST isteği, token ile korumalı)
router.post('/profile/update', verifyToken, updateProfile);

// ✅ Giriş yapılan cihazları kaydetme
router.post('/devices/save', verifyToken, saveLoginDevice);

// ✅ Giriş yapılan cihazları getirme
router.get('/devices', verifyToken, getLoginDevices);

// ✅ YENİ: Hesap gizliliği ayarını güncelleme
router.patch('/privacy', verifyToken, updatePrivacySettings);

module.exports = router;