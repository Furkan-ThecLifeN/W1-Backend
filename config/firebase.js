// config/firebase.js
const admin = require('firebase-admin');
const path = require('path');

const keyPath = process.env.NODE_ENV === 'production'
  ? '/etc/secrets/serviceAccountKey.json' 
  : path.join(__dirname, 'serviceAccountKey.json'); 

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath))
  });
}

const auth = admin.auth();
const db = admin.firestore();

module.exports = { auth, db };
