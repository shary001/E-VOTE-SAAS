const { pool } = require("../db");

async function logAction(actorUserId, organizationId, action, meta = {}) {
  try {
    await pool.query(
      `insert into audit_log (actor_user_id, organization_id, action, meta)
       values ($1, $2, $3, $4)`,
      [actorUserId || null, organizationId || null, action, meta]
    );
  } catch (err) {
    // Audit logging must never break the request it's attached to.
    console.error("audit log write failed:", err.message);
  }
}

module.exports = { logAction };
