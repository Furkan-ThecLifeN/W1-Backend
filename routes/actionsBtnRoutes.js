// /routes/actionsBtnRoutes.js
const express = require("express");
const protect = require("../middlewares/verifyToken");
const {
  toggleLike,
  checkLike,
  addComment,
  getComments,
  deleteComment,
  sharePost,
  toggleSave,
  checkSave,
} = require("../controllers/actionsBtnController");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,
});

// Beğeni işlemleri
router.post("/toggle-like", protect, apiLimiter, toggleLike);
router.post("/check-like", protect, apiLimiter, checkLike);

// Yorum işlemleri
router.post("/comments", protect, apiLimiter, addComment);
router.get("/comments", protect, apiLimiter, getComments);
router.delete("/comments", protect, apiLimiter, deleteComment);

// Paylaşma işlemi
router.post("/shares", protect, apiLimiter, sharePost);

// Kaydetme işlemleri
router.post("/toggle-save", protect, apiLimiter, toggleSave);
router.post("/check-save", protect, apiLimiter, checkSave);

module.exports = router;