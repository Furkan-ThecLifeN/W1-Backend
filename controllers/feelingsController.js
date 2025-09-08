// feelingsController.js
const { db, FieldValue } = require("../config/firebase");

// ✅ Gönderi paylaşma işlevi
exports.sharePost = async (req, res) => {
  console.log("İstek kullanıcısı:", req.user);

  const { postText, images, privacy } = req.body;

  if (!req.user || !req.user.uid) {
    console.error("Yetkilendirme hatası: Kullanıcı bilgileri eksik.");
    return res
      .status(401)
      .json({ error: "Yetkilendirme hatası: Kullanıcı bilgileri eksik." });
  }

  const uid = req.user.uid;

  // 🔹 Varsayılan bilgileri hazırla (JWT'den gelenler)
  let username =
    req.user.username ||
    (req.user.email ? req.user.email.split("@")[0] : "Kullanıcı");
  let displayName =
    req.user.name || req.user.displayName || req.user.email || "Kullanıcı";
  let photoURL =
    req.user.picture ||
    req.user.photoURL ||
    "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png";

  try {
    // 🔹 Firestore'dan kullanıcı profili çek (daha güvenilir)
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      username = userData.username || username;
      displayName = userData.displayName || displayName;
      photoURL = userData.photoURL || photoURL;
    }
  } catch (err) {
    console.error("Kullanıcı profili alınamadı, fallback kullanılacak:", err);
  }

  // Gönderi alanlarını kontrol et
  if (!postText?.trim() && (!images || images.length === 0)) {
    return res.status(400).json({
      error: "Gönderi metni veya en az bir görsel gereklidir.",
    });
  }

  // ✅ Yeni gönderi nesnesi
  const newFeeling = {
    uid,
    username,
    displayName,
    photoURL,
    text: postText,
    images: images || [],
    privacy,
    createdAt: FieldValue.serverTimestamp(),
    stats: {
      likes: 0,
      comments: 0,
      shares: 0,
    },
  };

  try {
    // ✅ 1. Kullanıcının kendi koleksiyonuna kaydet
    const userFeelingsRef = db
      .collection("users")
      .doc(uid)
      .collection("feelings");
    const userDocRef = await userFeelingsRef.add(newFeeling);
    console.log(`Kullanıcıya özel gönderi kaydedildi: ${userDocRef.id}`);

    let globalDocId = null;

    // ✅ 2. Eğer gönderi herkese açık ise global koleksiyona da ekle
    if (privacy === "public") {
      const globalDocRef = await db.collection("globalFeelings").add(newFeeling);
      globalDocId = globalDocRef.id;
      console.log(`Herkese açık gönderi de kaydedildi: ${globalDocId}`);
    }

    return res.status(201).json({
      message: "Gönderi başarıyla paylaşıldı.",
      feelingId: userDocRef.id,
      globalFeelingId: globalDocId,
    });
  } catch (error) {
    console.error("Gönderi paylaşım hatası:", error);
    return res.status(500).json({
      error: "Sunucu hatası: Gönderi paylaşılamadı.",
      details: error.message,
    });
  }
};
