const admin = require("firebase-admin");
const db = admin.firestore();

/**
 * Yeni bir feeling paylaşır
 */
exports.shareFeeling = async (req, res) => {
  try {
    const { postText, images, privacy } = req.body;
    const userId = req.user.uid;

    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }
    const userData = userDoc.data();

    const newFeelingData = {
      type: "feeling",
      collectionName: "globalFeelings",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      displayName: userData.displayName || "Kullanıcı",
      images: images || [],
      photoURL: userData.photoURL || "",
      privacy: privacy || "public",
      stats: {
        comments: 0,
        likes: 0,
        shares: 0,
        saves: 0,
      },
      text: postText || "",
      uid: userId,
      username: userData.username || "unknown_user",
      commentsDisabled: false, // Başlangıçta yorumlar açık
    };

    const newFeelingRef = await db.collection("globalFeelings").add(newFeelingData);

    res.status(201).json({
      message: "Gönderi başarıyla paylaşıldı!",
      postId: newFeelingRef.id,
    });
  } catch (error) {
    console.error("Gönderi paylaşılırken hata oluştu:", error);
    res.status(500).json({ error: "Sunucu hatası. Lütfen tekrar deneyin." });
  }
};


/**
 * Feeling siler
 */
exports.deleteFeeling = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;

    const feelingRef = db.collection("globalFeelings").doc(postId);
    const doc = await feelingRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }
    if (doc.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    await feelingRef.delete();
    res.status(200).json({ message: "Gönderi başarıyla silindi." });
  } catch (error) {
    console.error("Gönderi silme hatası:", error);
    res.status(500).json({ error: "Gönderi silinemedi.", details: error.message });
  }
};

/**
 * Yorumları kapatır
 */
exports.disableComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;

    const feelingRef = db.collection("globalFeelings").doc(postId);
    const doc = await feelingRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }
    if (doc.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    await feelingRef.update({ commentsDisabled: true });
    res.status(200).json({ message: "Yorumlar kapatıldı." });
  } catch (error) {
    console.error("Yorumları kapatma hatası:", error);
    res.status(500).json({ error: "Yorumlar kapatılamadı.", details: error.message });
  }
};

/**
 * Yorumları açar
 */
exports.enableComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;

    const feelingRef = db.collection("globalFeelings").doc(postId);
    const doc = await feelingRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }
    if (doc.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    await feelingRef.update({ commentsDisabled: false });
    res.status(200).json({ message: "Yorumlar açıldı." });
  } catch (error) {
    console.error("Yorumları açma hatası:", error);
    res.status(500).json({ error: "Yorumlar açılamadı.", details: error.message });
  }
};

/**
 * ID ile tek bir feeling çeker
 */
exports.getFeelingById = async (req, res) => {
  try {
    const { postId } = req.params;
    const docRef = db.collection("globalFeelings").doc(postId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }

    res.status(200).json({ post: doc.data() });
  } catch (error) {
    console.error("Gönderi çekme hatası:", error);
    res.status(500).json({ error: "Gönderi çekilemedi.", details: error.message });
  }
};
