const express = require("express");
const { pool } = require("../db");
const { hashPassword, checkPassword, randomToken, randomOtp } = require("../utils/password");
const { signToken } = require("../utils/jwt");
const { sendVerificationEmail, sendPasswordResetEmail } = require("../utils/email");
const { logAction } = require("../utils/audit");
const { requireAuth } = require("../middleware/auth");
const { loginLimiter, registerLimiter, emailActionLimiter } = require("../middleware/rateLimit");

const router = express.Router();

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Public list of active organizations, for the "join an organization" picker
// on the registration form.
router.get("/organizations", async (req, res) => {
  const { rows } = await pool.query(
    `select id, name, slug from organizations where status = 'active' order by name`
  );
  res.json(rows);
});

// Register either:
//   { mode: "create_org", organization_name, full_name, email, password }
//   { mode: "join_org", organization_id, full_name, email, password }
router.post("/register", registerLimiter, async (req, res) => {
  const { mode, full_name, email, password, organization_name, organization_id } = req.body || {};

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: "Full name, email and password are required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let orgId, role;
    if (mode === "create_org") {
      if (!organization_name || !organization_name.trim()) {
        throw httpError(400, "Organization name is required.");
      }
      const slug = slugify(organization_name) || randomToken().slice(0, 8);
      const orgResult = await client.query(
        `insert into organizations (name, slug, status) values ($1, $2, 'pending') returning id`,
        [organization_name.trim(), slug]
      );
      orgId = orgResult.rows[0].id;
      role = "org_admin";
    } else if (mode === "join_org") {
      if (!organization_id) throw httpError(400, "Choose an organization to join.");
      const orgCheck = await client.query(`select id from organizations where id = $1`, [organization_id]);
      if (!orgCheck.rows.length) throw httpError(400, "That organization doesn't exist.");
      orgId = organization_id;
      role = "member";
    } else {
      throw httpError(400, "mode must be 'create_org' or 'join_org'.");
    }

    const passwordHash = await hashPassword(password);
    const token = randomToken();
    const code = randomOtp();
    const codeHash = await hashPassword(code);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const codeExpires = new Date(Date.now() + 15 * 60 * 1000);

    const userResult = await client.query(
      `insert into users (organization_id, email, password_hash, full_name, role,
                           email_verify_token, email_verify_expires,
                           email_verify_code_hash, email_verify_code_expires)
       values ($1, lower($2), $3, $4, $5, $6, $7, $8, $9)
       returning id, email, full_name, role, organization_id`,
      [orgId, email.trim(), passwordHash, full_name.trim(), role, token, expires, codeHash, codeExpires]
    );

    await client.query("COMMIT");

    const user = userResult.rows[0];
    await sendVerificationEmail(user.email, user.full_name, token, code);
    await logAction(user.id, orgId, mode === "create_org" ? "organization.created" : "user.joined_organization");

    res.status(201).json({
      message: "Account created. Check your email to verify your address before logging in.",
      organization_pending: mode === "create_org",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: "That email is already registered." });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Registration failed. Please try again." });
  } finally {
    client.release();
  }
});

router.get("/verify-email", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Missing token." });

  const { rows } = await pool.query(
    `update users set email_verified = true, email_verify_token = null, email_verify_expires = null
      where email_verify_token = $1 and email_verify_expires > now()
      returning id, email`,
    [token]
  );
  if (!rows.length) {
    return res.status(400).json({ error: "That verification link is invalid or has expired." });
  }
  res.json({ message: "Email verified — you can log in now." });
});

router.post("/verify-email", async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !/^\d{6}$/.test(String(code || ""))) {
    return res.status(400).json({ error: "Email and a six-digit verification code are required." });
  }
  const { rows } = await pool.query(
    `select id, email_verify_code_hash from users
      where email = lower($1) and email_verify_code_expires > now() and email_verified = false`,
    [email]
  );
  if (!rows.length || !(await checkPassword(String(code), rows[0].email_verify_code_hash))) {
    return res.status(400).json({ error: "That verification code is invalid or has expired." });
  }
  await pool.query(
    `update users set email_verified = true, email_verify_token = null, email_verify_expires = null,
            email_verify_code_hash = null, email_verify_code_expires = null where id = $1`,
    [rows[0].id]
  );
  res.json({ message: "Email verified — you can log in now." });
});

router.post("/resend-verification", emailActionLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required." });

  const { rows } = await pool.query(
    `select id, full_name, email_verified from users where email = lower($1)`,
    [email]
  );
  // Same response whether or not the account exists, so this can't be used to
  // enumerate registered emails.
  if (rows.length && !rows[0].email_verified) {
    const token = randomToken();
    const code = randomOtp();
    const codeHash = await hashPassword(code);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const codeExpires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      `update users set email_verify_token = $1, email_verify_expires = $2,
              email_verify_code_hash = $3, email_verify_code_expires = $4 where id = $5`,
      [token, expires, codeHash, codeExpires, rows[0].id]
    );
    await sendVerificationEmail(email, rows[0].full_name, token, code);
  }
  res.json({ message: "If that account exists and isn't verified yet, a new link has been sent." });
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const { rows } = await pool.query(
    `select u.*, o.status as organization_status, o.name as organization_name
       from users u left join organizations o on o.id = u.organization_id
      where u.email = lower($1)`,
    [email]
  );
  const user = rows[0];
  if (!user || !(await checkPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  if (!user.email_verified) {
    return res.status(403).json({ error: "Please verify your email before logging in.", unverified: true });
  }

  const token = signToken(user);
  await logAction(user.id, user.organization_id, "user.logged_in");
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      organization_id: user.organization_id,
      organization_name: user.organization_name,
      organization_status: user.organization_status,
    },
  });
});

router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

router.post("/forgot-password", emailActionLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required." });

  const { rows } = await pool.query(`select id, full_name from users where email = lower($1)`, [email]);
  // Identical response either way — this endpoint must never reveal whether
  // an email is registered.
  if (rows.length) {
    const token = randomToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour — shorter-lived than email verification on purpose
    await pool.query(
      `update users set password_reset_token = $1, password_reset_expires = $2 where id = $3`,
      [token, expires, rows[0].id]
    );
    await sendPasswordResetEmail(email, rows[0].full_name, token);
    await logAction(rows[0].id, null, "user.password_reset_requested");
  }
  res.json({ message: "If that email is registered, a reset link is on its way." });
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: "Token and new password are required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const { rows } = await pool.query(
    `select id from users where password_reset_token = $1 and password_reset_expires > now()`,
    [token]
  );
  if (!rows.length) return res.status(400).json({ error: "That reset link is invalid or has expired." });

  const passwordHash = await hashPassword(password);
  await pool.query(
    `update users set password_hash = $1, password_reset_token = null, password_reset_expires = null where id = $2`,
    [passwordHash, rows[0].id]
  );
  await logAction(rows[0].id, null, "user.password_reset_completed");
  res.json({ message: "Password updated — you can log in now." });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Current password and new password are required." });
  }
  if (new_password.length < 12) {
    return res.status(400).json({ error: "New password must be at least 12 characters." });
  }
  const { rows } = await pool.query(`select password_hash from users where id = $1`, [req.user.id]);
  if (!rows.length || !(await checkPassword(current_password, rows[0].password_hash))) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  await pool.query(`update users set password_hash = $1 where id = $2`, [await hashPassword(new_password), req.user.id]);
  await logAction(req.user.id, req.user.organization_id, "user.password_changed");
  res.json({ message: "Password changed. Sign in again with your new password." });
});

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = router;
