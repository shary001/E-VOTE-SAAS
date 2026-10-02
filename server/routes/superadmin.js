const express = require("express");
const { pool, withTransaction } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { logAction } = require("../utils/audit");
const { hashPassword } = require("../utils/password");
const { toCsv } = require("../utils/csv");

const router = express.Router();
router.use(requireAuth, requireRole("super_admin"));

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Platform-wide snapshot for the super admin dashboard.
router.get("/overview", async (req, res) => {
  const [orgs, elections, users, votes] = await Promise.all([
    pool.query(`select status, count(*)::int as count from organizations group by status`),
    pool.query(`select status, count(*)::int as count from elections group by status`),
    pool.query(`select role, count(*)::int as count from users group by role`),
    pool.query(`select count(*)::int as count from votes`),
  ]);

  res.json({
    organizations: orgs.rows,
    elections: elections.rows,
    users: users.rows,
    total_votes_cast: votes.rows[0]?.count || 0,
  });
});

// Deep platform analytics for charts and visualization
router.get("/analytics", async (req, res) => {
  const [orgsByStatus, electionsByStatus, usersByRole, recentActivity, topOrgsByVotes] = await Promise.all([
    pool.query(`select status, count(*)::int as count from organizations group by status order by status`),
    pool.query(`select status, count(*)::int as count from elections group by status order by status`),
    pool.query(`select role, count(*)::int as count from users group by role order by role`),
    pool.query(`
      select date_trunc('day', created_at) as day, count(*)::int as actions
        from audit_log
       where created_at >= now() - interval '14 days'
       group by day
       order by day asc
    `),
    pool.query(`
      select o.name, count(vbi.id)::int as ballots_cast
        from organizations o
        join elections e on e.organization_id = o.id
        join voter_ballots_issued vbi on vbi.election_id = e.id
       group by o.id, o.name
       order by ballots_cast desc
       limit 6
    `),
  ]);

  res.json({
    orgsByStatus: orgsByStatus.rows,
    electionsByStatus: electionsByStatus.rows,
    usersByRole: usersByRole.rows,
    recentActivity: recentActivity.rows,
    topOrgsByVotes: topOrgsByVotes.rows,
  });
});

// System diagnostic & health metrics for production readiness
router.get("/system-info", async (req, res) => {
  let dbStatus = "connected";
  let dbLatency = 0;
  try {
    const t0 = Date.now();
    await pool.query("SELECT 1");
    dbLatency = Date.now() - t0;
  } catch (err) {
    dbStatus = "error: " + err.message;
  }

  const mem = process.memoryUsage();
  res.json({
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || "development",
    database: {
      status: dbStatus,
      latencyMs: dbLatency,
      totalCount: pool.totalCount || 0,
      idleCount: pool.idleCount || 0,
      waitingCount: pool.waitingCount || 0,
    },
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    },
  });
});

// List all organizations with stats and admin email
router.get("/organizations", async (req, res) => {
  const { rows } = await pool.query(`
    select o.*,
           (select count(*) from users u where u.organization_id = o.id) as member_count,
           (select count(*) from elections e where e.organization_id = o.id) as election_count,
           (select email from users u where u.organization_id = o.id and u.role = 'org_admin' order by u.created_at asc limit 1) as admin_email
      from organizations o
     order by o.created_at desc
  `);
  res.json(rows);
});

// Super admin directly provisions a new organization with an initial admin user
router.post("/organizations", async (req, res) => {
  const { name, slug, admin_name, admin_email, admin_password } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Organization name is required." });
  if (!admin_name || !admin_email || !admin_password) {
    return res.status(400).json({ error: "Initial admin name, email, and password are required." });
  }
  if (admin_password.length < 8) {
    return res.status(400).json({ error: "Admin password must be at least 8 characters long." });
  }

  const cleanSlug = slug ? slugify(slug) : slugify(name);
  if (!cleanSlug) return res.status(400).json({ error: "Invalid organization slug." });

  const existingOrg = await pool.query("select id from organizations where slug = $1", [cleanSlug]);
  if (existingOrg.rows.length) return res.status(409).json({ error: "Organization slug is already taken." });

  const existingUser = await pool.query("select id from users where email = $1", [admin_email.toLowerCase().trim()]);
  if (existingUser.rows.length) return res.status(409).json({ error: "Email is already in use by another user." });

  const passwordHash = await hashPassword(admin_password);

  const result = await withTransaction(async (client) => {
    const orgRes = await client.query(
      `insert into organizations (name, slug, status) values ($1, $2, 'active') returning *`,
      [name.trim(), cleanSlug]
    );
    const org = orgRes.rows[0];

    const userRes = await client.query(
      `insert into users (organization_id, full_name, email, password_hash, role, email_verified)
       values ($1, $2, $3, $4, 'org_admin', true) returning id, full_name, email, role`,
      [org.id, admin_name.trim(), admin_email.toLowerCase().trim(), passwordHash]
    );

    return { organization: org, admin: userRes.rows[0] };
  });

  await logAction(req.user.id, result.organization.id, "organization.created_by_superadmin", {
    organization_name: result.organization.name,
    admin_email: result.admin.email,
  });

  res.status(201).json(result);
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Update organization status (approve / suspend / reinstate)
router.patch("/organizations/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "active", "suspended"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, active, or suspended." });
  }
  if (!UUID_REGEX.test(req.params.id)) {
    return res.status(404).json({ error: "Organization not found." });
  }
  const { rows } = await pool.query(
    `update organizations set status = $1 where id = $2 returning *`,
    [status, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Organization not found." });
  await logAction(req.user.id, req.params.id, "organization.status_changed", { status });
  res.json(rows[0]);
});

// Export organizations list as CSV
router.get("/export/organizations", async (req, res) => {
  const { rows } = await pool.query(`
    select o.id, o.name, o.slug, o.status, o.created_at,
           (select count(*) from users u where u.organization_id = o.id) as member_count,
           (select count(*) from elections e where e.organization_id = o.id) as election_count,
           (select email from users u where u.organization_id = o.id and u.role = 'org_admin' order by u.created_at asc limit 1) as admin_email
      from organizations o
     order by o.created_at desc
  `);

  const columns = [
    { key: "id", label: "Organization ID" },
    { key: "name", label: "Organization Name" },
    { key: "slug", label: "Slug" },
    { key: "status", label: "Status" },
    { key: "admin_email", label: "Admin Email" },
    { key: "member_count", label: "Members Count" },
    { key: "election_count", label: "Elections Count" },
    { key: "created_at", label: "Created At" },
  ];

  const csv = toCsv(columns, rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="organizations-${Date.now()}.csv"`);
  res.send(csv);
});

// Audit log with filtering and search
router.get("/audit-log", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const action = req.query.action;
  const search = req.query.search;

  let query = `
    select a.*, a.meta as details, u.full_name as actor_name, o.name as organization_name
      from audit_log a
      left join users u on u.id = a.actor_user_id
      left join organizations o on o.id = a.organization_id
     where 1=1
  `;
  const params = [];

  if (action && action !== "all") {
    params.push(action);
    query += ` and a.action = $${params.length}`;
  }

  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    query += ` and (lower(u.full_name) like $${params.length} or lower(o.name) like $${params.length} or lower(a.action) like $${params.length})`;
  }

  params.push(limit);
  query += ` order by a.created_at desc limit $${params.length}`;

  const { rows } = await pool.query(query, params);
  res.json(rows);
});

// Export audit log as CSV
router.get("/export/audit-log", async (req, res) => {
  const { rows } = await pool.query(`
    select a.id, a.created_at, u.full_name as actor_name, u.email as actor_email,
           o.name as organization_name, a.action, a.meta as details
      from audit_log a
      left join users u on u.id = a.actor_user_id
      left join organizations o on o.id = a.organization_id
     order by a.created_at desc
     limit 1000
  `);

  const columns = [
    { key: "id", label: "Event ID" },
    { key: "created_at", label: "Timestamp" },
    { key: "actor_name", label: "Actor Name" },
    { key: "actor_email", label: "Actor Email" },
    { key: "organization_name", label: "Organization" },
    { key: "action", label: "Action" },
    { key: "details", label: "Details (JSON)" },
  ];

  const csv = toCsv(columns, rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${Date.now()}.csv"`);
  res.send(csv);
});

module.exports = router;
