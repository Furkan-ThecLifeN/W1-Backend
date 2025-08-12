// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/verifyToken');

const {
  registerUser,
  resolveUserIdentifier,
  getProfile,
  googleSignIn
} = require('../controllers/authController');

// Kullanıcı Kayıt
router.post('/register', registerUser);

// Giriş öncesi email/username çözümleme
router.post('/resolve-identifier', resolveUserIdentifier);

// Google ile giriş
router.post('/google-signin', googleSignIn);

// Kullanıcı profilini getirme (Login sonrası token ile)
router.get('/profile', verifyToken, getProfile);

module.exports = router;