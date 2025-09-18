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
function validateActionPayload(body) {
  if (!body) return "missing body";
  const { type, targetType, targetId } = body;
  if (!type || !["like", "save", "comment"].includes(type))
    return "invalid type";
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
// 📌 Like / Save Toggle
router.post("/toggle", verifyFirebaseToken, async (req, res) => {
  try {
    const validationErr = validateActionPayload(req.body);
    if (validationErr) return res.status(400).json({ error: validationErr });

    const { type, targetType, targetId } = req.body;
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName) return res.status(400).json({ error: "invalid targetType" });

    const actionId = `${type}_${targetType}_${cleanTargetId}_${req.user.uid}`;
    const actionRef = db.collection("actions").doc(actionId);
    const targetRef = db.collection(collectionName).doc(cleanTargetId);

    await db.runTransaction(async (t) => {
      const [actionSnap, targetSnap] = await Promise.all([
        t.get(actionRef),
        t.get(targetRef),
      ]);
      if (!targetSnap.exists) throw new Error("target not found");

      if (actionSnap.exists) {
        t.delete(actionRef);
        t.update(targetRef, {
          [`${type}Count`]: admin.firestore.FieldValue.increment(-1),
        });
      } else {
        t.set(actionRef, {
          type,
          targetType,
          targetId: cleanTargetId,
          userId: req.user.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        t.update(targetRef, {
          [`${type}Count`]: admin.firestore.FieldValue.increment(1),
        });
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("ToggleActionFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 📌 Yorum Ekle
router.post("/comment", verifyFirebaseToken, async (req, res) => {
  try {
    const validationErr = validateActionPayload(req.body);
    if (validationErr) return res.status(400).json({ error: validationErr });
    if (!req.body.content)
      return res.status(400).json({ error: "missing content" });

    const { targetType, targetId } = req.body;
    const content = sanitizeString(req.body.content);
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const commentRef = db
      .collection(collectionName)
      .doc(cleanTargetId)
      .collection("comments")
      .doc();

    await db.runTransaction(async (t) => {
      const targetSnap = await t.get(
        db.collection(collectionName).doc(cleanTargetId)
      );
      if (!targetSnap.exists) throw new Error("target not found");

      t.set(commentRef, {
        id: commentRef.id,
        userId: req.user.uid,
        content,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      t.update(db.collection(collectionName).doc(cleanTargetId), {
        commentsCount: admin.firestore.FieldValue.increment(1),
      });
    });

    return res.json({ ok: true, id: commentRef.id });
  } catch (err) {
    console.error("AddCommentFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 📌 Yorum Sil
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
        if (commentData.userId !== req.user.uid) throw new Error("forbidden");

        t.delete(commentRef);
        t.update(db.collection(collectionName).doc(cleanTargetId), {
          commentsCount: admin.firestore.FieldValue.increment(-1),
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

// 📌 Yorumları Getir
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

// 📌 Paylaşma Linki Alma
router.post("/shareLink", verifyFirebaseToken, async (req, res) => {
  try {
    const { targetType, targetId } = req.body;
    const cleanTargetId = sanitizeString(targetId);
    const collectionName = mapCollection(targetType);
    if (!collectionName)
      return res.status(400).json({ error: "invalid targetType" });

    const targetRef = db.collection(collectionName).doc(cleanTargetId);
    const snap = await targetRef.get();
    if (!snap.exists) return res.status(404).json({ error: "target not found" });

    const baseUrl = process.env.APP_URL || "https://yourapp.com";
    const shareLink = `${baseUrl}/${targetType}/${cleanTargetId}`;

    await targetRef.update({
      shareCount: admin.firestore.FieldValue.increment(1),
    });
    return res.json({ ok: true, shareLink });
  } catch (err) {
    console.error("GetShareLinkFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 📌 Batch Actions
router.post("/batch", verifyFirebaseToken, async (req, res) => {
  try {
    const { actions } = req.body;
    if (!Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: "actions array is missing or empty" });
    }

    const results = [];
    const batch = db.batch();

    for (const action of actions) {
      const { type, targetType, targetId } = action;
      const cleanTargetId = sanitizeString(targetId);
      const collectionName = mapCollection(targetType);

      if (!collectionName || !["like", "save"].includes(type)) {
        results.push({ success: false, error: "Invalid action" });
        continue;
      }

      const actionId = `${type}_${targetType}_${cleanTargetId}_${req.user.uid}`;
      const actionRef = db.collection("actions").doc(actionId);
      const targetRef = db.collection(collectionName).doc(cleanTargetId);

      // Check if a document with this ID exists.
      // We cannot use t.get inside a loop with firestore.
      // This means the batch action is only good for
      // optimistic, one-way updates.
      batch.update(targetRef, {
        [`${type}Count`]: admin.firestore.FieldValue.increment(action.finalState ? 1 : -1),
      });
      if (action.finalState) {
        batch.set(actionRef, {
          type,
          targetType,
          targetId: cleanTargetId,
          userId: req.user.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        batch.delete(actionRef);
      }

      results.push({ success: true });
    }

    // Commit the batch
    await batch.commit();

    res.json({ results });
  } catch (err) {
    console.error("BatchActionFail:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;