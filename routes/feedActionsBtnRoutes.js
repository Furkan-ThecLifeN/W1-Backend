// /routes/feedActionsBtnRoutes.js

const express = require("express");
const protect = require("../middlewares/verifyToken");
const {
  handleFeedAffinity,
  handleFeedCollection,
  submitFeedComment,
  retrieveFeedComments,
  removeFeedComment,
  recordFeedShare,
} = require("../controllers/feedActionsBtnController");
const router = express.Router();
const rateLimit = require("express-rate-limit");

// API hız sınırlayıcı
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Çok fazla istek gönderdiniz. Lütfen daha sonra tekrar deneyin.",
});

// Beğeni işlemleri
router.post("/feed-like-toggle", protect, apiLimiter, handleFeedAffinity);

// Kaydetme işlemleri
router.post("/feed-save-toggle", protect, apiLimiter, handleFeedCollection);

// Yorum işlemleri
router.post("/feed-comment-add", protect, apiLimiter, submitFeedComment);
router.get("/feed-comment-get", protect, apiLimiter, retrieveFeedComments);
router.delete("/feed-comment-remove", protect, apiLimiter, removeFeedComment);

// Paylaşım işlemi
router.post("/feed-share-post", protect, apiLimiter, recordFeedShare);

module.exports = router;
