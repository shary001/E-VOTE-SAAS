const rateLimit = require("express-rate-limit");

// Applied only to the endpoints someone could actually abuse: credential
// guessing, mass registration, and email-bombing via resend/forgot-password.
// Keyed by IP (express-rate-limit's default) — fine for a single-instance
// deploy like Render's free tier; if you ever run multiple instances behind
// a load balancer, swap the default memory store for a Redis store instead.

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in a few minutes." },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many accounts created from this network. Try again later." },
});

// Shared by resend-verification and forgot-password — both just "send this
// email again", both equally spammable.
const emailActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes before trying again." },
});

module.exports = { loginLimiter, registerLimiter, emailActionLimiter };
