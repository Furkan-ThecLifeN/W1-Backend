// middlewares/auth.js
const { auth } = require("../config/firebase");

async function verifyFirebaseToken(req, res, next) {
  try {
    // Authorization header'dan token al
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split("Bearer ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized: Token missing" });
    }

    // Firebase token doğrulama
    const decodedToken = await auth.verifyIdToken(token);

    // Kullanıcı bilgilerini request objesine ekle
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
    };

    next();
  } catch (err) {
    console.error("Token doğrulama hatası:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = verifyFirebaseToken;
