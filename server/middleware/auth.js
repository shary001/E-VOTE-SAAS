const { verifyToken } = require("../utils/jwt");
const { pool } = require("../db");

// Attaches req.user from the bearer token. Re-reads a couple of fields from
// the DB (not just the token payload) so a suspended org or a role change
// takes effect immediately instead of waiting out a 7-day-old JWT.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated." });

  try {
    const payload = verifyToken(token);
    const { rows } = await pool.query(
      `select u.id, u.email, u.full_name, u.role, u.organization_id, u.email_verified, u.created_at,
              o.status as organization_status
         from users u
         left join organizations o on o.id = u.organization_id
        where u.id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: "Account no longer exists." });
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have access to this." });
    }
    next();
  };
}

function requireVerifiedEmail(req, res, next) {
  if (!req.user.email_verified) {
    return res.status(403).json({ error: "Please verify your email first." });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireVerifiedEmail };
