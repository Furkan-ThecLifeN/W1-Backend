const express = require("express");
const postController = require("../controllers/postController");
const isAuthenticated = require("../middlewares/verifyToken");
const multer = require("multer");
const path = require("path");

const router = express.Router();

// Multer ayarı
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads"));
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// ✅ Gönderi paylaşım rotası
router.post("/share", isAuthenticated, upload.array("images", 5), postController.sharePost);

module.exports = router;
