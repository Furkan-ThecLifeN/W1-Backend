// controllers/reportController.js
const { db, FieldValue } = require("../config/firebase");

/**
 * Kullanıcıların gönderi veya kullanıcıları raporlamasını sağlar.
 * Raporlar, 'reports' koleksiyonuna kaydedilir.
 */
exports.createReport = async (req, res) => {
  const { postId, reportedUserId, reason } = req.body;
  const reporterUid = req.user.uid;

  if (!postId || !reportedUserId || !reason) {
    return res.status(400).json({ error: "Post ID, reported user ID ve şikayet sebebi zorunludur." });
  }

  try {
    // Öncelikle hangi koleksiyonda olduğunu kontrol edelim
    let postSnap = await db.collection("globalPosts").doc(postId).get();
    let collectionName = "globalPosts";

    if (!postSnap.exists) {
      postSnap = await db.collection("globalFeeds").doc(postId).get();
      collectionName = "globalFeeds";
    }

    if (!postSnap.exists) {
      postSnap = await db.collection("globalFeelings").doc(postId).get();
      collectionName = "globalFeelings";
    }

    if (!postSnap.exists) {
      return res.status(404).json({ error: "Raporlanacak gönderi bulunamadı." });
    }

    // Raporu reports koleksiyonuna ekle
    await db.collection("reports").add({
      postId,
      reportedUserId,
      reason,
      reporterUid,
      collection: collectionName, // hangi koleksiyondan raporlandığını kaydediyoruz
      createdAt: FieldValue.serverTimestamp(),
      status: "pending", // başlangıç durumu
    });

    return res.status(201).json({
      message: "Şikayetiniz başarıyla iletildi ve incelenmek üzere sıraya alındı.",
    });
  } catch (error) {
    console.error("Şikayet gönderme hatası:", error);
    return res.status(500).json({
      error: "Sunucu hatası: Şikayetiniz gönderilemedi.",
      details: error.message,
    });
  }
};
