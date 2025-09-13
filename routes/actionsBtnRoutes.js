// /routes/actionsBtnRoutes.js
const express = require("express");
const protect = require("../middlewares/verifyToken"); 
const {
  toggleLike,
  checkLike,
} = require("../controllers/actionsBtnController");
const router = express.Router();

// Beğeni işlemlerini controller'daki fonksiyonlara yönlendirir
router.post("/toggle-like", protect, toggleLike);
router.post("/check-like", protect, checkLike);

module.exports = router;