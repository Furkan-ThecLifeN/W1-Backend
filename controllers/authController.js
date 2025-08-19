// controllers/authController.js

const { auth, db } = require('../config/firebase');
const { isValidEmail, isValidUsername, isValidPassword } = require('../utils/validators');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const { serverTimestamp, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const fetch = require('node-fetch');
const userController = require('./userController');

require('dotenv').config();

// Nodemailer Transporter Ayarları
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Google OAuth2Client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Hoş geldin e-postası
const sendWelcomeEmail = async (email, username) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'W1\'e Hoş Geldiniz!',
        html: `
            <p>Merhaba ${username},</p>
            <p>W1 ailesine katıldığınız için teşekkür ederiz. Artık platformun tüm özelliklerinden yararlanabilirsiniz.</p>
            <p>Keyifli vakitler dileriz.</p>
            <p>W1 Ekibi</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Hoş geldin e-postası gönderildi.');
    } catch (error) {
        console.error('Hoş geldin e-postası gönderilirken hata:', error);
    }
};

// Silme Talebi E-postası
const sendDeletionEmail = async (email) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'W1 Hesap Silme Talebi Onayı',
        html: `
            <p>Merhaba,</p>
            <p>W1 hesabınız için kalıcı silme talebiniz alınmıştır. Hesabınız 15 gün içinde kalıcı olarak silinecektir.</p>
            <p>Bu işlemi iptal etmek için, 15 gün içinde hesabınıza tekrar giriş yapmanız yeterlidir.</p>
            <p>İyi günler dileriz.</p>
            <p>W1 Ekibi</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Hesap silme talebi e-postası gönderildi.');
    } catch (error) {
        console.error('Hesap silme e-postası gönderilirken hata:', error);
    }
};

// Silme İptal E-postası
const sendDeletionCanceledEmail = async (email) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'W1 Hesap Silme İptal Edildi',
        html: `
            <p>Merhaba,</p>
            <p>W1 hesabınız için başlattığınız kalıcı silme işlemi, hesabınıza tekrar giriş yapmanız nedeniyle iptal edilmiştir.</p>
            <p>Hesabınızın verileri korunmaya devam etmektedir.</p>
            <p>İyi günler dileriz.</p>
            <p>W1 Ekibi</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Hesap silme iptal e-postası gönderildi.');
    } catch (error) {
        console.error('Hesap silme iptal e-postası gönderilirken hata:', error);
    }
};

// Hesabı Kurtarma
exports.cancelAccountDeletion = async (uid) => {
    try {
        await db.collection('users').doc(uid).update({
            isPendingDeletion: FieldValue.delete(),
            pendingDeletionDate: FieldValue.delete(),
            deletionReason: FieldValue.delete()
        });
        console.log(`Hesap silme işlemi iptal edildi: ${uid}`);
    } catch (error) {
        console.error('Hesap kurtarma hatası:', error);
    }
};

// Kullanıcı Kaydı
exports.registerUser = async (req, res) => {
    const { email, password, username, displayName } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ error: 'E-posta, şifre ve kullanıcı adı gerekli.' });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Geçersiz e-posta formatı.' });
    }

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'Kullanıcı adı en az 3, en fazla 15 karakter olmalı ve sadece harf, rakam ve alt çizgi içerebilir.' });
    }

    if (!isValidPassword(password)) {
        return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı, en az bir büyük harf, bir küçük harf, bir rakam ve bir özel karakter içermelidir.' });
    }

    try {
        const usernameExists = await db.collection('users').where('username', '==', username).get();
        if (!usernameExists.empty) {
            return res.status(409).json({ error: 'Bu kullanıcı adı zaten kullanılıyor.' });
        }

        const userRecord = await auth.createUser({
            email: email,
            password: password,
            displayName: displayName || username
        });

        const userProfile = {
            uid: userRecord.uid,
            email: userRecord.email,
            username: username,
            displayName: displayName || username,
            photoURL: 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png',
            bio: '',
            familySystem: null,
            accountType: 'personal',
            isFrozen: false,
            createdAt: serverTimestamp(),
            stats: {
                posts: 0,
                rta: 0,
                followers: 0,
                following: 0,
            },
            lastChangeDates: {
                username: serverTimestamp(),
                email: serverTimestamp(),
                password: serverTimestamp(),
            },
        };
        await db.collection('users').doc(userRecord.uid).set(userProfile);

        await sendWelcomeEmail(email, username);

        return res.status(201).json({
            message: 'Kullanıcı başarıyla kaydedildi.',
            user: { uid: userRecord.uid, email: userRecord.email }
        });

    } catch (error) {
        console.error('Kayıt hatası:', error);
        if (error.code === 'auth/email-already-in-use') {
            return res.status(409).json({ error: 'Bu e-posta adresi zaten kullanılıyor.' });
        }
        return res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu.', details: error.message });
    }
};

// Kullanıcı Girişi
exports.login = async (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ error: 'E-posta/Kullanıcı adı ve şifre gerekli.' });
    }

    let userEmail;

    try {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(identifier)) {
            userEmail = identifier;
        } else {
            const usernameSnapshot = await db.collection('users').where('username', '==', identifier).limit(1).get();
            if (usernameSnapshot.empty) {
                return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
            }
            userEmail = usernameSnapshot.docs[0].data().email;
        }

        const userRecord = await getAuth().getUserByEmail(userEmail);

        // Firebase REST API ile şifre doğrulaması
        const apiKey = process.env.REACT_APP_REACT_APP_FIREBASE_API_KEY;
        const restApiUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
        const restApiResponse = await fetch(restApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail, password, returnSecureToken: true }),
        });

        const restApiData = await restApiResponse.json();

        if (!restApiResponse.ok) {
            if (restApiData.error && (restApiData.error.message === 'INVALID_PASSWORD' || restApiData.error.message === 'EMAIL_NOT_FOUND')) {
                return res.status(403).json({ error: 'Geçersiz email veya şifre.' });
            }
            throw new Error(restApiData.error.message);
        }

        // Eğer kullanıcı dondurulmuşsa, aktif hale getir
        if (userRecord.disabled) {
            console.log(`Dondurulmuş hesap algılandı. Yeniden aktif ediliyor: ${userRecord.email}`);
            await getAuth().updateUser(userRecord.uid, { disabled: false });
            await db.collection('users').doc(userRecord.uid).update({ isFrozen: false });
        }

        // ✅ GÜNCELLEME: Eğer hesap silinme beklemedeyse, işlemi iptal et
        const userDoc = await db.collection('users').doc(userRecord.uid).get();
        if (userDoc.exists && userDoc.data().isPendingDeletion) {
            console.log(`Silinme beklemesindeki hesap tekrar giriş yaptı. Silme işlemi iptal ediliyor: ${userRecord.email}`);
            await this.cancelAccountDeletion(userRecord.uid);
            await sendDeletionCanceledEmail(userRecord.email);
        }

        // Başarılı girişten sonra cihaz bilgilerini kaydet
        const ipAddress = req.clientIp;
        const userAgentString = req.useragent.source;
        await userController.saveLoginDevice(userRecord.uid, ipAddress, userAgentString);

        // Custom token oluşturma
        const customToken = await getAuth().createCustomToken(userRecord.uid);
        
        return res.status(200).json({ token: customToken });

    } catch (error) {
        console.error('Giriş sırasında hata:', error);
        if (error.code === 'auth/user-not-found') {
            return res.status(403).json({ error: 'Geçersiz email veya şifre.' });
        }
        return res.status(500).json({ error: 'Giriş sırasında bir hata oluştu.', details: error.message });
    }
};

// Tanımlayıcıyı (email/username) çözme
exports.resolveUserIdentifier = async (req, res) => {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Tanımlayıcı sağlanamadı.' });

    try {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(identifier)) {
            try {
                await auth.getUserByEmail(identifier);
                return res.status(200).json({ email: identifier });
            } catch (error) {
                if (error.code === 'auth/user-not-found') return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
                throw error;
            }
        }

        const usernameSnapshot = await db.collection('users').where('username', '==', identifier).limit(1).get();
        if (!usernameSnapshot.empty) return res.status(200).json({ email: usernameSnapshot.docs[0].data().email });
        return res.status(404).json({ error: 'Kullanıcı adı bulunamadı.' });

    } catch (error) {
        console.error('Tanımlayıcı çözümleme hatası:', error);
        return res.status(500).json({ error: 'Tanımlayıcı çözümlenirken hata oluştu.', details: error.message });
    }
};

// Profil görüntüleme
exports.getProfile = async (req, res) => {
    try {
        const { uid } = req.user;
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Kullanıcı profili bulunamadı.' });
        return res.status(200).json({ profile: userDoc.data() });
    } catch (error) {
        console.error('Profil getirme hatası:', error);
        return res.status(500).json({ error: 'Profil alınırken bir hata oluştu.', details: error.message });
    }
};

// Google ile Giriş
exports.googleSignIn = async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({ error: "Google ID token'ı gerekli." });
    }

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { sub: googleId, email, name: displayName, picture: photoURL } = payload;

        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(email);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                const username = email.split('@')[0] + Math.random().toString(36).substring(2, 5);
                
                const usernameExists = await db.collection('users').where('username', '==', username).get();
                if (!usernameExists.empty) {
                    username = email.split('@')[0] + Math.random().toString(36).substring(2, 8);
                }

                userRecord = await auth.createUser({
                    email,
                    displayName,
                    photoURL,
                    emailVerified: true
                });

                const userProfile = {
                    uid: userRecord.uid,
                    email: userRecord.email,
                    username: username,
                    displayName: displayName || username,
                    photoURL: photoURL || 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png',
                    bio: '',
                    familySystem: null,
                    accountType: 'personal',
                    isFrozen: false,
                    createdAt: serverTimestamp(),
                    stats: {
                        posts: 0,
                        rta: 0,
                        followers: 0,
                        following: 0,
                    },
                    lastChangeDates: {
                        username: serverTimestamp(),
                        email: serverTimestamp(),
                        password: serverTimestamp(),
                    },
                };
                await db.collection('users').doc(userRecord.uid).set(userProfile);
                await sendWelcomeEmail(email, displayName || username);

            } else {
                throw error;
            }
        }
        
        if (userRecord.disabled) {
            console.log(`Google girişi ile dondurulmuş hesap algılandı. Yeniden aktif ediliyor: ${userRecord.email}`);
            await getAuth().updateUser(userRecord.uid, { disabled: false });
            await db.collection('users').doc(userRecord.uid).update({ isFrozen: false });
        }

        // GÜNCELLEME: Eğer hesap silinme beklemedeyse, işlemi iptal et
        const userDoc = await db.collection('users').doc(userRecord.uid).get();
        if (userDoc.exists && userDoc.data().isPendingDeletion) {
            console.log(`Silinme beklemesindeki hesap tekrar Google ile giriş yaptı. Silme işlemi iptal ediliyor: ${userRecord.email}`);
            await this.cancelAccountDeletion(userRecord.uid);
            await sendDeletionCanceledEmail(userRecord.email);
        }

        // Başarılı girişten sonra cihaz bilgilerini kaydet
        const ipAddress = req.clientIp;
        const userAgentString = req.useragent.source;
        await userController.saveLoginDevice(userRecord.uid, ipAddress, userAgentString);

        const customToken = await auth.createCustomToken(userRecord.uid);
        const userProfile = (await db.collection('users').doc(userRecord.uid).get()).data();

        return res.status(200).json({
            message: 'Google ile giriş başarılı.',
            user: {
                uid: userRecord.uid,
                displayName: userRecord.displayName,
                email: userRecord.email,
                photoURL: userRecord.photoURL,
            },
            token: customToken
        });

    } catch (error) {
        console.error('Google ile giriş hatası:', error);
        return res.status(500).json({ error: 'Google ile giriş sırasında bir hata oluştu.', details: error.message });
    }
};

// Şifre sıfırlama
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'E-posta adresi gerekli.' });
    }

    try {
        await auth.generatePasswordResetLink(email);
        res.status(200).json({ message: 'Şifre sıfırlama e-postası başarıyla gönderildi.' });
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            return res.status(404).json({ error: 'Bu e-posta adresine kayıtlı bir kullanıcı bulunamadı.' });
        }
        console.error('Şifre sıfırlama hatası:', error);
        return res.status(500).json({ error: 'Şifre sıfırlama sırasında bir hata oluştu.' });
    }
};

// ✅ GÜNCELLEME: Hesabı Silme İşlemi Başlatma
exports.requestAccountDeletion = async (req, res) => {
    const { password, reason } = req.body;
    const { uid } = req.user;

    if (!password) {
        return res.status(400).json({ error: 'Şifrenizi girmek zorunludur.' });
    }

    try {
        const userRecord = await getAuth().getUser(uid);

        // Firebase REST API kullanarak şifre doğrulaması yap
        const apiKey = process.env.REACT_APP_FIREBASE_API_KEY;
        if (!apiKey) {
            console.error("REACT_APP_FIREBASE_API_KEY environment değişkeni tanımlı değil.");
            return res.status(500).json({ error: "Sunucu yapılandırma hatası." });
        }
        
        const restApiUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
        const restApiResponse = await fetch(restApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userRecord.email, password, returnSecureToken: true }),
        });

        if (!restApiResponse.ok) {
            // Şifre yanlışsa bu blok çalışır
            return res.status(401).json({ error: 'Girilen şifre yanlış.' });
        }
        
        // Kullanıcı hesabını "silinme beklemede" olarak işaretle
        await db.collection('users').doc(uid).update({
            isPendingDeletion: true,
            pendingDeletionDate: FieldValue.serverTimestamp(),
            deletionReason: reason || null
            // ✅ SİLİNDİ: Hata veren 'deletionLog' satırı kaldırıldı.
        });

        // Tüm mevcut oturumları iptal et
        await getAuth().revokeRefreshTokens(uid);

        // Kullanıcıya bilgilendirme e-postası gönder
        // await sendDeletionEmail(userRecord.email);

        return res.status(200).json({
            message: 'Hesabınız silinmek üzere işaretlendi. Bu süre içinde tekrar giriş yaparak işlemi iptal edebilirsiniz.'
        });

    } catch (error) {
        console.error('Hesap silme isteği hatası:', error);
        return res.status(500).json({ error: 'Hesap silme isteği sırasında bir hata oluştu.', details: error.message });
    }
};
