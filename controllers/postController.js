// controllers/postController.js
const { db, admin } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");

/**
 * 1. GÖNDERİ PAYLAŞMA
 * - Medya işleme (Dosya veya Link)
 * - Batch yazma (UserPost + GlobalPost + UserStats güncelleme)
 */
exports.sharePost = async (req, res) => {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Yetkisiz erişim." });

    const { uid } = req.user;
    const { caption, privacy, mediaUrls, mediaType } = req.body;
    const files = req.files;

    // --- Medya Hazırlığı ---
    let finalMediaUrls = [];

    // 1. JSON Body'den gelen URL'ler (Embed/Link)
    if (Array.isArray(mediaUrls)) {
      finalMediaUrls = mediaUrls;
    } else if (mediaUrls) {
      finalMediaUrls = [mediaUrls];
    }

    // 2. Yüklenen Dosyalar
    if (files && files.length > 0) {
      const uploadedUrls = files.map(
        (file) => `${req.protocol}://${req.get("host")}/uploads/${file.filename}`
      );
      finalMediaUrls = [...finalMediaUrls, ...uploadedUrls];
    }

    // Validasyon
    if (!caption?.trim() && finalMediaUrls.length === 0) {
      return res.status(400).json({ error: "Metin veya medya gereklidir." });
    }

    // Kullanıcı Profilini Çek (Snapshot için)
    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();
    
    if (!userDoc.exists) return res.status(404).json({ error: "Profil bulunamadı." });
    const userData = userDoc.data();

    // --- Veri Hazırlığı ---
    const postId = db.collection("globalPosts").doc().id; // ID önceden üretildi
    const createdAt = FieldValue.serverTimestamp();

    const postData = {
      id: postId,
      type: "post",
      uid,
      username: userData.username || "unknown",
      displayName: userData.displayName || "Kullanıcı",
      photoURL: userData.photoURL || "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png",
      caption: caption || "",
      mediaUrls: finalMediaUrls,
      mediaType: mediaType || "image",
      privacy: privacy || "public", // 'public', 'friends', 'private'
      createdAt,
      stats: { likes: 0, comments: 0, shares: 0 },
      commentsDisabled: false,
    };

    // --- Batch İşlemi (Tek Seferde Çoklu Yazma - Atomik) ---
    const batch = db.batch();

    // 1. Kullanıcının kendi koleksiyonuna yaz
    const userPostRef = userDocRef.collection("posts").doc(postId);
    batch.set(userPostRef, postData);

    // 2. Genel akışa yaz (Eğer gizli değilse)
    if (privacy !== "private") {
        const globalPostRef = db.collection("globalPosts").doc(postId);
        batch.set(globalPostRef, postData);
    }

    // 3. Kullanıcının post sayısını artır (Stats Güncelleme)
    batch.update(userDocRef, {
        "stats.posts": FieldValue.increment(1)
    });

    await batch.commit();

    return res.status(201).json({ 
        message: "Post paylaşıldı.", 
        post: postData 
    });

  } catch (error) {
    console.error("Post paylaşma hatası:", error);
    return res.status(500).json({ error: "Sunucu hatası." });
  }
};

/**
 * 2. GÖNDERİ SİLME
 * - Hem user hem global koleksiyondan siler
 * - Kullanıcının post sayısını düşürür
 */
exports.deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { uid } = req.user;

    const userPostRef = db.collection("users").doc(uid).collection("posts").doc(postId);
    const globalPostRef = db.collection("globalPosts").doc(postId);
    const userDocRef = db.collection("users").doc(uid);

    // Sadece user post referansını kontrol etmek yeterli (Read tasarrufu)
    const postSnap = await userPostRef.get();

    if (!postSnap.exists) return res.status(404).json({ error: "Gönderi bulunamadı." });
    
    // Yetki Kontrolü (Zaten path uid içeriyor ama ekstra güvenlik)
    if (postSnap.data().uid !== uid) return res.status(403).json({ error: "Yetkisiz işlem." });

    const batch = db.batch();

    // 1. Postları Sil
    batch.delete(userPostRef);
    batch.delete(globalPostRef);

    // 2. İstatistik Düşür
    batch.update(userDocRef, {
        "stats.posts": FieldValue.increment(-1)
    });

    await batch.commit();

    return res.status(200).json({ message: "Gönderi silindi." });

  } catch (e) {
    console.error("Post silme hatası:", e);
    return res.status(500).json({ error: "İşlem başarısız." });
  }
};

/**
 * 3. AKIŞ (FEED) GETİRME - (Story Mantığıyla Optimize Edildi)
 * - Takip edilenleri çeker.
 * - IN sorgusu ile toplu veri alır.
 */
exports.getPostFeed = async (req, res) => {
    try {
        const { uid } = req.user;
        const { lastDocId } = req.query; // Sayfalama için (Pagination)

        // 1. Takip Edilenleri Çek
        const followingSnap = await db.collection("follows")
            .where("followerUid", "==", uid)
            .where("status", "==", "following")
            .get();

        let targetUids = followingSnap.docs.map(doc => doc.data().followingUid);
        targetUids.push(uid); // Kendi gönderilerimizi de görelim

        if (targetUids.length === 0) return res.status(200).json({ posts: [] });

        // 2. Chunking (Firestore IN limiti: 30)
        // Burada sadece ilk 30 kişiyi alıyoruz. Gelişmiş sistemde bu kısım da sayfalanmalı.
        const activeUids = targetUids.slice(0, 30);

        let query = db.collection("globalPosts")
            .where("uid", "in", activeUids)
            .orderBy("createdAt", "desc")
            .limit(10); // Her seferde 10 post

        // Sayfalama (Infinite Scroll için)
        if (lastDocId) {
            const lastDocSnap = await db.collection("globalPosts").doc(lastDocId).get();
            if (lastDocSnap.exists) {
                query = query.startAfter(lastDocSnap);
            }
        }

        const snapshot = await query.get();
        const posts = snapshot.docs.map(doc => doc.data());

        return res.status(200).json({ 
            posts,
            lastDocId: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null
        });

    } catch (error) {
        console.error("Feed çekme hatası:", error);
        return res.status(500).json({ error: "Akış yüklenemedi." });
    }
};

/**
 * 4. YORUMLARI AÇ/KAPA (Toggle)
 * - Tek fonksiyonda birleştirildi.
 */
exports.togglePostComments = async (req, res) => {
    try {
        const { postId } = req.params;
        const { uid } = req.user;
        // Body'den durumu al: { disable: true } veya { disable: false }
        const { disable } = req.body; 

        if (typeof disable !== 'boolean') {
            return res.status(400).json({ error: "Geçersiz durum bilgisi." });
        }

        const userPostRef = db.collection("users").doc(uid).collection("posts").doc(postId);
        const globalPostRef = db.collection("globalPosts").doc(postId);

        // Önce varlık ve yetki kontrolü
        const postSnap = await userPostRef.get();
        if (!postSnap.exists) return res.status(404).json({ error: "Post bulunamadı." });
        
        // Batch ile güncelle
        const batch = db.batch();
        batch.update(userPostRef, { commentsDisabled: disable });
        
        // Global postu da güncelle (Eğer varsa - try catch kullanmadan batch içinde hata vermez, referans varsa dener)
        // Ancak globalPost'un varlığından emin olmak için update kullanıyoruz.
        // Eğer post 'private' ise globalde olmayabilir.
        const globalSnap = await globalPostRef.get();
        if (globalSnap.exists) {
            batch.update(globalPostRef, { commentsDisabled: disable });
        }

        await batch.commit();

        return res.status(200).json({ 
            message: `Yorumlar ${disable ? 'kapatıldı' : 'açıldı'}.`,
            commentsDisabled: disable 
        });

    } catch (error) {
        console.error("Yorum toggle hatası:", error);
        return res.status(500).json({ error: "İşlem başarısız." });
    }
};