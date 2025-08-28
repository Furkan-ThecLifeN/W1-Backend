// cronJob.js
const cron = require('node-cron');
const { db, admin } = require('./config/firebase');

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
        pendingUsersSnapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
          console.log(`Kullanıcı hesabı siliniyor: ${doc.id}`);
        });
        await batch.commit();
      } else {
        console.log('Silinecek bekleyen kullanıcı bulunamadı.');
      }
    } catch (error) {
      console.error('Hesap silme cron işinde hata:', error);
    }
  });

  // 2️⃣ Mesaj silme işi: her gün saat 02:00
  // Dosyalar sunucu tarafından indirilince zaten silindiği için,
  // bu cron job sadece süresi dolmuş metin veya mesajları silecek.
  cron.schedule('0 2 * * *', async () => {
    console.log('Süresi dolmuş mesajları silme cron işi başlatılıyor...');
    try {
      const now = admin.firestore.Timestamp.now();
      
      const allConversations = await db.collection('conversations').get();
      const batch = db.batch();
      let totalDeleted = 0;

      for (const convDoc of allConversations.docs) {
        const messagesRef = convDoc.ref.collection('messages');
        const snapshot = await messagesRef.where('expiresAt', '<=', now).get();

        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
          totalDeleted++;
        });
      }

      if (totalDeleted > 0) {
        await batch.commit();
        console.log(`${totalDeleted} adet süresi dolmuş mesaj silindi.`);
      } else {
        console.log('Silinecek süresi dolmuş mesaj bulunamadı.');
      }

    } catch (error) {
      console.error('Mesaj silme cron işinde hata:', error);
    }
  });
};

module.exports = { startDeletionJob };
