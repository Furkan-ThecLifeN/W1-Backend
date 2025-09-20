function getPostLink(targetType, targetId) {
  const baseUrl = process.env.APP_URL || "https://yourapp.com";

  switch (targetType) {
    case "post":
      return `${baseUrl}/post/${targetId}`;
    case "feed":
      return `${baseUrl}/feed/${targetId}`;
    case "feeling":
      return `${baseUrl}/feeling/${targetId}`;
    default:
      throw new Error("Geçersiz targetType");
  }
}

module.exports = getPostLink;
