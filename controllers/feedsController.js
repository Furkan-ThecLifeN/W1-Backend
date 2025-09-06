// controllers/feedsController.js
const { db, FieldValue } = require('../config/firebase');
const { getYouTubeEmbedUrl } = require('../utils/mediaHelpers'); // ✅ Doğru import satırı

exports.createFeed = async (req, res) => {
  const { content, mediaUrl, ownershipAccepted } = req.body;
  const userId = req.user.uid;

  if (!mediaUrl || !ownershipAccepted) {
    return res.status(400).json({ error: 'Video URL\'si ve sahiplik onayı gerekli.' });
  }

  const embedUrl = getYouTubeEmbedUrl(mediaUrl);
  if (!embedUrl) {
    return res.status(400).json({ error: 'Geçerli bir YouTube Shorts URL\'si değil.' });
  }

  try {
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }

    const userData = userSnap.data();

    // Yeni post için benzersiz bir ID oluştur ve bu ID'yi her iki koleksiyon için de kullan.
    const newPostRef = userRef.collection('feeds').doc(); // 'posts' yerine 'feeds' olarak güncelledim
    const newGlobalFeedRef = db.collection('globalFeeds').doc(newPostRef.id);

    const postData = {
      type: 'feed',
      content: content || '',
      mediaUrl: embedUrl,
      ownerId: userId,
      username: userData.username || 'Anonim Kullanıcı',
      userProfileImage: userData.photoURL || 'https://i.pravatar.cc/48',
      createdAt: FieldValue.serverTimestamp(),
      ownershipAccepted: ownershipAccepted,
      likes: 0, 
    };

    // Firestore'da toplu yazma işlemi başlat
    const batch = db.batch();
    batch.set(newPostRef, postData);
    batch.set(newGlobalFeedRef, postData);

    // İşlemi tamamla
    await batch.commit();

    // Kullanıcının post sayısını güncelle
    await userRef.update({
      'stats.posts': FieldValue.increment(1)
    });

    res.status(201).json({ message: 'Feed başarıyla paylaşıldı.', postId: newPostRef.id });
  } catch (error) {
    console.error('Feed oluşturma hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası: ' + error.message });
  }
};