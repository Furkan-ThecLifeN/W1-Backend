// routes/feelingsRoutes.js
const express = require("express");
const feelingsController = require("../controllers/feelingsController");
const isAuthenticated = require("../middlewares/verifyToken");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

// ✅ Gönderi paylaşım rotası - Giriş yapılması GEREKİR.
router.post("/share", isAuthenticated, apiLimiter, feelingsController.shareFeeling);

// ✅ Gönderi silme rotası (sadece gönderi sahibi silebilir)
router.delete("/:postId", isAuthenticated, feelingsController.deleteFeeling);

// ✅ Yorumları kapatma rotası (sadece gönderi sahibi yapabilir)
router.patch("/:postId/disable-comments", isAuthenticated, feelingsController.disableComments);

// ✅ Yorumları açma rotası (sadece gönderi sahibi yapabilir)
router.patch("/:postId/enable-comments", isAuthenticated, feelingsController.enableComments);

// ✅ Gönderi detaylarını getirme rotası - Herkes erişebilir
router.get("/:postId", apiLimiter, feelingsController.getFeelingById);

module.exports = router;
