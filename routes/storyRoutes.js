// routes/storyRoutes.js
const express = require("express");
const storyController = require("../controllers/storyController");
const isAuthenticated = require("../middlewares/verifyToken");
const multer = require("multer");
const path = require("path");

const router = express.Router();

// Multer ayarı (Dosya yüklemek istersen diye dursun)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../uploads")),
  filename: (req, file, cb) => cb(null, Date.now() + "_" + file.originalname.replace(/[^a-zA-Z0-9.]/g, "_"))
});
const upload = multer({ storage });

// DİKKAT: 'upload.array' kullanıyoruz ama frontend dosya göndermezse
// multer bunu pas geçer, req.body doludur. Sorun çıkarmaz.
router.post("/add", isAuthenticated, upload.array("media", 1), storyController.shareStory);
router.get("/feed", isAuthenticated, storyController.getStoryFeed);
router.delete("/:storyId", isAuthenticated, storyController.deleteStory);
router.get("/public-feed", isAuthenticated, storyController.getPublicStoryFeed);
router.post("/:storyId/view", isAuthenticated, storyController.markStoryAsViewed);

module.exports = router;