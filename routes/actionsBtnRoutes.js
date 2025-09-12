const { toggleLike, checkLike } = require("../controllers/actionsBtnController");
const verifyFirebaseToken = require("../middlewares/verifyToken");

const express = require("express");
const router = express.Router();

router.post("/toggle-like", verifyFirebaseToken, toggleLike);
router.post("/check-like", verifyFirebaseToken, checkLike); // <- EKLENDİ

module.exports = router;
