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

module.exports = router;
