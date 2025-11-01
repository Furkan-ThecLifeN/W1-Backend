// controllers/feelingController.js
const admin = require("firebase-admin");
const db = admin.firestore();

/**
 * Yeni bir feeling paylaşır
 * GÜNCELLENDİ: Artık hem global koleksiyona hem de kullanıcı alt koleksiyonuna yazar.
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
      commentsDisabled: false,
    };

    // --- GÜNCELLENEN BATCH LOGIC ---
    const newFeelingRef = db
      .collection("users")
      .doc(userId)
      .collection("feelings")
      .doc();
    const newGlobalFeelingRef = db
      .collection("globalFeelings")
      .doc(newFeelingRef.id);

    const batch = db.batch();
    // 1. Her zaman kullanıcının kendi koleksiyonuna yaz
    batch.set(newFeelingRef, newFeelingData);

    // 2. Sadece 'public' ise global koleksiyona yaz
    if (newFeelingData.privacy === "public") {
      batch.set(newGlobalFeelingRef, newFeelingData);
    }

    await batch.commit();
    // --- GÜNCELLEME SONU ---

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
 * GÜNCELLENDİ: Artık hem global koleksiyondan hem de kullanıcı alt koleksiyonundan siler.
 */
exports.deleteFeeling = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;

    // --- GÜNCELLENEN SİLME LOGIC ---
    // 1. Yetki kontrolü için kullanıcının kendi gönderisine bak
    const userFeelingRef = db
      .collection("users")
      .doc(uid)
      .collection("feelings")
      .doc(postId);
    const doc = await userFeelingRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }
    if (doc.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    // 2. Global referansı da hazırla
    const globalFeelingRef = db.collection("globalFeelings").doc(postId);

    // 3. Batch ile her iki yerden de sil
    const batch = db.batch();
    batch.delete(userFeelingRef);
    batch.delete(globalFeelingRef);

    await batch.commit();
    // --- GÜNCELLEME SONU ---

    res.status(200).json({ message: "Gönderi başarıyla silindi." });
  } catch (error) {
    console.error("Gönderi silme hatası:", error);
    res
      .status(500)
      .json({ error: "Gönderi silinemedi.", details: error.message });
  }
};

/**
 * Yorumları kapatır
 * GÜNCELLENDİ: Artık her iki koleksiyonda da günceller.
 */
exports.disableComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;

    // --- GÜNCELLENEN LOGIC ---
    const userFeelingRef = db
      .collection("users")
      .doc(uid)
      .collection("feelings")
      .doc(postId);
    const doc = await userFeelingRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }
    if (doc.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    const globalFeelingRef = db.collection("globalFeelings").doc(postId);

    // Batch veya ayrı await kullanılabilir
    await userFeelingRef.update({ commentsDisabled: true });
    // Globalde yoksa hata vermemesi için try-catch eklenebilir veya varlığı kontrol edilebilir
    // Şimdilik postController'daki gibi direkt update yapıyoruz:
    await globalFeelingRef.update({ commentsDisabled: true });
    // --- GÜNCELLEME SONU ---

    res.status(200).json({ message: "Yorumlar kapatıldı." });
  } catch (error) {
    console.error("Yorumları kapatma hatası:", error);
    res
      .status(500)
      .json({ error: "Yorumlar kapatılamadı.", details: error.message });
  }
};

/**
 * Yorumları açar
 * GÜNCELLENDİ: Artık her iki koleksiyonda da günceller.
 */
exports.enableComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;

    // --- GÜNCELLENEN LOGIC ---
    const userFeelingRef = db
      .collection("users")
      .doc(uid)
      .collection("feelings")
      .doc(postId);
    const doc = await userFeelingRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }
    if (doc.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    const globalFeelingRef = db.collection("globalFeelings").doc(postId);

    await userFeelingRef.update({ commentsDisabled: false });
    await globalFeelingRef.update({ commentsDisabled: false });
    // --- GÜNCELLEME SONU ---

    res.status(200).json({ message: "Yorumlar açıldı." });
  } catch (error) {
    console.error("Yorumları açma hatası:", error);
    res
      .status(500)
      .json({ error: "Yorumlar açılamadı.", details: error.message });
  }
};

/**
 * ID ile tek bir feeling çeker
 * (Bu fonksiyon globalden okumaya devam etmeli, public bir gönderiyi herkesin görebilmesi için)
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
    res
      .status(500)
      .json({ error: "Gönderi çekilemedi.", details: error.message });
  }
};
