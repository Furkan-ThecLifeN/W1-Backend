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

router.post('/create', verifyToken, apiLimiter, feedsController.createFeed);

module.exports = router;