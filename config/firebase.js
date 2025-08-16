const admin = require('firebase-admin');
const path = require('path');

const keyPath = process.env.NODE_ENV === 'production'
  ? '/etc/secrets/serviceAccountKey.json' 
  : path.join(__dirname, 'serviceAccountKey.json'); 

if (!admin.apps.length) {
  try {
    const serviceAccount = require(keyPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Firebase Admin SDK başlatılırken hata oluştu. Lütfen servis hesabı dosyasını kontrol edin.", error);
    process.exit(1); 
  }
}

const auth = admin.auth();
const db = admin.firestore();

// Not: Storage'ı devre dışı bıraktık
module.exports = { auth, db };