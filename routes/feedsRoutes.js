// routes/feedsRoutes.js
const express = require('express');
const router = express.Router();
const feedsController = require('../controllers/feedsController');
const verifyToken = require('../middlewares/verifyToken');
const rateLimit = require("express-rate-limit");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,
});

// ✅ Feed oluşturma (sadece giriş yapmış kullanıcı)
router.post('/create', verifyToken, apiLimiter, feedsController.createFeed);

// ✅ Feed silme (sadece feed sahibi)
router.delete('/:postId', verifyToken, feedsController.deleteFeed);

// ✅ Yorumları kapatma (sadece feed sahibi)
router.patch('/:postId/disable-comments', verifyToken, feedsController.disableComments);

// ✅ Yorumları açma (sadece feed sahibi)
router.patch('/:postId/enable-comments', verifyToken, feedsController.enableComments);

// ✅ Feed detayını getirme (herkes erişebilir)
router.get('/:postId', apiLimiter, feedsController.getFeedById);

module.exports = router;
