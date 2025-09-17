// /controllers/feedActionsBtnController.js

const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const db = admin.firestore();

// Beğeni İşlemini Yöneten Fonksiyon
exports.handleFeedAffinity = async (req, res) => {
  try {
    const { feedId } = req.body;
    const userId = req.user?.uid;
    const feedType = "globalFeeds";

    console.log("✅ handleFeedAffinity çalıştı");
    console.log("Body:", req.body);
    console.log("User UID:", userId);

    if (!feedId || !userId) {
      console.error("❌ feedId veya userId eksik!");
      return res.status(401).json({ error: "İşlem için kimlik doğrulama veya gönderi bilgisi eksik." });
    }

    const userLikeRef = db.collection("users").doc(userId).collection("likes").doc(feedId);
    const feedRef = db.collection(feedType).doc(feedId);

    const isLiked = await db.runTransaction(async (transaction) => {
      const userLikeDoc = await transaction.get(userLikeRef);
      const feedDoc = await transaction.get(feedRef);

      if (!feedDoc.exists) {
        throw new Error("Gönderi bulunamadı.");
      }

      if (userLikeDoc.exists) {
        // Beğeni varsa, sil
        transaction.delete(userLikeRef);
        transaction.update(feedRef, {
          likes: FieldValue.increment(-1),
        });
        return false;
      } else {
        // Beğeni yoksa, ekle
        transaction.set(userLikeRef, {
          likedAt: FieldValue.serverTimestamp(),
          feedId,
          ownerId: feedDoc.data().ownerId,
        });
        transaction.update(feedRef, {
          likes: FieldValue.increment(1),
        });
        return true;
      }
    });

    console.log("✅ Beğeni işlemi başarılı. isLiked:", isLiked);
    res.status(200).json({ success: true, isLiked });
  } catch (error) {
    console.error("Beğeni işlemi hatası:", error);
    res.status(500).json({
      error: "Beğeni işlemi başarısız oldu. " + error.message,
    });
  }
};

// Kaydetme İşlemini Yöneten Fonksiyon
exports.handleFeedCollection = async (req, res) => {
  const { feedId } = req.body;
  const userId = req.user.uid;
  const feedType = "globalFeeds";

  if (!feedId || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  const userSaveRef = db
    .collection("users")
    .doc(userId)
    .collection("saves")
    .doc(feedId);
  const feedRef = db.collection(feedType).doc(feedId);

  try {
    const isSaved = await db.runTransaction(async (transaction) => {
      const userSaveDoc = await transaction.get(userSaveRef);
      const feedDoc = await transaction.get(feedRef);

      if (!feedDoc.exists) {
        throw new Error("Gönderi bulunamadı.");
      }

      if (userSaveDoc.exists) {
        transaction.delete(userSaveRef);
        return false;
      } else {
        const feedData = feedDoc.data();
        const savedData = {
          feedId,
          type: "feed",
          ownerId: feedData.ownerId,
          mediaUrl: feedData.mediaUrl,
          content: feedData.content,
          createdAt: feedData.createdAt,
          savedAt: FieldValue.serverTimestamp(),
        };
        transaction.set(userSaveRef, savedData);
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

// Yorum Ekleme İşlemini Yöneten Fonksiyon
exports.submitFeedComment = async (req, res) => {
  const { feedId, commentText } = req.body;
  const userId = req.user.uid;
  const userPhotoURL = req.user.photoURL;
  const displayName = req.user.displayName;
  const feedType = "globalFeeds";

  if (!feedId || !commentText || !userId) {
    return res.status(400).json({ error: "Yorum eklemek için eksik bilgi." });
  }

  const feedRef = db.collection(feedType).doc(feedId);
  const commentsRef = feedRef.collection("comments");

  try {
    const newCommentRef = await commentsRef.add({
      uid: userId,
      displayName,
      photoURL: userPhotoURL,
      commentText,
      createdAt: FieldValue.serverTimestamp(),
    });

    // `postsActionsBtnController.js`'deki gibi "stats.comments" kullanmıyoruz.
    // Feed koleksiyonunda `comments` adında bir alan yok.
    // Ancak yoruma ekleme işlemi yapabilirsiniz, bu işlem istatistik güncellemeyi gerektirmez.
    
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
exports.retrieveFeedComments = async (req, res) => {
  const { feedId } = req.query;
  const feedType = "globalFeeds";

  if (!feedId) {
    return res.status(400).json({ error: "Gönderi kimliği eksik." });
  }

  const commentsRef = db.collection(feedType).doc(feedId).collection("comments");

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
exports.removeFeedComment = async (req, res) => {
  const { feedId, commentId } = req.body;
  const userId = req.user.uid;
  const feedType = "globalFeeds";

  if (!feedId || !commentId || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  const commentRef = db
    .collection(feedType)
    .doc(feedId)
    .collection("comments")
    .doc(commentId);
  const feedRef = db.collection(feedType).doc(feedId);

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
    });

    res.status(200).json({ success: true, message: "Yorum başarıyla silindi." });
  } catch (error) {
    console.error("Yorum silinirken hata:", error);
    res.status(500).json({ error: "Yorum silme işlemi başarısız oldu." });
  }
};

// Paylaşım İşlemini Yöneten Fonksiyon
exports.recordFeedShare = async (req, res) => {
  const { feedId } = req.body;
  const userId = req.user.uid;
  const feedType = "globalFeeds";

  if (!feedId || !userId) {
    return res.status(400).json({ error: "Eksik parametreler." });
  }

  const feedRef = db.collection(feedType).doc(feedId);

  try {
    const feedDoc = await feedRef.get();
    if (!feedDoc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }

    res.status(200).json({ success: true, message: "Paylaşım işlemi başarıyla tamamlandı." });
  } catch (error) {
    console.error("Paylaşım işlemi hatası:", error);
    res.status(500).json({
      error: "Paylaşım işlemi başarısız oldu. " + error.message,
    });
  }
};