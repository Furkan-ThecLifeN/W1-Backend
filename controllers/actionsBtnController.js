// /controllers/actionsBtnController.js
const { db, FieldValue } = require("../config/firebase");

// Beğeniyi açma/kapama işlemini yöneten fonksiyon
exports.toggleLike = async (req, res) => {
  const { postId, postType } = req.body;
  const userId = req.user.uid;

  if (!postId || !postType || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  const likeDocRef = db.collection("likes").doc(`${postId}_${userId}`);
  const postRef = db.collection(postType).doc(postId);

  try {
    const newLikesCount = await db.runTransaction(async (transaction) => {
      const likeDoc = await transaction.get(likeDocRef);
      const postDoc = await transaction.get(postRef);

      if (!postDoc.exists) {
        throw new Error("Gönderi bulunamadı.");
      }

      const currentLikes = postDoc.data().stats?.likes || 0;
      let newCount;

      if (likeDoc.exists) {
        // Beğeni zaten mevcut, silme işlemi yap
        transaction.delete(likeDocRef);
        transaction.update(postRef, {
          "stats.likes": FieldValue.increment(-1),
        });
        newCount = currentLikes - 1;
        return newCount;
      } else {
        // Beğeni mevcut değil, ekleme işlemi yap
        transaction.set(likeDocRef, {
          postId,
          userId,
          postType,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.update(postRef, {
          "stats.likes": FieldValue.increment(1),
        });
        newCount = currentLikes + 1;
        return newCount;
      }
    });

    res.status(200).json({ success: true, newLikesCount });
  } catch (error) {
    console.error("Beğeni işlemi sırasında hata:", error);
    res.status(500).json({
      error:
        "Beğeni işlemi başarısız oldu. Lütfen tekrar deneyin. " + error.message,
    });
  }
};

// Beğeni durumunu kontrol eden fonksiyon
exports.checkLike = async (req, res) => {
  const { postId } = req.body;
  const userId = req.user.uid;

  if (!postId || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  try {
    const likeDocRef = db.collection("likes").doc(`${postId}_${userId}`);
    const doc = await likeDocRef.get();
    const liked = doc.exists;

    res.status(200).json({ liked });
  } catch (error) {
    console.error("Beğeni durumu kontrol edilirken hata:", error);
    res.status(500).json({
      error: "Beğeni durumu kontrol edilirken bir sorun oluştu.",
    });
  }
};