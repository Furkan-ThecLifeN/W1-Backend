// controllers/messageController.js

const { db, admin } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const path = require("path");
const fs = require("fs");
const mime = require("mime-types");
const axios = require("axios");
const FormData = require("form-data");
// ✅ YENİ: https modülünü import ediyoruz
const https = require("https");

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

// Anonfiles yerine Gofile'ı kullanacak şekilde API adresini ve mantığı güncelliyoruz.
const UPLOAD_SERVICE_URL = "https://store1.gofile.io/uploadFile";

const httpsAgent = new https.Agent({
  // Anonfiles sunucusunun sertifika sorununu geçici olarak çözmek için
  // bu satırı ekliyoruz. Üretim ortamında bu önerilmez.
  rejectUnauthorized: false,
});

// ✅ GÜNCELLENDİ: Dosyayı Anonfiles'a Yükleme (anonymfile.com)
const uploadToAnonfiles = async (filePath) => {
  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));

    const response = await axios.post(
      "https://api.anonfiles.com/upload",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        // ✅ ÇÖZÜM: Self-signed certificate hatasını önlemek için
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        }),
      }
    );

    const responseData = response.data;

    // Anonfiles'ın yanıt formatını kontrol et
    if (responseData.status && responseData.data && responseData.data.file) {
      return responseData.data.file.url.full;
    }

    console.error("Anonfiles'a yükleme hatası veya geçersiz yanıt:", responseData);
    return null;

  } catch (error) {
    console.error("Anonfiles'a yükleme hatası:", error.response ? error.response.data : error.message);
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

// ✅ GÜNCELLENDİ: Dosya Yükleme ve Mesaj Gönderme
exports.uploadFileAndSendMessage = async (req, res) => {
  const { conversationId, fromId, toId, messageType, fileName } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "No file provided" });
  }

  const filePath = path.join(__dirname, "../", file.path);
  let fileUrl = null;
  let fileId = null;
  let errorOccurred = false;

  try {
    const isImage = file.mimetype.startsWith("image/");
    if (isImage) {
      fileUrl = await uploadToImgbb(filePath);
      if (!fileUrl) {
        errorOccurred = true;
      }
    } else {
      const form = new FormData();
      form.append("file", fs.createReadStream(filePath), file.originalname);
      const uploadResponse = await axios.post(UPLOAD_SERVICE_URL, form, {
        headers: { ...form.getHeaders() },
        httpsAgent,
      });

      if (uploadResponse.data.status === "ok") {
        fileUrl = uploadResponse.data.data.downloadPage;
        fileId = uploadResponse.data.data.fileId;
      } else {
        console.error("Gofile'a yükleme hatası veya geçersiz yanıt:", uploadResponse.data);
        errorOccurred = true;
      }
    }

    if (errorOccurred || !fileUrl) {
      fs.unlinkSync(filePath);
      return res.status(500).json({ error: "Dosya yükleme servisi bir URL döndürmedi." });
    }

    console.log(`Dosya başarıyla yüklendi: ${fileUrl}`);

    const conversationDocRef = db.collection("conversations").doc(conversationId);
    const newMessageRef = conversationDocRef.collection("messages").doc();
    
    const messageData = {
      senderId: fromId,
      receiverId: toId,
      text: messageType,
      type: isImage ? "image" : "file",
      url: fileUrl,
      fileName: fileName,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (fileId) {
      messageData.fileId = fileId;
    }

    const conversationData = {
      members: [fromId, toId],
      lastMessage: {
        text: isImage ? `Resim: ${fileName}` : `Dosya: ${fileName}`,
        senderId: fromId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(newMessageRef, messageData);
    batch.set(conversationDocRef, conversationData, { merge: true });
    await batch.commit();

    fs.unlinkSync(filePath);
    res.status(200).json({ message: "File uploaded and message sent!" });
  } catch (error) {
    console.error("Dosya yükleme hatası:", error);
    if (file) {
      fs.unlinkSync(file.path);
    }
    res.status(500).json({ error: "Dosya yükleme sırasında bir hata oluştu." });
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