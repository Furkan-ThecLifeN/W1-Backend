// controllers/messageController.js
const { db, admin } = require("../config/firebase");
const { getStorage } = require("firebase-admin/storage");
const { FieldValue } = require("firebase-admin/firestore");
// const getConversationId = require("../utils/getConversationId"); // Bu satır kaldırıldı.
const busboy = require("busboy");
const path = require("path");
const os = require("os");
const fs = require("fs");

// Konuşma Kimliği Oluşturma Fonksiyonu
const getConversationId = (user1Id, user2Id) => {
  return [user1Id, user2Id].sort().join("_");
};

// 1. Kullanıcının takipleştiği ve mesajlaştığı kişileri getir
exports.getConversations = async (req, res) => {
  try {
    const { uid } = req.user;

    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

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
    userDocs.forEach((doc) => {
      profiles[doc.id] = doc.data();
    });

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
    if (user1Id !== uid && user2Id !== uid) {
      return res
        .status(403)
        .json({ error: "Bu konuşmaya erişim izniniz yok." });
    }

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

// 3. Metin / Dosya / Ses Mesajı Gönderme
exports.sendMessage = async (req, res) => {
  try {
    const { uid } = req.user;
    const { receiverUid, text, file, audio } = req.body; // ✅ receiverUid sabit

    // ✅ Temel hata kontrolü
    if (!uid) {
      return res.status(401).json({ error: "Kimlik doğrulaması gerekli." });
    }
    if (!receiverUid) {
      return res.status(400).json({ error: "Alıcı bilgisi zorunludur." });
    }
    if (!text && !file && !audio) {
      return res.status(400).json({ error: "Mesaj içeriği boş olamaz." });
    }

    // ✅ Konuşma id'si üret
    const conversationId = getConversationId(uid, receiverUid);
    const messagesCollection = db
      .collection("conversations")
      .doc(conversationId)
      .collection("messages");

    const batch = db.batch();

    // ✅ Yeni mesaj (type alanı eklendi)
    const newMessageRef = messagesCollection.doc();
    const messageData = {
      senderId: uid,
      receiverId: receiverUid,
      text: text || null,
      file: file || null,
      audio: audio || null,
      type: text ? "text" : file ? "file" : audio ? "audio" : "unknown", // 🔥 type alanı eklendi
      createdAt: FieldValue.serverTimestamp(),
      status: "sent",
    };
    batch.set(newMessageRef, messageData);

    // ✅ Konuşma güncellemesi
    const conversationDocRef = db.collection("conversations").doc(conversationId);
    const lastMessage = {
      text: text || (file ? "📎 Dosya" : audio ? "🎤 Sesli Mesaj" : "..."),
      senderId: uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const conversationData = {
      members: [uid, receiverUid],
      lastMessage,
      updatedAt: FieldValue.serverTimestamp(),
      conversationId,
    };
    batch.set(conversationDocRef, conversationData, { merge: true });

    // ✅ İşlemi kaydet
    await batch.commit();

    return res.status(201).json({
      message: "Mesaj başarıyla gönderildi.",
      sentMessage: { id: newMessageRef.id, ...messageData },
    });
  } catch (error) {
    console.error("Mesaj gönderme hatası:", error);
    return res.status(500).json({ error: "Mesaj gönderilirken bir hata oluştu." });
  }
};


// 4. Dosya yükleme
exports.uploadFile = async (req, res) => {
  try {
    const { uid } = req.user;
    if (!req.file)
      return res.status(400).json({ error: "Dosya bulunamadı." });

    const bucket = getStorage().bucket();
    const filename = `chat_files/${uid}/${Date.now()}_${req.file.originalname}`;
    const file = bucket.file(filename);

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: { senderId: uid },
      },
      public: true,
    });

    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
    return res.status(200).json({
      url: fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
    });
  } catch (error) {
    console.error("Dosya yükleme hatası:", error);
    return res
      .status(500)
      .json({ error: "Dosya yüklenirken bir hata oluştu." });
  }
};

// 5. Dosya yükleme + Mesaj Gönderme (Süreli URL ile)
exports.uploadFileAndSendMessage = async (req, res) => {
  const bb = busboy({ headers: req.headers });
  const { uid } = req.user;
  let fileData = {};
  let fileBuffer = null;
  let fileMimeType = "";
  let fileName = "";

  bb.on("file", (name, file, info) => {
    const { filename, mimeType } = info;
    const filepath = path.join(os.tmpdir(), filename);
    fileMimeType = mimeType;
    fileName = filename;
    file.pipe(fs.createWriteStream(filepath));
    file.on("end", () => {
      fileBuffer = fs.readFileSync(filepath);
      fs.unlinkSync(filepath);
    });
  });

  bb.on("field", (name, value) => {
    if (name === "receiverUid") fileData.receiverUid = value;
    if (name === "expirationHours") fileData.expirationHours = parseInt(value);
  });

  bb.on("close", async () => {
    try {
      if (!fileBuffer || !fileData.receiverUid) {
        return res
          .status(400)
          .json({ error: "Dosya veya alıcı bilgisi eksik." });
      }

      const expirationHours = fileData.expirationHours || 24;
      const expiresAt = new Date(
        Date.now() + expirationHours * 60 * 60 * 1000
      );

      const filePath = `chat_media/${uid}/${Date.now()}_${fileName}`;
      const file = getStorage().bucket().file(filePath);
      await file.save(fileBuffer, { contentType: fileMimeType });

      const [url] = await file.getSignedUrl({
        action: "read",
        expires: expiresAt,
      });

      const conversationId = getConversationId(uid, fileData.receiverUid);
      const conversationDocRef = db
        .collection("conversations")
        .doc(conversationId);
      const newMessageRef = conversationDocRef.collection("messages").doc();

      const messageData = {
        senderId: uid,
        type: fileMimeType.startsWith("audio") ? "audio" : "file",
        url,
        fileName,
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        createdAt: FieldValue.serverTimestamp(),
      };

      await newMessageRef.set(messageData);
      await conversationDocRef.set(
        { updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );

      res.status(201).json({ message: "Dosya ve mesaj başarıyla gönderildi." });
    } catch (error) {
      console.error("Dosya yükleme ve mesaj gönderme hatası:", error);
      res.status(500).json({ error: "İşlem sırasında bir hata oluştu." });
    }
  });

  req.pipe(bb);
};

// 6. Kalpli Mesaj Gönderme
exports.sendHeartMessage = async (req, res) => {
  try {
    const { uid } = req.user;
    const { receiverUid } = req.body;

    const conversationId = getConversationId(uid, receiverUid);
    const conversationDocRef = db.collection("conversations").doc(conversationId);
    const newMessageRef = conversationDocRef.collection("messages").doc();

    const messageData = {
      senderId: uid,
      type: "heart",
      createdAt: FieldValue.serverTimestamp(),
    };

    await newMessageRef.set(messageData);
    await conversationDocRef.set(
      { updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    res.status(201).json({ message: "❤️ Kalpli mesaj gönderildi." });
  } catch (error) {
    console.error("Kalpli mesaj gönderme hatası:", error);
    res.status(500).json({ error: "İşlem sırasında bir hata oluştu." });
  }
};
