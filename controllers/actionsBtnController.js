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
    const likeDoc = await likeDocRef.get();
    const isLiked = likeDoc.exists;
    res.status(200).json({ success: true, isLiked });
  } catch (error) {
    console.error("Beğeni kontrol hatası:", error);
    res.status(500).json({ error: "Beğeni kontrolü sırasında hata oluştu." });
  }
};

// ✅ Yorum ekleme fonksiyonu
exports.addComment = async (req, res) => {
  const { postId, postType, commentText } = req.body;
  const userId = req.user.uid;

  if (!postId || !postType || !commentText || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  try {
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }
    const userData = userDoc.data();

    const newCommentRef = await db
      .collection(postType)
      .doc(postId)
      .collection("comments")
      .add({
        uid: userId,
        displayName: userData.displayName || "Kullanıcı",
        username: userData.username || "unknown_user",
        photoURL: userData.photoURL || "",
        text: commentText,
        createdAt: FieldValue.serverTimestamp(),
      });

    // Gönderinin yorum sayısını artır
    const postRef = db.collection(postType).doc(postId);
    await postRef.update({
      "stats.comments": FieldValue.increment(1),
    });

    res.status(201).json({
      message: "Yorum başarıyla eklendi.",
      commentId: newCommentRef.id,
    });
  } catch (error) {
    console.error("Yorum eklenirken hata oluştu:", error);
    res.status(500).json({
      error: "Yorum ekleme işlemi başarısız. Lütfen tekrar deneyin.",
    });
  }
};

// ✅ Yorumları getirme fonksiyonu
exports.getComments = async (req, res) => {
  const { postId } = req.query;
  const postType = "globalFeelings"; // Yorumlar her zaman globalFeelings alt koleksiyonunda

  if (!postId) {
    return res.status(400).json({ error: "Eksik Gönderi ID'si." });
  }

  try {
    const commentsRef = db
      .collection(postType)
      .doc(postId)
      .collection("comments")
      .orderBy("createdAt", "asc");

    const snapshot = await commentsRef.get();
    const comments = [];
    snapshot.forEach((doc) => {
      comments.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json({ comments });
  } catch (error) {
    console.error("Yorumlar çekilirken hata oluştu:", error);
    res.status(500).json({ error: "Yorumlar yüklenemedi." });
  }
};

// ✅ Yorum silme fonksiyonu
exports.deleteComment = async (req, res) => {
  const { postId, commentId, postType } = req.body;
  const userId = req.user.uid;

  if (!postId || !commentId || !postType || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  try {
    const commentRef = db
      .collection(postType)
      .doc(postId)
      .collection("comments")
      .doc(commentId);
    const commentDoc = await commentRef.get();

    if (!commentDoc.exists) {
      return res.status(404).json({ error: "Yorum bulunamadı." });
    }

    if (commentDoc.data().uid !== userId) {
      return res
        .status(403)
        .json({ error: "Bu yorumu silme yetkiniz yok." });
    }

    await commentRef.delete();

    // Gönderinin yorum sayısını azalt
    const postRef = db.collection(postType).doc(postId);
    await postRef.update({
      "stats.comments": FieldValue.increment(-1),
    });

    res.status(200).json({ message: "Yorum başarıyla silindi." });
  } catch (error) {
    console.error("Yorum silinirken hata oluştu:", error);
    res.status(500).json({
      error: "Yorum silme işlemi başarısız. Lütfen tekrar deneyin.",
    });
  }
};

// Gönderi paylaşım fonksiyonu (kullanıcının kendi profilinde paylaşması için)
exports.sharePost = async (req, res) => {
  const { postId, postType } = req.body;
  const userId = req.user.uid;

  if (!postId || !postType || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  try {
    const postRef = db.collection(postType).doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      return res.status(404).json({ error: "Paylaşılacak gönderi bulunamadı." });
    }
    const postData = postDoc.data();

    // Paylaşım koleksiyonuna yeni belge oluştur
    const shareRef = await db.collection("shares").add({
      originalPostId: postId,
      originalPostType: postType,
      sharedBy: userId,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Orijinal gönderinin paylaşım sayısını artır
    await postRef.update({
      "stats.shares": FieldValue.increment(1),
    });

    res.status(201).json({
      message: "Gönderi başarıyla paylaşıldı.",
      shareId: shareRef.id,
    });
  } catch (error) {
    console.error("Gönderi paylaşılırken hata oluştu:", error);
    res.status(500).json({
      error: "Gönderi paylaşma işlemi başarısız. Lütfen tekrar deneyin.",
    });
  }
};

// Kaydetme Fonksiyonu
exports.toggleSave = async (req, res) => {
  const { postId, postType } = req.body;
  const userId = req.user.uid;

  if (!postId || !postType || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  const saveDocRef = db.collection("users").doc(userId).collection("saves").doc(postId);
  const postRef = db.collection(postType).doc(postId);

  try {
    const isSaved = await db.runTransaction(async (transaction) => {
      const saveDoc = await transaction.get(saveDocRef);
      const postDoc = await transaction.get(postRef);

      if (!postDoc.exists) throw new Error("Gönderi bulunamadı.");

      if (saveDoc.exists) {
        // Kayıtlıysa, sil
        transaction.delete(saveDocRef);
        transaction.update(postRef, {
          "stats.saves": FieldValue.increment(-1),
        });
        return false;
      } else {
        // Kayıtlı değilse, ekle
        transaction.set(saveDocRef, {
          postId,
          postType,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.update(postRef, {
          "stats.saves": FieldValue.increment(1),
        });
        return true;
      }
    });

    res.status(200).json({ success: true, isSaved });
  } catch (error) {
    console.error("Kaydetme işlemi hatası:", error);
    res.status(500).json({
      error:
        "Kaydetme işlemi başarısız oldu. Lütfen tekrar deneyin. " + error.message,
    });
  }
};

// ✅ Gönderinin kaydedilip kaydedilmediğini kontrol eden fonksiyon
exports.checkSave = async (req, res) => {
  const { postId } = req.body;
  const userId = req.user.uid;

  if (!postId || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  try {
    const saveDocRef = db.collection("users").doc(userId).collection("saves").doc(postId);
    const doc = await saveDocRef.get();
    const isSaved = doc.exists;

    res.status(200).json({ success: true, isSaved });
  } catch (error) {
    console.error("Kaydetme kontrol hatası:", error);
    res.status(500).json({ error: "Kaydetme kontrolü sırasında hata oluştu." });
  }
};