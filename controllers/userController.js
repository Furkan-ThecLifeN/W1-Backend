// controllers/userController.js

const { auth, db } = require('../config/firebase');
const { isValidUsername } = require('../utils/validators');
const { getStorage } = require('firebase-admin/storage');
const { FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

// Profil güncelleme
exports.updateProfile = async (req, res) => {
    try {
        const { uid } = req.user;
        const updates = req.body;

        if (!uid) {
            return res.status(401).json({ error: 'Yetkisiz erişim.' });
        }

        const userDocRef = db.collection('users').doc(uid);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        }

        const userData = userDoc.data();

        // 15 günlük bekleme süresi kontrolü
        const now = new Date();
        const DURATION_LIMIT_DAYS = 15;

        const checkCooldown = (field) => {
            const lastChange = userData.lastChangeDates?.[field];
            if (lastChange) {
                const lastChangeDate = lastChange.toDate();
                if (now - lastChangeDate < DURATION_LIMIT_DAYS * 24 * 60 * 60 * 1000) {
                    const timeLeft = Math.ceil((DURATION_LIMIT_DAYS * 24 * 60 * 60 * 1000 - (now - lastChangeDate)) / (1000 * 60 * 60 * 24));
                    return `"${field}" alanı, ${timeLeft} gün sonra değiştirilebilir.`;
                }
            }
            return null;
        };

        const firestoreUpdates = {};
        const authUpdates = {};
        const lastChangeDatesUpdates = {};

        // Kullanıcı adı
        if (updates.username && updates.username !== userData.username) {
            const cooldownError = checkCooldown('username');
            if (cooldownError) return res.status(403).json({ error: cooldownError });
            if (!isValidUsername(updates.username)) return res.status(400).json({ error: 'Geçersiz kullanıcı adı formatı.' });
            const usernameSnapshot = await db.collection('users').where('username', '==', updates.username).get();
            if (!usernameSnapshot.empty && usernameSnapshot.docs[0].id !== uid) return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanılıyor.' });
            firestoreUpdates.username = updates.username;
            lastChangeDatesUpdates.username = FieldValue.serverTimestamp();
        }

        // Profil fotoğrafı
        if (updates.photoURL && updates.photoURL.startsWith('data:')) {
            const cooldownError = checkCooldown('photoURL');
            if (cooldownError) return res.status(403).json({ error: cooldownError });
            
            const bucket = getStorage().bucket();
            const filename = `profile_pictures/${uid}/${Date.now()}_profile.jpeg`;
            const file = bucket.file(filename);

            const base64Data = updates.photoURL.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            
            await file.save(buffer, {
                metadata: {
                    contentType: 'image/jpeg'
                },
                public: true
            });

            const photoURL = `https://storage.googleapis.com/${bucket.name}/${filename}`;
            firestoreUpdates.photoURL = photoURL;
            authUpdates.photoURL = photoURL;
            lastChangeDatesUpdates.photoURL = FieldValue.serverTimestamp();
        }

        // Display Name ve Bio
        if (updates.displayName !== undefined && updates.displayName !== userData.displayName) {
            firestoreUpdates.displayName = updates.displayName;
            authUpdates.displayName = updates.displayName;
            lastChangeDatesUpdates.displayName = FieldValue.serverTimestamp();
        }
        
        if (updates.bio !== undefined && updates.bio !== userData.bio) {
            firestoreUpdates.bio = updates.bio;
        }

        // Diğer alanlar
        if (updates.email !== undefined && updates.email !== userData.email) {
            const cooldownError = checkCooldown('email');
            if (cooldownError) return res.status(403).json({ error: cooldownError });
            firestoreUpdates.email = updates.email;
            lastChangeDatesUpdates.email = FieldValue.serverTimestamp();
            authUpdates.email = updates.email;
        }

        if (updates.phone !== undefined && updates.phone !== userData.phone) {
            const cooldownError = checkCooldown('phone');
            if (cooldownError) return res.status(403).json({ error: cooldownError });
            firestoreUpdates.phone = updates.phone;
            lastChangeDatesUpdates.phone = FieldValue.serverTimestamp();
        }

        // ✅ Hesap Tipi Güncelleme
        if (updates.accountType && updates.accountType !== userData.accountType) {
            if (updates.accountType === 'personal' || updates.accountType === 'business') {
                firestoreUpdates.accountType = updates.accountType;
            } else {
                return res.status(400).json({ error: 'Geçersiz hesap türü.' });
            }
        }

        // Şifre güncelleme
        if (updates.password) {
            const cooldownError = checkCooldown('password');
            if (cooldownError) return res.status(403).json({ error: cooldownError });
            await auth.updateUser(uid, { password: updates.password });
            lastChangeDatesUpdates.password = FieldValue.serverTimestamp();
        }

        // Firebase Auth'u güncelle
        if (Object.keys(authUpdates).length > 0) {
            await auth.updateUser(uid, authUpdates);
        }

        // Firestore'u güncelle
        const finalFirestoreUpdates = { ...firestoreUpdates };
        if (Object.keys(lastChangeDatesUpdates).length > 0) {
            finalFirestoreUpdates.lastChangeDates = {
                ...(userDoc.data().lastChangeDates || {}),
                ...lastChangeDatesUpdates
            };
        }

        // Eğer güncelleme yapılacak bir alan varsa Firestore'u güncelle
        if (Object.keys(finalFirestoreUpdates).length > 0) {
            await userDocRef.update(finalFirestoreUpdates);
        }

        // Güncellenmiş profili tekrar al
        const updatedUserDoc = await userDocRef.get();
        const updatedUser = updatedUserDoc.data();

        return res.status(200).json({ message: 'Profil başarıyla güncellendi.', profile: updatedUser });

    } catch (error) {
        console.error('Profil güncelleme hatası:', error);
        return res.status(500).json({ error: `Profil güncellenirken bir hata oluştu. Lütfen tekrar deneyin. Detay: ${error.message}` });
    }
};