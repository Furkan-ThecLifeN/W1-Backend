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

        if (updates.username && updates.username !== userData.username) {
            const cooldownError = checkCooldown('username');
            if (cooldownError) return res.status(403).json({ error: cooldownError });
            if (!isValidUsername(updates.username)) return res.status(400).json({ error: 'Geçersiz kullanıcı adı formatı.' });
            const usernameSnapshot = await db.collection('users').where('username', '==', updates.username).get();
            if (!usernameSnapshot.empty && usernameSnapshot.docs[0].id !== uid) return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanılıyor.' });
            firestoreUpdates.username = updates.username;
            lastChangeDatesUpdates.username = FieldValue.serverTimestamp();
        }

        if (updates.photoURL && updates.photoURL.startsWith('data:')) {
            const cooldownError = checkCooldown('photoURL');
            if (cooldownError) return res.status(403).json({ error: cooldownError });
            const bucket = getStorage().bucket();
            const filename = `profile_pictures/${uid}/${Date.now()}_profile.jpeg`;
            const file = bucket.file(filename);
            const base64Data = updates.photoURL.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await file.save(buffer, { metadata: { contentType: 'image/jpeg' }, public: true });
            const photoURL = `https://storage.googleapis.com/${bucket.name}/${filename}`;
            firestoreUpdates.photoURL = photoURL;
            authUpdates.photoURL = photoURL;
            lastChangeDatesUpdates.photoURL = FieldValue.serverTimestamp();
        }

        if (updates.displayName !== undefined && updates.displayName !== userData.displayName) {
            firestoreUpdates.displayName = updates.displayName;
            authUpdates.displayName = updates.displayName;
            lastChangeDatesUpdates.displayName = FieldValue.serverTimestamp();
        }
        
        if (updates.bio !== undefined && updates.bio !== userData.bio) {
            firestoreUpdates.bio = updates.bio;
        }

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

        if (updates.accountType && updates.accountType !== userData.accountType) {
            if (updates.accountType === 'personal' || updates.accountType === 'business') {
                firestoreUpdates.accountType = updates.accountType;
            } else {
                return res.status(400).json({ error: 'Geçersiz hesap türü.' });
            }
        }

        if (updates.password) {
            const cooldownError = checkCooldown('password');
            if (cooldownError) return res.status(403).json({ error: cooldownError });
            await auth.updateUser(uid, { password: updates.password });
            lastChangeDatesUpdates.password = FieldValue.serverTimestamp();
        }

        if (Object.keys(authUpdates).length > 0) {
            await auth.updateUser(uid, authUpdates);
        }

        const finalFirestoreUpdates = { ...firestoreUpdates };
        if (Object.keys(lastChangeDatesUpdates).length > 0) {
            finalFirestoreUpdates.lastChangeDates = {
                ...(userDoc.data().lastChangeDates || {}),
                ...lastChangeDatesUpdates
            };
        }

        if (Object.keys(finalFirestoreUpdates).length > 0) {
            await userDocRef.update(finalFirestoreUpdates);
        }

        const updatedUserDoc = await userDocRef.get();
        const updatedUser = updatedUserDoc.data();

        return res.status(200).json({ message: 'Profil başarıyla güncellendi.', profile: updatedUser });

    } catch (error) {
        console.error('Profil güncelleme hatası:', error);
        return res.status(500).json({ error: `Profil güncellenirken bir hata oluştu. Lütfen tekrar deneyin. Detay: ${error.message}` });
    }
};

// ✅ GÜNCELLENDİ: Cihaz ve Konum Bilgilerini Kaydetme
exports.saveLoginDevice = async (req, res) => {
    try {
        const { uid } = req.user;
        const ip = req.clientIp || 'Bilinmiyor';
        const userAgentInfo = req.useragent;
        let location = 'Konum Bilinmiyor';

        if (ip && ip !== 'Bilinmiyor') {
            try {
                const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=city,country,status`);
                const geoData = await geoRes.json();
                if (geoData.status === 'success') {
                    location = `${geoData.city}, ${geoData.country}`;
                }
            } catch (geoError) {
                console.error('Konum servisine erişirken hata:', geoError);
            }
        }

        let deviceType = 'Bilinmeyen Cihaz';
        if (userAgentInfo.isDesktop) {
            deviceType = 'Bilgisayar';
        } else if (userAgentInfo.isMobile) {
            deviceType = 'Mobil';
        } else if (userAgentInfo.isTablet) {
            deviceType = 'Tablet';
        }

        const browserName = userAgentInfo.browser || 'Bilinmeyen Tarayıcı';
        const osName = userAgentInfo.os || 'Bilinmeyen OS';
        
        if (!uid) {
            return res.status(401).json({ error: 'Yetkisiz erişim.' });
        }

        const deviceData = {
            ip,
            device: deviceType,
            browser: browserName,
            os: osName,
            location: location, 
            loggedInAt: FieldValue.serverTimestamp()
        };

        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.collection('devices').add(deviceData);
        
        return res.status(200).json({ message: 'Cihaz bilgileri başarıyla kaydedildi.' });

    } catch (error) {
        console.error('Cihaz kaydetme hatası:', error);
        return res.status(500).json({ error: 'Cihaz bilgileri kaydedilirken hata oluştu.', details: error.message });
    }
};

// ✅ GÜNCELLENDİ: Cihazları çekme
exports.getLoginDevices = async (req, res) => {
    try {
        const { uid } = req.user;
        const devicesSnapshot = await db.collection('users').doc(uid).collection('devices').orderBy('loggedInAt', 'desc').get();

        const devices = devicesSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id
            };
        });

        return res.status(200).json({ devices });

    } catch (error) {
        console.error('Cihaz geçmişi alınırken hata:', error);
        return res.status(500).json({ error: 'Cihaz geçmişi alınamadı.', details: error.message });
    }
};


// Cihaz bilgilerini kaydetme
exports.saveLoginDevice = async (req, res) => {
    try {
        const { uid } = req.user;
        
        // request-ip ve express-useragent'den gelen verileri kullan
        const ip = req.clientIp || 'Bilinmiyor';
        const userAgentInfo = req.useragent;

        // Basitleştirilmiş cihaz ve tarayıcı bilgileri
        let deviceType = 'Bilinmeyen Cihaz';
        if (userAgentInfo.isDesktop) {
            deviceType = 'Bilgisayar';
        } else if (userAgentInfo.isMobile) {
            deviceType = 'Mobil';
        } else if (userAgentInfo.isTablet) {
            deviceType = 'Tablet';
        }

        const browserName = userAgentInfo.browser || 'Bilinmeyen Tarayıcı';
        const osName = userAgentInfo.os || 'Bilinmeyen OS';
        
        if (!uid) {
            return res.status(401).json({ error: 'Yetkisiz erişim.' });
        }

        const deviceData = {
            ip,
            device: deviceType,
            browser: browserName,
            os: osName,
            loggedInAt: FieldValue.serverTimestamp()
        };

        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.collection('devices').add(deviceData);
        
        return res.status(200).json({ message: 'Cihaz bilgileri başarıyla kaydedildi.' });

    } catch (error) {
        console.error('Cihaz kaydetme hatası:', error);
        return res.status(500).json({ error: 'Cihaz bilgileri kaydedilirken hata oluştu.', details: error.message });
    }
};

// Giriş yapılan cihazları getirme
exports.getLoginDevices = async (req, res) => {
    try {
        const { uid } = req.user;

        const devicesSnapshot = await db.collection('loginHistory')
            .where('userId', '==', uid)
            .orderBy('timestamp', 'desc')
            .get();

        const devices = devicesSnapshot.docs.map(doc => {
            const data = doc.data();
            const timestamp = data.timestamp && data.timestamp.toDate
                ? data.timestamp.toDate()
                : null;
            
            return {
                ...data,
                id: doc.id,
                timestamp: timestamp
            };
        });

        return res.status(200).json({ devices });

    } catch (error) {
        console.error('Cihaz geçmişi alınırken hata:', error);
        return res.status(500).json({ error: `Cihaz geçmişi alınırken bir hata oluştu. Detay: ${error.message}` });
    }
};