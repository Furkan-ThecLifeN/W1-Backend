// middlewares/verifyToken.js
const admin = require("firebase-admin");
const { auth } = require('../config/firebase');

// Tokenleri ve doğrulama sonuçlarını tutmak için basit bir in-memory cache
const tokenCache = new Map();

// Cache temizleme mekanizması:
// Belirli aralıklarla süresi dolmuş tokenleri temizler.
// 5 dakikada bir çalışacak
setInterval(() => {
    const now = Date.now();
    for (let [token, decoded] of tokenCache.entries()) {
        // Tokenın süresinin bitmesine 1 dakika kala temizle
        if (decoded.exp * 1000 < now + 60000) {
            tokenCache.delete(token);
        }
    }
}, 5 * 60 * 1000);

module.exports = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error("Authorization başlığı eksik veya 'Bearer' ile başlamıyor.");
        return res.status(401).json({ error: 'Token gerekli.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // 1. Önce önbellekte (cache) ara
        if (tokenCache.has(token)) {
            const decodedToken = tokenCache.get(token);
            req.user = decodedToken;
            console.log("Token cache'ten doğrulandı. Kullanıcı UID:", decodedToken.uid);
            return next();
        }

        // 2. Önbellekte yoksa Firebase ile doğrula
        const decodedToken = await auth.verifyIdToken(token);
        
        // 3. Doğrulama başarılıysa önbelleğe kaydet
        tokenCache.set(token, decodedToken);
        
        console.log("Token başarıyla doğrulandı. Kullanıcı UID:", decodedToken.uid);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('verifyIdToken hatası:', error.code, ' - ', error.message);

        // Hata koduyla ilgili daha spesifik yanıtlar ver
        if (error.code === 'auth/argument-error' || error.code === 'auth/invalid-credential') {
            return res.status(401).json({ error: 'Geçersiz kimlik bilgisi. Token formatı hatalı veya süresi dolmuş olabilir.' });
        }

        if (error.code === 'auth/id-token-expired') {
            // Süresi dolan token'ı cache'den sil (zaten interval ile temizlenir ama anında müdahale için)
            tokenCache.delete(token);
            return res.status(401).json({ error: 'Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.' });
        }

        // Diğer genel hatalar için
        return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token.' });
    }
};