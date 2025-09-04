// controllers/feedsController.js

const { db, FieldValue } = require('../config/firebase');

// YouTube Shorts URL'sinden video ID'sini ve embed URL'sini çıkarmak için yardımcı fonksiyon
const getYouTubeEmbedUrl = (url) => {
  const shortsRegex = /(?:youtube\.com\/(?:shorts\/|live\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})/;
  const match = url.match(shortsRegex);
  if (match && match[1]) {
    const videoId = match[1];
    // Otomatik oynatma, döngü ve dikey video için gerekli parametreler
    return `https://www.youtube.com/embed/${videoId}?vq=hd1080&modestbranding=1&controls=0&rel=0&showinfo=0&autoplay=1&loop=1&playlist=${videoId}`;
  }
  return null;
};

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
    const newPostRef = db.collection('users').doc(userId).collection('posts').doc();
    const newGlobalFeedRef = db.collection('globalFeeds').doc(newPostRef.id);

    const postData = {
      type: 'feed',
      content: content || '',
      mediaUrl: embedUrl,
      ownerId: userId,
      createdAt: FieldValue.serverTimestamp(),
      ownershipAccepted: ownershipAccepted
    };

    // İki koleksiyona birden kayıt (Batch write)
    const batch = db.batch();
    batch.set(newPostRef, postData);
    batch.set(newGlobalFeedRef, postData);

    await batch.commit();

    // Kullanıcının post sayısını güncelle
    const userRef = db.collection('users').doc(userId);
    await userRef.update({
      'stats.posts': FieldValue.increment(1)
    });

    res.status(201).json({ message: 'Feed başarıyla paylaşıldı.', postId: newPostRef.id });
  } catch (error) {
    console.error('Feed oluşturma hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası: ' + error.message });
  }
};