const { db, admin } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");

// 1. Hikaye Paylaşma (Aynı kaldı, mantık doğru)
exports.shareStory = async (req, res) => {
  try {
    const { uid } = req.user;
    const { privacy, mediaUrl, mediaType, caption } = req.body; 
    const files = req.files;

    let finalMediaUrl = mediaUrl;
    let finalMediaType = mediaType || "image";

    if (files && files.length > 0) {
      finalMediaUrl = `${req.protocol}://${req.get("host")}/uploads/${files[0].filename}`;
      finalMediaType = files[0].mimetype.startsWith("video") ? "video" : "image";
    }

    if (!finalMediaUrl) return res.status(400).json({ error: "Medya gerekli." });

    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    const userData = userDoc.data();

    const storyId = db.collection("globalStories").doc().id;
    const createdAt = Date.now();
    const expiresAt = createdAt + (24 * 60 * 60 * 1000); // 24 Saat

    const storyData = {
      id: storyId,
      uid,
      username: userData.username,
      displayName: userData.displayName,
      userPhotoURL: userData.photoURL || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png",
      mediaUrl: finalMediaUrl,
      type: finalMediaType,
      caption: caption || "",
      privacy: privacy || "friends",
      createdAt,
      expiresAt,
      viewers: [],
      isDeleted: false
    };

    const batch = db.batch();
    const userStoryRef = db.collection("users").doc(uid).collection("stories").doc(storyId);
    const globalStoryRef = db.collection("globalStories").doc(storyId);

    batch.set(userStoryRef, storyData);
    batch.set(globalStoryRef, storyData);

    await batch.commit();

    res.status(201).json({ message: "Hikaye paylaşıldı.", story: storyData });

  } catch (error) {
    console.error("Share story error:", error);
    res.status(500).json({ error: "Sunucu hatası." });
  }
};

// 2. Hikaye Akışını Getir (🔥 OPTİMİZE EDİLDİ 🔥)
exports.getStoryFeed = async (req, res) => {
  try {
    const { uid } = req.user; // İstek yapan kişi (Ben)
    const now = Date.now();

    // 1. Takip ve Yakın Arkadaşları Çek (Aynı)
    const [followingSnap, closeFriendsSnap] = await Promise.all([
      db.collection("follows").where("followerUid", "==", uid).where("status", "==", "following").get(),
      db.collection("users").doc(uid).collection("closeFriends").get()
    ]);

    let targetUids = followingSnap.docs.map(doc => doc.data().followingUid);
    targetUids.push(uid); 
    const closeFriendUids = new Set(closeFriendsSnap.docs.map(doc => doc.id));

    if (targetUids.length === 0) return res.status(200).json({ feed: [] });

    // 2. Chunking (Aynı)
    const chunks = [];
    while (targetUids.length > 0) chunks.push(targetUids.splice(0, 30));

    let allActiveStories = [];

    // 3. Veritabanı Sorgusu (Aynı)
    for (const chunk of chunks) {
      const snapshot = await db.collection("globalStories")
        .where("uid", "in", chunk)
        .where("expiresAt", ">", now) 
        .where("isDeleted", "==", false)
        .orderBy("expiresAt", "asc")
        .get();

      snapshot.docs.forEach(doc => allActiveStories.push(doc.data()));
    }

    // 4. Gruplama ve Görüldü Kontrolü
    const groupedFeed = {};

    for (const story of allActiveStories) {
      // Gizlilik Kontrolü
      if (story.uid !== uid) {
         if (story.privacy === 'private') continue; 
         if (story.privacy === 'close_friendships' && !closeFriendUids.has(story.uid)) continue; 
      }

      // ✅ Görüldü Kontrolü: Ben bu hikayenin viewers listesinde var mıyım?
      // Not: story.viewers undefined olabilir, önlem alıyoruz.
      const viewers = story.viewers || [];
      const isViewed = viewers.includes(uid);

      // Story objesine 'seen' bayrağı ekle (Frontend bunu kullanacak)
      const storyWithStatus = { ...story, seen: isViewed };

      if (!groupedFeed[story.uid]) {
        groupedFeed[story.uid] = {
          user: {
            uid: story.uid,
            username: story.username,
            displayName: story.displayName,
            photoURL: story.userPhotoURL
          },
          stories: [],
          // Grubun tamamının görülüp görülmediğini takip edeceğiz
          allSeen: true 
        };
      }
      
      groupedFeed[story.uid].stories.push(storyWithStatus);
      
      // Eğer bu hikaye görülmemişse, grubun "hepsi görüldü" durumu false olur
      if (!isViewed) {
        groupedFeed[story.uid].allSeen = false;
      }
    }

    // 5. Sıralama (Görülmemişler Önce, Görülenler Sona)
    let feedArray = Object.values(groupedFeed);

    // Kendi içindeki sıralama (Zaman)
    feedArray.forEach(group => {
        group.stories.sort((a, b) => a.createdAt - b.createdAt);
    });

    // Ana Liste Sıralaması:
    // 1. Kendi hikayem her zaman en başta (Frontend hallediyor ama burada da ayırabilirsin)
    // 2. Görülmemiş hikayeler (allSeen: false)
    // 3. Görülmüş hikayeler (allSeen: true)
    feedArray.sort((a, b) => {
        if (a.user.uid === uid) return -1; // Ben hep baştayım
        if (b.user.uid === uid) return 1;
        
        if (a.allSeen === b.allSeen) return 0; // İkisi de aynı durumdaysa
        return a.allSeen ? 1 : -1; // Görülenler sona (true > false sıralaması)
    });

    res.status(200).json({ feed: feedArray });

  } catch (error) {
    console.error("Get story feed error:", error);
    res.status(500).json({ error: "Hikayeler alınamadı." });
  }
};

// 3. Hikaye Silme (Soft Delete)
exports.deleteStory = async (req, res) => {
  try {
    const { uid } = req.user;
    const { storyId } = req.params;

    const globalRef = db.collection("globalStories").doc(storyId);
    const userStoryRef = db.collection("users").doc(uid).collection("stories").doc(storyId);

    const doc = await globalRef.get();

    // Eğer globalden silinmişse (24 saat geçmiş ve cron silmişse) sadece user arşivinden sil
    if (!doc.exists) {
        await userStoryRef.delete();
        return res.status(200).json({ message: "Arşivden silindi." });
    }

    if (doc.data().uid !== uid) return res.status(403).json({ error: "Yetkisiz işlem." });

    const batch = db.batch();
    batch.delete(globalRef); 
    batch.delete(userStoryRef);

    await batch.commit();

    res.status(200).json({ message: "Hikaye kaldırıldı." });
  } catch (error) {
    console.error("Delete story error:", error);
    res.status(500).json({ error: "Hata." });
  }
};

// 4. Hikayeye Yorum Yapma (Placeholder)
exports.commentStory = async (req, res) => {
  try {
    const { uid } = req.user;
    const { storyId } = req.params;
    const { text } = req.body;

    const commentData = {
      senderUid: uid,
      storyId: storyId,
      text: text,
      createdAt: FieldValue.serverTimestamp()
    };

    await db.collection("storyComments").add(commentData);
    res.status(200).json({ message: "Yorum gönderildi." });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Yorum yapılamadı." });
  }
};

// ✅ YENİ FONKSİYON: Hikayeyi Görüldü İşaretle
exports.markStoryAsViewed = async (req, res) => {
  try {
    const { uid } = req.user; // Gören kişi
    const { storyId } = req.params;

    const storyRef = db.collection("globalStories").doc(storyId);
    
    // arrayUnion ile UID'yi ekle (varsa tekrar eklemez, güvenlidir)
    await storyRef.update({
      viewers: FieldValue.arrayUnion(uid)
    });

    // İsteğe bağlı: Kullanıcının kendi koleksiyonundakini de güncelle
    // (Bunu yapmak zorunda değilsin ama tutarlılık için iyi olabilir)
    // Ancak performans için şimdilik sadece globali güncelliyoruz.

    res.status(200).json({ message: "Viewed" });
  } catch (error) {
    console.error("Mark viewed error:", error);
    res.status(500).json({ error: "Error" });
  }
};

// ✅ YENİ: Global Public Story Feed (Keşfet Story'leri)
exports.getPublicStoryFeed = async (req, res) => {
  try {
    const { uid } = req.user;
    const now = Date.now();

    // Sadece 'public' olan, silinmemiş ve süresi dolmamış hikayeleri çek
    // Limit koyuyoruz ki milyonlarca veri gelmesin.
    const snapshot = await db.collection("globalStories")
      .where("privacy", "==", "public") 
      .where("expiresAt", ">", now)
      .where("isDeleted", "==", false)
      .orderBy("expiresAt", "desc") // En yeniler (veya popülerlik algoritması eklenebilir)
      .limit(50) 
      .get();

    let allStories = [];
    snapshot.docs.forEach(doc => allStories.push(doc.data()));

    // Gruplama ve Görüldü Kontrolü
    const groupedFeed = {};

    for (const story of allStories) {
      // Kendi hikayemi public feed'de görmeyeyim (isteğe bağlı)
      if (story.uid === uid) continue;

      // Görüldü kontrolü
      const viewers = story.viewers || [];
      const isViewed = viewers.includes(uid);
      const storyWithStatus = { ...story, seen: isViewed };

      if (!groupedFeed[story.uid]) {
        groupedFeed[story.uid] = {
          user: {
            uid: story.uid,
            username: story.username,
            displayName: story.displayName,
            photoURL: story.userPhotoURL
          },
          stories: [],
          allSeen: true 
        };
      }
      
      groupedFeed[story.uid].stories.push(storyWithStatus);
      
      if (!isViewed) {
        groupedFeed[story.uid].allSeen = false;
      }
    }

    // Sıralama (Görülmemişler önce)
    let feedArray = Object.values(groupedFeed);
    
    feedArray.forEach(group => {
        group.stories.sort((a, b) => a.createdAt - b.createdAt);
    });

    feedArray.sort((a, b) => {
        if (a.allSeen === b.allSeen) return 0;
        return a.allSeen ? 1 : -1;
    });

    res.status(200).json({ feed: feedArray });

  } catch (error) {
    console.error("Public story feed error:", error);
    res.status(500).json({ error: "Hikayeler alınamadı." });
  }
};