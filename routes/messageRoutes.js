const express = require("express");
const router = express.Router();
const verifyToken = require("../middlewares/verifyToken");
const messageController = require("../controllers/messageController");
const multer = require("multer");
const path = require("path");

// ... Storage ayarları AYNI ...
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const suffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + suffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// ✅ YENİ: Sadece durum kontrolü (Mesajları çekmez, ucuzdur)
router.get(
  "/:conversationId/status",
  verifyToken,
  messageController.checkConversationStatus
);

router.get("/conversations", verifyToken, messageController.getConversations);
router.get("/:conversationId", verifyToken, messageController.getMessages); // Artık sadece pagination için
router.post("/message", verifyToken, messageController.sendMessage);
// ... Diğer route'lar AYNI ...
router.post(
  "/file",
  verifyToken,
  upload.single("file"),
  messageController.uploadFileAndSendMessage
);
router.post("/heart", verifyToken, messageController.sendHeartMessage);
router.delete(
  "/:conversationId/message/:messageId",
  verifyToken,
  messageController.deleteMessage
);
router.delete(
  "/:conversationId/clear",
  verifyToken,
  messageController.clearConversation
);

module.exports = router;
