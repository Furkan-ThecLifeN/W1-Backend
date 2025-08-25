// cronJob.js
const cron = require('node-cron');
const { db, admin } = require('./config/firebase'); // admin'i de import edin
const { getStorage } = require('firebase-admin/storage');
const { getAuth } = require('firebase-admin/auth');

// Ayarlar
const DELETION_PERIOD_DAYS = 15;

// Cron Job başlatma fonksiyonu
const startDeletionJob = () => {

  // 1️⃣ Hesap silme işi: her gün saat 03:00
  cron.schedule('0 3 * * *', async () => {
    console.log('Hesap silme cron işi başlatılıyor...');
    try {
      const now = new Date();
      const fifteenDaysAgo = new Date(now.setDate(now.getDate() - DELETION_PERIOD_DAYS));

      const pendingUsersSnapshot = await db.collection('users')
        .where('isPendingDeletion', '==', true)
        .where('pendingDeletionDate', '<=', fifteenDaysAgo)
        .get();

      if (!pendingUsersSnapshot.empty) {
        const batch = db.batch();
        const uidsToDelete = [];

        for (const doc of pendingUsersSnapshot.docs) {
          const user = doc.data();
          const uid = user.uid;
          uidsToDelete.push(uid);

          batch.delete(db.collection('users').doc(uid));
        }

        await batch.commit();

        const bucket = getStorage().bucket();
        await Promise.all(uidsToDelete.map(async (uid) => {
          const [files] = await bucket.getFiles({ prefix: `profile_pictures/${uid}/` });
          await Promise.all(files.map(file => file.delete()));
        }));

        await getAuth().deleteUsers(uidsToDelete);
        console.log(`${uidsToDelete.length} adet hesap kalıcı olarak silindi.`);
      } else {
        console.log('Silinecek bekleyen hesap bulunamadı.');
      }

    } catch (error) {
      console.error('Hesap silme cron işinde hata oluştu:', error);
    }
  });

  // 2️⃣ Mesaj silme işi: her saat başı
  cron.schedule('0 * * * *', async () => {
    console.log('Süresi dolmuş mesajları silme cron işi başlatılıyor...');
    try {
      const now = admin.firestore.Timestamp.now(); // Firestore Timestamp kullan
      const messagesRef = db.collectionGroup('messages');
      const snapshot = await messagesRef.where('expiresAt', '<=', now).get();

      if (!snapshot.empty) {
        const batch = db.batch();
        const fileDeletions = [];

        snapshot.docs.forEach((doc) => {
          const { url, type } = doc.data();
          if (type === 'file' || type === 'audio') {
            // URL'den dosya yolunu doğru şekilde çıkar
            const urlParts = url.split('chat_media%2F');
            if (urlParts.length > 1) {
              const encodedFilePath = urlParts[1].split('?')[0];
              const filePath = decodeURIComponent(encodedFilePath);
              fileDeletions.push(getStorage().bucket().file(`chat_media/${filePath}`).delete());
            } else {
                console.warn(`Geçersiz URL formatı, dosya silinemedi: ${url}`);
            }
          }
          batch.delete(doc.ref);
        });

        await Promise.all(fileDeletions);
        await batch.commit();
        console.log(`Silinen ${snapshot.docs.length} adet süresi dolmuş mesaj.`);
      } else {
        console.log('Silinecek mesaj bulunamadı.');
      }

    } catch (error) {
      console.error('Mesaj silme cron işinde hata oluştu:', error);
    }
  });

};

module.exports = { startDeletionJob };