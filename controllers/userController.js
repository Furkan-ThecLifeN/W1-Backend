// controllers/userController.js

const { auth, db } = require("../config/firebase");
const { isValidUsername } = require("../utils/validators");
const { getStorage } = require("firebase-admin/storage");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");

// Profil güncelleme
exports.updateProfile = async (req, res) => {
  try {
    const { uid } = req.user;
    const updates = req.body;

    if (!uid) {
      return res.status(401).json({ error: "Yetkisiz erişim." });
    }

    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    const userData = userDoc.data();
    const now = new Date();
    const DURATION_LIMIT_DAYS = 15;

    const checkCooldown = (field) => {
      const lastChange = userData.lastChangeDates?.[field];
      if (lastChange) {
        const lastChangeDate = lastChange.toDate();
        if (now - lastChangeDate < DURATION_LIMIT_DAYS * 24 * 60 * 60 * 1000) {
          const timeLeft = Math.ceil(
            (DURATION_LIMIT_DAYS * 24 * 60 * 60 * 1000 -
              (now - lastChangeDate)) /
              (1000 * 60 * 60 * 24)
          );
          return `"${field}" alanı, ${timeLeft} gün sonra değiştirilebilir.`;
        }
      }
      return null;
    };

    const firestoreUpdates = {};
    const authUpdates = {};
    const lastChangeDatesUpdates = {};

    if (updates.username && updates.username !== userData.username) {
      const cooldownError = checkCooldown("username");
      if (cooldownError) return res.status(403).json({ error: cooldownError });
      if (!isValidUsername(updates.username))
        return res
          .status(400)
          .json({ error: "Geçersiz kullanıcı adı formatı." });
      const usernameSnapshot = await db
        .collection("users")
        .where("username", "==", updates.username)
        .get();
      if (!usernameSnapshot.empty && usernameSnapshot.docs[0].id !== uid)
        return res
          .status(400)
          .json({ error: "Bu kullanıcı adı zaten kullanılıyor." });
      firestoreUpdates.username = updates.username;
      lastChangeDatesUpdates.username = FieldValue.serverTimestamp();
    }

    // ✅ YENİ LOGIC: Base64 yüklemesi yerine doğrudan URL'yi kaydetme
    if (updates.photoURL && updates.photoURL !== userData.photoURL) {
      const cooldownError = checkCooldown("photoURL");
      if (cooldownError) return res.status(403).json({ error: cooldownError });

      // Basit bir URL doğrulaması
      if (!updates.photoURL.startsWith("http")) {
        return res
          .status(400)
          .json({ error: "Geçersiz fotoğraf URL formatı." });
      }

      firestoreUpdates.photoURL = updates.photoURL;
      authUpdates.photoURL = updates.photoURL;
      lastChangeDatesUpdates.photoURL = FieldValue.serverTimestamp();
    }

    if (
      updates.displayName !== undefined &&
      updates.displayName !== userData.displayName
    ) {
      firestoreUpdates.displayName = updates.displayName;
      authUpdates.displayName = updates.displayName;
      lastChangeDatesUpdates.displayName = FieldValue.serverTimestamp();
    }

    if (updates.bio !== undefined && updates.bio !== userData.bio) {
      firestoreUpdates.bio = updates.bio;
    }

    if (updates.email !== undefined && updates.email !== userData.email) {
      const cooldownError = checkCooldown("email");
      if (cooldownError) return res.status(403).json({ error: cooldownError });
      firestoreUpdates.email = updates.email;
      lastChangeDatesUpdates.email = FieldValue.serverTimestamp();
      authUpdates.email = updates.email;
    }

    if (updates.phone !== undefined && updates.phone !== userData.phone) {
      const cooldownError = checkCooldown("phone");
      if (cooldownError) return res.status(403).json({ error: cooldownError });
      firestoreUpdates.phone = updates.phone;
      lastChangeDatesUpdates.phone = FieldValue.serverTimestamp();
    }

    if (updates.accountType && updates.accountType !== userData.accountType) {
      if (
        updates.accountType === "personal" ||
        updates.accountType === "business"
      ) {
        firestoreUpdates.accountType = updates.accountType;
      } else {
        return res.status(400).json({ error: "Geçersiz hesap türü." });
      }
    }

    if (updates.password) {
      const cooldownError = checkCooldown("password");
      if (cooldownError) return res.status(403).json({ error: cooldownError });
      await auth.updateUser(uid, { password: updates.password });
      lastChangeDatesUpdates.password = FieldValue.serverTimestamp();
    }

    if (Object.keys(authUpdates).length > 0) {
      await auth.updateUser(uid, authUpdates);
    }

    const finalFirestoreUpdates = { ...firestoreUpdates };
    if (Object.keys(lastChangeDatesUpdates).length > 0) {
      finalFirestoreUpdates.lastChangeDates = {
        ...(userDoc.data().lastChangeDates || {}),
        ...lastChangeDatesUpdates,
      };
    }

    if (Object.keys(finalFirestoreUpdates).length > 0) {
      await userDocRef.update(finalFirestoreUpdates);
    }

    const updatedUserDoc = await userDocRef.get();
    const updatedUser = updatedUserDoc.data();

    return res
      .status(200)
      .json({ message: "Profil başarıyla güncellendi.", profile: updatedUser });
  } catch (error) {
    console.error("Profil güncelleme hatası:", error);
    return res.status(500).json({
      error: `Profil güncellenirken bir hata oluştu. Lütfen tekrar deneyin. Detay: ${error.message}`,
    });
  }
};

// ✅ GÜNCELLENDİ: Cihaz ve Konum Bilgilerini Kaydetme
exports.saveLoginDevice = async (req, res) => {
  try {
    const { uid } = req.user;
    const ip = req.clientIp || "Bilinmiyor";
    const userAgentInfo = req.useragent;
    let location = "Konum Bilinmiyor";

    if (ip && ip !== "Bilinmiyor") {
      try {
        const geoRes = await fetch(
          `http://ip-api.com/json/${ip}?fields=city,country,status`
        );
        const geoData = await geoRes.json();
        if (geoData.status === "success") {
          location = `${geoData.city}, ${geoData.country}`;
        }
      } catch (geoError) {
        console.error("Konum servisine erişirken hata:", geoError);
      }
    }

    let deviceType = "Bilinmeyen Cihaz";
    if (userAgentInfo.isDesktop) {
      deviceType = "Bilgisayar";
    } else if (userAgentInfo.isMobile) {
      deviceType = "Mobil";
    } else if (userAgentInfo.isTablet) {
      deviceType = "Tablet";
    }

    const browserName = userAgentInfo.browser || "Bilinmeyen Tarayıcı";
    const osName = userAgentInfo.os || "Bilinmeyen OS";

    if (!uid) {
      return res.status(401).json({ error: "Yetkisiz erişim." });
    }

    const deviceData = {
      ip,
      device: deviceType,
      browser: browserName,
      os: osName,
      location: location,
      loggedInAt: FieldValue.serverTimestamp(),
    };

    const userDocRef = db.collection("users").doc(uid);
    await userDocRef.collection("devices").add(deviceData);

    return res
      .status(200)
      .json({ message: "Cihaz bilgileri başarıyla kaydedildi." });
  } catch (error) {
    console.error("Cihaz kaydetme hatası:", error);
    return res.status(500).json({
      error: "Cihaz bilgileri kaydedilirken hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ GÜNCELLENDİ: Cihazları çekme
exports.getLoginDevices = async (req, res) => {
  try {
    const { uid } = req.user;
    const devicesSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("devices")
      .orderBy("loggedInAt", "desc")
      .get();

    const devices = devicesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
      };
    });

    return res.status(200).json({ devices });
  } catch (error) {
    console.error("Cihaz geçmişi alınırken hata:", error);
    return res
      .status(500)
      .json({ error: "Cihaz geçmişi alınamadı.", details: error.message });
  }
};

// ✅ YENİ: Hesap gizliliği (isPrivate) ayarını güncelleme
exports.updatePrivacySettings = async (req, res) => {
  try {
    const { uid } = req.user;
    const { isPrivate } = req.body;

    if (typeof isPrivate !== "boolean") {
      return res.status(400).json({ error: "Geçersiz gizlilik durumu." });
    }

    const userDocRef = db.collection("users").doc(uid);
    await userDocRef.update({
      isPrivate: isPrivate,
    });

    // 📌 Opsiyonel: Gizlilik ayarı değişikliğini loglamak
    console.log(
      `[PRIVACY_UPDATE] Kullanıcı ${uid} hesabını ${
        isPrivate ? "gizli" : "herkese açık"
      } yaptı.`
    );

    return res.status(200).json({
      message: "Gizlilik ayarları başarıyla güncellendi.",
      isPrivate: isPrivate,
    });
  } catch (error) {
    console.error("Gizlilik ayarları güncelleme hatası:", error);
    return res.status(500).json({
      error: "Gizlilik ayarları güncellenirken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİ: Gizlilik ayarlarını getirme
exports.getPrivacySettings = async (req, res) => {
  try {
    const { id } = req.params;
    const userDocRef = db.collection("users").doc(id);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    const { privacySettings } = userDoc.data();
    return res.status(200).json(privacySettings);
  } catch (error) {
    console.error("Gizlilik ayarları çekme hatası:", error);
    return res.status(500).json({
      error: "Gizlilik ayarları çekilirken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ GÜNCELLENDİ: Mesaj izinlerini güncelleme ('following' eklendi)
exports.updateMessagesPrivacy = async (req, res) => {
  try {
    const { uid } = req.user;
    const { messages } = req.body;

    // ✅✅✅ 'following' seçeneği validation'a eklendi ✅✅✅
    if (
      !["everyone", "followers", "following", "closeFriends", "no"].includes(
        messages
      )
    ) {
      return res.status(400).json({ error: "Geçersiz mesaj gizlilik ayarı." });
    }

    await db.collection("users").doc(uid).update({
      "privacySettings.messages": messages,
    });

    return res
      .status(200)
      .json({ message: "Mesaj izinleri başarıyla güncellendi.", messages });
  } catch (error) {
    console.error("Mesaj gizlilik ayarları güncelleme hatası:", error);
    return res.status(500).json({
      error: "Mesaj gizlilik ayarları güncellenirken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİ: Hikaye yanıt izinlerini güncelleme
exports.updateStoryRepliesPrivacy = async (req, res) => {
  try {
    const { uid } = req.user;
    const { storyReplies } = req.body;

    if (typeof storyReplies !== "boolean") {
      return res
        .status(400)
        .json({ error: "Geçersiz hikaye yanıt gizlilik ayarı." });
    }

    await db.collection("users").doc(uid).update({
      "privacySettings.storyReplies": storyReplies,
    });

    return res.status(200).json({
      message: "Hikaye yanıt izinleri başarıyla güncellendi.",
      storyReplies,
    });
  } catch (error) {
    console.error("Hikaye yanıt gizlilik ayarları güncelleme hatası:", error);
    return res.status(500).json({
      error: "Hikaye yanıt gizlilik ayarları güncellenirken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİ: Beğenileri gizleme ayarını güncelleme
exports.updateHideLikesSetting = async (req, res) => {
  try {
    const { uid } = req.user;
    const { hideLikes } = req.body;

    if (typeof hideLikes !== "boolean") {
      return res
        .status(400)
        .json({ error: 'Geçersiz değer. "hideLikes" bir boolean olmalıdır.' });
    }

    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    // Sadece gizlilik ayarı altındaki hideLikes alanını günceller
    await userDocRef.update({
      "privacySettings.hideLikes": hideLikes,
    });

    // Güncellenmiş kullanıcı verisini döndür
    const updatedUserDoc = await userDocRef.get();
    const updatedUser = updatedUserDoc.data();

    return res.status(200).json({
      message: "Beğenileri gizleme ayarı başarıyla güncellendi.",
      profile: updatedUser,
    });
  } catch (error) {
    console.error("Beğenileri gizleme ayarı güncelleme hatası:", error);
    return res
      .status(500)
      .json({ error: "Ayarlar güncellenirken bir hata oluştu." });
  }
};

/**
 * Kullanıcının bildirim ayarlarını getirir.
 * @param {object} req - Express Request nesnesi.
 * @param {object} res - Express Response nesnesi.
 */
exports.getUserNotificationSettings = async (req, res) => {
  try {
    const { uid } = req.user;
    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    const defaultSettings = {
      email: true,
      push: false,
      follows: true,
      likes: true,
      comments: true,
      messages: true,
    };

    const settings = userDoc.data().notificationSettings || defaultSettings;
    return res.status(200).json({ settings });
  } catch (error) {
    console.error("Bildirim ayarlarını getirme hatası:", error);
    return res
      .status(500)
      .json({ error: "Bildirim ayarları alınırken bir hata oluştu." });
  }
};

/**
 * Kullanıcının bildirim ayarlarını günceller.
 * @param {object} req - Express Request nesnesi.
 * @param {object} res - Express Response nesnesi.
 */
exports.updateUserNotificationSettings = async (req, res) => {
  try {
    const { uid } = req.user;
    const updates = req.body;

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Güncellenecek ayar bulunamadı." });
    }

    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    const currentSettings = userDoc.data().notificationSettings || {};
    const newSettings = {
      ...currentSettings,
      ...updates,
    };

    await userDocRef.update({
      notificationSettings: newSettings,
      "lastChangeDates.notificationSettings":
        admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `Bildirim ayarları güncellendi. Kullanıcı ID: ${uid}, Değişiklikler: ${JSON.stringify(
        updates
      )}`
    );
    return res.status(200).json({
      message: "Bildirim ayarları başarıyla güncellendi.",
      settings: newSettings,
    });
  } catch (error) {
    console.error("Bildirim ayarlarını güncelleme hatası:", error);
    return res
      .status(500)
      .json({ error: "Bildirim ayarları güncellenirken bir hata oluştu." });
  }
};

// ✅ YENİ: Kullanıcı Engelleme
exports.blockUser = async (req, res) => {
  try {
    const { uid } = req.user;
    const { targetUid } = req.params;
    const now = FieldValue.serverTimestamp(); // Ne zaman engellendiği bilgisi

    if (uid === targetUid) {
      return res.status(400).json({ error: "Kendinizi engelleyemezsiniz." });
    }

    const batch = db.batch();

    // ✅ GÜNCELLEME: Veri yazmadan önce her iki kullanıcının da dokümanını ÇEK
    const [userDoc, targetDoc] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("users").doc(targetUid).get(),
    ]);

    // ✅ GÜNCELLEME: Engellenecek kullanıcı var mı kontrol et
    if (!targetDoc.exists) {
      return res
        .status(404)
        .json({ error: "Engellenecek kullanıcı bulunamadı." });
    }
    // (userDoc, giriş yapıldığı için var olmalıdır)

    // ✅ GÜNCELLEME: Verileri al
    const userData = userDoc.data();
    const targetData = targetDoc.data();

    // 1. SİZİN belgeniz -> 'blockedUsers' (Engellediklerim) koleksiyonu
    const userBlockData = {
      type: "block_sent", // Eylem Türü: Engel Gönderildi
      uid: targetUid, // Kimi engellediğiniz
      blockedAt: now,
      // ✅ YENİ EKLENEN ALANLAR (BlockedUsers.jsx sayfası için)
      blockedUsername: targetData.username,
      blockedDisplayName: targetData.displayName,
      blockedPhotoURL: targetData.photoURL || null, // null olabilir
    };
    batch.set(
      userDoc.ref.collection("blockedUsers").doc(targetUid),
      userBlockData
    );

    // 2. HEDEF KİŞİNİN belgesi -> 'blockedBy' (Beni Engelleyenler) koleksiyonu
    const targetBlockData = {
      type: "block_received", // Eylem Türü: Engel Alındı
      uid: uid, // Kim tarafından engellendiği (Siz)
      blockedAt: now,
      // ✅ YENİ EKLENEN ALANLAR (Simetri ve ileride kullanım için)
      blockerUsername: userData.username,
      blockerDisplayName: userData.displayName,
      blockerPhotoURL: userData.photoURL || null, // null olabilir
    };
    batch.set(targetDoc.ref.collection("blockedBy").doc(uid), targetBlockData);

    // 2. Takip ilişkilerini kontrol et ve kaldır (Bu kısım aynı kalmalı)
    const followQuery1 = db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("followingUid", "==", targetUid);
    const followQuery2 = db
      .collection("follows")
      .where("followerUid", "==", targetUid)
      .where("followingUid", "==", uid);

    const [followSnapshot1, followSnapshot2] = await Promise.all([
      followQuery1.get(),
      followQuery2.get(),
    ]);

    let followingDecrement = 0;
    let followersDecrement = 0;
    let targetFollowingDecrement = 0;
    let targetFollowersDecrement = 0;

    if (!followSnapshot1.empty) {
      followSnapshot1.docs.forEach((doc) => batch.delete(doc.ref));
      if (followSnapshot1.docs[0].data().status === "following") {
        followingDecrement = -1;
        targetFollowersDecrement = -1;
      }
    }

    if (!followSnapshot2.empty) {
      followSnapshot2.docs.forEach((doc) => batch.delete(doc.ref));
      if (followSnapshot2.docs[0].data().status === "following") {
        followersDecrement = -1;
        targetFollowingDecrement = -1;
      }
    }

    // 3. İstatistikleri güncelle (Referansları .ref olarak kullan)
    if (followingDecrement || followersDecrement) {
      batch.update(userDoc.ref, {
        // .ref kullandık
        "stats.following": FieldValue.increment(followingDecrement),
        "stats.followers": FieldValue.increment(followersDecrement),
      });
    }
    if (targetFollowingDecrement || targetFollowersDecrement) {
      batch.update(targetDoc.ref, {
        // .ref kullandık
        "stats.following": FieldValue.increment(targetFollowingDecrement),
        "stats.followers": FieldValue.increment(targetFollowersDecrement),
      });
    }

    await batch.commit();

    // Güncel hedef istatistiklerini al (batch'ten sonra güncel veriyi çek)
    const updatedTargetUserDoc = await targetDoc.ref.get(); // .ref kullandık
    const newStats = updatedTargetUserDoc.data().stats;

    return res.status(200).json({
      message: "Kullanıcı başarıyla engellendi.",
      status: "blocking",
      newStats: newStats,
    });
  } catch (error) {
    console.error("Kullanıcı engelleme hatası:", error);
    return res.status(500).json({
      error: "Kullanıcı engellenirken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİ: Kullanıcı Engelini Kaldırma
exports.unblockUser = async (req, res) => {
  try {
    const { uid } = req.user;
    const { targetUid } = req.params;

    const batch = db.batch();
    const userRef = db.collection("users").doc(uid);
    const targetRef = db.collection("users").doc(targetUid);

    // Engelleme kayıtlarını sil
    batch.delete(userRef.collection("blockedUsers").doc(targetUid));
    batch.delete(targetRef.collection("blockedBy").doc(uid));

    await batch.commit();

    // Engel kalkınca 'none' durumuna döner, istatistik değişmez.
    return res.status(200).json({
      message: "Kullanıcının engeli kaldırıldı.",
      status: "none",
    });
  } catch (error) {
    console.error("Kullanıcı engeli kaldırma hatası:", error);
    return res.status(500).json({
      error: "Kullanıcı engeli kaldırılırken bir hata oluştu.",
      details: error.message,
    });
  }
};

/**
 * Giriş yapmış kullanıcının engellediği kullanıcıların listesini getirir.
 */
exports.getBlockedUsers = async (req, res) => {
  try {
    const { uid } = req.user;

    const blockedSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("blockedUsers")
      .orderBy("blockedAt", "desc") // En son engellenen en üstte
      .get();

    if (blockedSnapshot.empty) {
      return res.status(200).json({ blockedUsers: [] });
    }

    // Dokümanların içindeki veriyi doğrudan alıyoruz (blockUser'da kaydetmiştik)
    const blockedUsers = blockedSnapshot.docs.map((doc) => doc.data());

    return res.status(200).json({ blockedUsers });
  } catch (error) {
    console.error("Engellenen kullanıcıları getirme hatası:", error);
    return res
      .status(500)
      .json({ error: "Engellenen kullanıcılar getirilirken bir hata oluştu." });
  }
};

// ✅ GÜNCELLENDİ: Kullanıcı arama rotası (Engellenenleri filtrele)
exports.searchUsers = async (req, res) => {
  try {
    const { search } = req.query;
    const { uid: currentUserId } = req.user;

    if (!search) {
      return res.status(400).json({ error: "Arama metni gerekli." });
    }

    // ✅ Engellenen ve engelleyen UID listelerini al
    const blockedSnapshot = await db
      .collection("users")
      .doc(currentUserId)
      .collection("blockedUsers")
      .get();
    const blockedBySnapshot = await db
      .collection("users")
      .doc(currentUserId)
      .collection("blockedBy")
      .get();

    const blockedUids = new Set([
      ...blockedSnapshot.docs.map((d) => d.id),
      ...blockedBySnapshot.docs.map((d) => d.id),
    ]);

    const usersRef = db.collection("users");
    const usernameQuery = usersRef
      .where("username", ">=", search)
      .where("username", "<=", search + "\uf8ff")
      .limit(20);

    const snapshot = await usernameQuery.get();
    const users = [];
    snapshot.forEach((doc) => {
      // Kendi profilini VE engellenen/engelleyenleri hariç tut
      if (doc.id !== currentUserId && !blockedUids.has(doc.id)) {
        const userData = doc.data();
        users.push({
          uid: userData.uid,
          username: userData.username,
          photoURL: userData.photoURL,
          bio: userData.bio || "",
        });
      }
    });

    return res.status(200).json({ users });
  } catch (error) {
    console.error("Kullanıcı arama hatası:", error);
    return res.status(500).json({
      error: "Kullanıcılar aranırken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ Takip etme (Engelleme kontrolü dahil)
exports.followUser = async (req, res) => {
  try {
    const { uid } = req.user;
    const { targetUid } = req.body;
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (uid === targetUid) {
      return res.status(400).json({ error: "Kendinizi takip edemezsiniz." });
    }

    // ✅ Engelleme Kontrolü
    const [isBlockingDoc, isBlockedByDoc] = await Promise.all([
      db
        .collection("users")
        .doc(uid)
        .collection("blockedUsers")
        .doc(targetUid)
        .get(),
      db
        .collection("users")
        .doc(uid)
        .collection("blockedBy")
        .doc(targetUid)
        .get(),
    ]);

    if (isBlockingDoc.exists || isBlockedByDoc.exists) {
      return res
        .status(403)
        .json({ error: "Bu işlem engelleme nedeniyle gerçekleştirilemez." });
    }

    const [currentUserDoc, targetUserDoc] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("users").doc(targetUid).get(),
    ]);

    if (!targetUserDoc.exists) {
      return res.status(404).json({ error: "Hedef kullanıcı bulunamadı." });
    }

    const targetUserData = targetUserDoc.data();
    const isTargetPrivate = targetUserData.isPrivate;

    // Durum kontrolü: Zaten takip ediliyor mu veya takip isteği gönderilmiş mi?
    const existingFollow = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("followingUid", "==", targetUid)
      .get();

    if (!existingFollow.empty) {
      const status = existingFollow.docs[0].data().status;
      if (status === "following") {
        return res
          .status(409)
          .json({ error: "Kullanıcıyı zaten takip ediyorsunuz." });
      }
      if (status === "pending") {
        return res
          .status(409)
          .json({ error: "Takip isteği zaten gönderildi." });
      }
    }

    const followStatusToSet = isTargetPrivate ? "pending" : "following";

    const batch = db.batch();
    const newFollowDocRef = db.collection("follows").doc();

    batch.set(newFollowDocRef, {
      followerUid: uid,
      followingUid: targetUid,
      status: followStatusToSet,
      createdAt: now,
    });

    // ✅ Takip onaylandıysa istatistikleri güncelle
    if (followStatusToSet === "following") {
      batch.update(currentUserDoc.ref, {
        "stats.following": admin.firestore.FieldValue.increment(1),
      });
      batch.update(targetUserDoc.ref, {
        "stats.followers": admin.firestore.FieldValue.increment(1),
      });

      // 🔔 Bildirim ekle (yeni takipçi)
      batch.set(
        db.collection("users").doc(targetUid).collection("notifications").doc(),
        {
          fromUid: uid,
          toUid: targetUid,
          type: "new_follower",
          createdAt: now,
          fromUsername: currentUserDoc.data().username || "Anonim",
          isRead: false,
        }
      );

      // 🧩 1️⃣ Takip gerçekleştiyse mesajlaşma alanı oluştur
      const conversationId = [uid, targetUid].sort().join("_");
      const conversationRef = db
        .collection("conversations")
        .doc(conversationId);

      const conversationData = {
        members: [uid, targetUid],
        createdAt: now,
        updatedAt: now,
        lastMessage: {
          text: "Sohbet başlatıldı",
          senderId: uid,
          updatedAt: now,
        },
        conversationId,
      };

      // 🧩 2️⃣ Eğer sohbet daha önce yoksa oluştur
      const existingConversation = await conversationRef.get();
      if (!existingConversation.exists) {
        batch.set(conversationRef, conversationData);
      }
    } else if (followStatusToSet === "pending") {
      // 🔔 Bildirim ekle (takip isteği)
      batch.set(
        db.collection("users").doc(targetUid).collection("notifications").doc(),
        {
          fromUid: uid,
          toUid: targetUid,
          type: "follow_request",
          createdAt: now,
          fromUsername: currentUserDoc.data().username || "Anonim",
          isRead: false,
        }
      );
    }

    await batch.commit();

    return res.status(200).json({
      message: `Takip ${
        isTargetPrivate ? "isteği gönderildi" : "işlemi başarılı"
      }.`,
      status: followStatusToSet,
    });
  } catch (error) {
    console.error("Takip işlemi hatası:", error);
    return res.status(500).json({
      error: "Takip işlemi sırasında bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ GÜNCELLENDİ: Takipten çıkma
exports.unfollowUser = async (req, res) => {
  try {
    const { uid } = req.user;
    const { targetUid } = req.params;

    const followSnapshot = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("followingUid", "==", targetUid)
      .get();

    if (followSnapshot.empty) {
      return res.status(404).json({ error: "Takip ilişkisi bulunamadı." });
    }

    const batch = db.batch();
    followSnapshot.docs.forEach((doc) => batch.delete(doc.ref));

    const currentUserDocRef = db.collection("users").doc(uid);
    const targetUserDocRef = db.collection("users").doc(targetUid);

    batch.update(currentUserDocRef, {
      "stats.following": admin.firestore.FieldValue.increment(-1),
    });
    batch.update(targetUserDocRef, {
      "stats.followers": admin.firestore.FieldValue.increment(-1),
    });

    await batch.commit();

    // ✅ YENİ EKLENEN KISIM: Güncel istatistikleri çek ve gönder
    const targetUserDoc = await targetUserDocRef.get();
    const updatedStats = targetUserDoc.data().stats;

    return res.status(200).json({
      message: "Kullanıcı takipten çıkarıldı.",
      status: "none",
      newStats: updatedStats, // Frontend'e güncel istatistikleri gönder
    });
  } catch (error) {
    console.error("Takipten çıkma hatası:", error);
    return res.status(500).json({
      error: "Takipten çıkarken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİ: Takipçiyi Kaldırma
exports.removeFollower = async (req, res) => {
  try {
    const { uid } = req.user;
    const { followerUid } = req.params;

    // Sadece kendi hesabınızdan takipçi kaldırabilirsiniz
    const userDocRef = db.collection("users").doc(uid);
    const followerDocRef = db.collection("users").doc(followerUid);

    const followerFollowsSnapshot = await db
      .collection("follows")
      .where("followerUid", "==", followerUid)
      .where("followingUid", "==", uid)
      .get();

    if (followerFollowsSnapshot.empty) {
      return res.status(404).json({ error: "Bu kullanıcı takipçiniz değil." });
    }

    const batch = db.batch();
    followerFollowsSnapshot.docs.forEach((doc) => batch.delete(doc.ref));

    batch.update(userDocRef, {
      "stats.followers": admin.firestore.FieldValue.increment(-1),
    });
    batch.update(followerDocRef, {
      "stats.following": admin.firestore.FieldValue.increment(-1),
    });

    await batch.commit();

    return res.status(200).json({
      message: "Takipçi başarıyla kaldırıldı.",
      uid: followerUid,
    });
  } catch (error) {
    console.error("Takipçi kaldırma hatası:", error);
    res.status(500).json({ error: "Takipçi kaldırılırken bir hata oluştu." });
  }
};

// ✅ YENİ: Takip Edileni Kaldırma (Takipten Çıkma)
exports.removeFollowing = async (req, res) => {
  try {
    const { uid } = req.user;
    const { followingUid } = req.params;

    // Sadece kendi takip ettiğiniz kişileri kaldırabilirsiniz
    const userDocRef = db.collection("users").doc(uid);
    const followingDocRef = db.collection("users").doc(followingUid);

    const followsSnapshot = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("followingUid", "==", followingUid)
      .get();

    if (followsSnapshot.empty) {
      return res
        .status(404)
        .json({ error: "Bu kullanıcıyı takip etmiyorsunuz." });
    }

    const batch = db.batch();
    followsSnapshot.docs.forEach((doc) => batch.delete(doc.ref));

    batch.update(userDocRef, {
      "stats.following": admin.firestore.FieldValue.increment(-1),
    });
    batch.update(followingDocRef, {
      "stats.followers": admin.firestore.FieldValue.increment(-1),
    });

    await batch.commit();

    return res.status(200).json({
      message: "Kullanıcı takipten başarıyla çıkarıldı.",
      uid: followingUid,
    });
  } catch (error) {
    console.error("Takip edileni kaldırma hatası:", error);
    res
      .status(500)
      .json({ error: "Takip edilen kaldırılırken bir hata oluştu." });
  }
};

// ✅ YENİ: Takip isteği geri çekme
exports.retractFollowRequest = async (req, res) => {
  try {
    const { uid } = req.user;
    const { targetUid } = req.params;

    if (!targetUid) {
      return res.status(400).json({ error: "Hedef kullanıcı kimliği eksik." });
    }

    // 1. Takip isteğini "follows" koleksiyonunda bul (pending)
    const requestQuerySnapshot = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("followingUid", "==", targetUid)
      .where("status", "==", "pending")
      .get();

    if (requestQuerySnapshot.empty) {
      return res.status(404).json({ error: "Takip isteği bulunamadı." });
    }

    // 2. Takip isteğini sil
    const batch = db.batch();
    requestQuerySnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    return res.status(200).json({
      message: "Takip isteği başarıyla geri çekildi.",
      status: "none",
    });
  } catch (error) {
    console.error("Takip isteği geri çekme hatası:", error);
    res
      .status(500)
      .json({ error: "Takip isteği geri çekilirken bir hata oluştu." });
  }
};

// ✅ GÜNCELLEME: Takip isteğini kabul etme
exports.acceptFollowRequest = async (req, res) => {
  try {
    const { requesterUid } = req.params;
    const { uid: targetUid } = req.user;
    const now = admin.firestore.FieldValue.serverTimestamp(); // Tanımlanmış

    const batch = db.batch();

    const followRequestQuery = await db
      .collection("follows")
      .where("followerUid", "==", requesterUid)
      .where("followingUid", "==", targetUid)
      .where("status", "==", "pending")
      .get();

    if (followRequestQuery.empty) {
      return res
        .status(404)
        .json({ error: "Bekleyen takip isteği bulunamadı." });
    }

    const followRequestDoc = followRequestQuery.docs[0];
    const followRequestRef = followRequestDoc.ref;

    batch.update(followRequestRef, { status: "following" });

    const [requesterUserDoc, targetUserDoc] = await Promise.all([
      db.collection("users").doc(requesterUid).get(),
      db.collection("users").doc(targetUid).get(),
    ]);

    if (requesterUserDoc.exists && targetUserDoc.exists) {
      batch.update(requesterUserDoc.ref, {
        "stats.following": admin.firestore.FieldValue.increment(1),
      });
      batch.update(targetUserDoc.ref, {
        "stats.followers": admin.firestore.FieldValue.increment(1),
      });
    }

    // Bildirimleri güncelle: Kendi bildirimini (targetUid) okundu olarak işaretle
    const notificationsSnapshot = await db
      .collection("users")
      .doc(targetUid)
      .collection("notifications")
      .where("fromUid", "==", requesterUid)
      .where("type", "==", "follow_request")
      .get();

    notificationsSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        type: "follow_accepted",
        isRead: true, // Kabul ettiğinize göre bu bildirim artık okundu sayılır.
      });
    });

    // ✅ YENİ EKLENTİ: İstek gönderen kullanıcıya (requesterUid) takip kabul edildi bildirimi gönder
    batch.set(
      db
        .collection("users")
        .doc(requesterUid)
        .collection("notifications")
        .doc(),
      {
        fromUid: targetUid, // Kabul eden
        toUid: requesterUid, // Kabul edilen
        type: "follow_accepted",
        createdAt: now,
        fromUsername: targetUserDoc.data().username || "Anonim",
        isRead: false, // Yeni kabul bildirimi, istek gönderen için okunmamış olacak.
      }
    );

    await batch.commit();

    return res
      .status(200)
      .json({ message: "Takip isteği kabul edildi.", newStatus: "following" });
  } catch (error) {
    console.error("Takip isteği kabul etme hatası:", error);
    return res
      .status(500)
      .json({ error: "Takip isteği kabul edilirken bir hata oluştu." });
  }
};

// ✅ GÜNCELLEME: Takip isteğini reddetme
exports.rejectFollowRequest = async (req, res) => {
  try {
    const { requesterUid } = req.params;
    const { uid: targetUid } = req.user;

    const batch = db.batch();

    const followRequestQuery = await db
      .collection("follows")
      .where("followerUid", "==", requesterUid)
      .where("followingUid", "==", targetUid)
      .where("status", "==", "pending")
      .get();

    if (followRequestQuery.empty) {
      return res
        .status(404)
        .json({ error: "Bekleyen takip isteği bulunamadı." });
    }

    const followRequestRef = followRequestQuery.docs[0].ref;

    // Takip isteğini silmek yerine sadece tip güncelle
    const notificationsSnapshot = await db
      .collection("users")
      .doc(targetUid)
      .collection("notifications")
      .where("fromUid", "==", requesterUid)
      .where("type", "==", "follow_request")
      .get();

    notificationsSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, { type: "follow_rejected" });
    });

    batch.delete(followRequestRef);

    await batch.commit();

    return res.status(200).json({ message: "Takip isteği reddedildi." });
  } catch (error) {
    console.error("Takip isteği reddetme hatası:", error);
    return res
      .status(500)
      .json({ error: "Takip isteği reddedilirken bir hata oluştu." });
  }
};

// ✅ GÜNCELLENDİ: Kullanıcıya mesaj gönderme ('following' kontrolü eklendi)
exports.sendMessage = async (req, res) => {
  try {
    const { uid } = req.user; // Gönderen
    const { targetUid, messageContent } = req.body; // Alan

    if (uid === targetUid) {
      return res
        .status(400)
        .json({ error: "Kendinize mesaj gönderemezsiniz." });
    }

    // Engelleme Kontrolü
    const [isBlockingDoc, isBlockedByDoc] = await Promise.all([
      db
        .collection("users")
        .doc(uid)
        .collection("blockedUsers")
        .doc(targetUid)
        .get(),
      db
        .collection("users")
        .doc(uid)
        .collection("blockedBy")
        .doc(targetUid)
        .get(),
    ]);

    if (isBlockingDoc.exists || isBlockedByDoc.exists) {
      return res
        .status(403)
        .json({ error: "Engellenen kullanıcıya mesaj gönderemezsiniz." });
    }

    const [currentUserDoc, targetUserDoc] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("users").doc(targetUid).get(),
    ]);

    if (!targetUserDoc.exists) {
      return res.status(404).json({ error: "Hedef kullanıcı bulunamadı." });
    }

    const targetUserData = targetUserDoc.data();
    // ✅ 'following' de artık geçerli bir ayar
    const messagesPrivacy =
      targetUserData.privacySettings?.messages || "everyone";

    // --- Mesaj İzin Kontrol Mantığı ---

    let canSendMessage = false;
    let messageType = "message"; // Varsayılan olarak direkt mesaj

    switch (messagesPrivacy) {
      case "everyone":
        canSendMessage = true;
        break;

      case "no":
        canSendMessage = false;
        break;

      case "followers": // Alıcının takip ettikleri (Yani ben onu takip ediyor muyum?)
        const senderFollowsRecipient = await db
          .collection("follows")
          .where("followerUid", "==", uid) // Ben (gönderen)
          .where("followingUid", "==", targetUid) // Onu (alan) takip ediyor muyum?
          .where("status", "==", "following")
          .get();
        if (!senderFollowsRecipient.empty) {
          canSendMessage = true;
        }
        break;

      // ✅✅✅ YENİ CASE: 'following' (Alıcının takipçileri - Yani o beni takip ediyor mu?) ✅✅✅
      case "following":
        const recipientFollowsSender = await db
          .collection("follows")
          .where("followerUid", "==", targetUid) // O (alan)
          .where("followingUid", "==", uid) // Beni (gönderen) takip ediyor mu?
          .where("status", "==", "following")
          .get();
        if (!recipientFollowsSender.empty) {
          canSendMessage = true;
        }
        break;

      case "closeFriends":
        // Gönderen (ben), alıcının (target) yakın arkadaş listesinde miyim?
        const isSenderCloseFriend = await db
          .collection("users")
          .doc(targetUid) // Alan kişi
          .collection("closeFriends")
          .doc(uid) // Gönderen (ben)
          .get();
        if (isSenderCloseFriend.exists) {
          canSendMessage = true;
        }
        break;

      default:
        canSendMessage = false; // Bilinmeyen bir ayar varsa reddet
    }

    // --- İzin Kontrolü Sonu ---

    // İzin yoksa, mesaj isteği (messageRequest) olarak gönder
    if (!canSendMessage) {
      // (Mesaj isteği gönderme kodunuz burada - DEĞİŞMEDİ)
      messageType = "messageRequest";
      const messageRequestRef = db.collection("messageRequests").doc();
      await messageRequestRef.set({
        /* ...istek verileri... */
      });
      // await this.sendNotification({ /* ...istek bildirimi... */ }); // `this` yerine exports kullanın veya helper yapın
      // Notification helper fonksiyonunuzu çağırmanız gerekebilir:
      // await exports.sendNotification(targetUid, uid, "newMessageRequest");
      return res
        .status(202)
        .json({ message: "Mesaj isteği başarıyla gönderildi." });
    }

    // İzin varsa, doğrudan mesaj gönder
    // (Direkt mesaj gönderme kodunuz burada - DEĞİŞMEDİ)
    const messageRef = db.collection("messages").doc();
    await messageRef.set({
      senderUid: uid,
      receiverUid: targetUid,
      content: messageContent,
      type: messageType, // "message" olacak
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // await exports.sendNotification(targetUid, uid, "newMessage"); // Bildirim helper'ı çağırın
    return res.status(200).json({ message: "Mesaj başarıyla gönderildi." });
  } catch (error) {
    console.error("Mesaj gönderme hatası:", error);
    return res.status(500).json({
      error: "Mesaj gönderilirken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİ FONKSİYON: Takipleşilen Kullanıcıları Getir (Yakın Arkadaşlar için)
exports.getMutualFollows = async (req, res) => {
  try {
    const { uid } = req.user;

    // 1. Benim takip ettiklerim (following)
    const followingSnapshot = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("status", "==", "following") // Sadece onaylanmış
      .get();
    const followingUids = new Set(
      followingSnapshot.docs.map((doc) => doc.data().followingUid)
    );

    if (followingUids.size === 0) {
      return res.status(200).json({ mutuals: [] });
    }

    // 2. Beni takip edenler (followers)
    const followersSnapshot = await db
      .collection("follows")
      .where("followingUid", "==", uid)
      .where("status", "==", "following") // Sadece onaylanmış
      .get();
    const followerUids = new Set(
      followersSnapshot.docs.map((doc) => doc.data().followerUid)
    );

    // 3. Kesişim (Takipleşilenler - Mutuals)
    const mutualUids = [...followingUids].filter((id) => followerUids.has(id));

    if (mutualUids.length === 0) {
      return res.status(200).json({ mutuals: [] });
    }

    // 4. Mevcut yakın arkadaş listemi al
    const closeFriendsSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("closeFriends")
      .get();
    const closeFriendUids = new Set(
      closeFriendsSnapshot.docs.map((doc) => doc.id)
    );

    // 5. Takipleşilen kullanıcıların profil bilgilerini çek
    const usersSnapshot = await db
      .collection("users")
      .where(admin.firestore.FieldPath.documentId(), "in", mutualUids)
      .get();

    const mutuals = usersSnapshot.docs.map((doc) => {
      const userData = doc.data();
      return {
        uid: doc.id,
        username: userData.username,
        displayName: userData.displayName,
        photoURL: userData.photoURL,
        // ✅ isClose: true/false bayrağını ekle
        isClose: closeFriendUids.has(doc.id),
      };
    });

    return res.status(200).json({ mutuals });
  } catch (error) {
    console.error("Takipleşilen kullanıcıları getirme hatası:", error);
    return res
      .status(500)
      .json({ error: "Liste getirilirken bir hata oluştu." });
  }
};

// ✅ YENİ FONKSİYON: Yakın Arkadaş Ekleme
exports.addCloseFriend = async (req, res) => {
  try {
    const { uid } = req.user;
    const { targetUid } = req.params;

    // Eklenecek kullanıcının verisini çek (username, photoURL vb. için)
    const targetUserDoc = await db.collection("users").doc(targetUid).get();
    if (!targetUserDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }
    const targetData = targetUserDoc.data();

    // Veriyi 'closeFriends' alt koleksiyonuna yaz
    await db
      .collection("users")
      .doc(uid)
      .collection("closeFriends")
      .doc(targetUid)
      .set({
        uid: targetUid,
        username: targetData.username,
        displayName: targetData.displayName,
        photoURL: targetData.photoURL || null,
        addedAt: FieldValue.serverTimestamp(),
      });

    return res
      .status(200)
      .json({ message: "Kullanıcı yakın arkadaşlara eklendi." });
  } catch (error) {
    console.error("Yakın arkadaş ekleme hatası:", error);
    return res.status(500).json({ error: "İşlem sırasında bir hata oluştu." });
  }
};

// ✅ YENİ FONKSİYON: Yakın Arkadaş Çıkarma
exports.removeCloseFriend = async (req, res) => {
  try {
    const { uid } = req.user;
    const { targetUid } = req.params;

    // 'closeFriends' alt koleksiyonundan sil
    await db
      .collection("users")
      .doc(uid)
      .collection("closeFriends")
      .doc(targetUid)
      .delete();

    return res
      .status(200)
      .json({ message: "Kullanıcı yakın arkadaşlardan çıkarıldı." });
  } catch (error) {
    console.error("Yakın arkadaş çıkarma hatası:", error);
    return res.status(500).json({ error: "İşlem sırasında bir hata oluştu." });
  }
};

// ✅ YENİ FONKSİYON: Takip Edilenleri ve Yakın Arkadaş Durumunu Getir
/**
 * Giriş yapmış kullanıcının TAKİP ETTİĞİ TÜM KULLANICILARI
 * ve onların "Yakın Arkadaş" durumunu getirir.
 */
exports.getFollowingWithCloseFriendStatus = async (req, res) => {
  try {
    const { uid } = req.user;

    // 1. Kullanıcının takip ettiği kişilerin UID'lerini al
    const followingSnapshot = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("status", "==", "following")
      .get();

    if (followingSnapshot.empty) {
      return res.status(200).json({ following: [] });
    }

    const followingUids = followingSnapshot.docs.map(
      (doc) => doc.data().followingUid
    );

    // 2. Kullanıcının "Yakın Arkadaş" listesinin UID'lerini al
    const closeFriendsSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("closeFriends")
      .get();

    const closeFriendUids = new Set(
      closeFriendsSnapshot.docs.map((doc) => doc.id)
    );

    // 3. Takip edilen kullanıcıların tam profil bilgilerini çek
    // Firestore 'in' sorgusu 30'luk gruplar halinde yapılmalıdır.
    const followingList = [];
    const chunkSize = 30;

    for (let i = 0; i < followingUids.length; i += chunkSize) {
      const chunk = followingUids.slice(i, i + chunkSize);

      const usersSnapshot = await db
        .collection("users")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();

      usersSnapshot.docs.forEach((doc) => {
        const userData = doc.data();
        followingList.push({
          uid: doc.id,
          username: userData.username,
          displayName: userData.displayName,
          photoURL: userData.photoURL || null,
          // ✅ Her kullanıcı için "Yakın Arkadaş" durumunu kontrol et
          isClose: closeFriendUids.has(doc.id),
        });
      });
    }

    // Listeyi isme göre sırala
    followingList.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return res.status(200).json({ following: followingList });
  } catch (error) {
    console.error(
      "Takip edilenleri ve yakın arkadaş durumunu getirme hatası:",
      error
    );
    return res
      .status(500)
      .json({ error: "Liste getirilirken bir hata oluştu." });
  }
};

// ✅ YENİ: sendNotification fonksiyonu
exports.sendNotification = async (
  toUid,
  fromUid,
  type,
  content = null,
  postId = null,
  commentId = null
) => {
  try {
    // 🔎 Alıcının bildirim ayarlarını kontrol et
    const receiverDoc = await db.collection("users").doc(toUid).get();
    const receiverData = receiverDoc.data();
    if (
      !receiverData ||
      !receiverData.notificationSettings ||
      !receiverData.notificationSettings.push
    ) {
      console.log(
        `Bildirim ayarları kapalı olduğu için ${toUid} kullanıcısına bildirim gönderilmedi.`
      );
      return;
    }

    // 🔎 Gönderenin kullanıcı adını çek
    const fromUserDoc = await db.collection("users").doc(fromUid).get();
    const fromUserData = fromUserDoc.exists ? fromUserDoc.data() : null;
    const fromUsername = fromUserData ? fromUserData.username : "Bilinmeyen";

    // 📌 Bildirim datası
    const notificationData = {
      fromUid,
      fromUsername,
      toUid,
      type, // örn: newFollow, followRequest, followRequestApproved, newMessage, etc.
      content,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (postId) notificationData.postId = postId;
    if (commentId) notificationData.commentId = commentId;

    // 🔥 Bildirimi Firestore'a ekle
    await db.collection("notifications").add(notificationData);

    console.log(`📩 '${type}' bildirimi ${toUid} kullanıcısına kaydedildi.`);
  } catch (error) {
    console.error("❌ Bildirim gönderilirken hata oluştu:", error);
    // Hata durumunda süreci durdurma, sadece logla
  }
};

// ✅ YENİ: Kullanıcı profilini kullanıcı adına göre getirme
exports.getProfileByUsername = async (req, res) => {
  try {
    const { username } = req.params;
    const cleanUsername = username.toLowerCase();

    const userDoc = await db
      .collection("users")
      .where("username", "==", cleanUsername)
      .limit(1)
      .get();

    if (userDoc.empty) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    const profileData = userDoc.docs[0].data();
    const uid = userDoc.docs[0].id;

    // Güvenlik: Hassas bilgileri temizle
    const sanitizedProfile = {
      uid: uid,
      username: profileData.username,
      displayName: profileData.displayName,
      photoURL: profileData.photoURL,
      bio: profileData.bio,
      familySystem: profileData.familySystem,
      isPrivate: profileData.isPrivate,
      stats: profileData.stats,
      lastChangeDates: profileData.lastChangeDates,
      createdAt: profileData.createdAt,
    };

    return res.status(200).json({ profile: sanitizedProfile });
  } catch (error) {
    console.error("Profil bilgisi çekme hatası:", error);
    res
      .status(500)
      .json({ error: "Profil bilgileri alınırken bir hata oluştu." });
  }
};

// ✅ Kullanıcılar arası takip durumunu kontrol etme
exports.getFollowStatus = async (req, res) => {
  try {
    const { targetUid } = req.params;
    const { uid } = req.user;

    if (uid === targetUid) {
      return res.status(200).json({ followStatus: "self" });
    }

    // ✅ Engelleme kontrolü
    const [isBlockingDoc, isBlockedByDoc] = await Promise.all([
      db
        .collection("users")
        .doc(uid)
        .collection("blockedUsers")
        .doc(targetUid)
        .get(),
      db
        .collection("users")
        .doc(uid)
        .collection("blockedBy")
        .doc(targetUid)
        .get(),
    ]);

    if (isBlockingDoc.exists) {
      return res.status(200).json({ followStatus: "blocking" });
    }
    if (isBlockedByDoc.exists) {
      return res.status(200).json({ followStatus: "blocked_by" });
    }

    // ✅ Takip ilişkisini veya takip isteğini kontrol et
    const followDoc = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("followingUid", "==", targetUid)
      .get();

    if (!followDoc.empty) {
      const followData = followDoc.docs[0].data();
      if (followData.status === "following") {
        return res.status(200).json({ followStatus: "following" });
      } else if (followData.status === "pending") {
        return res.status(200).json({ followStatus: "pending" });
      }
    }

    return res.status(200).json({ followStatus: "none" });
  } catch (error) {
    console.error("Takip durumu getirme hatası:", error);
    return res.status(500).json({
      error: "Takip durumu çekilirken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİLENEN FONKSİYON: Bildirimleri kullanıcının alt koleksiyonundan getirme
exports.getNotifications = async (req, res) => {
  try {
    const { uid } = req.user;
    const notificationsSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("notifications")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const notifications = notificationsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt.toDate().toISOString(),
    }));

    return res.status(200).json({ notifications });
  } catch (error) {
    console.error("Bildirimleri getirme hatası:", error);
    return res
      .status(500)
      .json({ error: "Bildirimler getirilirken bir hata oluştu." });
  }
};

// ✅ YENİ EKLENEN KRİTİK FONKSİYON: Okunmamış bildirim sayısını getirme
exports.getUnreadNotificationsCount = async (req, res) => {
  try {
    const { uid } = req.user;

    // Kullanıcının 'notifications' alt koleksiyonundaki tüm 'isRead: false' bildirimlerini say
    const notificationsSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("notifications")
      .where("isRead", "==", false)
      .get();

    const totalUnreadCount = notificationsSnapshot.size;

    return res.status(200).json({ unreadCount: totalUnreadCount });
  } catch (error) {
    console.error("Okunmamış bildirim sayısı getirme hatası:", error);
    res
      .status(500)
      .json({ error: "Okunmamış bildirim sayısı alınırken bir hata oluştu." });
  }
};

// 💡 Sizin sağladığınız fonksiyonun güvenli versiyonu (Bildirimleri Okundu İşaretleme)
exports.markNotificationsAsRead = async (req, res) => {
  try {
    const { uid } = req.user;
    const batch = db.batch();

    // Sadece okunmamış (isRead: false) olanları günceller
    const notificationsSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("notifications")
      .where("isRead", "==", false)
      .get();

    // Batch işlemi ile tüm unread bildirimleri tek seferde atomically günceller
    notificationsSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, { isRead: true });
    });

    await batch.commit();

    // Başarılı olursa 200 döner
    return res
      .status(200)
      .json({ message: "Tüm bildirimler okundu olarak işaretlendi." });
  } catch (error) {
    console.error("Bildirimleri okundu olarak işaretleme hatası:", error);
    return res.status(500).json({ error: "İşlem sırasında bir hata oluştu." });
  }
};

// ✅ YENİ: Belirli bir kullanıcının takipçilerini getirme
exports.getFollowers = async (req, res) => {
  try {
    const { targetUid } = req.params; // URL parametresinden hedef UID
    const currentUid = req.user.uid; // middleware’den gelen giriş yapmış kullanıcı UID

    // ✅ Hedef kullanıcının profilini al
    const targetUserDoc = await db.collection("users").doc(targetUid).get();
    if (!targetUserDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    const targetUserData = targetUserDoc.data();
    const isTargetPrivate = targetUserData.isPrivate;

    // ✅ Eğer hedef hesap gizliyse ve mevcut kullanıcı onu takip etmiyorsa erişimi engelle
    if (isTargetPrivate && currentUid !== targetUid) {
      const isFollowing = await db
        .collection("follows")
        .where("followerUid", "==", currentUid)
        .where("followingUid", "==", targetUid)
        .get();

      if (isFollowing.empty) {
        return res
          .status(403)
          .json({ error: "Bu hesabı görüntülemek için takip etmelisiniz." });
      }
    }

    // ✅ Hedef kullanıcının takipçilerini getir
    const followersSnapshot = await db
      .collection("follows")
      .where("followingUid", "==", targetUid)
      .get();

    if (followersSnapshot.empty) {
      return res.status(200).json({ followers: [] });
    }

    const followerUids = followersSnapshot.docs.map(
      (doc) => doc.data().followerUid
    );

    // ✅ UID listesi ile kullanıcı profillerini çek
    const usersSnapshot = await db
      .collection("users")
      .where(admin.firestore.FieldPath.documentId(), "in", followerUids)
      .get();

    const followers = usersSnapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));

    return res.status(200).json({ followers });
  } catch (error) {
    console.error("Takipçi listesi getirme hatası:", error);
    return res.status(500).json({
      error: "Takipçi listesi alınırken bir hata oluştu.",
    });
  }
};

// ✅ YENİ: Belirli bir kullanıcının takip ettiklerini getirme (GÜNCELLENMİŞ)
exports.getFollowing = async (req, res) => {
  try {
    const { targetUid } = req.params;
    const currentUid = req.user.uid;

    const targetUserDoc = await db.collection("users").doc(targetUid).get();
    if (!targetUserDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }
    const targetUserData = targetUserDoc.data();
    const isTargetPrivate = targetUserData.isPrivate;

    if (isTargetPrivate && currentUid !== targetUid) {
      const isFollowing = await db
        .collection("follows")
        .where("followerUid", "==", currentUid)
        .where("followingUid", "==", targetUid)
        .where("status", "==", "following") // ✅ Sadece takip ediyorsa...
        .get();

      if (isFollowing.empty) {
        return res
          .status(403)
          .json({ error: "Bu hesabı görüntülemek için takip etmelisiniz." });
      }
    }

    const followingSnapshot = await db
      .collection("follows")
      .where("followerUid", "==", targetUid)
      .where("status", "==", "following") // ✅✅✅ EKSİK OLAN KOD: Sadece onaylanmışları al
      .get();

    if (followingSnapshot.empty) {
      return res.status(200).json({ following: [] });
    }

    const followingUids = followingSnapshot.docs.map(
      (doc) => doc.data().followingUid
    );

    // Not: Firestore 'in' sorgusu 30 UID ile sınırlıdır.
    // Çok fazla takip edilen varsa, bu kodun parçalara ayrılması gerekebilir.
    const usersSnapshot = await db
      .collection("users")
      .where(admin.firestore.FieldPath.documentId(), "in", followingUids)
      .get();

    const following = usersSnapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));

    return res.status(200).json({ following });
  } catch (error) {
    console.error("Takip edilenler listesi getirme hatası:", error);
    res
      .status(500)
      .json({ error: "Takip edilenler listesi alınırken bir hata oluştu." });
  }
};

// ✅ YENİ: Kullanıcının bekleyen takip isteklerini getirme
exports.getPendingRequests = async (req, res) => {
  try {
    const { uid } = req.user;

    const requestsSnapshot = await db
      .collection("followRequests")
      .where("receiverUid", "==", uid)
      .get();

    if (requestsSnapshot.empty) {
      return res.status(200).json({ requests: [] });
    }

    const senderUids = requestsSnapshot.docs.map((doc) => doc.data().senderUid);

    const usersSnapshot = await db
      .collection("users")
      .where(admin.firestore.FieldPath.documentId(), "in", senderUids)
      .get();

    const senders = usersSnapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));

    return res.status(200).json({ requests: senders });
  } catch (error) {
    console.error("Bekleyen istekleri getirme hatası:", error);
    res
      .status(500)
      .json({ error: "Bekleyen takip istekleri alınırken bir hata oluştu." });
  }
};

/**
 * ✅ YENİ FONKSİYON: Kullanıcı içeriğini gizlilik filtreli getirme
 * İsteği yapanın (A), profil sahibine (B) göre ilişkisini kontrol eder
 * ve sadece görmeye izni olan gönderileri döndürür.
 */
exports.getUserContent = async (req, res) => {
  try {
    // 1. İsteği yapan Kullanıcı A'nın kimliği
    const { uid: viewerUid } = req.user;
    // 2. Profili görüntülenen Kullanıcı B'nin kimliği (username)
    const { username: profileUsername } = req.params;
    // 3. Hangi tab'ın istendiği
    const { tab } = req.query;

    if (!viewerUid) {
      return res.status(401).json({ error: "Yetkisiz erişim." });
    }
    if (!["posts", "feelings", "feeds"].includes(tab)) {
      return res.status(400).json({ error: "Geçersiz sekme türü." });
    }

    // Kullanıcı B'nin UID'sini ve gizlilik durumunu al
    const profileUserQuery = await db
      .collection("users")
      .where("username", "==", profileUsername)
      .limit(1)
      .get();

    if (profileUserQuery.empty) {
      return res
        .status(404)
        .json({ error: "Profil sahibi kullanıcı bulunamadı." });
    }

    const profileUserDoc = profileUserQuery.docs[0];
    const profileUid = profileUserDoc.id; // Kullanıcı B'nin UID'si
    const profileData = profileUserDoc.data();
    const isProfilePrivate = profileData.isPrivate || false;

    // 4. Kullanıcı A ve B arasındaki ilişkiyi kontrol et
    let allowedPrivacy = []; // İzin verilen gizlilik seviyeleri

    // 4a. Kendi profiline mi bakıyor?
    if (viewerUid === profileUid) {
      allowedPrivacy = ["public", "friends", "close_friendships", "private"];
    } else {
      // 4b. Engelleme kontrolü
      const [isBlockingDoc, isBlockedByDoc] = await Promise.all([
        db
          .collection("users")
          .doc(viewerUid)
          .collection("blockedUsers")
          .doc(profileUid)
          .get(),
        db
          .collection("users")
          .doc(viewerUid)
          .collection("blockedBy")
          .doc(profileUid)
          .get(),
      ]);

      if (isBlockingDoc.exists || isBlockedByDoc.exists) {
        return res.status(200).json({ content: [] }); // Engelliyse boş döndür
      }

      // 4c. Takip kontrolü (A, B'yi takip ediyor mu?)
      const followDoc = await db
        .collection("follows")
        .where("followerUid", "==", viewerUid)
        .where("followingUid", "==", profileUid)
        .where("status", "==", "following")
        .get();
      const isFollowing = !followDoc.empty;

      // 4d. Yakın Arkadaş kontrolü (A, B'nin yakın arkadaş listesinde mi?)
      const closeFriendDoc = await db
        .collection("users")
        .doc(profileUid) // Profil sahibinin (B)
        .collection("closeFriends")
        .doc(viewerUid) // İzleyenin (A)
        .get();
      const isCloseFriend = closeFriendDoc.exists;

      // 5. İzin verilen gizlilik seviyelerini belirle
      allowedPrivacy.push("public"); // 'public' her zaman (eğer profil gizli değilse)

      // Eğer profil gizliyse VE A, B'yi takip etmiyorsa
      if (isProfilePrivate && !isFollowing) {
        allowedPrivacy = []; // Hiçbir şey göremez
      } else {
        // Profil gizli değil VEYA A, B'yi takip ediyor
        // Not: 'friends' (Arkadaşlar) için sizin tanımınız gerekiyor.
        // Şimdilik 'friends' için "takip etmeyi" (isFollowing) baz alıyoruz.
        if (isFollowing) {
          allowedPrivacy.push("friends");
        }

        if (isCloseFriend) {
          allowedPrivacy.push("close_friendships");
          allowedPrivacy.push("friends"); // Yakın arkadaşsa, normal arkadaş gönderilerini de görür
        }
      }
    }

    if (allowedPrivacy.length === 0) {
      return res.status(200).json({ content: [] });
    }

    // 6. Kullanıcı B'nin alt koleksiyonunu sorgula
    const collectionNameMap = {
      posts: "posts",
      feelings: "feelings",
      feeds: "feeds",
    };
    const collectionToQuery = collectionNameMap[tab];

    const contentQuery = db
      .collection("users")
      .doc(profileUid) // Kullanıcı B'nin alt koleksiyonu
      .collection(collectionToQuery)
      .where("privacy", "in", allowedPrivacy) // ✅ Sadece izin verilen gizliliktekiler
      .orderBy("createdAt", "desc")
      .limit(30); // (Sayfalama için limit)

    const contentSnapshot = await contentQuery.get();

    // 7. Sadece izin verilen gönderileri döndür
    const content = contentSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.status(200).json({ content });
  } catch (error) {
    console.error("Profil içeriği çekme hatası:", error);
    return res.status(500).json({
      error: "İçerik getirilirken bir sunucu hatası oluştu.",
      details: error.message,
    });
  }
};
