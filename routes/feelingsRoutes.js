// routes/feelingsRoutes.js
const express = require("express");
const feelingsController = require("../controllers/feelingsController");
const isAuthenticated = require("../middlewares/verifyToken");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

// Gönderi paylaşım rotası - Giriş yapılması GEREKİR.
router.post("/share", isAuthenticated, apiLimiter, feelingsController.sharePost);

// Gönderi detaylarını getirme rotası - Herkes erişebilir.
router.get("/:postId", apiLimiter, feelingsController.getFeelingById);

module.exports = router;