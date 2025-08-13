// routes/userRoutes.js

const express = require('express');
const router = express.Router();
const verifyToken = require('../middlewares/verifyToken');
const { updateProfile } = require('../controllers/userController');

// Kullanıcı profilini güncelleme (Login sonrası token ile)
router.post('/profile/update', verifyToken, updateProfile);

module.exports = router;