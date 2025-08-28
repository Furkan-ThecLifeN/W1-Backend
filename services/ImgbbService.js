// services/ImgbbService.js

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const imgbbApiUrl = "https://api.imgbb.com/1/upload";

const uploadToImgbb = async (filePath, apiKey) => {
  const formData = new FormData();
  formData.append("key", apiKey);
  formData.append("image", fs.createReadStream(filePath));
  // Tek kullanımlık görüntüleme için expiration'ı "once" olarak ayarlayın
  formData.append("expiration", "once");

  try {
    const response = await axios.post(imgbbApiUrl, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    if (response.data.success) {
      return response.data.data.url;
    } else {
      throw new Error("Imgbb yükleme hatası: " + response.data.error.message);
    }
  } catch (error) {
    console.error("Imgbb API hatası:", error.response ? error.response.data : error.message);
    throw new Error("Imgbb'ye dosya yüklenirken bir hata oluştu.");
  }
};

module.exports = { uploadToImgbb };