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
    // Kullanıcı bilgilerini çek
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }

    const userData = userSnap.data();

    const newPostRef = userRef.collection('posts').doc();
    const newGlobalFeedRef = db.collection('globalFeeds').doc(newPostRef.id);

    const postData = {
      type: 'feed',
      content: content || '',
      mediaUrl: embedUrl,
      ownerId: userId,
      username: userData.username || 'Anonim Kullanıcı',
      userProfileImage: userData.photoURL || 'https://i.pravatar.cc/48',
      createdAt: FieldValue.serverTimestamp(),
      ownershipAccepted: ownershipAccepted
    };

    // İki koleksiyona birden kayıt (Batch write)
    const batch = db.batch();
    batch.set(newPostRef, postData);
    batch.set(newGlobalFeedRef, postData);

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
