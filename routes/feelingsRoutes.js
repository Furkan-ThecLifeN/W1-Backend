// routes/feelingsRoutes.js
const express = require("express");
const feelingsController = require("../controllers/feelingsController");
const isAuthenticated = require("../middlewares/verifyToken");
const router = express.Router();

// ✅ Gönderi paylaşım rotası
router.post("/share", isAuthenticated, feelingsController.sharePost);

// ✅ getFeelingById fonksiyonu feelingsController üzerinden çağrılıyor
router.get("/:postId", isAuthenticated, feelingsController.getFeelingById);

module.exports = router;