// firebase.js dosyamızın içeriği
const admin = require('firebase-admin');
const path = require('path');

// JSON dosyasının yolu
const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const auth = admin.auth();
const db = admin.firestore();

module.exports = { auth, db };

