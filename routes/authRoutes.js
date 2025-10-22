// routes/authRoutes.js

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const verifyToken = require("../middlewares/verifyToken");
const authController = require("../controllers/authController");

// ✅ Global async error handler wrapper
function safeHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error("🔥 Route error:", err);
      res.status(500).json({ error: "Beklenmeyen bir hata oluştu." });
    });
  };
}

// ✅ Rate limiters
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dakika
  max: 5, // 1 dakikada max 5 istek
  message: { error: "Çok fazla deneme. Lütfen biraz bekleyin." },
});

const normalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "İstek sınırını aştınız. Lütfen daha sonra deneyin." },
});

// Kullanıcı Kayıt
router.post("/register", strictLimiter, safeHandler(authController.registerUser));

// Kullanıcı Giriş
router.post("/login", strictLimiter, safeHandler(authController.login));

// Giriş öncesi email/username çözümleme
router.post("/resolve-identifier", normalLimiter, safeHandler(authController.resolveUserIdentifier));

// Google ile giriş
router.post("/google-signin", normalLimiter, safeHandler(authController.googleSignIn));

// Kullanıcı profilini getirme (Login sonrası token ile)
router.get("/profile", verifyToken, normalLimiter, safeHandler(authController.getProfile));

// ✅ GÜNCELLENDİ: Şifre sıfırlama "isteği" (Kod gönderir)
router.post("/forgot-password", strictLimiter, safeHandler(authController.forgotPassword));

// ✅ YENİ: Kod ile şifreyi "sıfırlama"
router.post("/reset-password", strictLimiter, safeHandler(authController.resetPasswordWithCode));

// ✅ Hesabı kalıcı olarak silme isteği
router.post("/delete-account", verifyToken, strictLimiter, safeHandler(authController.requestAccountDeletion));

// ✅ Tüm cihazlardan çıkış yapma
router.post("/logoutAll", verifyToken, normalLimiter, safeHandler(authController.logoutAllDevices));

module.exports = router;