// routes/messageRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middlewares/verifyToken");
// const upload = require("../middlewares/multerConfig"); // Busboy kullanıldığı için artık buna gerek yok
const messageController = require("../controllers/messageController");

// Mesajlaşma Endpoints
router.get("/conversations", verifyToken, messageController.getConversations);
// Düzeltme: /messages yerine doğrudan /:conversationId kullanıyoruz
router.get("/:conversationId", verifyToken, messageController.getMessages);
router.post("/message", verifyToken, messageController.sendMessage);
// Düzeltme: upload.single("file") kaldırıldı, busboy controller'da işleniyor
router.post("/file", verifyToken, messageController.uploadFileAndSendMessage);
router.post("/heart", verifyToken, messageController.sendHeartMessage);

module.exports = router;