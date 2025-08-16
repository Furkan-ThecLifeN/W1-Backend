require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const requestIp = require('request-ip');
const useragent = require('express-useragent');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  'https://w1-fawn.vercel.app'
];

app.use(helmet());
app.use(express.json());
app.use(requestIp.mw());
app.use(useragent.express());

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      callback(new Error(`CORS policy: ${origin} erişime izin verilmedi`), false);
    }
  },
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests. Please try again after 15 minutes.'
});
app.use(limiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes); // Rota ismi daha mantıklı hale getirildi

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server ${PORT} portunda çalışıyor`));