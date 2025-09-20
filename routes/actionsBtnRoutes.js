// actionsBtnRoutes.js
const express = require("express");
const admin = require("firebase-admin");
const validator = require("validator");
const rateLimit = require("express-rate-limit");

const router = express.Router();
const db = admin.firestore();

// 🚀 Genel API Hız Sınırlayıcı (Rate Limiter)
// Bu sınırlayıcı, IP başına dakikada 30 isteğe izin verir.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dakika
  max: 30, // 1 dakika içinde 30 istek
  message: "Çok fazla istek yaptınız, lütfen biraz bekleyin."
});

router.use(apiLimiter);

// 🔒 Middleware: Token kontrolü
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

    const { targetType, targetId, finalState } = req.body;
    if (typeof finalState !== 'boolean') {
      return res.status(400).json({ error: "missing finalState" });
    }
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const likeRef = db.collection("users").doc(req.user.uid).collection("likes").doc(cleanTargetId);
    const targetRef = db.collection(collectionName).doc(cleanTargetId);

    let newStats;

    await db.runTransaction(async (t) => {
      const [likeSnap, targetSnap] = await Promise.all([
        t.get(likeRef),
        t.get(targetRef),
      ]);
      if (!targetSnap.exists) throw new Error("target not found");

      const currentStats = targetSnap.data().stats || { likes: 0, comments: 0, shares: 0, saves: 0 };
      newStats = { ...currentStats };

      if (finalState) {
        if (!likeSnap.exists) {
          t.set(likeRef, {
            postId: cleanTargetId,
            postType: collectionName,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          newStats.likes = (currentStats.likes || 0) + 1;
        }
      } else {
        if (likeSnap.exists) {
          t.delete(likeRef);
          newStats.likes = Math.max(0, currentStats.likes - 1);
        }
      }

      t.update(targetRef, { stats: newStats });
    });

    return res.json({ ok: true, liked: finalState, stats: newStats });
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

    const { targetType, targetId, finalState } = req.body;
    if (typeof finalState !== 'boolean') {
      return res.status(400).json({ error: "missing finalState" });
    }
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const saveRef = db.collection("users").doc(req.user.uid).collection("saves").doc(cleanTargetId);
    const targetRef = db.collection(collectionName).doc(cleanTargetId);

    let newStats;

    await db.runTransaction(async (t) => {
      const [saveSnap, targetSnap] = await Promise.all([
        t.get(saveRef),
        t.get(targetRef),
      ]);
      if (!targetSnap.exists) throw new Error("target not found");

      const currentStats = targetSnap.data().stats || { likes: 0, comments: 0, shares: 0, saves: 0 };
      newStats = { ...currentStats };

      if (finalState) {
        if (!saveSnap.exists) {
          t.set(saveRef, {
            postId: cleanTargetId,
            postType: collectionName,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          newStats.saves = (currentStats.saves || 0) + 1;
        }
      } else {
        if (saveSnap.exists) {
          t.delete(saveRef);
          newStats.saves = Math.max(0, currentStats.saves - 1);
        }
      }
      t.update(targetRef, { stats: newStats });
    });

    return res.json({ ok: true, saved: finalState, stats: newStats });
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

    const stats = targetSnap.data().stats || { likes: 0, comments: 0, shares: 0, saves: 0 };

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
// 📌 Yorum Ekle (GÜNCELLENDİ)
router.post("/comment", verifyFirebaseToken, async (req, res) => {
  try {
    const { targetType, targetId, content } = req.body;
    if (!targetType || !targetId) return res.status(400).json({ error: "invalid payload" });
    if (!content || typeof content !== "string" || validator.isEmpty(content)) return res.status(400).json({ error: "missing content" });

    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName) return res.status(400).json({ error: "invalid targetType" });

    const userRef = db.collection("users").doc(req.user.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: "user not found" });
    const userData = userSnap.data();

    const commentRef = db.collection(collectionName).doc(cleanTargetId).collection("comments").doc();
    const commentObj = {
      id: commentRef.id,
      uid: req.user.uid,
      username: userData.username || "",
      displayName: userData.displayName || "",
      photoURL: userData.photoURL || "",
      text: sanitizeString(content),
    };

    await db.runTransaction(async (t) => {
      const targetRef = db.collection(collectionName).doc(cleanTargetId);
      const targetSnap = await t.get(targetRef);
      if (!targetSnap.exists) throw new Error("target not found");
      t.set(commentRef, { ...commentObj, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      t.update(targetRef, { "stats.comments": admin.firestore.FieldValue.increment(1) });
    });

    return res.json({ ok: true, comment: commentObj });
  } catch (err) {
    console.error("AddCommentFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

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

// 📌 Yorum Listeleme (GÜNCELLENDİ)
router.get(
  "/comments/:targetType/:targetId",
  verifyFirebaseToken,
  async (req, res) => {
    try {
      const { targetType, targetId } = req.params;
      const cleanTargetId = sanitizeString(targetId);
      const collectionName = mapCollection(targetType);
      if (!collectionName) return res.status(400).json({ error: "invalid targetType" });

      const commentsRef = db
        .collection(collectionName)
        .doc(cleanTargetId)
        .collection("comments")
        .orderBy("createdAt", "desc");
      const snapshot = await commentsRef.get();
      const comments = snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        const { createdAt, ...rest } = data;
        return { id: doc.id, ...rest };
      });
      return res.json({ ok: true, comments });
    } catch (err) {
      console.error("GetCommentsFail:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ---------------------------------------------------
// 📌 Yeni Endpoint: Takip Edilen Kullanıcıları Getirme
router.get("/following", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await db.collection("follows").where("followerUid", "==", uid).get();
    const followingUids = snap.docs.map(d => d.data().followingUid).filter(Boolean).filter(id => id !== uid);
    if (!followingUids.length) return res.json({ ok: true, users: [] });
    const usersSnap = await Promise.all(followingUids.map(id => db.collection("users").doc(id).get()));
    const users = usersSnap.map(s => {
      const d = s.data() || {};
      return { uid: s.id, username: d.username || "", displayName: d.displayName || "", photoURL: d.photoURL || "" };
    });
    return res.json({ ok: true, users });
  } catch (err) {
    console.error("GetFollowingFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 📌 Yeni Endpoint: Gönderi Paylaşma
router.post("/sendShare", verifyFirebaseToken, async (req, res) => {
  try {
    const { postId, recipients } = req.body;
    if (!postId || !Array.isArray(recipients)) return res.status(400).json({ error: "invalid payload" });

    const uid = req.user.uid;
    const sanitizedRecipients = recipients.map(sanitizeString).filter(r => r && r !== uid);
    if (!sanitizedRecipients.length) return res.status(400).json({ error: "no recipients" });

    const allowed = [];
    const chunkSize = 10;
    for (let i = 0; i < sanitizedRecipients.length; i += chunkSize) {
      const chunk = sanitizedRecipients.slice(i, i + chunkSize);
      const snap = await db.collection("follows").where("followerUid", "==", uid).where("followingUid", "in", chunk).get();
      snap.docs.forEach(d => {
        const data = d.data();
        if (data && data.followingUid) allowed.push(data.followingUid);
      });
    }
    if (!allowed.length) return res.status(400).json({ error: "recipients not allowed" });

    const batch = db.batch();
    const collectionName = "globalFeeds";
    const targetRef = db.collection(collectionName).doc(postId);
    batch.update(targetRef, { "stats.shares": admin.firestore.FieldValue.increment(allowed.length) });
    const baseUrl = process.env.APP_URL || "https://yourapp.com";
    const shareLink = `${baseUrl}/feelings/${postId}`;
    allowed.forEach(recipientUid => {
      const notifRef = db.collection("users").doc(recipientUid).collection("notifications").doc();
      batch.set(notifRef, {
        fromUid: uid,
        type: "share",
        postId,
        link: shareLink,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false
      });
    });
    await batch.commit();
    return res.json({ ok: true, sentTo: allowed.length, shareLink });
  } catch (err) {
    console.error("SendShareFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 📌 Rate Limit için basit in-memory cache
const shareTimestamps = new Map();
const RATE_LIMIT_MS = 5000; // 5 saniye

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

    // ✨ Rate limit kontrolü
    const userId = req.user.uid;
    const lastShareTime = shareTimestamps.get(userId);
    if (lastShareTime && Date.now() - lastShareTime < RATE_LIMIT_MS) {
      console.warn(`Rate limit triggered for user: ${userId}`);
      // Client tarafı debounce'u zaten hallettiği için 429 yerine başarı mesajı dön
      const baseUrl = process.env.APP_URL || "https://yourapp.com";
      const shareLink = `${baseUrl}/${targetType}/${cleanTargetId}`;
      return res.json({ ok: true, shareLink });
    }

    const baseUrl = process.env.APP_URL || "https://yourapp.com";
    const shareLink = `${baseUrl}/${targetType}/${cleanTargetId}`;

    await targetRef.update({
      "stats.shares": admin.firestore.FieldValue.increment(1),
    });

    // Son paylaşım zamanını güncelle
    shareTimestamps.set(userId, Date.now());

    return res.json({ ok: true, shareLink });
  } catch (err) {
    console.error("GetShareLinkFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 📌 Yeni Endpoint: Tek seferde tüm feed verisini getirme
router.get("/posts/feed", verifyFirebaseToken, async (req, res) => {
  try {
    // 1. Tüm postları getir
    const [postsSnap, likedSnap, savedSnap] = await Promise.all([
      db.collection("globalFeeds").get(),
      db.collection("users").doc(req.user.uid).collection("likes").get(),
      db.collection("users").doc(req.user.uid).collection("saves").get(),
    ]);

    // 2. Kullanıcının beğendiği ve kaydettiği post ID'lerini bir Set'e al
    const likedPostIds = new Set(likedSnap.docs.map(doc => doc.id));
    const savedPostIds = new Set(savedSnap.docs.map(doc => doc.id));

    // 3. Post verilerini birleştir ve formatla
    const posts = postsSnap.docs.map(doc => {
      const postId = doc.id;
      return {
        id: postId,
        ...doc.data(),
        userLiked: likedPostIds.has(postId),
        userSaved: savedPostIds.has(postId),
      };
    });

    return res.json({ ok: true, posts });
  } catch (err) {
    console.error("GetPostsFeedFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;