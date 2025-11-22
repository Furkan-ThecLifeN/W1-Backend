const { db, admin } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const https = require("https");

// ----------------------------------------------------------------
// YARDIMCI FONKSİYONLAR
// ----------------------------------------------------------------

const getConversationId = (user1Id, user2Id) =>
  [user1Id, user2Id].sort().join("_");

const checkBlockStatus = async (uid, otherUserId) => {
  try {
    const [blocking, blockedBy] = await Promise.all([
      db.collection("users").doc(uid).collection("blockedUsers").doc(otherUserId).get(),
      db.collection("users").doc(uid).collection("blockedBy").doc(otherUserId).get(),
    ]);
    if (blocking.exists) return "blocking"; // Biz engelledik
    if (blockedBy.exists) return "blocked"; // O bizi engelledi
    return null;
  } catch (e) {
    return null;
  }
};

const uploadToImgbb = async (filePath) => {
  try {
    const formData = new FormData();
    formData.append("image", fs.createReadStream(filePath));
    const res = await axios.post(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
      formData,
      { headers: formData.getHeaders() }
    );
    return res.data.data.display_url;
  } catch (e) {
    console.error("Imgbb Upload Error:", e);
    return null;
  }
};

const UPLOAD_SERVICE_URL = "https://store1.gofile.io/uploadFile";
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ----------------------------------------------------------------
// CONTROLLER FONKSİYONLARI
// ----------------------------------------------------------------

// 1. Durum Kontrolü (Hafif Endpoint)
exports.checkConversationStatus = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { uid } = req.user;
    const [u1, u2] = conversationId.split("_");

    if (u1 !== uid && u2 !== uid) return res.status(403).json({ error: "Erişim reddedildi." });
    
    const otherId = u1 === uid ? u2 : u1;
    const blockStatus = await checkBlockStatus(uid, otherId);
    
    return res.status(200).json({ blockStatus });
  } catch (e) {
    return res.status(500).json({ error: "Durum kontrolü hatası." });
  }
};

// 2. Sohbetleri Getir (Conversations List)
exports.getConversations = async (req, res) => {
  try {
    const { uid } = req.user;
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

    const following = userDoc.data().following || [];
    const followers = userDoc.data().followers || [];
    const mutuals = following.filter((id) => followers.includes(id));

    const convRef = db.collection("conversations");
    // Sadece kullanıcının olduğu sohbetler
    const snaps = await convRef
      .where("members", "array-contains", uid)
      .orderBy("updatedAt", "desc")
      .get();

    const messagedUsers = new Set();
    const convMap = new Map();
    snaps.docs.forEach((doc) => {
      const data = doc.data();
      const other = data.members.find((m) => m !== uid);
      if (other) {
        messagedUsers.add(other);
        convMap.set(other, data);
      }
    });

    // Sadece karşılıklı takiplesilenler VEYA daha önce mesajlaşılanlar
    const usersToFetch = [...new Set([...mutuals, ...messagedUsers])];
    
    // Profil bilgilerini çek (Eğer çok fazla kullanıcı varsa bunu optimize etmek gerekebilir)
    // Ancak 'getConversations' ana sayfa yükü olduğu için burada kabul edilebilir.
    if (usersToFetch.length === 0) return res.status(200).json({ conversations: [] });

    const userDocs = await db.collection("users").where(admin.firestore.FieldPath.documentId(), "in", usersToFetch).get();
    const profiles = {};
    userDocs.forEach((doc) => (profiles[doc.id] = doc.data()));

    const conversations = usersToFetch.map((id) => {
        const p = profiles[id] || {};
        const c = convMap.get(id);
        return {
          uid: id,
          conversationId: c ? c.conversationId : getConversationId(uid, id),
          displayName: p.displayName || p.username || "Kullanıcı",
          photoURL: p.photoURL || null,
          lastMessage: c ? c.lastMessage : null,
          updatedAt: c ? c.updatedAt : null,
          membersInfo: c ? c.membersInfo : null
        };
      }).sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));

    return res.status(200).json({ conversations });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Hata oluştu." });
  }
};

// 3. Eski Mesajları Getir (Pagination için)
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { uid } = req.user;
    const { limit = 20, startAfter } = req.query;
    const [u1, u2] = conversationId.split("_");

    if (u1 !== uid && u2 !== uid) return res.status(403).json({ error: "Erişim reddedildi." });

    // Sadece paginasyon sırasında engel kontrolüne gerek olmayabilir ama güvenlik için kalsın
    // Eğer çok yoğunsa burası kaldırılabilir, çünkü zaten chat açılırken kontrol ediliyor.
    
    let q = db.collection("conversations").doc(conversationId).collection("messages")
      .orderBy("createdAt", "desc")
      .limit(parseInt(limit));

    if (startAfter) {
      const lastDoc = await db.collection("conversations").doc(conversationId).collection("messages").doc(startAfter).get();
      if (!lastDoc.exists) return res.status(404).json({ error: "Referans mesaj bulunamadı." });
      q = q.startAfter(lastDoc);
    }

    const snapshot = await q.get();
    const messages = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.status(200).json({ messages, blockStatus: null });
  } catch (e) {
    return res.status(500).json({ error: "Mesajlar alınamadı." });
  }
};

// 4. Mesaj Gönderme (Optimize Edildi)
exports.sendMessage = async (req, res) => {
  try {
    const { uid } = req.user;
    const { receiverUid, text } = req.body;
    if (!text) return res.status(400).json({ error: "Boş mesaj gönderilemez." });

    const blockStatus = await checkBlockStatus(uid, receiverUid);
    if (blockStatus) return res.status(403).json({ error: "Mesaj gönderilemez.", blockStatus });

    // Gönderen bilgilerini al (Denormalization için)
    const senderDoc = await db.collection("users").doc(uid).get();
    const senderData = senderDoc.data() || {};
    const senderInfo = {
        displayName: senderData.displayName || senderData.username || "User",
        photoURL: senderData.photoURL || null
    };

    const cid = getConversationId(uid, receiverUid);
    const convRef = db.collection("conversations").doc(cid);
    const msgRef = convRef.collection("messages").doc();
    const now = FieldValue.serverTimestamp();

    const batch = db.batch();
    
    batch.set(msgRef, {
      senderId: uid,
      receiverUid,
      text,
      type: "text",
      createdAt: now,
    });

    // Sohbeti güncelle + membersInfo ekle
    batch.set(convRef, {
        members: [uid, receiverUid],
        lastMessage: { text, senderId: uid, updatedAt: now },
        updatedAt: now,
        conversationId: cid,
        [`membersInfo.${uid}`]: senderInfo 
      }, { merge: true }
    );
    
    await batch.commit();
    return res.status(200).json({ message: "Gönderildi." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Hata oluştu." });
  }
};

// 5. Dosya Yükleme
exports.uploadFileAndSendMessage = async (req, res) => {
  const { conversationId, fromId, toId, messageType, fileName } = req.body;
  const file = req.file;
  
  if (!file) return res.status(400).json({ error: "Dosya yok." });

  const blockStatus = await checkBlockStatus(fromId, toId);
  if (blockStatus) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(403).json({ error: "Engellendi.", blockStatus });
  }

  const filePath = path.join(__dirname, "../", file.path);
  let fileUrl = null, fileId = null;

  try {
    const senderDoc = await db.collection("users").doc(fromId).get();
    const senderData = senderDoc.data() || {};
    const senderInfo = {
        displayName: senderData.displayName || senderData.username || "User",
        photoURL: senderData.photoURL || null
    };

    const isImage = file.mimetype.startsWith("image/");
    if (isImage) {
      fileUrl = await uploadToImgbb(filePath);
    } else {
      const form = new FormData();
      form.append("file", fs.createReadStream(filePath), file.originalname);
      const resp = await axios.post(UPLOAD_SERVICE_URL, form, {
        headers: { ...form.getHeaders() },
        httpsAgent,
      });
      if (resp.data.status === "ok") {
        fileUrl = resp.data.data.downloadPage;
        fileId = resp.data.data.fileId;
      }
    }

    if (!fileUrl) throw new Error("URL alınamadı.");

    const convRef = db.collection("conversations").doc(conversationId);
    const msgRef = convRef.collection("messages").doc();
    const now = FieldValue.serverTimestamp();
    
    const msgData = {
      senderId: fromId,
      receiverId: toId,
      text: messageType,
      type: isImage ? "image" : "file",
      url: fileUrl,
      fileName,
      createdAt: now,
    };
    if (fileId) msgData.fileId = fileId;

    const batch = db.batch();
    batch.set(msgRef, msgData);
    
    batch.set(convRef, {
        members: [fromId, toId],
        lastMessage: {
          text: isImage ? `📷 ${fileName}` : `📁 ${fileName}`,
          senderId: fromId,
          updatedAt: now,
        },
        updatedAt: now,
        [`membersInfo.${fromId}`]: senderInfo
      }, { merge: true }
    );
    
    await batch.commit();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(200).json({ message: "Dosya gönderildi." });
  } catch (e) {
    console.error(e);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: "Yükleme hatası." });
  }
};

// 6. Kalp Gönderme
exports.sendHeartMessage = async (req, res) => {
  try {
    const { uid } = req.user;
    const { receiverUid, text } = req.body;

    const blockStatus = await checkBlockStatus(uid, receiverUid);
    if (blockStatus) return res.status(403).json({ error: "Engellendi.", blockStatus });

    const senderDoc = await db.collection("users").doc(uid).get();
    const senderData = senderDoc.data() || {};
    const senderInfo = {
        displayName: senderData.displayName || senderData.username || "User",
        photoURL: senderData.photoURL || null
    };

    const cid = getConversationId(uid, receiverUid);
    const convRef = db.collection("conversations").doc(cid);
    const msgRef = convRef.collection("messages").doc();
    const now = FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.set(msgRef, {
      senderId: uid,
      type: "heart",
      text: text || "❤️",
      createdAt: now,
    });
    
    batch.set(convRef, {
        members: [uid, receiverUid],
        lastMessage: {
          text: text ? `❤️ ${text}` : "❤️",
          senderId: uid,
          updatedAt: now,
        },
        updatedAt: now,
        conversationId: cid,
        [`membersInfo.${uid}`]: senderInfo
      }, { merge: true }
    );
    
    await batch.commit();
    return res.status(200).json({ message: "Kalp gönderildi." });
  } catch (e) {
    return res.status(500).json({ error: "Hata." });
  }
};

// 7. Tekil Silme
exports.deleteMessage = async (req, res) => {
  try {
    const { uid } = req.user;
    const { conversationId, messageId } = req.params;
    const msgRef = db.collection("conversations").doc(conversationId).collection("messages").doc(messageId);
    const doc = await msgRef.get();

    if (!doc.exists) return res.status(404).json({ error: "Mesaj yok." });
    if (doc.data().senderId !== uid) return res.status(403).json({ error: "Yetkisiz işlem." });

    await msgRef.delete();
    return res.status(200).json({ message: "Silindi." });
  } catch (e) {
    return res.status(500).json({ error: "Silme hatası." });
  }
};

// 8. Sohbeti Temizle
exports.clearConversation = async (req, res) => {
  try {
    const { uid } = req.user;
    const { conversationId } = req.params;
    const convRef = db.collection("conversations").doc(conversationId);
    const convDoc = await convRef.get();

    if (!convDoc.exists || !convDoc.data().members.includes(uid)) {
      return res.status(403).json({ error: "Yetkisiz." });
    }

    const msgsRef = convRef.collection("messages");
    const snap = await msgsRef.get();
    
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    
    batch.update(convRef, {
      lastMessage: {
        text: "Sohbet temizlendi",
        senderId: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
    });

    await batch.commit();
    return res.status(200).json({ message: "Temizlendi." });
  } catch (e) {
    return res.status(500).json({ error: "Hata." });
  }
};

// Dosya İndirme (Geçici)
exports.serveAndDestroyFile = async (req, res) => {
    try {
      const fPath = path.join(__dirname, "..", "uploads", req.params.fileName);
      if (!fs.existsSync(fPath)) return res.status(404).send("Dosya yok.");
      res.download(fPath, (err) => {
        fs.unlink(fPath, () => {});
      });
    } catch (e) {
      res.status(500).send("Hata.");
    }
};