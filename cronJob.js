// cronJob.js
const cron = require('node-cron');
const { db, auth } = require('./config/firebase');
const { getStorage } = require('firebase-admin/storage');
const { getAuth } = require('firebase-admin/auth');

// ✅ YENİ: 15 gün bekleme süresi
const DELETION_PERIOD_DAYS = 15;

const startDeletionJob = () => {
    // Her gün gece 03:00'te çalışır
    cron.schedule('0 3 * * *', async () => {
        console.log('Hesap silme cron işi başlatılıyor...');
        try {
            const now = new Date();
            const fifteenDaysAgo = new Date(now.setDate(now.getDate() - DELETION_PERIOD_DAYS));

            // Silinme beklemesindeki kullanıcıları bul
            const pendingUsersSnapshot = await db.collection('users')
                .where('isPendingDeletion', '==', true)
                .where('pendingDeletionDate', '<=', fifteenDaysAgo)
                .get();

            if (pendingUsersSnapshot.empty) {
                console.log('Silinecek bekleyen hesap bulunamadı.');
                return;
            }

            const batch = db.batch();
            const uidsToDelete = [];

            for (const doc of pendingUsersSnapshot.docs) {
                const user = doc.data();
                const uid = user.uid;
                uidsToDelete.push(uid);

                // Firestore belgelerini silinme için batch'e ekle
                // Profil belgesi
                batch.delete(db.collection('users').doc(uid));

                // Diğer koleksiyonlar (örnek: posts, comments)
                // Bu kısım, projenizin yapısına göre elle veya koleksiyonlara göre ayarlanmalıdır.
                // Örneğin:
                // const postsSnapshot = await db.collection('posts').where('userId', '==', uid).get();
                // postsSnapshot.docs.forEach(postDoc => batch.delete(postDoc.ref));
            }

            // Batch işlemini uygula
            await batch.commit();

            // ✅ Storage'daki dosyaları sil
            const bucket = getStorage().bucket();
            await Promise.all(uidsToDelete.map(async (uid) => {
                const [files] = await bucket.getFiles({ prefix: `profile_pictures/${uid}/` });
                await Promise.all(files.map(file => file.delete()));
            }));

            // ✅ Firebase Auth hesaplarını sil
            await getAuth().deleteUsers(uidsToDelete);

            console.log(`${uidsToDelete.length} adet hesap kalıcı olarak silindi.`);
        } catch (error) {
            console.error('Hesap silme cron işinde hata oluştu:', error);
        }
    });
};

module.exports = { startDeletionJob };