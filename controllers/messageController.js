// controllers/messageController.js
const { db, admin } = require("../config/firebase");
const { getStorage } = require("firebase-admin/storage");
const { FieldValue } = require("firebase-admin/firestore");

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

    const mutualFollowers = followingList.filter(userId =>
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
      const otherUserId = data.members.find(member => member !== uid);
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
    userDocs.forEach(doc => {
      profiles[doc.id] = doc.data();
    });

    const conversations = usersToFetch.map(userId => {
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
    const messages = snapshot.docs.map(doc => ({
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

// 3. Mesaj gönderme
exports.sendMessage = async (req, res) => {
  try {
    const { uid } = req.user;
    const { receiverId, text, file, audio } = req.body;

    if (!receiverId) {
      return res.status(400).json({ error: "Alıcı bilgisi zorunludur." });
    }

    const conversationId = getConversationId(uid, receiverId);
    const messagesCollection = db
      .collection("conversations")
      .doc(conversationId)
      .collection("messages");

    const batch = db.batch();

    const newMessageRef = messagesCollection.doc();
    const messageData = {
      senderId: uid,
      text: text || null,
      file: file || null,
      audio: audio || null,
      createdAt: FieldValue.serverTimestamp(),
      status: "sent",
    };

    batch.set(newMessageRef, messageData);

    const conversationDocRef = db
      .collection("conversations")
      .doc(conversationId);
    const lastMessage = {
      text: text || (file ? "Dosya" : audio ? "Sesli Mesaj" : "..."),
      senderId: uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const conversationData = {
      members: [uid, receiverId],
      lastMessage: lastMessage,
      updatedAt: FieldValue.serverTimestamp(),
      conversationId: conversationId,
    };

    batch.set(conversationDocRef, conversationData, { merge: true });
    await batch.commit();

    return res.status(201).json({
      message: "Mesaj başarıyla gönderildi.",
      sentMessage: { id: newMessageRef.id, ...messageData },
    });
  } catch (error) {
    console.error("Mesaj gönderme hatası:", error);
    return res
      .status(500)
      .json({ error: "Mesaj gönderilirken bir hata oluştu." });
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
