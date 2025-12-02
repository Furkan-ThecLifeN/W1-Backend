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
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// ==========================================
// ✅ POST ROUTES
// ==========================================

// 1. Paylaşma (Resim/Video/Metin)
router.post(
  "/share",
  isAuthenticated,
  apiLimiter,
  upload.array("media", 5), 
  postController.sharePost
);

// 2. Silme
router.delete("/:postId", isAuthenticated, postController.deletePost);

// 3. Akış (Feed) Getirme - EKSİKTİ, EKLENDİ
// Kullanıcının takip ettiği kişilerin gönderilerini getirir.
router.get("/feed", isAuthenticated, postController.getPostFeed);

// 4. Yorumları Aç/Kapa (Tek Route) - GÜNCELLENDİ
// Controller'daki 'togglePostComments' fonksiyonuna bağlandı.
// Body: { "disable": true } veya { "disable": false } gönderilmeli.
router.patch("/:postId/comments", isAuthenticated, postController.togglePostComments);

// 5. Raporlama
router.post("/report", isAuthenticated, reportController.createReport);

module.exports = router;