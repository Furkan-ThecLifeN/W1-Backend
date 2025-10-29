// actionsBtnRoutes.js
const express = require("express");
const admin = require("firebase-admin");
const validator = require("validator");
const rateLimit = require("express-rate-limit");
const getPostLink = require("../utils/getPostLink");

const router = express.Router();
const db = admin.firestore();

// 🚀 Genel API Hız Sınırlayıcı (Rate Limiter)
const apiLimiter = rateLimit({
  windowMs: 1, // 1 ms (önemsiz)
  max: Infinity, // Sınırsız istek hakkı
  standardHeaders: false,
  legacyHeaders: false,
  message: "", // Boş mesaj
});

router.use(apiLimiter);

// 🔒 Middleware: Token kontrolü (GEREKLİ ENDPOINT'LER İÇİN)
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

// 💡 YENİ EKLENDİ: Beğeni ve yorumlar için bildirim oluşturma yardımcı fonksiyonu
async function createNotification(
  type,
  fromUid,
  fromUsername,
  postId,
  postOwnerId,
  commentText = null
) {
  if (fromUid === postOwnerId) {
    return; // Kullanıcı kendi postunu beğeniyorsa/yorum yapıyorsa bildirim oluşturma
  }

  const notificationRef = db
    .collection("users")
    .doc(postOwnerId)
    .collection("notifications")
    .doc();
  const newNotification = {
    type,
    fromUid,
    fromUsername,
    postId,
    postOwnerId,
    isRead: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (commentText) {
    newNotification.commentText = commentText;
  }

  await notificationRef.set(newNotification);
  console.log(`Yeni bildirim oluşturuldu. Tip: ${type}, Alıcı: ${postOwnerId}`);
}

// ---------------------------------------------------
// 📌 Yeni Endpoint: Gönderi Paylaşma
router.post("/share", verifyFirebaseToken, async (req, res) => {
  const { targetType, targetId, receiverUid } = req.body;
  const senderUid = req.user.uid;

  if (!targetType || !targetId || !receiverUid) {
    return res.status(400).json({
      error: "Eksik parametreler: targetType, targetId, receiverUid",
    });
  }

  try {
    await db.runTransaction(async (t) => {
      // ---- 1) Tüm GEREKLİ okuma işlemleri ----
      const collectionRef = db.collection(mapCollection(targetType));
      const targetRef = collectionRef.doc(targetId);
      const targetDoc = await t.get(targetRef);
      if (!targetDoc.exists) throw new Error("Hedef gönderi bulunamadı.");

      const conversationId = [senderUid, receiverUid].sort().join("_");
      const conversationRef = db.collection("conversations").doc(conversationId);
      const conversationDoc = await t.get(conversationRef);

      const messageRef = conversationRef.collection("messages").doc();

      const postLink = getPostLink(targetType, targetId);

      // ---- 2) Okumalar bitti → şimdi YAZMALAR ----
      // Paylaşım sayısını artır
      t.update(targetRef, {
        "stats.shares": admin.firestore.FieldValue.increment(1),
      });

      if (!conversationDoc.exists) {
        t.set(conversationRef, {
          members: [senderUid, receiverUid],
          lastMessage: {
            senderId: senderUid,
            text: postLink,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        t.update(conversationRef, {
          lastMessage: {
            senderId: senderUid,
            text: postLink,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      t.set(messageRef, {
        senderId: senderUid,
        receiverUid: receiverUid,
        text: postLink,
        type: "share",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    res.json({ success: true, message: "Paylaşım başarıyla gönderildi." });
  } catch (err) {
    console.error("Paylaşım transaction hatası:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 Yeni Endpoint: Yorum Silme
router.delete(
  "/deleteComment/:commentId",
  verifyFirebaseToken,
  async (req, res) => {
    const { commentId } = req.params;
    const currentUserId = req.user.uid;

    // Query parametrelerinden hedef post bilgilerini al
    const { targetType, targetId } = req.query;

    if (!commentId || !targetType || !targetId) {
      return res.status(400).json({ error: "Eksik parametreler." });
    }

    const collectionName = mapCollection(targetType);
    if (!collectionName) {
      return res.status(400).json({ error: "Geçersiz targetType." });
    }

    const commentRef = db
      .collection(collectionName)
      .doc(targetId)
      .collection("comments")
      .doc(commentId);
    const postRef = db.collection(collectionName).doc(targetId);

    try {
      await db.runTransaction(async (t) => {
        const commentSnap = await t.get(commentRef);

        if (!commentSnap.exists) {
          throw new Error("Yorum bulunamadı.");
        }

        const commentData = commentSnap.data();
        if (commentData.uid !== currentUserId) {
          throw new Error("Yalnızca kendi yorumunuzu silebilirsiniz.");
        }

        // 1. Yorumu sil
        t.delete(commentRef);

        // 2. Postun yorum sayısını azalt
        t.update(postRef, {
          "stats.comments": admin.firestore.FieldValue.increment(-1),
        });
      });

      res.status(200).json({ ok: true, message: "Yorum başarıyla silindi." });
    } catch (error) {
      console.error("Yorum silme işlemi başarısız:", error);
      res.status(500).json({
        error: error.message || "Yorum silme sırasında bir hata oluştu.",
      });
    }
  }
);

// ---------------------------------------------------
// 📌 Yeni Endpoint: Toggle Like
router.post("/toggleLike", verifyFirebaseToken, async (req, res) => {
  try {
    const validationErr = validateTargetPayload(req.body);
    if (validationErr) return res.status(400).json({ error: validationErr });

    const { targetType, targetId, finalState } = req.body;
    if (typeof finalState !== "boolean") {
      return res.status(400).json({ error: "missing finalState" });
    }
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const likeRef = db
      .collection("users")
      .doc(req.user.uid)
      .collection("likes")
      .doc(cleanTargetId);
    const targetRef = db.collection(collectionName).doc(cleanTargetId);

    let newStats;

    await db.runTransaction(async (t) => {
      // 💡 YENİ EKLENDİ: Bildirim için gerekli user ve post verilerini al
      const [likeSnap, targetSnap, likerUserSnap] = await Promise.all([
        t.get(likeRef),
        t.get(targetRef),
        t.get(db.collection("users").doc(req.user.uid)),
      ]);

      if (!targetSnap.exists) throw new Error("target not found");
      const postData = targetSnap.data();

      const currentStats = postData.stats || {
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
      };
      newStats = { ...currentStats };

      if (finalState) {
        if (!likeSnap.exists) {
          t.set(likeRef, {
            postId: cleanTargetId,
            postType: collectionName,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          newStats.likes = (currentStats.likes || 0) + 1;

          // 💡 YENİ EKLENDİ: Beğeni bildirimi oluştur
          if (likerUserSnap.exists) {
            const likerUsername = likerUserSnap.data().username;
            await createNotification(
              "like",
              req.user.uid,
              likerUsername,
              cleanTargetId,
              postData.uid
            );
          }
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
    if (typeof finalState !== "boolean") {
      return res.status(400).json({ error: "missing finalState" });
    }
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const saveRef = db
      .collection("users")
      .doc(req.user.uid)
      .collection("saves")
      .doc(cleanTargetId);
    const targetRef = db.collection(collectionName).doc(cleanTargetId);

    let newStats;

    await db.runTransaction(async (t) => {
      const [saveSnap, targetSnap] = await Promise.all([
        t.get(saveRef),
        t.get(targetRef),
      ]);
      if (!targetSnap.exists) throw new Error("target not found");

      const currentStats = targetSnap.data().stats || {
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
      };
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

// ------------------------------------------------------------------
// --- GÜNCELLENEN BÖLÜM BAŞLANGICI ---
// ------------------------------------------------------------------

// 📌 Yeni Endpoint: Stats Getirme (HERKESE AÇIK OLARAK GÜNCELLENDİ)
router.get("/getStats/:targetType/:targetId", async (req, res) => {
  // verifyFirebaseToken kaldırıldı
  try {
    // --- 1. Opsiyonel Token Kontrolü ---
    let userId = null;
    let liked = false;
    let saved = false;

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split("Bearer ")[1]
      : null;

    if (token) {
      try {
        // Token'ı doğrulamayı dene
        const decoded = await admin.auth().verifyIdToken(token);
        userId = decoded.uid;
      } catch (err) {
        // Token geçersizse veya süresi dolmuşsa sorun değil, public devam et
        console.warn(
          "getStats: Geçersiz/süresi dolmuş token, public veri dönülüyor."
        );
      }
    }
    // --- Opsiyonel Token Kontrolü Bitti ---

    // --- 2. Herkese Açık Verileri Çek ---
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

    const stats = targetSnap.data().stats || {
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
    };

    // --- 3. Kullanıcı Giriş Yapmışsa Beğeni Durumunu Kontrol Et ---
    if (userId) {
      const [likeSnap, saveSnap] = await Promise.all([
        db
          .collection("users")
          .doc(userId) // req.user.uid yerine userId kullan
          .collection("likes")
          .doc(cleanTargetId)
          .get(),
        db
          .collection("users")
          .doc(userId) // req.user.uid yerine userId kullan
          .collection("saves")
          .doc(cleanTargetId)
          .get(),
      ]);

      liked = likeSnap.exists;
      saved = saveSnap.exists;
    }
    // --- Kullanıcı Kontrolü Bitti ---

    // Herkese açık stats + (varsa) kullanıcıya özel liked/saved durumu
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
    if (!targetType || !targetId)
      return res.status(400).json({ error: "invalid payload" });
    if (!content || typeof content !== "string" || validator.isEmpty(content))
      return res.status(400).json({ error: "missing content" });

    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const userRef = db.collection("users").doc(req.user.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists)
      return res.status(404).json({ error: "user not found" });
    const userData = userSnap.data();

    const commentRef = db
      .collection(collectionName)
      .doc(cleanTargetId)
      .collection("comments")
      .doc();
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
      const postData = targetSnap.data();

      t.set(commentRef, {
        ...commentObj,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      t.update(targetRef, {
        "stats.comments": admin.firestore.FieldValue.increment(1),
      });

      // 💡 YENİ EKLENDİ: Yorum bildirimi oluştur
      await createNotification(
        "comment",
        req.user.uid,
        userData.username,
        cleanTargetId,
        postData.uid,
        content.substring(0, 50)
      );
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

// 📌 Yorum Listeleme (HERKESE AÇIK OLARAK GÜNCELLENDİ)
router.get(
  "/comments/:targetType/:targetId",
  // verifyFirebaseToken kaldırıldı
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
      const comments = snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        const { createdAt, ...rest } = data; // createdAt timestamp'ını client'a gönderme
        return { id: doc.id, ...rest };
      });
      return res.json({ ok: true, comments });
    } catch (err) {
      console.error("GetCommentsFail:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }
);

// ------------------------------------------------------------------
// --- GÜNCELLENEN BÖLÜM SONU ---
// ------------------------------------------------------------------

// 📌 Yeni Endpoint: Takip Edilen Kullanıcıları Getirme
router.get("/following", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .get();
    const followingUids = snap.docs
      .map((d) => d.data().followingUid)
      .filter(Boolean)
      .filter((id) => id !== uid);
    if (!followingUids.length) return res.json({ ok: true, users: [] });
    const usersSnap = await Promise.all(
      followingUids.map((id) => db.collection("users").doc(id).get())
    );
    const users = usersSnap.map((s) => {
      const d = s.data() || {};
      return {
        uid: s.id,
        username: d.username || "",
        displayName: d.displayName || "",
        photoURL: d.photoURL || "",
      };
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
    if (!postId || !Array.isArray(recipients))
      return res.status(400).json({ error: "invalid payload" });

    const uid = req.user.uid;
    const sanitizedRecipients = recipients
      .map(sanitizeString)
      .filter((r) => r && r !== uid);
    if (!sanitizedRecipients.length)
      return res.status(400).json({ error: "no recipients" });

    const allowed = [];
    const chunkSize = 10;
    for (let i = 0; i < sanitizedRecipients.length; i += chunkSize) {
      const chunk = sanitizedRecipients.slice(i, i + chunkSize);
      const snap = await db
        .collection("follows")
        .where("followerUid", "==", uid)
        .where("followingUid", "in", chunk)
        .get();
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data && data.followingUid) allowed.push(data.followingUid);
      });
    }
    if (!allowed.length)
      return res.status(400).json({ error: "recipients not allowed" });

    const batch = db.batch();
    const collectionName = "globalFeeds";
    const targetRef = db.collection(collectionName).doc(postId);
    batch.update(targetRef, {
      "stats.shares": admin.firestore.FieldValue.increment(allowed.length),
    });
    const baseUrl = process.env.APP_URL || "https://yourapp.com";
    const shareLink = `${baseUrl}/post/${postId}`;
    allowed.forEach((recipientUid) => {
      const notifRef = db
        .collection("users")
        .doc(recipientUid)
        .collection("notifications")
        .doc();
      batch.set(notifRef, {
        fromUid: uid,
        type: "share",
        postId,
        link: shareLink,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
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
    const likedPostIds = new Set(likedSnap.docs.map((doc) => doc.id));
    const savedPostIds = new Set(savedSnap.docs.map((doc) => doc.id));

    // 3. Post verilerini birleştir ve formatla
    const posts = postsSnap.docs.map((doc) => {
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