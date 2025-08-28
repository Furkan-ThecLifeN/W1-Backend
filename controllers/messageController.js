// controllers/messageController.js

const { db, admin } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const path = require("path");
const fs = require("fs");
const mime = require("mime-types");
const axios = require("axios");
const FormData = require("form-data");

// Konuşma Kimliği Oluşturma Fonksiyonu
const getConversationId = (user1Id, user2Id) => {
  return [user1Id, user2Id].sort().join("_");
};

// Fonksiyon: Dosyayı Imgbb'ye Yükleme
const uploadToImgbb = async (filePath) => {
  try {
    const formData = new FormData();
    formData.append("image", fs.createReadStream(filePath));

    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );
    return response.data.data.url;
  } catch (error) {
    console.error("Imgbb'ye yükleme hatası:", error);
    return null;
  }
};

// 1. Kullanıcının takipleştiği ve mesajlaştığı kişileri getir
exports.getConversations = async (req, res) => {
  try {
    const { uid } = req.user;
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists)
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });

    const followingList = userDoc.data().following || [];
    const followersList = userDoc.data().followers || [];
    const mutualFollowers = followingList.filter((userId) =>
      followersList.includes(userId)
    );

    const conversationsRef = db.collection("conversations");
    const myConversationsSnapshot = await conversationsRef
      .where("members", "array-contains", uid)
      .orderBy("updatedAt", "desc")
      .get();

    const messagedUsers = new Set();
    const conversationDataMap = new Map();

    for (const doc of myConversationsSnapshot.docs) {
      const data = doc.data();
      const otherUserId = data.members.find((member) => member !== uid);
      messagedUsers.add(otherUserId);
      conversationDataMap.set(otherUserId, data);
    }

    const usersToFetch = [...new Set([...mutualFollowers, ...messagedUsers])];
    if (usersToFetch.length === 0)
      return res.status(200).json({ conversations: [] });

    const userDocs = await db
      .collection("users")
      .where(admin.firestore.FieldPath.documentId(), "in", usersToFetch)
      .get();

    const profiles = {};
    userDocs.forEach((doc) => (profiles[doc.id] = doc.data()));

    const conversations = usersToFetch.map((userId) => {
      const profile = profiles[userId] || {};
      const conversationData = conversationDataMap.get(userId);
      return {
        uid: userId,
        conversationId: conversationData
          ? conversationData.conversationId
          : getConversationId(uid, userId),
        displayName: profile.displayName || profile.username,
        photoURL: profile.photoURL,
        lastMessage: conversationData ? conversationData.lastMessage : null,
        updatedAt: conversationData ? conversationData.updatedAt : null,
      };
    });

    conversations.sort((a, b) => {
      const aTime = a.updatedAt ? a.updatedAt.seconds : 0;
      const bTime = b.updatedAt ? b.updatedAt.seconds : 0;
      return bTime - aTime;
    });

    return res.status(200).json({ conversations });
  } catch (error) {
    console.error("Konuşmaları getirme hatası:", error);
    return res
      .status(500)
      .json({ error: "Konuşmaları getirirken bir hata oluştu." });
  }
};

// 2. Mesajları getirme (Pagination ile)
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { uid } = req.user;
    const { limit = 20, startAfter } = req.query;

    const [user1Id, user2Id] = conversationId.split("_");
    if (user1Id !== uid && user2Id !== uid)
      return res
        .status(403)
        .json({ error: "Bu konuşmaya erişim izniniz yok." });

    let queryRef = db
      .collection("conversations")
      .doc(conversationId)
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(parseInt(limit));

    if (startAfter) {
      const lastDoc = await db
        .collection("conversations")
        .doc(conversationId)
        .collection("messages")
        .doc(startAfter)
        .get();
      if (!lastDoc.exists)
        return res.status(404).json({ error: "Başlangıç belgesi bulunamadı." });
      queryRef = queryRef.startAfter(lastDoc);
    }

    const snapshot = await queryRef.get();
    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.status(200).json({ messages });
  } catch (error) {
    console.error("Mesajları getirme hatası:", error);
    return res
      .status(500)
      .json({ error: "Mesajlar getirilirken bir hata oluştu." });
  }
};

// 3. Metin Mesajı Gönderme
exports.sendMessage = async (req, res) => {
  try {
    const { uid } = req.user;
    const { receiverUid, text } = req.body;
    if (!text)
      return res.status(400).json({ error: "Mesaj içeriği boş olamaz." });

    const conversationId = getConversationId(uid, receiverUid);
    const conversationDocRef = db
      .collection("conversations")
      .doc(conversationId);
    const newMessageRef = conversationDocRef.collection("messages").doc();

    const messageData = {
      senderId: uid,
      receiverUid,
      text,
      type: "text",
      createdAt: FieldValue.serverTimestamp(),
    };

    const conversationData = {
      members: [uid, receiverUid],
      lastMessage: {
        text,
        senderId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
      conversationId,
    };

    const batch = db.batch();
    batch.set(newMessageRef, messageData);
    batch.set(conversationDocRef, conversationData, { merge: true });
    await batch.commit();

    return res.status(200).json({ message: "Mesaj başarıyla gönderildi." });
  } catch (error) {
    console.error("Mesaj gönderme hatası:", error);
    return res
      .status(500)
      .json({ error: "Mesaj gönderilirken bir hata oluştu." });
  }
};

// 4. ✅ Güncellendi: Tekil Dosya Yükleme ve Mesaj Gönderme
exports.uploadFileAndSendMessage = async (req, res) => {
  const { uid } = req.user;
  const { receiverUid } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "Dosya yüklenmedi." });
  }

  try {
    const mimeType = file.mimetype;
    let fileUrl = "";
    let messageType = "";

    // Dosya türüne göre farklı işlem
    if (mimeType.startsWith("image/")) {
      // Fotoğrafsa, Imgbb'ye yükle
      fileUrl = await uploadToImgbb(file.path);
      messageType = "image";
      // Yerel dosyayı hemen sil
      fs.unlinkSync(file.path);
      if (!fileUrl) {
        return res
          .status(500)
          .json({ error: "Fotoğraf yüklenirken bir hata oluştu." });
      }
    } else {
      // Diğer dosya türleriyse (ses, video, vb.), mevcut yerel yapıyı kullan
      const fileName = file.filename;
      fileUrl = `/api/messages/file/${fileName}`;
      messageType = mimeType.startsWith("audio/") ? "audio" : "file";
    }

    const conversationId = getConversationId(uid, receiverUid);
    const conversationDocRef = db.collection("conversations").doc(conversationId);
    const newMessageRef = conversationDocRef.collection("messages").doc();

    const messageData = {
      senderId: uid,
      type: messageType,
      fileName: file.originalname,
      url: fileUrl,
      createdAt: FieldValue.serverTimestamp(),
    };

    const conversationData = {
      members: [uid, receiverUid],
      lastMessage: {
        text: messageType === "image" ? "Fotoğraf gönderdi." : "Dosya gönderdi.",
        senderId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
      conversationId,
    };

    const batch = db.batch();
    batch.set(newMessageRef, messageData);
    batch.set(conversationDocRef, conversationData, { merge: true });
    await batch.commit();

    res.status(200).json({ message: "Dosya başarıyla gönderildi." });
  } catch (error) {
    console.error("Dosya yükleme ve mesaj gönderme hatası:", error);
    res.status(500).json({ error: "Dosya gönderilirken bir hata oluştu." });
  }
};

// 5. Tek Kullanımlık Dosya Sunma ve Silme
exports.serveAndDestroyFile = async (req, res) => {
  try {
    const { fileName } = req.params;
    const filePath = path.join(__dirname, "..", "uploads", fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send("Dosya bulunamadı.");
    }

    res.download(filePath, (err) => {
      if (err) {
        console.error("Dosya gönderilirken hata:", err);
      }
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) console.error("Dosya silinirken hata:", unlinkErr);
      });
    });
  } catch (error) {
    console.error("Dosya sunma ve silme hatası:", error);
    res.status(500).send("Sunucu İç Hatası.");
  }
};

// 6. Kalpli Mesaj Gönderme
exports.sendHeartMessage = async (req, res) => {
  try {
    const { uid } = req.user;
    const { receiverUid, text } = req.body;

    const conversationId = getConversationId(uid, receiverUid);
    const conversationDocRef = db.collection("conversations").doc(conversationId);
    const newMessageRef = conversationDocRef.collection("messages").doc();

    const messageData = {
      senderId: uid,
      type: "heart",
      text: text || "❤️",
      createdAt: FieldValue.serverTimestamp(),
    };

    const conversationData = {
      members: [uid, receiverUid],
      lastMessage: {
        text: text ? `❤️ ${text}` : "❤️ Kalpli Mesaj",
        senderId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
      conversationId,
    };

    const batch = db.batch();
    batch.set(newMessageRef, messageData);
    batch.set(conversationDocRef, conversationData, { merge: true });
    await batch.commit();

    return res.status(200).json({ message: "Kalpli mesaj başarıyla gönderildi." });
  } catch (error) {
    console.error("Kalpli mesaj gönderme hatası:", error);
    return res.status(500).json({ error: "Kalpli mesaj gönderilirken bir hata oluştu." });
  }
};