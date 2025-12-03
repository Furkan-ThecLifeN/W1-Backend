// controllers/authController.js
const { auth, db } = require("../config/firebase");
const {
  isValidEmail,
  isValidUsername,
  isValidPassword,
} = require("../utils/validators");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");
const { serverTimestamp, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const fetch = require("node-fetch");
const userController = require("./userController");

require("dotenv").config();

// Nodemailer Transporter Ayarları
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Google OAuth2Client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- YENİ YARDIMCI FONKSİYONLAR BURAYA EKLENDİ ---

// 6 haneli rastgele bir kod üretir
const generateResetCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Kod içeren şifre sıfırlama e-postasını gönderir
const sendResetCodeEmail = async (email, code) => {
  const mailOptions = {
    // Gmail hesabınız (w1globalmailbox@gmail.com)
    from: `W1 Destek <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "W1 Şifre SıfırlAMA Kodunuz",
    html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <p>Merhaba,</p>
            <p>W1 hesabınız için bir şifre sıfırlama talebi aldık.</p>
            <p>Aşağıdaki kodu kullanarak şifrenizi sıfırlayabilirsiniz. Bu kod <strong>10 dakika</strong> geçerlidir.</p>
            <h2 style="font-size: 28px; letter-spacing: 3px; text-align: center; margin: 25px 0; padding: 10px; background-color: #f4f4f4; border-radius: 5px;">
                ${code}
            </h2>
            <p>Eğer bu talebi siz yapmadıysanız, bu e-postayı görmezden gelebilirsiniz.</p>
            <p>İyi günler,<br>W1 Ekibi</p>
        </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Şifre sıfırlama kodu gönderildi: ${email}`);
  } catch (error) {
    console.error("Şifre sıfırlama kodu e-postası gönderilirken hata:", error);
    // Hata oluşsa bile dışarıya yansıtmıyoruz ki kullanıcı e-postanın varlığını anlayamasın.
  }
};

// --- MEVCUT YARDIMCI FONKSİYONLARINIZ (DEĞİŞMEDİ) ---

// Hoş geldin e-postası
const sendWelcomeEmail = async (email, username) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "W1'e Hoş Geldiniz!",
    html: `
            <p>Merhaba ${username},</p>
            <p>W1 ailesine katıldığınız için teşekkür ederiz. Artık platformun tüm özelliklerinden yararlanabilirsiniz.</p>
            <p>Keyifli vakitler dileriz.</p>
            <p>W1 Ekibi</p>
        `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Hoş geldin e-postası gönderildi.");
  } catch (error) {
    console.error("Hoş geldin e-postası gönderilirken hata:", error);
  }
};

// Silme Talebi E-postası
const sendDeletionEmail = async (email) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "W1 Hesap Silme Talebi Onayı",
    html: `
            <p>Merhaba,</p>
            <p>W1 hesabınız için kalıcı silme talebiniz alınmıştır. Hesabınız 15 gün içinde kalıcı olarak silinecektir.</p>
            <p>Bu işlemi iptal etmek için, 15 gün içinde hesabınıza tekrar giriş yapmanız yeterlidir.</p>
            <p>İyi günler dileriz.</p>
            <p>W1 Ekibi</p>
        `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Hesap silme talebi e-postası gönderildi.");
  } catch (error) {
    console.error("Hesap silme e-postası gönderilirken hata:", error);
  }
};

// Silme İptal E-postası
const sendDeletionCanceledEmail = async (email) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "W1 Hesap Silme İptal Edildi",
    html: `
            <p>Merhaba,</p>
            <p>W1 hesabınız için başlattığınız kalıcı silme işlemi, hesabınıza tekrar giriş yapmanız nedeniyle iptal edilmiştir.</p>
            <p>Hesabınızın verileri korunmaya devam etmektedir.</p>
            <p>İyi günler dileriz.</p>
            <p>W1 Ekibi</p>
        `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Hesap silme iptal e-postası gönderildi.");
  } catch (error) {
    console.error("Hesap silme iptal e-postası gönderilirken hata:", error);
  }
};

// Hesabı Kurtarma
exports.cancelAccountDeletion = async (uid) => {
  try {
    await db.collection("users").doc(uid).update({
      isPendingDeletion: FieldValue.delete(),
      pendingDeletionDate: FieldValue.delete(),
      deletionReason: FieldValue.delete(),
    });
    console.log(`Hesap silme işlemi iptal edildi: ${uid}`);
  } catch (error) {
    console.error("Hesap kurtarma hatası:", error);
  }
};

// Kullanıcı Kaydı
exports.registerUser = async (req, res) => {
  const {
    email,
    password,
    username,
    firstName,
    lastName,
    displayName: reqDisplayName,
    photoURL,
    phoneNumber,
    ...otherFields
  } = req.body;

  // Temel alan kontrolü
  if (!email || !password || !username) {
    return res
      .status(400)
      .json({ error: "E-posta, şifre ve kullanıcı adı gerekli." });
  }

  // Email, username ve password validasyonu
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Geçersiz e-posta formatı." });
  }
  if (!isValidUsername(username)) {
    return res.status(400).json({
      error:
        "Kullanıcı adı en az 3, en fazla 24 karakter olmalı ve sadece harf, rakam ve alt çizgi içerebilir.",
    });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({
      error:
        "Şifre en az 8 karakter olmalı, en az bir büyük harf, bir küçük harf, bir rakam ve bir özel karakter içermelidir.",
    });
  }

  try {
    // Username kontrolü
    const usernameExists = await db
      .collection("users")
      .where("username", "==", username)
      .get();
    if (!usernameExists.empty) {
      return res
        .status(409)
        .json({ error: "Bu kullanıcı adı zaten kullanılıyor." });
    }

    // DisplayName oluşturma: öncelik req.body.displayName, sonra firstName+lastName, yoksa username
    const displayName =
      reqDisplayName ||
      (firstName && lastName ? `${firstName} ${lastName}` : username);

    // Firebase Auth kaydı
    const userRecord = await auth.createUser({
      email,
      password,
      displayName,
      phoneNumber: phoneNumber || undefined,
      photoURL: photoURL || undefined,
    });

    const uid = userRecord.uid;

    // Firestore kullanıcı profili
    const userProfile = {
      uid,
      email: userRecord.email,
      username,
      displayName,
      photoURL:
        photoURL ||
        "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png",
      bio: "",
      familySystem: null,
      accountType: "personal",
      isPrivate: false,
      isFrozen: false,
      createdAt: FieldValue.serverTimestamp(),
      stats: {
        posts: 0,
        rta: 0,
        followers: 0,
        following: 0,
      },
      lastChangeDates: {
        username: FieldValue.serverTimestamp(),
        email: FieldValue.serverTimestamp(),
        password: FieldValue.serverTimestamp(),
      },
      privacySettings: {
        messages: "everyone",
        storyReplies: true,
      },
      notificationSettings: {
        email: true,
        push: true,
        follows: true,
        likes: true,
        comments: true,
        messages: true,
      },
      ...otherFields,
    };

    await db.collection("users").doc(uid).set(userProfile);

    res.status(201).json({ uid, message: "Kullanıcı başarıyla kaydedildi" });
  } catch (error) {
    console.error("Kayıt hatası:", error);
    res.status(500).json({ error: "Sunucu hatası: " + error.message });
  }
};

// YENİ VE GÜVENİLİR GİRİŞ FONKSİYONU
exports.login = async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res
      .status(400)
      .json({ error: "E-posta/Kullanıcı adı ve şifre gerekli." });
  }

  let userEmail;
  let uid;
  let userRecord;

  // --- Adım 1: E-posta adresini çözme (Identifier -> Email) ---
  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(identifier)) {
      userEmail = identifier;
      console.log(`[Login] Adım 1: E-posta ile giriş denemesi: ${userEmail}`);
    } else {
      console.log(
        `[Login] Adım 1: Kullanıcı adı ile giriş denemesi: ${identifier}`
      );
      const usernameSnapshot = await db
        .collection("users")
        .where("username", "==", identifier)
        .limit(1)
        .get();

      if (usernameSnapshot.empty) {
        // GÜVENLİK NOTU: "Kullanıcı bulunamadı" demek yerine, şifre yanlışmış gibi
        // davranmak "user enumeration" saldırılarını engeller.
        console.log(
          `[Login] Adım 1 HATA: Kullanıcı adı bulunamadı: ${identifier}`
        );
        return res.status(403).json({ error: "Geçersiz kimlik bilgileri." });
      }
      userEmail = usernameSnapshot.docs[0].data().email;
      uid = usernameSnapshot.docs[0].data().uid;
      console.log(
        `[Login] Adım 1 BAŞARILI: Kullanıcı adı çözüldü: ${identifier} -> ${userEmail}`
      );
    }
  } catch (err) {
    console.error("[Login] Adım 1 KRİTİK HATA (DB Query):", err);
    return res
      .status(500)
      .json({ error: "Giriş sırasında sunucu hatası (Adım 1)." });
  }

  // --- Adım 2: Firebase Auth'da kullanıcının varlığını doğrulama ---
  try {
    // Eğer UID'yi username aramasından almadıysak, email ile alalım.
    if (uid) {
      userRecord = await auth.getUser(uid); // UID varsa bu daha hızlı.
    } else {
      userRecord = await auth.getUserByEmail(userEmail);
      uid = userRecord.uid; // UID'yi buradan al
    }

    if (userRecord.disabled) {
      console.log(`[Login] Adım 2 HATA: Hesap dondurulmuş: ${userEmail}`);
      return res.status(403).json({ error: "Bu hesap dondurulmuştur." });
    }
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      console.log(
        `[Login] Adım 2 HATA: Kullanıcı Auth'da bulunamadı: ${userEmail}`
      );
    } else {
      console.error("[Login] Adım 2 KRİTİK HATA (Auth Query):", error);
    }
    // Sebep ne olursa olsun, kullanıcıya standart hatayı dön
    return res.status(403).json({ error: "Geçersiz kimlik bilgileri." });
  }

  // --- Adım 3: Şifre Doğrulama (Firebase REST API) ---
  let data;
  try {
    // !!! EN ÖNEMLİ DÜZELTME BURADA !!!
    // Diğer fonksiyonda (requestAccountDeletion) 'REACT_APP_FIREBASE_API_KEY' kullanmışsınız.
    // Tutarlılık için burada da onu kullanıyoruz.
    const apiKey = process.env.REACT_APP_FIREBASE_API_KEY;

    if (!apiKey) {
      // Bu log Render'da görünürse, sorun %100 budur.
      console.error(
        "!!!! [Login] Adım 3 KRİTİK HATA !!!!: REACT_APP_FIREBASE_API_KEY environment değişkeni bulunamadı. Render.com'da bu değişkeni tanımladınız mı?"
      );
      return res
        .status(500)
        .json({ error: "Sunucu yapılandırma hatası: API Key eksik." });
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userEmail,
        password,
        returnSecureToken: true,
      }),
    });

    data = await response.json();

    // Hata kontrolü 'response.ok' ile yapılır.
    if (!response.ok) {
      // Firebase'den gelen asıl hata mesajını (INVALID_LOGIN_CREDENTIALS) sunucu loguna yazdır.
      const errorMessage = data.error
        ? data.error.message
        : "Bilinmeyen API hatası";
      console.error(
        `[Login] Adım 3 HATA: Firebase REST API hatası (${userEmail}): ${errorMessage}`
      );
      // Gelen hata kodu ne olursa olsun, kullanıcıya her zaman "Geçersiz kimlik bilgileri" dön.
      return res.status(403).json({ error: "Geçersiz kimlik bilgileri." });
    }


  } catch (err) {
    console.error("[Login] Adım 3 KRİTİK HATA (Fetch):", err);
    return res
      .status(500)
      .json({ error: "Giriş sırasında sunucu hatası (Adım 3)." });
  }

  // --- Adım 4: Başarılı Giriş İşlemleri (Cihaz Kaydı ve Token Oluşturma) ---
  try {
    // Cihaz kaydetme
    await db
      .collection("users")
      .doc(uid)
      .collection("loginDevices")
      .add({
        ipAddress: req.clientIp || null,
        userAgent: req.useragent.source || null,
        lastLogin: FieldValue.serverTimestamp(),
      });
    console.log(`[Login] Adım 4: Cihaz kaydedildi: ${uid}`);

    // Custom token oluştur
    const customToken = await auth.createCustomToken(uid);

    // Eğer hesap silinme beklemedeyse, iptal et
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists && userDoc.data().isPendingDeletion) {
      console.log(
        `[Login] Silinme beklemesindeki hesap giriş yaptı. İptal ediliyor: ${userEmail}`
      );
      // 'this' yerine 'exports' kullanarak aynı dosyadaki diğer fonksiyonu çağır
      await exports.cancelAccountDeletion(uid);
      await sendDeletionCanceledEmail(userEmail); // Bu fonksiyon aynı dosyada tanımlı
    }

    // Her şey tamamsa, token'ı kullanıcıya gönder
    return res.status(200).json({ token: customToken });
  } catch (err) {
    console.error("[Login] Adım 4 KRİTİK HATA (Token/DB):", err);
    return res
      .status(500)
      .json({ error: "Giriş sonrası işlem hatası (Adım 4)." });
  }
};

// Tanımlayıcıyı (email/username) çözme
exports.resolveUserIdentifier = async (req, res) => {
  const { identifier } = req.body;
  if (!identifier)
    return res.status(400).json({ error: "Tanımlayıcı sağlanamadı." });

  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(identifier)) {
      try {
        await auth.getUserByEmail(identifier);
        return res.status(200).json({ email: identifier });
      } catch (error) {
        if (error.code === "auth/user-not-found")
          return res.status(404).json({ error: "Kullanıcı bulunamadı." });
        throw error;
      }
    }

    const usernameSnapshot = await db
      .collection("users")
      .where("username", "==", identifier)
      .limit(1)
      .get();
    if (!usernameSnapshot.empty)
      return res
        .status(200)
        .json({ email: usernameSnapshot.docs[0].data().email });
    return res.status(404).json({ error: "Kullanıcı adı bulunamadı." });
  } catch (error) {
    console.error("Tanımlayıcı çözümleme hatası:", error);
    return res.status(500).json({
      error: "Tanımlayıcı çözümlenirken hata oluştu.",
      details: error.message,
    });
  }
};

// Profil görüntüleme
exports.getProfile = async (req, res) => {
  try {
    const { uid } = req.user; // verifyToken middleware'i ile gelen uid
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "Kullanıcı profili bulunamadı." });
    }

    return res.status(200).json({ profile: userDoc.data() });
  } catch (error) {
    console.error("Profil getirme hatası:", error);
    return res.status(500).json({
      error: "Profil alınırken bir hata oluştu.",
      details: error.message,
    });
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
    const {
      sub: googleId,
      email,
      name: displayName,
      picture: photoURL,
    } = payload;

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        const username =
          email.split("@")[0] + Math.random().toString(36).substring(2, 5);

        const usernameExists = await db
          .collection("users")
          .where("username", "==", username)
          .get();
        if (!usernameExists.empty) {
          username =
            email.split("@")[0] + Math.random().toString(36).substring(2, 8);
        }

        userRecord = await auth.createUser({
          email,
          displayName,
          photoURL,
          emailVerified: true,
        });

        const userProfile = {
          uid: userRecord.uid,
          email: userRecord.email,
          username: username,
          displayName: displayName || username,
          photoURL:
            photoURL ||
            "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png",
          bio: "",
          familySystem: null,
          accountType: "personal",
          isPrivate: false,
          isFrozen: false,
          createdAt: FieldValue.serverTimestamp(), // Bu satırı değiştirin
          stats: {
            posts: 0,
            rta: 0,
            followers: 0,
            following: 0,
          },
          lastChangeDates: {
            username: FieldValue.serverTimestamp(), // Bunu da değiştirin
            email: FieldValue.serverTimestamp(), // Bunu da değiştirin
            password: FieldValue.serverTimestamp(), // Bunu da değiştirin
          },
          privacySettings: {
            messages: "everyone",
            storyReplies: true,
          },
          notificationSettings: {
            email: true,
            push: true,
            follows: true,
            likes: true,
            comments: true,
            messages: true,
          },
        };
        await db.collection("users").doc(userRecord.uid).set(userProfile);
        await sendWelcomeEmail(email, displayName || username);
      } else {
        throw error;
      }
    }

    if (userRecord.disabled) {
      console.log(
        `Google girişi ile dondurulmuş hesap algılandı. Yeniden aktif ediliyor: ${userRecord.email}`
      );
      await getAuth().updateUser(userRecord.uid, { disabled: false });
      await db
        .collection("users")
        .doc(userRecord.uid)
        .update({ isFrozen: false });
    }

    // GÜNCELLEME: Eğer hesap silinme beklemedeyse, işlemi iptal et
    const userDoc = await db.collection("users").doc(userRecord.uid).get();
    if (userDoc.exists && userDoc.data().isPendingDeletion) {
      console.log(
        `Silinme beklemesindeki hesap tekrar Google ile giriş yaptı. Silme işlemi iptal ediliyor: ${userRecord.email}`
      );
      await this.cancelAccountDeletion(userRecord.uid);
      await sendDeletionCanceledEmail(userRecord.email);
    }

    // Başarılı girişten sonra cihaz bilgilerini kaydet
    const ipAddress = req.clientIp;
    const userAgentString = req.useragent.source;
    await userController.saveLoginDevice(
      userRecord.uid,
      ipAddress,
      userAgentString
    );

    const customToken = await auth.createCustomToken(userRecord.uid);
    const userProfile = (
      await db.collection("users").doc(userRecord.uid).get()
    ).data();

    return res.status(200).json({
      message: "Google ile giriş başarılı.",
      user: {
        uid: userRecord.uid,
        displayName: userRecord.displayName,
        email: userRecord.email,
        photoURL: userRecord.photoURL,
      },
      token: customToken,
    });
  } catch (error) {
    console.error("Google ile giriş hatası:", error);
    return res.status(500).json({
      error: "Google ile giriş sırasında bir hata oluştu.",
      details: error.message,
    });
  }
};

// --- GÜNCELLENEN ROUTE FONKSİYONU ---

// Şifre sıfırlama (Adım 1: Kod Gönderme)
// Bu fonksiyon, Firebase'in 'generatePasswordResetLink' metodunun yerini alıyor.
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "E-posta adresi gerekli." });
  }

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      // Güvenlik gereği (User Enumeration önlemi):
      // Kullanıcı bulunamasa bile, sanki e-posta gönderilmiş gibi davranıyoruz.
      // Sadece konsola logluyoruz.
      console.log(`Şifre sıfırlama talebi: Kullanıcı bulunamadı (${email})`);
      return res
        .status(200)
        .json({
          message:
            "Eğer e-posta adresi sistemimizde kayıtlıysa, bir sıfırlama kodu gönderildi.",
        });
    }
    console.error("Kullanıcı arama hatası:", error);
    return res.status(500).json({ error: "İşlem sırasında bir hata oluştu." });
  }

  // Kullanıcı bulundu, şimdi kod üretiyoruz.
  const code = generateResetCode();
  // Kodu 10 dakika geçerli olacak şekilde ayarlıyoruz.
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
    // Kodu ve son kullanma tarihini Firestore'a (yeni bir koleksiyona) kaydediyoruz.
    // Bu, hangi kullanıcının hangi kodu ne zamana kadar kullanabileceğini takip etmemizi sağlar.
    await db.collection("passwordResets").doc(userRecord.uid).set({
      email: userRecord.email,
      code: code,
      expiresAt: expiresAt,
    });

    // E-postayı gönder
    await sendResetCodeEmail(userRecord.email, code);

    // Başarılı yanıt (kullanıcı bulunamasa da aynı yanıtı veriyoruz)
    return res
      .status(200)
      .json({
        message:
          "Eğer e-posta adresi sistemimizde kayıtlıysa, bir sıfırlama kodu gönderildi.",
      });
  } catch (error) {
    console.error("Şifre sıfırlama (kod kaydetme/mail) hatası:", error);
    return res
      .status(500)
      .json({ error: "Sıfırlama kodu gönderilirken bir hata oluştu." });
  }
};

// --- YENİ ROUTE FONKSİYONU ---

// Şifre Sıfırlama (Adım 2: Kodu Doğrulama ve Yeni Şifre Belirleme)
exports.resetPasswordWithCode = async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return res
      .status(400)
      .json({ error: "E-posta, kod ve yeni şifre gereklidir." });
  }

  // Yeni şifrenin kurallarınıza uyup uymadığını kontrol ediyoruz.
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({
      error:
        "Şifre en az 8 karakter olmalı, en az bir büyük harf, bir küçük harf, bir rakam ve bir özel karakter içermelidir.",
    });
  }

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (error) {
    // Kullanıcı yoksa, kodun veya e-postanın geçersiz olduğunu belirtiyoruz.
    return res
      .status(404)
      .json({ error: "Geçersiz e-posta veya sıfırlama kodu." });
  }

  try {
    // Firestore'dan bu kullanıcı için kaydedilmiş sıfırlama belgesini al
    const resetDocRef = db.collection("passwordResets").doc(userRecord.uid);
    const resetDoc = await resetDocRef.get();

    if (!resetDoc.exists) {
      return res
        .status(400)
        .json({ error: "Geçersiz veya süresi dolmuş sıfırlama kodu." });
    }

    const { code: storedCode, expiresAt } = resetDoc.data();

    // 1. Kodu kontrol et
    if (storedCode !== code) {
      return res.status(400).json({ error: "Geçersiz sıfırlama kodu." });
    }

    // 2. Süresini kontrol et
    if (new Date() > expiresAt.toDate()) {
      await resetDocRef.delete(); // Süresi dolmuş kodu sil
      return res
        .status(400)
        .json({
          error:
            "Sıfırlama kodunun süresi dolmuş. Lütfen yeni bir kod isteyin.",
        });
    }

    // Her şey yolunda: Şifreyi Firebase Auth'da güncelle
    await auth.updateUser(userRecord.uid, { password: newPassword });

    // Kodu sil (tek kullanımlık olmalı)
    await resetDocRef.delete();

    // (İsteğe bağlı) Şifrenin değiştiğine dair bir onay e-postası gönderilebilir.

    return res.status(200).json({ message: "Şifreniz başarıyla güncellendi." });
  } catch (error) {
    console.error("Şifre sıfırlama (kod doğrulama) hatası:", error);
    return res
      .status(500)
      .json({ error: "Şifre sıfırlanırken bir hata oluştu." });
  }
};

// ✅ GÜNCELLEME: Hesabı Silme İşlemi Başlatma
exports.requestAccountDeletion = async (req, res) => {
  const { password, reason } = req.body;
  const { uid } = req.user;

  if (!password) {
    return res.status(400).json({ error: "Şifrenizi girmek zorunludur." });
  }

  try {
    const userRecord = await getAuth().getUser(uid);

    // Firebase REST API kullanarak şifre doğrulaması yap
    const apiKey = process.env.REACT_APP_FIREBASE_API_KEY;
    if (!apiKey) {
      console.error(
        "REACT_APP_FIREBASE_API_KEY environment değişkeni tanımlı değil."
      );
      return res.status(500).json({ error: "Sunucu yapılandırma hatası." });
    }

    const restApiUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
    const restApiResponse = await fetch(restApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userRecord.email,
        password,
        returnSecureToken: true,
      }),
    });

    if (!restApiResponse.ok) {
      // Şifre yanlışsa bu blok çalışır
      return res.status(401).json({ error: "Girilen şifre yanlış." });
    }

    // Kullanıcı hesabını "silinme beklemede" olarak işaretle
    await db
      .collection("users")
      .doc(uid)
      .update({
        isPendingDeletion: true,
        pendingDeletionDate: FieldValue.serverTimestamp(),
        deletionReason: reason || null,
        // ✅ SİLİNDİ: Hata veren 'deletionLog' satırı kaldırıldı.
      });

    // Tüm mevcut oturumları iptal et
    await getAuth().revokeRefreshTokens(uid);

    // Kullanıcıya bilgilendirme e-postası gönder
    // await sendDeletionEmail(userRecord.email);

    return res.status(200).json({
      message:
        "Hesabınız silinmek üzere işaretlendi. Bu süre içinde tekrar giriş yaparak işlemi iptal edebilirsiniz.",
    });
  } catch (error) {
    console.error("Hesap silme isteği hatası:", error);
    return res.status(500).json({
      error: "Hesap silme isteği sırasında bir hata oluştu.",
      details: error.message,
    });
  }
};

// ✅ YENİ: Tüm cihazlardaki oturumları sonlandırma
exports.logoutAllDevices = async (req, res) => {
  const { uid } = req.user; // Token'dan gelen kullanıcı kimliği
  try {
    await getAuth().revokeRefreshTokens(uid);

    // Kullanıcıya isteğe bağlı bilgilendirme e-postası gönderilebilir.
    // const userRecord = await getAuth().getUser(uid);
    // await sendLogoutAllEmail(userRecord.email);

    // Güvenlik logu tutma
    console.log(
      `[LOGOUT_ALL] Kullanıcı ${uid} tüm cihazlardaki oturumlarını sonlandırdı. Tarih: ${new Date()}`
    );

    return res.status(200).json({
      message: "Tüm cihazlardaki oturumlarınız başarıyla kapatıldı.",
    });
  } catch (error) {
    console.error("Tüm cihazlardan çıkış hatası:", error);
    return res.status(500).json({
      error: "Tüm cihazlardan çıkış yapılırken bir hata oluştu.",
      details: error.message,
    });
  }
};
