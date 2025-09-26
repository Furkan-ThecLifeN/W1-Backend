// controllers/feedsController.js
const { db, FieldValue } = require("../config/firebase");
const { getYouTubeEmbedUrl } = require("../utils/mediaHelpers");

exports.createFeed = async (req, res) => {
  if (!req.user?.uid) {
    return res
      .status(401)
      .json({ error: "Yetkilendirme hatası. Lütfen giriş yapın." });
  }

  const { postText, mediaUrl, ownershipAccepted, images, privacy } = req.body; 
  const userId = req.user.uid;

  if (!mediaUrl || !ownershipAccepted) {
    return res
      .status(400)
      .json({ error: "Video URL'si ve sahiplik onayı gerekli." });
  }

  const embedUrl = getYouTubeEmbedUrl(mediaUrl);
  if (!embedUrl) {
    return res
      .status(400)
      .json({ error: "Geçerli bir YouTube Shorts URL'si değil." });
  }

  try {
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }
    const userData = userDoc.data();

    const postData = {
      type: "feed",
      createdAt: FieldValue.serverTimestamp(),
      uid: userId,
      ownerId: userId,
      username: userData.username || "unknown_user",
      displayName: userData.displayName || "Kullanıcı",
      userProfileImage:
        userData.photoURL ||
        "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png",
      photoURL: userData.photoURL || "",
      text: postText || "",
      content: postText || "",
      mediaUrl: embedUrl,
      ownershipAccepted: ownershipAccepted,
      privacy: privacy || "public", // ✅ gizlilik alanı eklendi
      images: images || [],
      stats: {
        comments: 0,
        likes: 0,
        shares: 0,
        saves: 0,
      },
    };

    const newFeedRef = db
      .collection("users")
      .doc(userId)
      .collection("feeds")
      .doc();
    const newGlobalFeedRef = db.collection("globalFeeds").doc(newFeedRef.id);

    const batch = db.batch();
    batch.set(newFeedRef, postData);

    // ✅ sadece public olanlar globalFeeds'e yazılır
    if (privacy === "public") {
      batch.set(newGlobalFeedRef, postData);
    }

    await batch.commit();

    await db.collection("users").doc(userId).update({
      "stats.posts": FieldValue.increment(1),
    });

    res
      .status(201)
      .json({ message: "Feed başarıyla paylaşıldı.", postId: newFeedRef.id });
  } catch (error) {
    console.error("Feed oluşturma hatası:", error);
    res.status(500).json({ error: "Sunucu hatası: " + error.message });
  }
};
