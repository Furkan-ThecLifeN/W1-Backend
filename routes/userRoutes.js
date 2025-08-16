// W1-Backend/routes/userRoutes.js

const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/verifyToken');
const userController = require('../controllers/userController');

// Kullanıcı profilini güncelleme (POST isteği, token ile korumalı)
router.post('/profile/update', verifyToken, userController.updateProfile);

module.exports = router;