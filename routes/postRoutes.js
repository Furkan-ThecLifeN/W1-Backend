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
    // Türkçe karakter ve boşluk temizliği yaparak dosya adı oluşturma
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
    const uniqueName = Date.now() + "-" + safeName;
    cb(null, uniqueName);
  },
});

// Resim ve Video kabul edecek şekilde upload tanımı
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Örn: 50MB limit (video için artırıldı)
});

// ✅ Gönderi paylaşım rotası
// "media" alanı hem resim hem video dosyaları için kullanılacak
router.post(
  "/share",
  isAuthenticated,
  apiLimiter,
  upload.array("media", 5), // Frontend'den 'media' key'i ile gönderiyoruz
  postController.sharePost
);

// Diğer rotalar aynı kalıyor...
router.delete("/:postId", isAuthenticated, postController.deletePost);
router.patch("/:postId/disable-comments", isAuthenticated, postController.disableComments);
router.patch("/:postId/enable-comments", isAuthenticated, postController.enableComments);
router.post("/report", isAuthenticated, reportController.createReport);

module.exports = router;