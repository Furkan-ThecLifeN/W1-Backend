const express = require("express");
const feelingsController = require("../controllers/feelingsController");
const reportController = require("../controllers/reportController"); // ✅ Raporlama eklendi
const isAuthenticated = require("../middlewares/verifyToken");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

// ✅ Paylaşma
router.post("/share", isAuthenticated, apiLimiter, feelingsController.shareFeeling);

// ✅ Silme
router.delete("/:postId", isAuthenticated, feelingsController.deleteFeeling);

// ✅ Akış Getirme - EKSİKTİ, EKLENDİ
router.get("/feed", isAuthenticated, feelingsController.getFeelingFeed);

// ✅ Yorumları Aç/Kapa (Tek Route - Controller ile uyumlu)
router.patch("/:postId/comments", isAuthenticated, feelingsController.toggleFeelingComments);

// ✅ Tekil Detay
router.get("/:postId", apiLimiter, feelingsController.getFeelingById);

// ✅ Raporlama - EKSİKTİ, EKLENDİ
router.post("/report", isAuthenticated, reportController.createReport);

module.exports = router;