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

// Beğeni işlemleri
router.post("/toggle-like", protect, toggleLike);
router.post("/check-like", protect, checkLike);

// Yorum işlemleri
router.post("/comments", protect, addComment);
router.get("/comments", protect, getComments);
router.delete("/comments", protect, deleteComment);

// Paylaşma işlemi
router.post("/shares", protect, sharePost);

// Kaydetme işlemleri
router.post("/toggle-save", protect, toggleSave);
router.post("/check-save", protect, checkSave);

module.exports = router;