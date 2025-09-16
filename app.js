// app.js (ana dosya)

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const requestIp = require("request-ip");
const useragent = require("express-useragent");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const messageRoutes = require("./routes/messageRoutes");
const feedsRoutes = require("./routes/feedsRoutes");
const feelingsRoutes = require("./routes/feelingsRoutes");
const postRoutes = require("./routes/postRoutes");
const actionsBtnRoutes = require("./routes/actionsBtnRoutes"); // ✅ Bu, "Feelings" (tweetler) için kullanılan rota
const postsActionsBtnRoutes = require("./routes/postsActionsBtnRoutes"); // ✅ Bu, "Posts" için yeni rota

const { startDeletionJob } = require("./cronJob");

const app = express();

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

app.use("/uploads", express.static(uploadsDir));

const allowedOrigins = ["http://localhost:3000", "https://w1-fawn.vercel.app"];

app.use(helmet());
app.use(express.json());
app.use(requestIp.mw());
app.use(useragent.express());

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        callback(
          new Error(`CORS policy: ${origin} erişime izin verilmedi`),
          false
        );
      }
    },
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests. Please try again after 15 minutes.",
});
app.use(limiter);

// ✅ Route tanımlamaları
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/feeds", feedsRoutes);
app.use("/api/feelings", feelingsRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/posts", postsActionsBtnRoutes); // Posts işlemleri için
app.use("/api/actions", actionsBtnRoutes); // Feelings işlemleri için
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("API çalışıyor!");
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
  startDeletionJob();
});