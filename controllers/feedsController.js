const { db, FieldValue } = require("../config/firebase");
const { getYouTubeEmbedUrl } = require("../utils/mediaHelpers");

// Feed oluşturma
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
      privacy: privacy || "public",
      images: images || [],
      stats: {
        comments: 0,
        likes: 0,
        shares: 0,
        saves: 0,
      },
      commentsDisabled: false, // yorumlar başlangıçta açık
    };

    const newFeedRef = db
      .collection("users")
      .doc(userId)
      .collection("feeds")
      .doc();
    const newGlobalFeedRef = db.collection("globalFeeds").doc(newFeedRef.id);

    const batch = db.batch();
    batch.set(newFeedRef, postData);

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

// Feed silme
exports.deleteFeed = async (req, res) => {
  const { postId } = req.params;
  const uid = req.user.uid;

  try {
    const userFeedRef = db.collection("users").doc(uid).collection("feeds").doc(postId);
    const feedSnap = await userFeedRef.get();

    if (!feedSnap.exists) {
      return res.status(404).json({ error: "Feed bulunamadı." });
    }

    if (feedSnap.data().uid !== uid) {
      return res.status(403).json({ error: "Yetkiniz yok." });
    }

    const globalFeedRef = db.collection("globalFeeds").doc(postId);
    const batch = db.batch();
    batch.delete(userFeedRef);
    batch.delete(globalFeedRef);

    await batch.commit();
    res.status(200).json({ message: "Feed başarıyla silindi." });
  } catch (e) {
    console.error("Feed silme hatası:", e);
    res.status(500).json({ error: "Feed silinemedi.", details: e.message });
  }
};

// Yorumları kapatma
exports.disableComments = async (req, res) => {
  const { postId } = req.params;
  const uid = req.user.uid;

  try {
    const feedRef = db.collection("users").doc(uid).collection("feeds").doc(postId);
    const feedSnap = await feedRef.get();

    if (!feedSnap.exists) return res.status(404).json({ error: "Feed bulunamadı." });
    if (feedSnap.data().uid !== uid) return res.status(403).json({ error: "Yetkiniz yok." });

    await feedRef.update({ commentsDisabled: true });
    await db.collection("globalFeeds").doc(postId).update({ commentsDisabled: true });

    res.status(200).json({ message: "Yorumlar kapatıldı." });
  } catch (e) {
    console.error("Yorum kapatma hatası:", e);
    res.status(500).json({ error: "Yorumlar kapatılamadı.", details: e.message });
  }
};

// Yorumları açma
exports.enableComments = async (req, res) => {
  const { postId } = req.params;
  const uid = req.user.uid;

  try {
    const feedRef = db.collection("users").doc(uid).collection("feeds").doc(postId);
    const feedSnap = await feedRef.get();

    if (!feedSnap.exists) return res.status(404).json({ error: "Feed bulunamadı." });
    if (feedSnap.data().uid !== uid) return res.status(403).json({ error: "Yetkiniz yok." });

    await feedRef.update({ commentsDisabled: false });
    await db.collection("globalFeeds").doc(postId).update({ commentsDisabled: false });

    res.status(200).json({ message: "Yorumlar açıldı." });
  } catch (e) {
    console.error("Yorum açma hatası:", e);
    res.status(500).json({ error: "Yorumlar açılamadı.", details: e.message });
  }
};

// Feed detayını getirme
exports.getFeedById = async (req, res) => {
  try {
    const { postId } = req.params;
    const feedRef = db.collection("globalFeeds").doc(postId);
    const doc = await feedRef.get();

    if (!doc.exists) return res.status(404).json({ error: "Feed bulunamadı." });

    res.status(200).json({ post: doc.data() });
  } catch (error) {
    console.error("Feed çekme hatası:", error);
    res.status(500).json({ error: "Feed çekilemedi." });
  }
};
