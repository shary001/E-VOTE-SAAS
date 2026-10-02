const nodemailer = require("nodemailer");

// Default transport: plain SMTP (works immediately with a Gmail app password —
// no domain verification needed, which matters for a student project). Once
// you own a domain, swap this for Resend/Postmark/etc. for real deliverability;
// the sendMail() call below is the only place that needs to change.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const FROM = process.env.SMTP_FROM || process.env.SMTP_USER;

async function sendVerificationEmail(to, fullName, token, code) {
  const link = `${APP_URL}/verify-email.html?token=${token}&email=${encodeURIComponent(to)}`;
  return sendMail(
    to,
    "Verify your email",
    `<p>Hi ${escapeHtml(fullName)},</p>
     <p>Enter this one-time verification code to activate your account:</p>
     <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escapeHtml(code)}</p>
     <p>Or use the verification link below:</p>
     <p><a href="${link}">${link}</a></p>
     <p>The code expires in 15 minutes. If you didn't request this, ignore this email.</p>`
  );
}

async function sendApplicationDecisionEmail(to, fullName, electionTitle, approved, note) {
  const verb = approved ? "approved" : "not approved";
  return sendMail(
    to,
    `Your candidacy for "${electionTitle}" was ${verb}`,
    `<p>Hi ${escapeHtml(fullName)},</p>
     <p>Your application to run in <strong>${escapeHtml(electionTitle)}</strong> was <strong>${verb}</strong>.</p>
     ${note ? `<p>Reviewer note: ${escapeHtml(note)}</p>` : ""}`
  );
}

async function sendPasswordResetEmail(to, fullName, token) {
  const link = `${APP_URL}/reset-password.html?token=${token}`;
  return sendMail(
    to,
    "Reset your password",
    `<p>Hi ${escapeHtml(fullName)},</p>
     <p>Someone requested a password reset for this account. If that was you:</p>
     <p><a href="${link}">${link}</a></p>
     <p>This link expires in 1 hour. If you didn't request this, you can ignore this email — your password won't change.</p>`
  );
}

async function sendMail(to, subject, html) {
  if (!process.env.SMTP_HOST) {
    // No SMTP configured yet (e.g. first local run) — log instead of throwing,
    // so the rest of the flow (esp. during development) isn't blocked.
    console.log(`[email:skip - no SMTP_HOST set] to=${to} subject="${subject}"`);
    return { skipped: true };
  }
  try {
    return await transporter.sendMail({ from: FROM, to, subject, html });
  } catch (err) {
    // Email is a notification side effect; an SMTP outage must not undo a
    // committed account, application decision, or password-reset request.
    console.error(`[email:error] ${err.message}`);
    return { failed: true };
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

module.exports = { sendVerificationEmail, sendApplicationDecisionEmail, sendPasswordResetEmail };
