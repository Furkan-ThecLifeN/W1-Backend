// controllers/feedsController.js
const { db, FieldValue } = require("../config/firebase");
const { getYouTubeEmbedUrl } = require("../utils/mediaHelpers");

/**
 * Kullanıcının YouTube Shorts paylaşmasını sağlar.
 * Gönderi hem kullanıcının özel koleksiyonuna hem de genel akışa kaydedilir.
 */
exports.createFeed = async (req, res) => {
  if (!req.user?.uid) {
    return res.status(401).json({ error: "Yetkilendirme hatası. Lütfen giriş yapın." });
  }

  const { content, mediaUrl, ownershipAccepted } = req.body;
  const userId = req.user.uid;

  if (!mediaUrl || !ownershipAccepted) {
    return res.status(400).json({ error: "Video URL'si ve sahiplik onayı gerekli." });
  }

  const embedUrl = getYouTubeEmbedUrl(mediaUrl);
  if (!embedUrl) {
    return res.status(400).json({ error: "Geçerli bir YouTube Shorts URL'si değil." });
  }

  try {
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }
    const userData = userDoc.data();

    const postData = {
      type: "feed",
      content: content || "",
      mediaUrl: embedUrl,
      ownerId: userId,
      username: userData.username || "Anonim Kullanıcı",
      userProfileImage: userData.photoURL || "https://i.pravatar.cc/48",
      createdAt: FieldValue.serverTimestamp(),
      ownershipAccepted: ownershipAccepted,
      likes: 0,
    };

    // Yeni feed için benzersiz ID oluşturur.
    const newFeedRef = db.collection("users").doc(userId).collection("feeds").doc();
    const newGlobalFeedRef = db.collection("globalFeeds").doc(newFeedRef.id);

    const batch = db.batch();
    batch.set(newFeedRef, postData);
    batch.set(newGlobalFeedRef, postData);

    await batch.commit();

    // Kullanıcının istatistiklerini günceller.
    await db.collection("users").doc(userId).update({
      "stats.posts": FieldValue.increment(1),
    });

    res.status(201).json({ message: "Feed başarıyla paylaşıldı.", postId: newFeedRef.id });
  } catch (error) {
    console.error("Feed oluşturma hatası:", error);
    res.status(500).json({ error: "Sunucu hatası: " + error.message });
  }
};