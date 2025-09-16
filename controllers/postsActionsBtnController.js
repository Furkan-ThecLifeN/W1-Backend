// /controllers/postsActionsBtnController.js

const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const db = admin.firestore();

// Gönderi Beğenisini Yöneten Fonksiyon
exports.handlePostAffinity = async (req, res) => {
  const { postId } = req.body;
  const userId = req.user?.uid;
  const postType = "globalPosts";

  if (!postId || !userId) {
    return res.status(401).json({ error: "İşlem için kimlik doğrulama veya gönderi bilgisi eksik." });
  }

  const likeDocRef = db.collection("likes").doc(`${postId}_${userId}`);
  const postRef = db.collection(postType).doc(postId);

  try {
    const isLiked = await db.runTransaction(async (transaction) => {
      const likeDoc = await transaction.get(likeDocRef);
      const postDoc = await transaction.get(postRef);

      if (!postDoc.exists) {
        throw new Error("Gönderi bulunamadı.");
      }

      if (likeDoc.exists) {
        transaction.delete(likeDocRef);
        transaction.update(postRef, {
          "stats.likes": FieldValue.increment(-1),
        });
        return false;
      } else {
        transaction.set(likeDocRef, {
          postId,
          postType,
          createdAt: FieldValue.serverTimestamp(),
          uid: userId,
        });
        transaction.update(postRef, {
          "stats.likes": FieldValue.increment(1),
        });
        return true;
      }
    });

    res.status(200).json({ success: true, isLiked });
  } catch (error) {
    console.error("Beğeni işlemi hatası:", error);
    res.status(500).json({
      error: "Beğeni işlemi başarısız oldu. " + error.message,
    });
  }
};

// Gönderi Kaydetme İşlemini Yöneten Fonksiyon
exports.handlePostCollection = async (req, res) => {
  const { postId } = req.body;
  const userId = req.user.uid;
  const postType = "globalPosts";

  if (!postId || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  const saveDocRef = db.collection("users").doc(userId).collection("saves").doc(postId);
  const postRef = db.collection(postType).doc(postId);

  try {
    const isSaved = await db.runTransaction(async (transaction) => {
      const saveDoc = await transaction.get(saveDocRef);
      const postDoc = await transaction.get(postRef);

      if (!postDoc.exists) {
        throw new Error("Gönderi bulunamadı.");
      }

      if (saveDoc.exists) {
        transaction.delete(saveDocRef);
        transaction.update(postRef, {
          "stats.saves": FieldValue.increment(-1),
        });
        return false;
      } else {
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
      error: "Kaydetme işlemi başarısız oldu. " + error.message,
    });
  }
};

// Yorum Ekleme Fonksiyonu
exports.submitPostComment = async (req, res) => {
  const { postId, commentText } = req.body;
  const userId = req.user.uid;
  const userPhotoURL = req.user.photoURL;
  const displayName = req.user.displayName;
  const postType = "globalPosts";

  if (!postId || !commentText || !userId) {
    return res.status(400).json({ error: "Yorum eklemek için eksik bilgi." });
  }

  const postRef = db.collection(postType).doc(postId);
  const commentsRef = postRef.collection("comments");

  try {
    const newCommentRef = await commentsRef.add({
      uid: userId,
      displayName,
      photoURL: userPhotoURL,
      commentText,
      createdAt: FieldValue.serverTimestamp(),
    });

    await postRef.update({
      "stats.comments": FieldValue.increment(1),
    });

    res.status(201).json({
      message: "Yorum başarıyla eklendi.",
      commentId: newCommentRef.id,
    });
  } catch (error) {
    console.error("Yorum eklenirken hata oluştu:", error);
    res.status(500).json({ error: "Yorum ekleme işlemi başarısız oldu." });
  }
};

// Gönderiye Ait Yorumları Getiren Fonksiyon
exports.retrievePostComments = async (req, res) => {
  const { postId } = req.query;
  const postType = "globalPosts";

  if (!postId) {
    return res.status(400).json({ error: "Gönderi kimliği eksik." });
  }

  const commentsRef = db.collection(postType).doc(postId).collection("comments");

  try {
    const commentsSnapshot = await commentsRef.orderBy("createdAt", "asc").get();
    const comments = commentsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({ comments });
  } catch (error) {
    console.error("Yorumlar getirilirken hata:", error);
    res.status(500).json({ error: "Yorumlar getirilemedi." });
  }
};

// Yorum Silme İşlemini Yöneten Fonksiyon
exports.removePostComment = async (req, res) => {
  const { postId, commentId } = req.body;
  const userId = req.user.uid;
  const postType = "globalPosts";

  if (!postId || !commentId || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  const commentRef = db.collection(postType).doc(postId).collection("comments").doc(commentId);
  const postRef = db.collection(postType).doc(postId);

  try {
    const commentDoc = await commentRef.get();

    if (!commentDoc.exists) {
      return res.status(404).json({ error: "Yorum bulunamadı." });
    }

    if (commentDoc.data().uid !== userId) {
      return res.status(403).json({ error: "Bu yorumu silme yetkiniz yok." });
    }

    await db.runTransaction(async (transaction) => {
      transaction.delete(commentRef);
      transaction.update(postRef, {
        "stats.comments": FieldValue.increment(-1),
      });
    });

    res.status(200).json({ success: true, message: "Yorum başarıyla silindi." });
  } catch (error) {
    console.error("Yorum silinirken hata:", error);
    res.status(500).json({ error: "Yorum silme işlemi başarısız oldu." });
  }
};

// Paylaşım İşlemini Yöneten Fonksiyon
exports.recordPostShare = async (req, res) => {
  const { postId } = req.body;
  const userId = req.user.uid;
  const postType = "globalPosts";

  if (!postId || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  const postRef = db.collection(postType).doc(postId);

  try {
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }

    await db.runTransaction(async (transaction) => {
      transaction.update(postRef, {
        "stats.shares": FieldValue.increment(1),
      });
    });

    res.status(200).json({ success: true, message: "Paylaşım sayısı güncellendi." });
  } catch (error) {
    console.error("Paylaşım işlemi hatası:", error);
    res.status(500).json({
      error: "Paylaşım işlemi başarısız oldu. " + error.message,
    });
  }
};