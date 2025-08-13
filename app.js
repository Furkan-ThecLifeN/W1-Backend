require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

// ✅ İzin verilen frontend adresleri (hem local hem Vercel)
const allowedOrigins = [
  'http://localhost:3000',           // Local geliştirme
  'https://w1-fawn.vercel.app'       // Vercel domain
];

// ✅ Helmet güvenlik ayarları
app.use(helmet());

// ✅ JSON parser
app.use(express.json());

// ✅ Gelişmiş CORS ayarı
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Postman gibi originsiz istekleri kabul et
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error(`CORS policy: ${origin} erişime izin verilmedi`), false);
    }
  },
  credentials: true
}));

// ✅ Rate limit (DDOS önleme)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Çok fazla istek. Lütfen 15 dakika sonra tekrar deneyin.'
});
app.use(limiter);

// ✅ Rotalar
app.use('/api/auth', authRoutes);
app.use('/api/auth', userRoutes); // Kullanıcı işlemleri

// ✅ Sunucu başlatma
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server ${PORT} portunda çalışıyor`));
