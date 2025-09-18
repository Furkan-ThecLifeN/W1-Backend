// batchActionsController.js

const { targetId, actionType } = action;

// Gönderiler koleksiyonu
const targetRef = db.collection("posts").doc(targetId);
const targetSnap = await transaction.get(targetRef);

if (!targetSnap.exists) {
  console.error("Target not found:", targetId, "in posts");
  throw new Error("target not found");
}

// Buradan sonra beğeni/saklama sayaçlarını güncelle
