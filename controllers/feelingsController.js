const admin = require('firebase-admin');
const db = admin.firestore();

exports.sharePost = async (req, res) => {
  try {
    // Frontend'den gelen 'postText' değişkenini doğru şekilde yakalıyoruz.
    const { postText, images, privacy } = req.body;
    const userId = req.user.uid;

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }
    const userData = userDoc.data();

    // Firestore'a kaydedilecek gönderi yapısını oluştur
    const newPostData = {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      displayName: userData.displayName || 'Kullanıcı',
      images: images || [],
      photoURL: userData.photoURL || '',
      privacy: privacy || 'public',
      stats: {
        comments: 0,
        likes: 0,
        shares: 0,
      },
      // Backend'de yakaladığımız 'postText' değişkenini burada kullanıyoruz.
      text: postText || '',
      uid: userId,
      username: userData.username || 'unknown_user', // Kullanıcı verisinden username alanını al
    };

    // Gönderiyi 'globalFeelings' koleksiyonuna kaydet
    const newFeelingRef = await db.collection('globalFeelings').add(newPostData);

    res.status(201).json({
      message: "Gönderi başarıyla paylaşıldı!",
      postId: newFeelingRef.id,
    });

  } catch (error) {
    console.error("Gönderi paylaşılırken hata oluştu:", error);
    res.status(500).json({ error: "Sunucu hatası. Lütfen tekrar deneyin." });
  }
};
