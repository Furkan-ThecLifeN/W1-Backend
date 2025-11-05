// app.js (ana dosya)

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const requestIp = require("request-ip");
const useragent = require("express-useragent");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const verifyFirebaseToken = require("./middlewares/auth");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const messageRoutes = require("./routes/messageRoutes");
const feedsRoutes = require("./routes/feedsRoutes");
const feelingsRoutes = require("./routes/feelingsRoutes");
const postRoutes = require("./routes/postRoutes");
const actionsBtnRoutes = require("./routes/actionsBtnRoutes");
const reportRoutes = require("./routes/reportRoutes");

const { batchActionsController } = require("./routes/batchActions");
const { startDeletionJob } = require("./cronJob");

const app = express();

// ✅ HATA ÇÖZÜMÜ: Render.com'da express-rate-limit'in
// düzgün çalışması için proxy'e güven.
app.set('trust proxy', 1);

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

app.use("/uploads", express.static(uploadsDir));

// ✅ İzin verilen adresler (sizin listeniz)
const allowedOrigins = [
  "http://localhost:3000",
  "https://w1-fawn.vercel.app/"
];

app.use(helmet());
app.use(express.json());
app.use(requestIp.mw());
app.use(useragent.express());

// ✅ CORS ayarları (sizin mantığınız + syntax düzeltmesi)
app.use(
  cors({
    origin: function (origin, callback) {
      // !origin (Postman, curl vb. istekler için)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        // Düzeltme: Hata mesajı için backtick (`) kullanıldı
        callback(
          new Error(`CORS policy: ${origin} erişime izin verilmedi`),
          false
        );
      }
    },
    credentials: true,
  })
);

// ✅ Route tanımlamaları
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/feeds", feedsRoutes);
app.use("/api/feelings", feelingsRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/actions", actionsBtnRoutes);
app.use("/api/reports", reportRoutes);

// ✅ Batch endpoint ayrıca bağla
app.post("/api/actions/batch", verifyFirebaseToken, batchActionsController);

app.use(express.static("public"));

// ✅ Root route
app.get("/", (req, res) => {
  res.send("API çalışıyor!");
});

// ✅ Server başlatma
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  // Düzeltme: Konsol log'u için backtick (`) kullanıldı
  console.log(`Server ${PORT} portunda çalışıyor`);
  startDeletionJob();
});