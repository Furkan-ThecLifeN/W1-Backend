// routes/reportRoutes.js
const express = require("express");
const reportController = require("../controllers/reportController");
const isAuthenticated = require("../middlewares/verifyToken");
const rateLimit = require("express-rate-limit");

const router = express.Router();

// Raporlama uç noktası için özel rate limiter
// Kullanıcıların kısa sürede çok fazla rapor göndermesini engeller
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 saat
  max: 5, // 1 saat içinde en fazla 5 rapor göndermesine izin ver
  message: "Çok fazla şikayet gönderdiniz. Lütfen 1 saat sonra tekrar deneyin.",
});

// ✅ Rapor oluşturma rotası (Post, Feed, Feeling tüm gönderiler için geçerli)
router.post("/create", isAuthenticated, reportLimiter, reportController.createReport);

module.exports = router;
