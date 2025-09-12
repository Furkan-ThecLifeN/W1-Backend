// backend/controllers/likeController.js
const { db, FieldValue } = require("../config/firebase");

// Gönderiyi beğenme / beğeniyi kaldırma
exports.toggleLike = async (req, res) => {
  try {
    const { postId, postType } = req.body;
    const userId = req.user?.uid;

    if (!userId)
      return res.status(401).json({ error: "Kullanıcı kimliği bulunamadı." });
    if (!postId || !postType)
      return res.status(400).json({ error: "Eksik parametre" });

    const collectionMap = {
      feeling: `users/${userId}/feelings`,
      globalFeeling: "globalFeelings",
    };

    const postCollectionName = collectionMap[postType];
    if (!postCollectionName)
      return res.status(400).json({ error: "Geçersiz postType" });

    const postRef = db.collection(postCollectionName).doc(postId);
    const likeRef = db.collection("users").doc(userId).collection("likes").doc(postId);

    const postDoc = await postRef.get();
    if (!postDoc.exists) return res.status(404).json({ error: "Gönderi bulunamadı." });

    // Transaction ile güvenli güncelleme
    await db.runTransaction(async (t) => {
      const likeDoc = await t.get(likeRef);
      const currentlyLiked = likeDoc.exists;
      const newLikesCount = currentlyLiked
        ? (postDoc.data()?.stats?.likes || 1) - 1
        : (postDoc.data()?.stats?.likes || 0) + 1;

      // feelings güncelle
      t.update(postRef, { "stats.likes": newLikesCount });

      if (currentlyLiked) {
        t.delete(likeRef);
      } else {
        t.set(likeRef, {
          ...postDoc.data(),
          postId,
          postType,
          createdAt: FieldValue.serverTimestamp(),
          stats: { ...postDoc.data()?.stats, likes: newLikesCount },
        });
      }
    });

    const updatedPost = await postRef.get();
    const updatedLikes = updatedPost.data()?.stats?.likes || 0;

    res.status(200).json({ success: true, newLikes: updatedLikes });
  } catch (err) {
    console.error("toggleLike hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
};

// Kullanıcının daha önce beğenip beğenmediğini kontrol etme
exports.checkLike = async (req, res) => {
  try {
    const { postId, postType } = req.body;
    const userId = req.user?.uid;
    if (!userId || !postId || !postType) return res.status(400).json({ liked: false });

    const likeRef = db.collection("users").doc(userId).collection("likes").doc(postId);
    const docSnap = await likeRef.get();
    res.status(200).json({ liked: docSnap.exists });
  } catch (err) {
    console.error("checkLike hatası:", err);
    res.status(500).json({ liked: false });
  }
};
