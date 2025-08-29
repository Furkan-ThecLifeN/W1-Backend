// routes/messageRoutes.js

const express = require("express");
const router = express.Router();
const verifyToken = require("../middlewares/verifyToken");
const messageController = require("../controllers/messageController");
const multer = require("multer");
const path = require("path");

// Multer'ı, dosyaları 'uploads' klasörüne kaydetmek için yapılandırır.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Mesajlaşma ile ilgili tüm API rotaları
router.get("/conversations", verifyToken, messageController.getConversations);
router.get("/:conversationId", verifyToken, messageController.getMessages);
router.post("/message", verifyToken, messageController.sendMessage);

// Bu rota, hem fotoğrafları hem de diğer dosyaları yüklemek için kullanılır.
router.post(
  "/file", 
  verifyToken, 
  upload.single("file"), 
  messageController.uploadFileAndSendMessage
);

// Kalpli mesajlar için özel rota
router.post("/heart", verifyToken, messageController.sendHeartMessage);

module.exports = router;
