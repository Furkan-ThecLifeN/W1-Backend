// /routes/postsActionsBtnRoutes.js

const express = require("express");
const protect = require("../middlewares/verifyToken");
const {
  handlePostAffinity,
  handlePostCollection,
  submitPostComment,
  retrievePostComments,
  removePostComment,
  recordPostShare,
} = require("../controllers/postsActionsBtnController");
const router = express.Router();
const rateLimit = require("express-rate-limit");

// API hız sınırlayıcı
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100, // Her IP için 15 dakikada 100 istek sınırı
  message: "Çok fazla istek gönderdiniz. Lütfen daha sonra tekrar deneyin.",
});

// Beğeni işlemleri
router.post("/like-toggle", protect, apiLimiter, handlePostAffinity);

// Kaydetme işlemleri
router.post("/save-toggle", protect, apiLimiter, handlePostCollection);

// Yorum işlemleri
router.post("/comment-add", protect, apiLimiter, submitPostComment);
router.get("/comment-get", protect, apiLimiter, retrievePostComments);
router.delete("/comment-remove", protect, apiLimiter, removePostComment);

// Paylaşım işlemi
router.post("/share-post", protect, apiLimiter, recordPostShare);

module.exports = router;