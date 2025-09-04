// routes/feedsRoutes.js

const express = require('express');
const router = express.Router();
const feedsController = require('../controllers/feedsController');
const verifyToken = require('../middlewares/verifyToken');

router.post('/create', verifyToken, feedsController.createFeed);

module.exports = router;