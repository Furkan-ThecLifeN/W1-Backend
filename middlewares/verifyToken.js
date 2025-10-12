// middlewares/verifyToken.js
const { auth } = require('../config/firebase');

// Tokenleri ve doğrulama sonuçlarını tutmak için basit bir in-memory cache
// Map: token -> decodedToken
const tokenCache = new Map();

// Maksimum cache boyutu (gerekirse azalt)
const MAX_CACHE_ENTRIES = 5000;

// Cache temizleme mekanizması: belirli aralıklarla süresi dolmuş tokenleri temizler.
// 5 dakikada bir çalışacak
setInterval(() => {
  const now = Date.now();
  for (let [token, decoded] of tokenCache.entries()) {
    try {
      // decoded.exp beklenen yapı: unix seconds
      if (decoded && decoded.exp && (decoded.exp * 1000 < now + 60000)) {
        tokenCache.delete(token);
      }
    } catch (e) {
      // Beklenmeyen decoded yapısı varsa güvenli şekilde sil
      tokenCache.delete(token);
    }
  }

  // Eğer cache çok büyürse (ör: bir sızıntı/hatadan dolayı), eski kayıtları kırparız
  if (tokenCache.size > MAX_CACHE_ENTRIES) {
    const keys = tokenCache.keys();
    // Silinecek miktar: yarıya düşürelim
    const removeCount = Math.floor(tokenCache.size - MAX_CACHE_ENTRIES / 2);
    for (let i = 0; i < removeCount; i++) {
      const k = keys.next().value;
      if (!k) break;
      tokenCache.delete(k);
    }
  }
}, 5 * 60 * 1000);

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Daha ayrıntılı console.log kaldırıldı — sadece hata yanıtı dönüyoruz
    return res.status(401).json({ error: 'Token gerekli.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 1. Önce önbellekte (cache) ara
    if (tokenCache.has(token)) {
      const decodedToken = tokenCache.get(token);
      req.user = decodedToken;
      // **Önemli:** cache-hit'lerde artık log yazılmıyor (spam önlemek için).
      return next();
    }

    // 2. Önbellekte yoksa Firebase ile doğrula (bu noktada log gerekli)
    const decodedToken = await auth.verifyIdToken(token);

    // 3. Doğrulama başarılıysa önbelleğe kaydet
    tokenCache.set(token, decodedToken);

    // Yeni doğrulama olayları için kısa bir log bırakıyoruz (bunu hafif tuttuk)
    console.log("Token yeni doğrulandı ve cache'e eklendi. Kullanıcı UID:", decodedToken.uid);

    req.user = decodedToken;
    next();
  } catch (error) {
    // Daha açıklayıcı hata mesajlarıyla dönüyoruz
    console.error('verifyIdToken hatası:', error.code || "unknown", '-', error.message || error.toString());

    if (error.code === 'auth/argument-error' || error.code === 'auth/invalid-credential') {
      return res.status(401).json({ error: 'Geçersiz kimlik bilgisi. Token formatı hatalı veya süresi dolmuş olabilir.' });
    }

    if (error.code === 'auth/id-token-expired') {
      // Süresi dolan token'ı cache'den sil (anında müdahale)
      tokenCache.delete(token);
      return res.status(401).json({ error: 'Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.' });
    }

    // Diğer genel hatalar için
    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token.' });
  }
};
