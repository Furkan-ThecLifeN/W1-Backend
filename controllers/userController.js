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

    if (updates.photoURL && updates.photoURL.startsWith("data:")) {
      const cooldownError = checkCooldown("photoURL");
      if (cooldownError) return res.status(403).json({ error: cooldownError });
      const bucket = getStorage().bucket();
      const filename = `profile_pictures/${uid}/${Date.now()}_profile.jpeg`;
      const file = bucket.file(filename);
      const base64Data = updates.photoURL.replace(
        /^data:image\/\w+;base64,/,
        ""
      );
      const buffer = Buffer.from(base64Data, "base64");
      await file.save(buffer, {
        metadata: { contentType: "image/jpeg" },
        public: true,
      });
      const photoURL = `https://storage.googleapis.com/${bucket.name}/${filename}`;
      firestoreUpdates.photoURL = photoURL;
      authUpdates.photoURL = photoURL;
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
    return res
      .status(500)
      .json({
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
    return res
      .status(500)
      .json({
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

    return res
      .status(200)
      .json({
        message: "Gizlilik ayarları başarıyla güncellendi.",
        isPrivate: isPrivate,
      });
  } catch (error) {
    console.error("Gizlilik ayarları güncelleme hatası:", error);
    return res
      .status(500)
      .json({
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
    return res
      .status(500)
      .json({
        error: "Gizlilik ayarları çekilirken bir hata oluştu.",
        details: error.message,
      });
  }
};

// ✅ YENİ: Mesaj izinlerini güncelleme
exports.updateMessagesPrivacy = async (req, res) => {
  try {
    const { uid } = req.user;
    const { messages } = req.body;

    if (!["everyone", "followers", "no"].includes(messages)) {
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
    return res
      .status(500)
      .json({
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

    return res
      .status(200)
      .json({
        message: "Hikaye yanıt izinleri başarıyla güncellendi.",
        storyReplies,
      });
  } catch (error) {
    console.error("Hikaye yanıt gizlilik ayarları güncelleme hatası:", error);
    return res
      .status(500)
      .json({
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
    return res.status(500).json({ error: "Bildirim ayarları alınırken bir hata oluştu." });
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
      "lastChangeDates.notificationSettings": admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Bildirim ayarları güncellendi. Kullanıcı ID: ${uid}, Değişiklikler: ${JSON.stringify(updates)}`);
    return res.status(200).json({
      message: "Bildirim ayarları başarıyla güncellendi.",
      settings: newSettings,
    });
  } catch (error) {
    console.error("Bildirim ayarlarını güncelleme hatası:", error);
    return res.status(500).json({ error: "Bildirim ayarları güncellenirken bir hata oluştu." });
  }
};

// ✅ YENİ: Kullanıcı arama rotası
exports.searchUsers = async (req, res) => {
  try {
    const { search } = req.query;
    const { uid: currentUserId } = req.user; // Oturum açmış kullanıcının UID'sini al

    if (!search) {
      return res.status(400).json({ error: "Arama metni gerekli." });
    }

    const usersRef = db.collection("users");
    const usernameQuery = usersRef
      .where("username", ">=", search)
      .where("username", "<=", search + "\uf8ff")
      .limit(20);

    const snapshot = await usernameQuery.get();
    const users = [];
    snapshot.forEach((doc) => {
      // Kendi profilini sonuçlardan hariç tut
      if (doc.id !== currentUserId) {
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
    return res
      .status(500)
      .json({
        error: "Kullanıcılar aranırken bir hata oluştu.",
        details: error.message,
      });
  }
};

// ✅ GÜNCELLENDİ: Takip etme, takip isteği atma ve takip durumunu kontrol etme
exports.followUser = async (req, res) => {
  try {
    const { uid } = req.user;
    const { targetUid } = req.body;
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (uid === targetUid) {
      return res.status(400).json({ error: "Kendinizi takip edemezsiniz." });
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

    if (isTargetPrivate) {
      const existingRequest = await db.collection("follows")
        .where("followerUid", "==", uid)
        .where("followingUid", "==", targetUid)
        .get();

      if (!existingRequest.empty) {
        return res.status(409).json({ error: "Takip isteği zaten gönderildi." });
      }

      await db.collection("follows").doc().set({
        followerUid: uid,
        followingUid: targetUid,
        status: "pending",
        createdAt: now,
      });

      // 🔔 Bildirim ekle - Düzeltildi: Artık doğru alt koleksiyona yazıyor
      await db.collection("users").doc(targetUid).collection("notifications").add({
        fromUid: uid,
        toUid: targetUid,
        type: "follow_request",
        createdAt: now,
        fromUsername: currentUserDoc.data().username || "Anonim",
      });

      return res.status(200).json({
        message: "Takip isteği başarıyla gönderildi.",
        status: "pending",
      });
    }

    const existingFollow = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("followingUid", "==", targetUid)
      .get();

    if (!existingFollow.empty) {
      return res.status(409).json({ error: "Kullanıcıyı zaten takip ediyorsunuz." });
    }

    const batch = db.batch();
    batch.set(db.collection("follows").doc(), {
      followerUid: uid,
      followingUid: targetUid,
      status: "following",
      createdAt: now,
    });

    batch.update(currentUserDoc.ref, {
      "stats.following": admin.firestore.FieldValue.increment(1),
    });
    batch.update(targetUserDoc.ref, {
      "stats.followers": admin.firestore.FieldValue.increment(1),
    });

    // 🔔 Bildirim ekle - Düzeltildi: Artık doğru alt koleksiyona yazıyor
    batch.set(db.collection("users").doc(targetUid).collection("notifications").doc(), {
      fromUid: uid,
      toUid: targetUid,
      type: "new_follower",
      createdAt: now,
      fromUsername: currentUserDoc.data().username || "Anonim",
    });

    await batch.commit();

    const targetUserDocAfterUpdate = await targetUserDoc.ref.get();
    const updatedStats = targetUserDocAfterUpdate.data().stats;

    return res.status(200).json({
      message: "Takip işlemi başarılı.",
      status: "following",
      newStats: updatedStats,
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
      return res.status(404).json({ error: "Bu kullanıcıyı takip etmiyorsunuz." });
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
    res.status(500).json({ error: "Takip edilen kaldırılırken bir hata oluştu." });
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
    const requestQuerySnapshot = await db.collection("follows")
        .where("followerUid", "==", uid)
        .where("followingUid", "==", targetUid)
        .where("status", "==", "pending")
        .get();

    if (requestQuerySnapshot.empty) {
      return res.status(404).json({ error: "Takip isteği bulunamadı." });
    }

    // 2. Takip isteğini sil
    const batch = db.batch();
    requestQuerySnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    return res.status(200).json({
      message: "Takip isteği başarıyla geri çekildi.",
      status: "none"
    });
  } catch (error) {
    console.error("Takip isteği geri çekme hatası:", error);
    res.status(500).json({ error: "Takip isteği geri çekilirken bir hata oluştu." });
  }
};
// ✅ YENİ: Takip isteğini kabul etme
exports.acceptFollowRequest = async (req, res) => {
  try {
    const { requesterUid } = req.params; // Takip isteğini gönderen kullanıcı
    const targetUid = req.user.uid;      // Takip isteğini kabul eden (mevcut kullanıcı)
    const now = admin.firestore.FieldValue.serverTimestamp();

    // 1. Pending isteği bul
    const requestSnapshot = await db
      .collection("follows")
      .where("followerUid", "==", requesterUid)
      .where("followingUid", "==", targetUid)
      .where("status", "==", "pending")
      .get();

    if (requestSnapshot.empty) {
      return res.status(404).json({ error: "Takip isteği bulunamadı." });
    }

    const batch = db.batch();

    // 2. İsteği güncelle → "following" yap
    requestSnapshot.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: "following",
        acceptedAt: now,
      });
    });

    const requesterUserDocRef = db.collection("users").doc(requesterUid);
    const targetUserDocRef = db.collection("users").doc(targetUid);

    // 3. İstatistikleri güncelle
    batch.update(requesterUserDocRef, {
      "stats.following": admin.firestore.FieldValue.increment(1),
    });
    batch.update(targetUserDocRef, {
      "stats.followers": admin.firestore.FieldValue.increment(1),
    });

    // 4. Batch işlemleri uygula
    await batch.commit();

    // 5. Bildirim işlemleri (senin mevcut mantığını koruyorum)
    try {
      await exports.sendNotification(requesterUid, targetUid, "follow_accepted");
      await exports.sendNotification(targetUid, requesterUid, "new_follower");
    } catch (notifyErr) {
      console.error("Bildirim gönderilemedi:", notifyErr);
    }

    // 6. Eski "follow_request" bildirimini sil
    try {
      const notificationQuery = db.collection("notifications")
        .where("type", "==", "follow_request")
        .where("fromUid", "==", requesterUid)
        .where("toUid", "==", targetUid);

      const notificationSnapshot = await notificationQuery.get();
      if (!notificationSnapshot.empty) {
        const notifBatch = db.batch();
        notificationSnapshot.docs.forEach(doc => {
          notifBatch.delete(doc.ref);
        });
        await notifBatch.commit();
      }
    } catch (notifDeleteErr) {
      console.error("Eski bildirim silinemedi:", notifDeleteErr);
    }

    return res.status(200).json({ message: "Takip isteği başarıyla kabul edildi.", status: "following" });
  } catch (error) {
    console.error("Takip isteği kabul etme hatası:", error);
    return res.status(500).json({
      error: "İsteği kabul ederken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİ: Takip isteğini reddetme
exports.rejectFollowRequest = async (req, res) => {
  try {
    const { requesterUid } = req.params;
    const targetUid = req.user.uid;

    // 1. Bildirimi sil
    try {
      const notificationQuery = db.collection("notifications")
        .where("type", "==", "follow_request")
        .where("fromUid", "==", requesterUid)
        .where("toUid", "==", targetUid);

      const notificationSnapshot = await notificationQuery.get();
      if (!notificationSnapshot.empty) {
        const notifBatch = db.batch();
        notificationSnapshot.docs.forEach(doc => {
          notifBatch.delete(doc.ref);
        });
        await notifBatch.commit();
      }
    } catch (notifErr) {
      console.error("Bildirim silme hatası:", notifErr);
    }

    // 2. Follow dokümanını sil (pending olanı)
    const requestSnapshot = await db
      .collection("follows")
      .where("followerUid", "==", requesterUid)
      .where("followingUid", "==", targetUid)
      .where("status", "==", "pending")
      .get();

    if (requestSnapshot.empty) {
      return res.status(404).json({ error: "Takip isteği bulunamadı." });
    }

    const batch = db.batch();
    requestSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    return res.status(200).json({ message: "Takip isteği başarıyla reddedildi.", status: "none" });
  } catch (error) {
    console.error("Takip isteği reddetme hatası:", error);
    return res.status(500).json({
      error: "İsteği reddederken bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİ: Kullanıcıya mesaj gönderme veya mesaj isteği atma
exports.sendMessage = async (req, res) => {
  try {
    const { uid } = req.user;
    const { targetUid, messageContent } = req.body;

    if (uid === targetUid) {
      return res
        .status(400)
        .json({ error: "Kendinize mesaj gönderemezsiniz." });
    }

    const [currentUserDoc, targetUserDoc] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("users").doc(targetUid).get(),
    ]);

    if (!targetUserDoc.exists) {
      return res.status(404).json({ error: "Hedef kullanıcı bulunamadı." });
    }

    const targetUserData = targetUserDoc.data();
    const messagesPrivacy =
      targetUserData.privacySettings?.messages || "everyone";

    const isFollowing = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("followingUid", "==", targetUid)
      .get();

    let messageType = "message";
    let conversationId;

    // Mesajlaşma mantığı
    if (messagesPrivacy === "everyone" || isFollowing) {
      messageType = "message";
      // Doğrudan mesaj gönderme
      // Konuşma koleksiyonu oluşturulabilir veya mevcut olanı bulunabilir.
      // Örnek: 'conversations' koleksiyonuna mesajı ekle
    } else {
      messageType = "messageRequest";
      // Mesaj isteği olarak kaydet
      // Örnek: 'messageRequests' koleksiyonuna mesajı ekle
      return res
        .status(202)
        .json({ message: "Mesaj isteği başarıyla gönderildi." });
    }

    // Buraya mesajı Firestore'a yazma mantığı gelecek
    const messageRef = db.collection("messages").doc();
    await messageRef.set({
      senderUid: uid,
      receiverUid: targetUid,
      content: messageContent,
      type: messageType,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Bildirim gönder
    await this.sendNotification({
      senderUid: uid,
      receiverUid: targetUid,
      type: messageType === "message" ? "newMessage" : "newMessageRequest",
    });

    return res.status(200).json({ message: "Mesaj başarıyla gönderildi." });
  } catch (error) {
    console.error("Mesaj gönderme hatası:", error);
    return res
      .status(500)
      .json({
        error: "Mesaj gönderilirken bir hata oluştu.",
        details: error.message,
      });
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

    const userDoc = await db.collection('users').where('username', '==', cleanUsername).limit(1).get();

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
        stats: profileData.stats, // ✅ GÜNCELLEME: stats verilerini ekledik
        lastChangeDates: profileData.lastChangeDates,
        createdAt: profileData.createdAt
    };

    return res.status(200).json({ profile: sanitizedProfile });
  } catch (error) {
    console.error("Profil bilgisi çekme hatası:", error);
    res.status(500).json({ error: "Profil bilgileri alınırken bir hata oluştu." });
  }
};

// ✅ YENİ: Kullanıcılar arası takip durumunu kontrol etme
exports.getFollowStatus = async (req, res) => {
  try {
    const { targetUid } = req.params;
    const { uid } = req.user;

    if (uid === targetUid) {
      return res.status(200).json({ followStatus: "self" });
    }

    // Takip ilişkisini kontrol et
    const followDoc = await db
      .collection("follows")
      .where("followerUid", "==", uid)
      .where("followingUid", "==", targetUid)
      .get();

    if (!followDoc.empty) {
      return res.status(200).json({ followStatus: "following" });
    }

    // Takip isteği var mı kontrol et
    const requestDoc = await db
      .collection("followRequests")
      .where("senderUid", "==", uid)
      .where("receiverUid", "==", targetUid)
      .get();

    if (!requestDoc.empty) {
      return res.status(200).json({ followStatus: "pending" });
    }

    return res.status(200).json({ followStatus: "none" });
  } catch (error) {
    console.error("Takip durumu getirme hatası:", error);
    res
      .status(500)
      .json({
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
    return res.status(500).json({ error: "Bildirimler getirilirken bir hata oluştu." });
  }
};

// 💡 Yeni fonksiyon: Bildirimleri okundu olarak işaretleme
exports.markNotificationsAsRead = async (req, res) => {
  try {
    const { uid } = req.user;
    const batch = db.batch();
    const notificationsSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("notifications")
      .where("isRead", "==", false)
      .get();

    notificationsSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, { isRead: true });
    });

    await batch.commit();
    return res.status(200).json({ message: "Tüm bildirimler okundu olarak işaretlendi." });
  } catch (error) {
    console.error("Bildirimleri okundu olarak işaretleme hatası:", error);
    return res.status(500).json({ error: "İşlem sırasında bir hata oluştu." });
  }
};

// ✅ YENİ: Belirli bir kullanıcının takipçilerini getirme
exports.getFollowers = async (req, res) => {
  try {
    const { targetUid } = req.params;   // URL parametresinden hedef UID
    const currentUid = req.user.uid;    // middleware’den gelen giriş yapmış kullanıcı UID

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


// ✅ YENİ: Belirli bir kullanıcının takip ettiklerini getirme
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
      .get();

    if (followingSnapshot.empty) {
      return res.status(200).json({ following: [] });
    }

    const followingUids = followingSnapshot.docs.map((doc) => doc.data().followingUid);

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