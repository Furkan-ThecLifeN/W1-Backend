// actionsBtnRoutes.js

const express = require("express");
const admin = require("firebase-admin");
const validator = require("validator");

const router = express.Router();
const db = admin.firestore();

// 🔒 Middleware: Token kontrol
async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split("Bearer ")[1]
      : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid };
    next();
  } catch (err) {
    console.error("FirebaseTokenError:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ✅ Koleksiyon eşlemesi
function mapCollection(targetType) {
  const map = {
    post: "globalPosts",
    feed: "globalFeeds",
    feeling: "globalFeelings",
  };
  return map[targetType] || null;
}

// ✅ Payload validasyonu
function validateTargetPayload(body) {
  if (!body) return "missing body";
  const { targetType, targetId } = body;
  if (!targetType || !["post", "feed", "feeling"].includes(targetType))
    return "invalid targetType";
  if (!targetId || typeof targetId !== "string" || validator.isEmpty(targetId))
    return "invalid targetId";
  return null;
}

function sanitizeString(s) {
  if (typeof s !== "string") return s;
  return validator.escape(s).slice(0, 2000);
}

// ---------------------------------------------------
// 📌 Yeni Endpoint: Toggle Like
router.post("/toggleLike", verifyFirebaseToken, async (req, res) => {
  try {
    const validationErr = validateTargetPayload(req.body);
    if (validationErr) return res.status(400).json({ error: validationErr });

    const { targetType, targetId } = req.body;
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const likeRef = db.collection("users").doc(req.user.uid).collection("likes").doc(cleanTargetId);
    const targetRef = db.collection(collectionName).doc(cleanTargetId);

    let isLiked = false;
    let newStats;

    await db.runTransaction(async (t) => {
      const [likeSnap, targetSnap] = await Promise.all([
        t.get(likeRef),
        t.get(targetRef),
      ]);
      if (!targetSnap.exists) throw new Error("target not found");

      const currentStats = targetSnap.data().stats || { likes: 0, comments: 0, shares: 0 };
      newStats = { ...currentStats };

      if (likeSnap.exists) {
        t.delete(likeRef);
        newStats.likes = Math.max(0, currentStats.likes - 1);
        isLiked = false;
      } else {
        t.set(likeRef, {
          postId: cleanTargetId,
          postType: collectionName,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        newStats.likes = (currentStats.likes || 0) + 1;
        isLiked = true;
      }

      t.update(targetRef, { stats: newStats });
    });

    return res.json({ ok: true, liked: isLiked, stats: newStats });
  } catch (err) {
    console.error("ToggleLikeFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 📌 Yeni Endpoint: Toggle Save
router.post("/toggleSave", verifyFirebaseToken, async (req, res) => {
  try {
    const validationErr = validateTargetPayload(req.body);
    if (validationErr) return res.status(400).json({ error: validationErr });

    const { targetType, targetId } = req.body;
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const saveRef = db.collection("users").doc(req.user.uid).collection("saves").doc(cleanTargetId);
    const targetRef = db.collection(collectionName).doc(cleanTargetId);

    let isSaved = false;

    await db.runTransaction(async (t) => {
      const [saveSnap, targetSnap] = await Promise.all([
        t.get(saveRef),
        t.get(targetRef),
      ]);
      if (!targetSnap.exists) throw new Error("target not found");

      if (saveSnap.exists) {
        t.delete(saveRef);
        isSaved = false;
      } else {
        t.set(saveRef, {
          postId: cleanTargetId,
          postType: collectionName,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        isSaved = true;
      }
    });

    return res.json({ ok: true, saved: isSaved });
  } catch (err) {
    console.error("ToggleSaveFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 📌 Yeni Endpoint: Stats Getirme
router.get("/getStats/:targetType/:targetId", verifyFirebaseToken, async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const targetRef = db.collection(collectionName).doc(cleanTargetId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      return res.status(404).json({ error: "target not found" });
    }

    const stats = targetSnap.data().stats || { likes: 0, comments: 0, shares: 0 };
    
    // Kullanıcının beğenme ve kaydetme durumlarını kontrol etme
    const [likeSnap, saveSnap] = await Promise.all([
      db.collection("users").doc(req.user.uid).collection("likes").doc(cleanTargetId).get(),
      db.collection("users").doc(req.user.uid).collection("saves").doc(cleanTargetId).get(),
    ]);

    const liked = likeSnap.exists;
    const saved = saveSnap.exists;

    return res.json({ ok: true, stats, liked, saved });
  } catch (err) {
    console.error("GetStatsFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------
// 📌 Yorum Ekle
router.post("/comment", verifyFirebaseToken, async (req, res) => {
  try {
    const validationErr = validateTargetPayload(req.body);
    if (validationErr) return res.status(400).json({ error: validationErr });
    if (!req.body.content)
      return res.status(400).json({ error: "missing content" });

    const { targetType, targetId } = req.body;
    const content = sanitizeString(req.body.content);
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const userRef = db.collection("users").doc(req.user.uid);
    const userData = await userRef.get().then((snap) => snap.data());
    if (!userData) throw new Error("user not found");

    const commentRef = db
      .collection(collectionName)
      .doc(cleanTargetId)
      .collection("comments")
      .doc();

    await db.runTransaction(async (t) => {
      const targetRef = db.collection(collectionName).doc(cleanTargetId);
      const targetSnap = await t.get(targetRef);
      if (!targetSnap.exists) throw new Error("target not found");

      t.set(commentRef, {
        uid: req.user.uid,
        username: userData.username,
        displayName: userData.displayName,
        photoURL: userData.photoURL,
        text: content,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      t.update(targetRef, {
        "stats.comments": admin.firestore.FieldValue.increment(1),
      });
    });

    return res.json({ ok: true, id: commentRef.id });
  } catch (err) {
    console.error("AddCommentFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Diğer yorum endpoint’leri aynı şekilde kalabilir
router.delete(
  "/comment/:targetType/:targetId/:commentId",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const { targetType, targetId, commentId } = req.params;
      const cleanTargetId = sanitizeString(targetId);
      const collectionName = mapCollection(targetType);
      if (!collectionName)
        return res.status(400).json({ error: "invalid targetType" });

      const commentRef = db
        .collection(collectionName)
        .doc(cleanTargetId)
        .collection("comments")
        .doc(commentId);

      await db.runTransaction(async (t) => {
        const snap = await t.get(commentRef);
        if (!snap.exists) throw new Error("comment not found");
        const commentData = snap.data();
        if (commentData.uid !== req.user.uid) throw new Error("forbidden");

        t.delete(commentRef);
        t.update(db.collection(collectionName).doc(cleanTargetId), {
          "stats.comments": admin.firestore.FieldValue.increment(-1),
        });
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("DeleteCommentFail:", err.message);
      if (err.message === "forbidden")
        return res.status(403).json({ error: "forbidden" });
      return res.status(500).json({ error: err.message });
    }
  }
);

// Yorumları getir ve paylaş linki endpoint’leri değişmedi

router.get(
  "/comments/:targetType/:targetId",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const { targetType, targetId } = req.params;
      const cleanTargetId = sanitizeString(targetId);
      const collectionName = mapCollection(targetType);
      if (!collectionName)
        return res.status(400).json({ error: "invalid targetType" });

      const commentsRef = db
        .collection(collectionName)
        .doc(cleanTargetId)
        .collection("comments")
        .orderBy("createdAt", "desc");
      const snapshot = await commentsRef.get();
      const comments = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      return res.json({ ok: true, comments });
    } catch (err) {
      console.error("GetCommentsFail:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }
);

router.post("/shareLink", verifyFirebaseToken, async (req, res) => {
  try {
    const { targetType, targetId } = req.body;
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const targetRef = db.collection(collectionName).doc(cleanTargetId);
    const snap = await targetRef.get();
    if (!snap.exists)
      return res.status(404).json({ error: "target not found" });

    const baseUrl = process.env.APP_URL || "https://yourapp.com";
    const shareLink = `${baseUrl}/${targetType}/${cleanTargetId}`;

    await targetRef.update({
      "stats.shares": admin.firestore.FieldValue.increment(1),
    });
    return res.json({ ok: true, shareLink });
  } catch (err) {
    console.error("GetShareLinkFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
