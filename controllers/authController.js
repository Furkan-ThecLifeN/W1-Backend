// authController.js

const { auth, db } = require('../config/firebase');
const { isValidEmail, isValidUsername, isValidPassword } = require('../utils/validators');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');

require('dotenv').config();

// Nodemailer Transporter Ayarları
let transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Google OAuth2Client (Frontend'den gelen ID Token'ı doğrulamak için)
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Yardımcı fonksiyon: Kayıt sonrası hoş geldin e-postası gönder
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
    console.log(`Backend: Hoş geldin e-postası ${email} adresine başarıyla gönderildi.`);
  } catch (error) {
    console.error(`Backend: Hoş geldin e-postası ${email} adresine gönderilirken hata:`, error.message);
    throw new Error(`E-posta gönderilemedi: ${error.message}`);
  }
};

exports.registerUser = async (req, res) => {
  const { email, username, displayName, password, confirmPassword } = req.body;

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Geçersiz email formatı.' });
  }
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Geçersiz kullanıcı adı formatı. Sadece küçük harf, rakam, alt çizgi (_) ve nokta (.) kullanılabilir, 3-15 karakter olmalıdır.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Şifre en az 8 karakter, 1 büyük harf, 1 küçük harf, 1 rakam ve 1 özel karakter içermelidir.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Şifreler eşleşmiyor.' });
  }

  try {
    // Kullanıcı adı ve e-posta kontrolü
    const usernameSnapshot = await db.collection('users').where('username', '==', username).get();
    if (!usernameSnapshot.empty) {
      return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
    }
    try {
      await auth.getUserByEmail(email);
      return res.status(409).json({ error: 'Bu e-posta adresi zaten kullanılıyor.' });
    } catch (firebaseErr) {
      if (firebaseErr.code !== 'auth/user-not-found') {
        throw firebaseErr;
      }
    }

    // Firebase Auth ile kullanıcı oluşturma
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: displayName || username,
      // OTP akışı olmadığı için emailVerified varsayılan olarak false kalır
    });

    // Firestore'da kullanıcı profili oluşturma
    const userProfile = {
      uid: userRecord.uid,
      email: userRecord.email,
      username,
      displayName: displayName || username,
      createdAt: new Date(),
    };
    await db.collection('users').doc(userRecord.uid).set(userProfile);

    // Başarılı kayıt sonrası hoş geldin e-postası gönder
    await sendWelcomeEmail(userRecord.email, userProfile.displayName);

    return res.status(201).json({ message: 'Kayıt başarılı! Şimdi giriş yapabilirsiniz.' });
  } catch (error) {
    console.error('Backend: Kayıt sırasında hata oluştu:', error);
    if (error.code === 'auth/email-already-in-use') {
      return res.status(409).json({ error: 'Bu e-posta adresi zaten kullanılıyor.' });
    }
    return res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu.', details: error.message });
  }
};

// --- OTP ile ilgili fonksiyonlar silindi ---

exports.googleSignIn = async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'Google ID Token gerekli.' });
  }

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
        
        await sendWelcomeEmail(googleEmail, googleDisplayName); // Google ile kayıt sonrası da hoş geldin e-postası gönder
      } else {
        throw error;
      }
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
    console.error('Backend: Google ile giriş sırasında hata oluştu:', error);
    return res.status(500).json({ error: 'Google ile giriş sırasında bir hata oluştu.', details: error.message });
  }
};

exports.resolveUserIdentifier = async (req, res) => {
  const { identifier } = req.body;

  if (!identifier) {
    return res.status(400).json({ error: 'Tanımlayıcı boş bırakılamaz.' });
  }

  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(identifier)) {
      try {
        await auth.getUserByEmail(identifier);
        return res.status(200).json({ email: identifier });
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        }
        throw error;
      }
    }

    const usernameSnapshot = await db.collection('users').where('username', '==', identifier).limit(1).get();
    if (!usernameSnapshot.empty) {
      const userDoc = usernameSnapshot.docs[0].data();
      return res.status(200).json({ email: userDoc.email });
    } else {
      return res.status(404).json({ error: 'Kullanıcı adı bulunamadı.' });
    }
  } catch (error) {
    console.error('Backend: Tanımlayıcı çözümleme hatası:', error);
    return res.status(500).json({ error: 'Tanımlayıcı çözümlenirken bir hata oluştu.', details: error.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const { uid } = req.user;
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Kullanıcı profili bulunamadı.' });
    }

    return res.status(200).json({ profile: userDoc.data() });
  } catch (err) {
    return res.status(500).json({ error: 'Profil alınırken bir hata oluştu.', details: err.message });
  }
};