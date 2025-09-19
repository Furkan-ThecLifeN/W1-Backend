//batchActionsController.js
const admin = require("firebase-admin");
const db = admin.firestore();

// Helper: targetType -> collection mapping
function mapCollection(targetType) {
  switch (targetType) {
    case "post":
      return "posts";
    case "reel":
      return "reels";
    default:
      return null;
  }
}

async function batchActionsController(req, res) {
  const { items } = req.body; // items: [{type, targetType, targetId, finalState}]
  const uid = req.user.uid;

  if (!Array.isArray(items)) return res.status(400).json({ error: "invalid items" });

  const batch = db.batch();

  try {
    for (const action of items) {
      const { type, targetType, targetId, finalState } = action;
      const collectionName = mapCollection(targetType);
      if (!collectionName) continue;

      const targetRef = db.collection(collectionName).doc(targetId);
      const targetSnap = await targetRef.get();

      if (!targetSnap.exists) {
        console.error("Target not found:", targetId, "in", collectionName);
        continue;
      }

      const userRef = db.collection("users").doc(uid);

      if (type === "like") {
        const likeRef = userRef.collection("likes").doc(targetId);
        if (finalState) {
          batch.set(likeRef, { postId: targetId, postType: collectionName, createdAt: admin.firestore.FieldValue.serverTimestamp() });
          batch.update(targetRef, { "stats.likes": admin.firestore.FieldValue.increment(1) });
        } else {
          batch.delete(likeRef);
          batch.update(targetRef, { "stats.likes": admin.firestore.FieldValue.increment(-1) });
        }
      }

      if (type === "save") {
        const saveRef = userRef.collection("saves").doc(targetId);
        if (finalState) {
          batch.set(saveRef, { postId: targetId, postType: collectionName, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        } else {
          batch.delete(saveRef);
        }
      }
    }

    await batch.commit();
    return res.json({ ok: true });

  } catch (err) {
    console.error("BatchActionFail:", err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { batchActionsController };
