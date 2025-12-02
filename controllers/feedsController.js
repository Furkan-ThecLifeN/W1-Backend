// controllers/feedsController.js
const { db, admin } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const { getYouTubeEmbedUrl } = require("../utils/mediaHelpers");

/**
 * 1. FEED OLUŞTURMA
 */
exports.createFeed = async (req, res) => {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Yetkilendirme hatası." });

    const { postText, mediaUrl, ownershipAccepted, rulesAccepted, images, privacy } = req.body; 
    const userId = req.user.uid;

    const isAccepted = rulesAccepted || ownershipAccepted;

    // --- Validasyonlar ---
    // 1. URL ve Onay Kontrolü
    if (!mediaUrl || !isAccepted) {
      return res.status(400).json({ error: "Video URL'si ve kural onayı gereklidir." });
    }

    // 2. YouTube Embed Kontrolü
    const embedUrl = getYouTubeEmbedUrl(mediaUrl);
    if (!embedUrl) {
      return res.status(400).json({ error: "Geçerli bir YouTube Shorts URL'si değil." });
    }

    // 🔥 DEĞİŞİKLİK: 150 KARAKTER KURALI KALDIRILDI 🔥
    // Sadece boş metin kontrolü yapabilirsin (İsteğe bağlı, boş da olabilir)
    // if (!postText || postText.trim().length === 0) { ... }

    // Kullanıcı Profilini Çek
    const userDocRef = db.collection("users").doc(userId);
    const userDoc = await userDocRef.get();
    
    if (!userDoc.exists) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    
    const userData = userDoc.data();

    // --- Veri Hazırlığı ---
    const feedId = db.collection("globalFeeds").doc().id; 
    const createdAt = FieldValue.serverTimestamp();

    const postData = {
      id: feedId,
      type: "feed",
      collectionName: "globalFeeds",
      createdAt,
      uid: userId,
      ownerId: userId,
      username: userData.username || "unknown_user",
      displayName: userData.displayName || "Kullanıcı",
      userProfileImage: userData.photoURL || "",
      photoURL: userData.photoURL || "",
      text: postText || "",
      content: postText || "",
      mediaUrl: embedUrl,
      rulesAccepted: true, 
      isOriginalContent: false,
      privacy: privacy || "public",
      images: images || [],
      stats: { comments: 0, likes: 0, shares: 0, saves: 0 },
      commentsDisabled: false,
    };

    const batch = db.batch();

    // 1. Kullanıcı Koleksiyonu
    const userFeedRef = userDocRef.collection("feeds").doc(feedId);
    batch.set(userFeedRef, postData);

    // 2. Global Koleksiyon (Gizli değilse)
    if (privacy !== "private") {
        const globalFeedRef = db.collection("globalFeeds").doc(feedId);
        batch.set(globalFeedRef, postData);
    }

    // 3. İstatistik Artır
    batch.update(userDocRef, {
        "stats.posts": FieldValue.increment(1)
    });

    await batch.commit();

    res.status(201).json({ message: "Feed başarıyla paylaşıldı.", postId: feedId });

  } catch (error) {
    console.error("Feed oluşturma hatası:", error);
    res.status(500).json({ error: "Sunucu hatası: " + error.message });
  }
};

/**
 * 2. FEED SİLME
 */
exports.deleteFeed = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;

    const userFeedRef = db.collection("users").doc(uid).collection("feeds").doc(postId);
    const globalFeedRef = db.collection("globalFeeds").doc(postId);
    const userDocRef = db.collection("users").doc(uid);

    const feedSnap = await userFeedRef.get();

    if (!feedSnap.exists) return res.status(404).json({ error: "Feed bulunamadı." });
    if (feedSnap.data().uid !== uid) return res.status(403).json({ error: "Yetkiniz yok." });

    const batch = db.batch();

    batch.delete(userFeedRef);
    batch.delete(globalFeedRef);

    batch.update(userDocRef, {
        "stats.posts": FieldValue.increment(-1)
    });

    await batch.commit();

    res.status(200).json({ message: "Feed başarıyla silindi." });
  } catch (e) {
    console.error("Feed silme hatası:", e);
    res.status(500).json({ error: "Feed silinemedi.", details: e.message });
  }
};

/**
 * 3. AKIŞ (FEED) GETİRME
 */
exports.getFeedFeed = async (req, res) => {
    try {
        const { uid } = req.user;
        const { lastDocId } = req.query;

        const followingSnap = await db.collection("follows")
            .where("followerUid", "==", uid)
            .where("status", "==", "following")
            .get();

        let targetUids = followingSnap.docs.map(doc => doc.data().followingUid);
        targetUids.push(uid);

        if (targetUids.length === 0) return res.status(200).json({ feeds: [] });

        const activeUids = targetUids.slice(0, 30);

        let query = db.collection("globalFeeds")
            .where("uid", "in", activeUids)
            .orderBy("createdAt", "desc")
            .limit(10);

        if (lastDocId) {
            const lastDocSnap = await db.collection("globalFeeds").doc(lastDocId).get();
            if (lastDocSnap.exists) {
                query = query.startAfter(lastDocSnap);
            }
        }

        const snapshot = await query.get();
        const feeds = snapshot.docs.map(doc => doc.data());

        return res.status(200).json({
            feeds,
            lastDocId: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null
        });

    } catch (error) {
        console.error("Feed akışı hatası:", error);
        return res.status(500).json({ error: "Akış yüklenemedi." });
    }
};

/**
 * 4. YORUMLARI AÇ/KAPA
 */
exports.toggleFeedComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;
    const { disable } = req.body; 

    if (typeof disable !== 'boolean') {
        return res.status(400).json({ error: "Geçersiz durum." });
    }

    const userFeedRef = db.collection("users").doc(uid).collection("feeds").doc(postId);
    const globalFeedRef = db.collection("globalFeeds").doc(postId);

    const feedSnap = await userFeedRef.get();
    if (!feedSnap.exists) return res.status(404).json({ error: "Feed bulunamadı." });
    
    const batch = db.batch();
    batch.update(userFeedRef, { commentsDisabled: disable });
    
    const globalSnap = await globalFeedRef.get();
    if (globalSnap.exists) {
        batch.update(globalFeedRef, { commentsDisabled: disable });
    }

    await batch.commit();

    res.status(200).json({ 
        message: `Yorumlar ${disable ? 'kapatıldı' : 'açıldı'}.`,
        commentsDisabled: disable
    });
  } catch (e) {
    console.error("Yorum toggle hatası:", e);
    res.status(500).json({ error: "İşlem başarısız.", details: e.message });
  }
};

/**
 * 5. FEED DETAYI GETİRME
 */
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