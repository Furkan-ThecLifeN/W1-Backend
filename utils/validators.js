// backend/utils/validators.js

exports.isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

exports.isValidUsername = (username) => {
  const usernameRegex = /^[a-z0-9_.]{3,15}$/;
  return usernameRegex.test(username);
};

exports.isValidPassword = (password) => {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+{}\[\]:;<>,.?~\\-]).{8,}$/;
  return passwordRegex.test(password);
};
