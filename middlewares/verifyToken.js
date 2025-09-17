const { auth } = require('../config/firebase'); // Firebase Admin Auth import

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error("Authorization başlığı eksik veya 'Bearer' ile başlamıyor.");
    return res.status(401).json({ error: 'Token gerekli.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(token);
    console.log("Token başarıyla doğrulandı. Kullanıcı UID:", decodedToken.uid);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('verifyIdToken hatası:', error.code, ' - ', error.message);

    if (error.code === 'auth/argument-error' || error.code === 'auth/invalid-credential') {
      return res.status(401).json({ error: 'Geçersiz kimlik bilgisi. Token formatı hatalı veya süresi dolmuş olabilir.' });
    }

    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.' });
    }

    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token.' });
  }
};
