// controllers/postController.js
const { db, FieldValue } = require("../config/firebase");

/**
 * Kullanıcının resim veya yazı içeren gönderi paylaşmasını sağlar.
 * Gönderi hem kullanıcının özel koleksiyonuna hem de genel akışa kaydedilir.
 */
exports.sharePost = async (req, res) => {
  if (!req.user?.uid) {
    return res.status(401).json({ error: "Yetkilendirme hatası. Lütfen giriş yapın." });
  }

  const { caption, privacy, imageUrls: bodyImageUrls } = req.body;
  const uid = req.user.uid;

  // Frontend'den gelen veya multer ile yüklenen görselleri birleştirir.
  let imageUrls = [];
  if (Array.isArray(bodyImageUrls)) {
    imageUrls = bodyImageUrls;
  }
  if (req.files?.length > 0) {
    const uploadedUrls = req.files.map(
      (file) => `${req.protocol}://${req.get("host")}/uploads/${file.filename}`
    );
    imageUrls = [...imageUrls, ...uploadedUrls];
  }

  // Gönderi içeriği boşsa hatayı önler.
  if (!caption?.trim() && imageUrls.length === 0) {
    return res.status(400).json({ error: "Gönderi metni veya en az bir görsel gereklidir." });
  }

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı profili bulunamadı." });
    }
    const userData = userDoc.data();

    const postData = {
      uid,
      username: userData.username || "unknown_user",
      displayName: userData.displayName || "Kullanıcı",
      photoURL: userData.photoURL || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png",
      caption: caption || "",
      imageUrls,
      privacy: privacy || "public",
      createdAt: FieldValue.serverTimestamp(),
      stats: {
        likes: 0,
        comments: 0,
        shares: 0,
      },
      commentsDisabled: false, // Yorumlar ilk başta açık olur
    };

    // Yeni gönderi için benzersiz ID oluşturur ve bu ID'yi her iki koleksiyon için de kullanır.
    const newPostRef = db.collection("users").doc(uid).collection("posts").doc();
    const newGlobalPostRef = db.collection("globalPosts").doc(newPostRef.id);

    // Batch işlemi başlatılır.
    const batch = db.batch();

    // Kullanıcının özel koleksiyonuna ve global koleksiyona aynı veriyi kaydeder.
    batch.set(newPostRef, postData);
    if (privacy === "public") {
      batch.set(newGlobalPostRef, postData);
    }

    // İşlem tamamlanır.
    await batch.commit();

    return res.status(201).json({
      message: "Post başarıyla paylaşıldı.",
      postId: newPostRef.id,
    });
  } catch (error) {
    console.error("Post paylaşım hatası:", error);
    return res.status(500).json({
      error: "Sunucu hatası: Post paylaşılamadı.",
      details: error.message,
    });
  }
};

/**
 * Gönderiyi hem kullanıcının kişisel koleksiyonundan hem de genel akıştan siler.
 * Sadece gönderi sahibi tarafından kullanılabilir.
 */
exports.deletePost = async (req, res) => {
  const { postId } = req.params;
  const uid = req.user.uid;

  try {
    const userPostRef = db.collection("users").doc(uid).collection("posts").doc(postId);
    const postSnap = await userPostRef.get();

    if (!postSnap.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }
    // Güvenlik kontrolü: Gönderinin sahibinin silme yetkisi olduğunu doğrular.
    if (postSnap.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    const globalPostRef = db.collection("globalPosts").doc(postId);

    const batch = db.batch();
    batch.delete(userPostRef);
    batch.delete(globalPostRef);

    await batch.commit();
    return res.status(200).json({ message: "Gönderi başarıyla silindi." });
  } catch (e) {
    console.error("Gönderi silme hatası:", e);
    return res.status(500).json({ error: "Gönderi silinemedi.", details: e.message });
  }
};

/**
 * Gönderide yorum yapma özelliğini kapatır.
 * Sadece gönderi sahibi tarafından kullanılabilir.
 */
exports.disableComments = async (req, res) => {
  const { postId } = req.params;
  const uid = req.user.uid;

  try {
    const postRef = db.collection("users").doc(uid).collection("posts").doc(postId);
    const postSnap = await postRef.get();

    if (!postSnap.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }
    // Güvenlik kontrolü: Gönderinin sahibinin yorumları kapatma yetkisi olduğunu doğrular.
    if (postSnap.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    // Firestore'da `commentsDisabled` flag'ini `true` olarak günceller.
    await postRef.update({ commentsDisabled: true });

    // Global akışta da aynı güncellemeyi yapar, böylece herkes için geçerli olur.
    const globalPostRef = db.collection("globalPosts").doc(postId);
    await globalPostRef.update({ commentsDisabled: true });
    
    return res.status(200).json({ message: "Yorumlar başarıyla kapatıldı." });
  } catch (e) {
    console.error("Yorumları kapatma hatası:", e);
    return res.status(500).json({ error: "Yorumlar kapatılamadı.", details: e.message });
  }
};