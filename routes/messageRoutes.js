// routes/messageRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middlewares/verifyToken");
const upload = require("../middlewares/multerConfig"); // Multer'ı ekle
const messageController = require("../controllers/messageController");

// Mesajlaşma Endpoints
router.get("/conversations", verifyToken, messageController.getConversations);
router.get("/messages/:conversationId", verifyToken, messageController.getMessages);
router.post("/message", verifyToken, messageController.sendMessage);
router.post("/message/file", verifyToken, upload.single("file"), messageController.uploadFile); // Dosya yükleme

module.exports = router;
