// src/utils/mediaHelpers.js

exports.getYouTubeEmbedUrl = (url) => {
  if (!url) {
    return null;
  }
  
  // YouTube video ID'sini bulmak için regex
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/shorts\/|youtu\.be\/)([^&?]+)/;
  const match = url.match(regex);
  
  if (match && match[1]) {
    const videoId = match[1];
    return `https://www.youtube.com/embed/${videoId}`;
  }
  
  return null;
};