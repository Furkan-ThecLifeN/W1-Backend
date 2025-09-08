// controllers/postController.js
const { db, FieldValue } = require("../config/firebase");

// ✅ Gönderi paylaşma işlevi
exports.sharePost = async (req, res) => {
  console.log("İstek kullanıcısı:", req.user);

  const { caption, privacy } = req.body;
  let imageUrls = [];

  if (req.files && req.files.length > 0) {
    imageUrls = req.files.map(file => `${req.protocol}://${req.get("host")}/uploads/${file.filename}`);
  }

  if (!req.user || !req.user.uid) {
    console.error("Yetkilendirme hatası: Kullanıcı bilgileri eksik.");
    return res
      .status(401)
      .json({ error: "Yetkilendirme hatası: Kullanıcı bilgileri eksik." });
  }

  // Kullanıcı bilgilerini güvenli şekilde al
  const uid = req.user.uid;
  const displayName = req.user.name || req.user.displayName || req.user.email;
  const username = req.user.username || (req.user.email ? req.user.email.split("@")[0] : "Kullanıcı");
  const photoURL = req.user.picture || req.user.photoURL || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png";

  // Gönderi alanlarını kontrol et
  if (!caption.trim() && imageUrls.length === 0) {
    return res.status(400).json({
      error: "Gönderi metni veya en az bir görsel gereklidir.",
    });
  }

  // ✅ Yeni gönderi nesnesi
  const newPost = {
    uid,
    username,
    displayName,
    photoURL,
    caption: caption || "",
    imageUrls, // artık array
    privacy,
    createdAt: FieldValue.serverTimestamp(),
    stats: {
      likes: 0,
      comments: 0,
      shares: 0,
    },
  };

  try {
    // ✅ 1. Gönderiyi her zaman kullanıcının kişisel 'posts' koleksiyonuna kaydet
    const userPostsRef = db
      .collection("users")
      .doc(uid)
      .collection("posts");
    const userDocRef = await userPostsRef.add(newPost);
    console.log(`Kullanıcıya özel post kaydedildi: ${userDocRef.id}`);

    let globalDocId = null;

    // ✅ 2. Eğer gizlilik "public" ise, global 'globalPosts' koleksiyonuna da kaydet
    if (privacy === "public") {
      const globalDocRef = await db.collection("globalPosts").add(newPost);
      globalDocId = globalDocRef.id;
      console.log(`Herkese açık post da kaydedildi: ${globalDocId}`);
    }

    return res.status(201).json({
      message: "Post başarıyla paylaşıldı.",
      postId: userDocRef.id,
      globalPostId: globalDocId,
    });
  } catch (error) {
    console.error("Post paylaşım hatası:", error);
    return res.status(500).json({
      error: "Sunucu hatası: Post paylaşılamadı.",
      details: error.message,
    });
  }
};
