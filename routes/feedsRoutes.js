const express = require('express');
const router = express.Router();
const feedsController = require('../controllers/feedsController');
const reportController = require("../controllers/reportController"); // ✅ Raporlama eklendi
const verifyToken = require('../middlewares/verifyToken');
const rateLimit = require("express-rate-limit");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,
});

// ✅ Feed oluşturma
router.post('/create', verifyToken, apiLimiter, feedsController.createFeed);

// ✅ Feed silme
router.delete('/:postId', verifyToken, feedsController.deleteFeed);

// ✅ Akış Getirme (Takip edilenlerin feedleri) - EKSİKTİ, EKLENDİ
router.get('/feed', verifyToken, feedsController.getFeedFeed);

// ✅ Yorumları Aç/Kapa (Tek Route - Controller ile uyumlu)
router.patch('/:postId/comments', verifyToken, feedsController.toggleFeedComments);

// ✅ Feed detayını getirme
router.get('/:postId', apiLimiter, feedsController.getFeedById);

// ✅ Raporlama - EKSİKTİ, EKLENDİ
router.post("/report", verifyToken, reportController.createReport);

module.exports = router;