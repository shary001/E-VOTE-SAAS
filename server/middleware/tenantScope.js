const { pool } = require("../db");

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Loads the election named by :electionId and makes sure it belongs to the
// caller's organization before any handler touches it. Super admins bypass
// the org check (they're allowed to look, never to run elections).
function tenantScopeElection() {
  return async (req, res, next) => {
    const { electionId } = req.params;
    if (!electionId || !UUID_REGEX.test(electionId)) {
      return res.status(404).json({ error: "Election not found." });
    }
    const { rows } = await pool.query(
      `select e.*, o.status as organization_status, o.name as organization_name
         from elections e join organizations o on o.id = e.organization_id
        where e.id = $1`,
      [electionId]
    );
    if (!rows.length) return res.status(404).json({ error: "Election not found." });
    const election = rows[0];

    if (req.user.role !== "super_admin" && election.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: "That election isn't part of your organization." });
    }
    req.election = election;
    next();
  };
}

module.exports = { tenantScopeElection };
