const admin = require('firebase-admin');
const path = require('path');

const keyPath = process.env.NODE_ENV === 'production'
  ? '/etc/secrets/serviceAccountKey.json' 
  : path.join(__dirname, 'serviceAccountKey.json'); 

if (!admin.apps.length) {
  try {
    const serviceAccount = require(keyPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: "your-bucket-name.appspot.com"
    });
  } catch (error) {
    console.error("Firebase Admin SDK başlatılırken hata oluştu.", error);
    process.exit(1); 
  }
}

const auth = admin.auth();
const db = admin.firestore();
const bucket = admin.storage().bucket();

module.exports = { auth, db, bucket };
