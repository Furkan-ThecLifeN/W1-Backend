require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const app = express();
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes'); // Yeni eklenen: userRoutes

app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Çok fazla istek. Lütfen 15 dakika sonra tekrar deneyin.'
});
app.use(limiter);

// Kimlik doğrulama ile ilgili rotalar
app.use('/api/auth', authRoutes);

// Kullanıcı işlemleri ile ilgili rotalar (profil güncelleme gibi)
app.use('/api/auth', userRoutes); // Yeni eklenen: userRoutes'i de kullanıyoruz

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server ${PORT} portunda çalışıyor`));