// controllers/userController.js

const { auth, db } = require('../config/firebase');
const { isValidUsername } = require('../utils/validators');
const { getStorage } = require('firebase-admin/storage');
const { FieldValue } = require('firebase-admin/firestore');

// Profil güncelleme
exports.updateProfile = async (req, res) => {
    try {
        const { uid } = req.user;
        const updates = req.body;

        if (!uid) {
            return res.status(401).json({ error: 'Yetkisiz erişim.' });
        }

        const firestoreUpdates = {};
        const authUpdates = {};
        const lastChangeDatesUpdates = {};

        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        }

        // Kullanıcı adı
        if (updates.username) {
            if (!isValidUsername(updates.username)) {
                return res.status(400).json({ error: 'Geçersiz kullanıcı adı formatı.' });
            }
            const usernameSnapshot = await db.collection('users').where('username', '==', updates.username).get();
            if (!usernameSnapshot.empty && usernameSnapshot.docs[0].id !== uid) {
                return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
            }
            firestoreUpdates.username = updates.username;
            lastChangeDatesUpdates.username = FieldValue.serverTimestamp();
            authUpdates.displayName = updates.username;
        }

        // Görünen ad
        if (updates.displayName) {
            firestoreUpdates.displayName = updates.displayName;
            lastChangeDatesUpdates.displayName = FieldValue.serverTimestamp();
            authUpdates.displayName = updates.displayName;
        }

        // Bio
        if (updates.bio) {
            firestoreUpdates.bio = updates.bio;
            lastChangeDatesUpdates.bio = FieldValue.serverTimestamp();
        }

        // Profil fotoğrafı
        if (updates.photoURL && updates.photoURL.startsWith('data:image')) {
            const storage = getStorage();
            const bucket = storage.bucket();
            const fileName = `profile_images/${uid}_${Date.now()}`;
            const file = bucket.file(fileName);

            const userRecord = await auth.getUser(uid);
            if (userRecord.photoURL) {
                try {
                    const oldFileName = decodeURIComponent(userRecord.photoURL.split('/').pop().split('?')[0]);
                    const oldFile = bucket.file(oldFileName);
                    if (await oldFile.exists()) {
                        await oldFile.delete();
                    }
                } catch (deleteError) {
                    console.warn("Eski profil fotoğrafı silinirken hata:", deleteError.message);
                }
            }

            const base64Data = updates.photoURL.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            
            await file.save(buffer, {
                metadata: {
                    contentType: updates.photoURL.split(';')[0].split(':')[1],
                },
            });

            // Yüklenen resmin herkese açık URL'sini oluşturma
            const newPhotoURL = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
            
            authUpdates.photoURL = newPhotoURL;
            firestoreUpdates.photoURL = newPhotoURL;
            lastChangeDatesUpdates.photoURL = FieldValue.serverTimestamp();
        }

        // Diğer alanlar
        if (updates.email) {
            firestoreUpdates.email = updates.email;
            lastChangeDatesUpdates.email = FieldValue.serverTimestamp();
            authUpdates.email = updates.email;
        }

        if (updates.phone) {
            firestoreUpdates.phone = updates.phone;
            lastChangeDatesUpdates.phone = FieldValue.serverTimestamp();
        }

        // Firebase Auth'u güncelle
        if (Object.keys(authUpdates).length > 0) {
            await auth.updateUser(uid, authUpdates);
        }

        // Firestore'u güncelle
        const finalFirestoreUpdates = { ...firestoreUpdates };
        if (Object.keys(lastChangeDatesUpdates).length > 0) {
            finalFirestoreUpdates.lastChangeDates = {
                ...userDoc.data().lastChangeDates,
                ...lastChangeDatesUpdates
            };
        }

        if (Object.keys(finalFirestoreUpdates).length > 0) {
            await userDocRef.update(finalFirestoreUpdates);
        }

        // Güncellenmiş profili tekrar al
        const updatedUserDoc = await userDocRef.get();
        const updatedUser = updatedUserDoc.data();

        return res.status(200).json({ message: 'Profil başarıyla güncellendi.', profile: updatedUser });

    } catch (error) {
        console.error('Profil güncelleme hatası:', error);
        return res.status(500).json({ error: 'Profil güncellenirken bir hata oluştu.', details: error.message });
    }
};