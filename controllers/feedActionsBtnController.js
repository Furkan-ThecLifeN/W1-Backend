// /controllers/feedActionsBtnController.js

const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { v4: uuidv4 } = require("uuid");
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

// Yorum Ekleme İşlemini Yöneten Fonksiyon (Admin SDK)
exports.submitFeedComment = async (req, res) => {
  const { feedId, feedType, commentText } = req.body;
  const { uid, name, email } = req.user;

  if (!feedId || !commentText) {
    return res.status(400).json({ error: "feedId ve commentText gerekli." });
  }

  try {
    const feedCollectionName = feedType || "globalFeeds";
    const feedRef = db.collection(feedCollectionName).doc(feedId);
    const commentsRef = feedRef.collection("comments");

    const newComment = {
      uid,
      displayName: name || email.split("@")[0] || "Kullanıcı",
      text: commentText,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const commentDocRef = await commentsRef.add(newComment);

    // Belgeyi tekrar çekip timestamp'i gerçek Date olarak gönderebilirsin
    const commentSnap = await commentDocRef.get();
    const commentData = commentSnap.data();

    res.status(201).json({
      message: "Yorum başarıyla eklendi.",
      comment: { id: commentDocRef.id, ...commentData },
    });
  } catch (err) {
    console.error("Yorum ekleme hatası:", err);
    res.status(500).json({ error: "Yorum eklenemedi (sunucu hatası)." });
  }
};

// Gönderiye Ait Yorumları Getiren Fonksiyon
exports.retrieveFeedComments = async (req, res) => {
  try {
    const { feedId, feedType } = req.query;

    if (!feedId || !feedType) {
      return res.status(400).json({ error: "Eksik parametreler: feedId ve feedType gerekli." });
    }

    // ✅ Yorumları çekmeden önce ana gönderinin varlığını kontrol et
    const feedRef = db.collection(feedType).doc(feedId);
    const feedDoc = await feedRef.get();

    if (!feedDoc.exists) {
      console.error("❌ Belirtilen feedId için gönderi bulunamadı:", feedId);
      return res.status(404).json({ error: "Yorum yapılacak gönderi bulunamadı." });
    }

    const commentsRef = feedRef.collection("comments");
    const commentsSnapshot = await commentsRef.orderBy("createdAt", "desc").get();

    const comments = commentsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({ comments });
  } catch (error) {
    console.error("Yorum çekilirken hata oluştu:", error);
    res.status(500).json({ error: "Yorumlar çekilirken bir hata oluştu." });
  }
};

// Yorum Silme İşlemini Yöneten Fonksiyon
exports.removeFeedComment = async (req, res) => {
  const { feedId, commentId } = req.body;
  const uid = req.user?.uid;

  if (!feedId || !commentId || !uid) {
    return res.status(400).json({ error: "Feed ID, yorum ID veya kullanıcı ID eksik." });
  }

  try {
    const commentRef = db.collection("globalFeeds").doc(feedId).collection("comments").doc(commentId);
    
    const commentDoc = await commentRef.get();

    if (!commentDoc.exists) {
      return res.status(404).json({ error: "Yorum bulunamadı." });
    }

    if (commentDoc.data().uid !== uid) {
      return res.status(403).json({ error: "Bu yorumu silme yetkiniz yok." });
    }

    await commentRef.delete();
    
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