// controllers/authController.js

const { auth, db } = require('../config/firebase');
const { isValidEmail, isValidUsername, isValidPassword } = require('../utils/validators');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
// Firestore ve Storage'ı direkt firebase-admin paketinden alıyoruz
const { getDoc, serverTimestamp } = require('firebase-admin/firestore'); 

require('dotenv').config();

// Nodemailer Transporter Ayarları
let transporter = nodemailer.createTransport({
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
    let mailOptions = {
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
        console.log(`Hoş geldin e-postası ${email} adresine başarıyla gönderildi.`);
    } catch (error) {
        console.error(`Hoş geldin e-postası gönderilirken hata:`, error.message);
        throw new Error(`E-posta gönderilemedi: ${error.message}`);
    }
};

// Kullanıcı kayıt
exports.registerUser = async (req, res) => {
    const { email, username, displayName, password, confirmPassword } = req.body;

    if (!isValidEmail(email)) return res.status(400).json({ error: 'Geçersiz email formatı.' });
    if (!isValidUsername(username)) return res.status(400).json({ error: 'Geçersiz kullanıcı adı formatı.' });
    if (!isValidPassword(password)) return res.status(400).json({ error: 'Şifre kriterleri sağlanmadı.' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'Şifreler eşleşmiyor.' });

    try {
        const usernameSnapshot = await db.collection('users').where('username', '==', username).get();
        if (!usernameSnapshot.empty) return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });

        try {
            await auth.getUserByEmail(email);
            return res.status(409).json({ error: 'Bu e-posta adresi zaten kullanılıyor.' });
        } catch (firebaseErr) {
            if (firebaseErr.code !== 'auth/user-not-found') throw firebaseErr;
        }

        const userRecord = await auth.createUser({
            email,
            password,
            displayName: displayName || username
        });

        const userProfile = {
            uid: userRecord.uid,
            email: userRecord.email,
            username,
            displayName: displayName || username,
            createdAt: new Date(),
        };

        await db.collection('users').doc(userRecord.uid).set(userProfile);
        await sendWelcomeEmail(userRecord.email, userProfile.displayName);

        return res.status(201).json({ message: 'Kayıt başarılı! Şimdi giriş yapabilirsiniz.' });

    } catch (error) {
        console.error('Kayıt sırasında hata:', error);
        if (error.code === 'auth/email-already-in-use') return res.status(409).json({ error: 'Bu e-posta adresi zaten kullanılıyor.' });
        return res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu.', details: error.message });
    }
};

// Google ile giriş
exports.googleSignIn = async (req, res) => {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Google ID Token gerekli.' });

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        const googleEmail = payload['email'];
        const googleUid = payload['sub'];
        const googleDisplayName = payload['name'];
        const googlePhotoUrl = payload['picture'];

        let firebaseUser;
        try {
            firebaseUser = await auth.getUserByEmail(googleEmail);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                firebaseUser = await auth.createUser({
                    uid: googleUid,
                    email: googleEmail,
                    displayName: googleDisplayName,
                    photoURL: googlePhotoUrl,
                    emailVerified: true
                });

                await db.collection('users').doc(firebaseUser.uid).set({
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    username: googleEmail.split('@')[0],
                    displayName: firebaseUser.displayName,
                    photoURL: googlePhotoUrl,
                    createdAt: new Date(),
                    isEmailVerified: true
                });

                await sendWelcomeEmail(googleEmail, googleDisplayName);
            } else throw error;
        }

        const firebaseToken = await auth.createCustomToken(firebaseUser.uid);

        return res.status(200).json({
            message: 'Google ile giriş başarılı.',
            token: firebaseToken,
            user: {
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
                emailVerified: firebaseUser.emailVerified
            }
        });

    } catch (error) {
        console.error('Google giriş hatası:', error);
        return res.status(500).json({ error: 'Google ile giriş sırasında bir hata oluştu.', details: error.message });
    }
};

// Tanımlayıcı çözümleme
exports.resolveUserIdentifier = async (req, res) => {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Tanımlayıcı boş bırakılamaz.' });

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
    } catch (err) {
        return res.status(500).json({ error: 'Profil alınırken hata oluştu.', details: err.message });
    }
};