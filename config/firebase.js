// config/firebase.js

const admin = require("firebase-admin");
const path = require("path");
const FieldValue = admin.firestore.FieldValue;

// Render üzerinde Secret Files yolu
const keyPath = process.env.NODE_ENV === "production"
  ? "/etc/secrets/serviceAccountKey.json" // Render'a yüklediğin secret file yolu
  : path.join(__dirname, "serviceAccountKey.json"); // Local için

if (!admin.apps.length) {
  try {
    const serviceAccount = require(keyPath);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // Storage kullanmayacaksan bu satırı kaldırabilirsin
      // storageBucket: "your-bucket-name.appspot.com"
    });
    console.log("Firebase Admin SDK başlatıldı ✅");
  } catch (error) {
    console.error("Firebase Admin SDK başlatılırken hata oluştu:", error);
    process.exit(1);
  }
}

const auth = admin.auth();
const db = admin.firestore();

module.exports = { admin, auth, db, FieldValue };
