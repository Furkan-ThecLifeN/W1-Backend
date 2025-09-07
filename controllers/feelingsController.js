// feelingsController.js
const { db, FieldValue } = require("../config/firebase");

// ✅ Gönderi paylaşma işlevi
exports.sharePost = async (req, res) => {
  // Hata ayıklama için token ve kullanıcı bilgilerini logla
  console.log("İstek kullanıcısı:", req.user);

  const { postText, images, privacy } = req.body;

  // Yetkilendirme kontrolü
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
  const photoURL =
    req.user.picture ||
    req.user.photoURL ||
    "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png";

  // Gönderi alanlarını kontrol et
  if (!postText.trim() && (!images || images.length === 0)) {
    return res.status(400).json({
      error: "Gönderi metni veya en az bir görsel gereklidir.",
    });
  }

  // Yeni gönderi nesnesi
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
    let docRef;
    if (privacy === "public") {
      docRef = await db.collection("globalFeelings").add(newFeeling);
      console.log(`Herkese açık gönderi kaydedildi: ${docRef.id}`);
      return res.status(201).json({
        message: "Gönderi başarıyla herkese açık olarak paylaşıldı.",
        feelingId: docRef.id,
      });
    } else {
      const userFeelingsRef = db
        .collection("users")
        .doc(uid)
        .collection("feelings");
      docRef = await userFeelingsRef.add(newFeeling);
      console.log(`Kullanıcıya özel gönderi kaydedildi: ${docRef.id}`);
      return res.status(201).json({
        message: "Gönderi başarıyla özel olarak paylaşıldı.",
        feelingId: docRef.id,
      });
    }
  } catch (error) {
    console.error("Gönderi paylaşım hatası:", error);
    return res.status(500).json({
      error: "Sunucu hatası: Gönderi paylaşılamadı.",
      details: error.message,
    });
  }
};
