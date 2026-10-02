const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET;
if (!SECRET && process.env.NODE_ENV !== "test") {
  throw new Error("JWT_SECRET must be set outside test mode.");
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      organization_id: user.organization_id,
      email: user.email,
    },
    SECRET || "dev-only-insecure-secret",
    { expiresIn: process.env.JWT_EXPIRES_IN || "2h" }
  );
}

function verifyToken(token) {
  return jwt.verify(token, SECRET || "dev-only-insecure-secret");
}

module.exports = { signToken, verifyToken };
