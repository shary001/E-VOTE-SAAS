const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { toCsv } = require("../utils/csv");

const router = express.Router();
router.use(requireAuth, requireRole("org_admin"));

// Comprehensive overview metrics for organization dashboard
router.get("/overview", async (req, res) => {
  const orgId = req.user.organization_id;

  const [orgRes, electionsRes, applicationsRes, rosterRes, ballotsRes] = await Promise.all([
    pool.query(`select id, name, slug, status, created_at from organizations where id = $1`, [orgId]),
    pool.query(`select status, count(*)::int as count from elections where organization_id = $1 group by status`, [orgId]),
    pool.query(`
      select ca.status, count(*)::int as count
        from candidate_applications ca
        join elections e on e.id = ca.election_id
       where e.organization_id = $1
       group by ca.status
    `, [orgId]),
    pool.query(`
      select
        count(*)::int as total_members,
        count(*) filter (where role = 'candidate')::int as candidate_count,
        count(*) filter (where role = 'member')::int as voter_count,
        count(*) filter (where email_verified = true)::int as verified_count
      from users
      where organization_id = $1
    `, [orgId]),
    pool.query(`
      select count(vbi.id)::int as total_ballots
        from voter_ballots_issued vbi
        join elections e on e.id = vbi.election_id
       where e.organization_id = $1
    `, [orgId]),
  ]);

  const org = orgRes.rows[0];
  const electionCounts = Object.fromEntries(electionsRes.rows.map(r => [r.status, r.count]));
  const applicationCounts = Object.fromEntries(applicationsRes.rows.map(r => [r.status, r.count]));
  const roster = rosterRes.rows[0] || { total_members: 0, candidate_count: 0, voter_count: 0, verified_count: 0 };

  res.json({
    organization: org,
    elections: {
      total: Object.values(electionCounts).reduce((a, b) => a + b, 0),
      draft: electionCounts.draft || 0,
      accepting_applications: electionCounts.accepting_applications || 0,
      voting_open: electionCounts.voting_open || 0,
      closed: electionCounts.closed || 0,
    },
    applications: {
      pending: applicationCounts.pending || 0,
      approved: applicationCounts.approved || 0,
      rejected: applicationCounts.rejected || 0,
    },
    roster,
    total_ballots_cast: ballotsRes.rows[0]?.total_ballots || 0,
  });
});

// The whole org roster with roles and candidacies
router.get("/roster", async (req, res) => {
  const { rows } = await pool.query(
    `select u.id, u.full_name, u.email, u.role, u.email_verified, u.created_at,
            (select count(*) from candidate_applications ca
              where ca.user_id = u.id and ca.status = 'approved') as approved_candidacies
       from users u
      where u.organization_id = $1
      order by u.full_name asc`,
    [req.user.organization_id]
  );
  res.json(rows);
});

// Export organization roster as CSV
router.get("/export/roster", async (req, res) => {
  const { rows } = await pool.query(
    `select u.id, u.full_name, u.email, u.role, u.email_verified, u.created_at,
            (select count(*) from candidate_applications ca
              where ca.user_id = u.id and ca.status = 'approved') as approved_candidacies
       from users u
      where u.organization_id = $1
      order by u.full_name asc`,
    [req.user.organization_id]
  );

  const columns = [
    { key: "id", label: "User ID" },
    { key: "full_name", label: "Full Name" },
    { key: "email", label: "Email" },
    { key: "role", label: "Role" },
    { key: "email_verified", label: "Email Verified" },
    { key: "approved_candidacies", label: "Approved Candidacies" },
    { key: "created_at", label: "Joined Date" },
  ];

  const csv = toCsv(columns, rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="roster-${Date.now()}.csv"`);
  res.send(csv);
});

const { hashPassword } = require("../utils/password");
const { logAction } = require("../utils/audit");

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Create a new member / voter / admin in this organization
router.post("/members", async (req, res) => {
  const { full_name, email, password, role } = req.body || {};
  if (!full_name || !full_name.trim()) return res.status(400).json({ error: "Full name is required." });
  if (!email || !email.trim()) return res.status(400).json({ error: "Email is required." });
  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters long." });

  const validRoles = ["member", "candidate", "org_admin"];
  const memberRole = role && validRoles.includes(role) ? role : "member";

  const existing = await pool.query("select id from users where email = $1", [email.toLowerCase().trim()]);
  if (existing.rows.length) return res.status(409).json({ error: "Email is already registered." });

  const passwordHash = await hashPassword(password);

  const { rows } = await pool.query(
    `insert into users (organization_id, full_name, email, password_hash, role, email_verified)
     values ($1, $2, $3, $4, $5, true)
     returning id, organization_id, full_name, email, role, email_verified, created_at`,
    [req.user.organization_id, full_name.trim(), email.toLowerCase().trim(), passwordHash, memberRole]
  );

  await logAction(req.user.id, req.user.organization_id, "member.created_by_orgadmin", {
    member_id: rows[0].id,
    email: rows[0].email,
    role: rows[0].role,
  });

  res.status(201).json(rows[0]);
});

// Update an existing member in this organization
router.patch("/members/:id", async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: "Member not found." });
  const { full_name, email, role, password } = req.body || {};

  const userRes = await pool.query(
    "select * from users where id = $1 and organization_id = $2",
    [req.params.id, req.user.organization_id]
  );
  if (!userRes.rows.length) return res.status(404).json({ error: "Member not found in your organization." });
  const targetUser = userRes.rows[0];

  const updates = [];
  const values = [];

  if (full_name && full_name.trim()) {
    values.push(full_name.trim());
    updates.push(`full_name = $${values.length}`);
  }

  if (email && email.trim() && email.toLowerCase().trim() !== targetUser.email) {
    const cleanEmail = email.toLowerCase().trim();
    const existing = await pool.query("select id from users where email = $1 and id != $2", [cleanEmail, req.params.id]);
    if (existing.rows.length) return res.status(409).json({ error: "Email is already taken by another account." });
    values.push(cleanEmail);
    updates.push(`email = $${values.length}`);
  }

  if (role) {
    const validRoles = ["member", "candidate", "org_admin"];
    if (!validRoles.includes(role)) return res.status(400).json({ error: `role must be one of: ${validRoles.join(", ")}` });
    values.push(role);
    updates.push(`role = $${values.length}`);
  }

  if (password && password.trim()) {
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters long." });
    const passwordHash = await hashPassword(password);
    values.push(passwordHash);
    updates.push(`password_hash = $${values.length}`);
  }

  if (!updates.length) return res.status(400).json({ error: "No fields provided to update." });

  values.push(req.params.id);
  values.push(req.user.organization_id);
  const { rows } = await pool.query(
    `update users set ${updates.join(", ")}
      where id = $${values.length - 1} and organization_id = $${values.length}
     returning id, organization_id, full_name, email, role, email_verified, created_at`,
    values
  );

  await logAction(req.user.id, req.user.organization_id, "member.updated_by_orgadmin", {
    member_id: rows[0].id,
    email: rows[0].email,
    role: rows[0].role,
  });

  res.json(rows[0]);
});

// Remove a member from the organization
router.delete("/members/:id", async (req, res) => {
  if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: "Member not found." });
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own admin account." });
  }

  const userRes = await pool.query(
    "select id, full_name, email, role from users where id = $1 and organization_id = $2",
    [req.params.id, req.user.organization_id]
  );
  if (!userRes.rows.length) return res.status(404).json({ error: "Member not found in your organization." });
  const targetUser = userRes.rows[0];

  await pool.query("delete from users where id = $1", [req.params.id]);
  await logAction(req.user.id, req.user.organization_id, "member.deleted_by_orgadmin", {
    deleted_member_id: targetUser.id,
    deleted_email: targetUser.email,
  });

  res.json({ message: `Member "${targetUser.full_name}" (${targetUser.email}) removed successfully.` });
});

module.exports = router;
