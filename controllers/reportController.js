// controllers/reportController.js
const { db, FieldValue } = require("../config/firebase");

/**
 * Kullanıcıların gönderi veya kullanıcıları raporlamasını sağlar.
 * Raporlar, 'reports' koleksiyonuna kaydedilir.
 */
exports.createReport = async (req, res) => {
  const { postId, reportedUserId, reason } = req.body;
  const reporterUid = req.user.uid;

  // Temel veri doğrulaması: Gerekli alanların doldurulduğundan emin olunur.
  if (!postId || !reportedUserId || !reason) {
    return res.status(400).json({ error: "Post ID, reported user ID ve şikayet sebebi zorunludur." });
  }

  try {
    // Raporlanacak gönderinin gerçekten var olup olmadığını kontrol edin (isteğe bağlı ama önerilir).
    const postRef = db.collection("globalPosts").doc(postId);
    const postSnap = await postRef.get();

    if (!postSnap.exists) {
      // Gönderi mevcut değilse 404 döndür. Bu, hatalı istekleri engeller.
      return res.status(404).json({ error: "Raporlanacak gönderi bulunamadı." });
    }

    // `reports` koleksiyonuna yeni bir rapor belgesi eklenir.
    await db.collection("reports").add({
      postId,
      reportedUserId,
      reason,
      reporterUid,
      createdAt: FieldValue.serverTimestamp(),
      status: 'pending', // Raporun durumunu takip etmek için başlangıç durumu
    });

    return res.status(201).json({ message: "Şikayetiniz başarıyla iletildi ve incelenmek üzere sıraya alındı." });
  } catch (error) {
    console.error("Şikayet gönderme hatası:", error);
    return res.status(500).json({ 
      error: "Sunucu hatası: Şikayetiniz gönderilemedi.",
      details: error.message,
    });
  }
};