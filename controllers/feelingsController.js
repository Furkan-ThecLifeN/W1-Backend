// controllers/feelingsController.js
const admin = require("firebase-admin");
const db = admin.firestore();
const { FieldValue } = admin.firestore;

/**
 * 1. FEELING PAYLAŞMA
 * - Batch işlemi ile User Collection, Global Collection ve User Stats güncellenir.
 */
exports.shareFeeling = async (req, res) => {
  try {
    const { postText, images, privacy } = req.body;
    const userId = req.user.uid;

    // Kullanıcı verisini çek (Snapshot için)
    const userDocRef = db.collection("users").doc(userId);
    const userDoc = await userDocRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }
    const userData = userDoc.data();

    // ID ve Zaman damgası
    const feelingId = db.collection("globalFeelings").doc().id;
    const createdAt = FieldValue.serverTimestamp();

    const newFeelingData = {
      id: feelingId,
      type: "feeling",
      collectionName: "globalFeelings",
      uid: userId,
      username: userData.username || "unknown_user",
      displayName: userData.displayName || "Kullanıcı",
      photoURL: userData.photoURL || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png",
      text: postText || "",
      images: images || [],
      privacy: privacy || "public",
      createdAt,
      stats: {
        comments: 0,
        likes: 0,
        shares: 0,
        saves: 0,
      },
      commentsDisabled: false,
    };

    const batch = db.batch();

    // 1. Kullanıcının kendi koleksiyonuna yaz
    const userFeelingRef = userDocRef.collection("feelings").doc(feelingId);
    batch.set(userFeelingRef, newFeelingData);

    // 2. Genel akışa yaz (Sadece 'public' ise)
    // Eğer 'friends' veya 'private' ise global listeye eklenmeyebilir,
    // ancak Feed algoritması 'getFeelingFeed' içinde zaten filtreleme yapar.
    // PostController mantığıyla uyumlu olması için gizli değilse ekliyoruz.
    if (privacy !== "private") {
        const globalFeelingRef = db.collection("globalFeelings").doc(feelingId);
        batch.set(globalFeelingRef, newFeelingData);
    }

    // 3. Kullanıcının istatistiklerini güncelle (stats.feelings)
    batch.update(userDocRef, {
        "stats.feelings": FieldValue.increment(1)
    });

    await batch.commit();

    res.status(201).json({
      message: "Feeling paylaşıldı!",
      postId: feelingId,
      feeling: newFeelingData
    });

  } catch (error) {
    console.error("Feeling paylaşma hatası:", error);
    res.status(500).json({ error: "Sunucu hatası." });
  }
};

/**
 * 2. FEELING SİLME
 * - Atomik işlemle her yerden siler ve sayacı düşürür.
 */
exports.deleteFeeling = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;

    const userFeelingRef = db.collection("users").doc(uid).collection("feelings").doc(postId);
    const globalFeelingRef = db.collection("globalFeelings").doc(postId);
    const userDocRef = db.collection("users").doc(uid);

    // Sadece user referansını kontrol et (Maliyet tasarrufu)
    const doc = await userFeelingRef.get();

    if (!doc.exists) return res.status(404).json({ error: "Gönderi bulunamadı." });
    if (doc.data().uid !== uid) return res.status(403).json({ error: "Yetkisiz işlem." });

    const batch = db.batch();

    // 1. Silme İşlemleri
    batch.delete(userFeelingRef);
    batch.delete(globalFeelingRef);

    // 2. İstatistik Düşürme
    batch.update(userDocRef, {
        "stats.feelings": FieldValue.increment(-1)
    });

    await batch.commit();

    res.status(200).json({ message: "Feeling silindi." });

  } catch (error) {
    console.error("Silme hatası:", error);
    res.status(500).json({ error: "Silinemedi." });
  }
};

/**
 * 3. FEELING AKIŞINI GETİR (FEED) - (YENİ ÖZELLİK)
 * - Takip edilen kullanıcıların "feelings" paylaşımlarını getirir.
 */
exports.getFeelingFeed = async (req, res) => {
    try {
        const { uid } = req.user;
        const { lastDocId } = req.query; // Sayfalama için

        // 1. Takip edilenleri çek
        const followingSnap = await db.collection("follows")
            .where("followerUid", "==", uid)
            .where("status", "==", "following")
            .get();

        let targetUids = followingSnap.docs.map(doc => doc.data().followingUid);
        targetUids.push(uid); // Kendimizi de ekle

        if (targetUids.length === 0) return res.status(200).json({ feelings: [] });

        // 2. Chunking (Limit 30)
        const activeUids = targetUids.slice(0, 30);

        let query = db.collection("globalFeelings")
            .where("uid", "in", activeUids)
            .orderBy("createdAt", "desc")
            .limit(10);

        // Sayfalama
        if (lastDocId) {
            const lastDocSnap = await db.collection("globalFeelings").doc(lastDocId).get();
            if (lastDocSnap.exists) {
                query = query.startAfter(lastDocSnap);
            }
        }

        const snapshot = await query.get();
        const feelings = snapshot.docs.map(doc => doc.data());

        return res.status(200).json({
            feelings,
            lastDocId: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null
        });

    } catch (error) {
        console.error("Feed hatası:", error);
        return res.status(500).json({ error: "Akış yüklenemedi." });
    }
};

/**
 * 4. YORUMLARI AÇ/KAPA (TEK FONKSİYON)
 * - PostController'daki gibi birleştirildi.
 */
exports.toggleFeelingComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const uid = req.user.uid;
    const { disable } = req.body; // true = kapat, false = aç

    if (typeof disable !== 'boolean') {
        return res.status(400).json({ error: "Geçersiz değer." });
    }

    const userFeelingRef = db.collection("users").doc(uid).collection("feelings").doc(postId);
    const globalFeelingRef = db.collection("globalFeelings").doc(postId);

    const doc = await userFeelingRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Bulunamadı." });
    
    const batch = db.batch();
    batch.update(userFeelingRef, { commentsDisabled: disable });
    
    // Globalde varsa güncelle
    const globalSnap = await globalFeelingRef.get();
    if (globalSnap.exists) {
        batch.update(globalFeelingRef, { commentsDisabled: disable });
    }

    await batch.commit();

    res.status(200).json({ 
        message: `Yorumlar ${disable ? 'kapatıldı' : 'açıldı'}.`,
        commentsDisabled: disable
    });

  } catch (error) {
    console.error("Yorum toggle hatası:", error);
    res.status(500).json({ error: "İşlem başarısız." });
  }
};

/**
 * 5. TEK BİR FEELING GETİR (ID İLE)
 */
exports.getFeelingById = async (req, res) => {
  try {
    const { postId } = req.params;
    const docRef = db.collection("globalFeelings").doc(postId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Gönderi bulunamadı." });
    }

    res.status(200).json({ post: doc.data() });
  } catch (error) {
    console.error("Detay çekme hatası:", error);
    res.status(500).json({ error: "Gönderi çekilemedi." });
  }
};