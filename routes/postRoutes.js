// routes/postRoutes.js
const express = require("express");
const postController = require("../controllers/postController");
const reportController = require("../controllers/reportController");
const isAuthenticated = require("../middlewares/verifyToken");
const multer = require("multer");
const path = require("path");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

// Multer ayarı
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads"));
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// ✅ Gönderi paylaşım rotası
router.post(
  "/share",
  isAuthenticated,
  apiLimiter,
  upload.array("images", 5),
  postController.sharePost
);

// ✅ Yeni: Gönderi silme rotası (sadece gönderi sahibi silebilir)
router.delete("/:postId", isAuthenticated, postController.deletePost);

// ✅ Yeni: Yorumları kapatma rotası (sadece gönderi sahibi yapabilir)
router.patch(
  "/:postId/disable-comments",
  isAuthenticated,
  postController.disableComments
);

// ✅ Yeni: Yorumları açma rotası
router.patch(
  "/:postId/enable-comments",
  isAuthenticated,
  postController.enableComments
);

// ✅ Yeni: Gönderi raporlama rotası (herkes raporlayabilir)
// Not: `reportController.createReport` fonksiyonunu kullanır.
router.post("/report", isAuthenticated, reportController.createReport);

module.exports = router;
