// middlewares/verifyToken.js
const admin = require('../config/firebase').auth; // Firebase Admin Auth import

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token gerekli.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decodedToken = await admin.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('verifyToken middleware hatası:', error.message);
    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token.' });
  }
};
