const bcrypt = require("bcryptjs");
const crypto = require("crypto");

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}
function randomOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

module.exports = { hashPassword, checkPassword, randomToken, randomOtp };
