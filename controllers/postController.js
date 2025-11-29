// controllers/postController.js
const { db, FieldValue } = require("../config/firebase");

/**
 * Kullanıcının resim veya VIDEO içeren gönderi paylaşmasını sağlar.
 * Gönderi hem kullanıcının özel koleksiyonuna hem de genel akışa kaydedilir.
 */
exports.sharePost = async (req, res) => {
  if (!req.user?.uid) {
    return res.status(401).json({ error: "Yetkilendirme hatası. Lütfen giriş yapın." });
  }

  // Frontend'den gelen verileri alıyoruz.
  // Not: Frontend artık 'mediaType' (video/image) ve 'mediaUrls' gönderebilir.
  const { caption, privacy, mediaUrls: bodyMediaUrls, mediaType } = req.body;
  const uid = req.user.uid;

  // Medya URL'lerini topluyoruz (Hem string URL olarak gelenler hem de dosya olarak yüklenenler)
  let finalMediaUrls = [];
  
  // 1. Body'den gelen URL'leri işle (String veya Array olabilir)
  if (Array.isArray(bodyMediaUrls)) {
    finalMediaUrls = bodyMediaUrls;
  } else if (bodyMediaUrls) {
    finalMediaUrls = [bodyMediaUrls];
  }

  // 2. Multer ile yüklenen dosyaları işle (Eğer dosya yüklenmişse)
  if (req.files?.length > 0) {
    const uploadedUrls = req.files.map(
      (file) => `${req.protocol}://${req.get("host")}/uploads/${file.filename}`
    );
    finalMediaUrls = [...finalMediaUrls, ...uploadedUrls];
  }

  // Validasyon: Ne metin var ne de medya varsa hata ver
  if (!caption?.trim() && finalMediaUrls.length === 0) {
    return res.status(400).json({ error: "Gönderi metni veya en az bir medya (resim/video) gereklidir." });
  }

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı profili bulunamadı." });
    }
    const userData = userDoc.data();

    const postData = {
      type: "post",
      collectionName: "globalPosts",
      uid,
      username: userData.username || "unknown_user",
      displayName: userData.displayName || "Kullanıcı",
      photoURL: userData.photoURL || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png",
      caption: caption || "",
      
      // ✅ YENİ: Hem genel medya alanı hem de tipini kaydediyoruz
      mediaUrls: finalMediaUrls,
      mediaType: mediaType || "image", // Frontend göndermezse varsayılan 'image'
      
      // Geriye dönük uyumluluk (Eski bileşenler bozulmasın diye imageUrls'u de dolduruyoruz)
      imageUrls: finalMediaUrls, 
      
      privacy: privacy || "public",
      createdAt: FieldValue.serverTimestamp(),
      stats: {
        likes: 0,
        comments: 0,
        shares: 0,
      },
      commentsDisabled: false,
    };

    const newPostRef = db.collection("users").doc(uid).collection("posts").doc();
    const newGlobalPostRef = db.collection("globalPosts").doc(newPostRef.id);

    const batch = db.batch();
    batch.set(newPostRef, postData);
    if (privacy === "public") {
      batch.set(newGlobalPostRef, postData);
    }

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

// Yorumları açma 
exports.enableComments = async (req, res) => {
  const { postId } = req.params;
  const uid = req.user.uid;

  try {
    const postRef = db.collection("users").doc(uid).collection("posts").doc(postId);
    const postSnap = await postRef.get();

    if (!postSnap.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }
    if (postSnap.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    await postRef.update({ commentsDisabled: false });

    const globalPostRef = db.collection("globalPosts").doc(postId);
    await globalPostRef.update({ commentsDisabled: false });

    return res.status(200).json({ message: "Yorumlar başarıyla açıldı." });
  } catch (e) {
    console.error("Yorumları açma hatası:", e);
    return res.status(500).json({ error: "Yorumlar açılamadı.", details: e.message });
  }
};