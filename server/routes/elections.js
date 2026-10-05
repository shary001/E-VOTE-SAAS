const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { tenantScopeElection } = require("../middleware/tenantScope");
const { logAction } = require("../utils/audit");
const { toCsv } = require("../utils/csv");

const router = express.Router();

const STATUS_ORDER = ["draft", "accepting_applications", "voting_open", "closed"];

// ---------------------------------------------------------------- org_admin
router.post("/", requireAuth, requireRole("org_admin"), async (req, res) => {
  const { title, position_name, description, eligibility_rules,
          application_open_at, application_close_at, voting_open_at, voting_close_at } = req.body || {};

  if (!title || !position_name || !application_open_at || !application_close_at
      || !voting_open_at || !voting_close_at) {
    return res.status(400).json({ error: "title, position_name, and all four dates are required." });
  }
  if (!(new Date(application_open_at) < new Date(application_close_at)
        && new Date(application_close_at) <= new Date(voting_open_at)
        && new Date(voting_open_at) < new Date(voting_close_at))) {
    return res.status(400).json({ error: "Dates must run: application open < application close <= voting open < voting close." });
  }

  const { rows } = await pool.query(
    `insert into elections (organization_id, title, position_name, description, eligibility_rules,
                             application_open_at, application_close_at, voting_open_at, voting_close_at,
                             created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [req.user.organization_id, title, position_name, description || "",
     eligibility_rules || {}, application_open_at, application_close_at, voting_open_at, voting_close_at,
     req.user.id]
  );
  await logAction(req.user.id, req.user.organization_id, "election.created", { election_id: rows[0].id, title });
  res.status(201).json(rows[0]);
});

router.get("/", requireAuth, requireRole("org_admin"), async (req, res) => {
  const { rows } = await pool.query(
    `select e.*,
            (select count(*) from candidate_applications ca where ca.election_id = e.id and ca.status = 'pending') as pending_applications,
            (select count(*) from candidate_applications ca where ca.election_id = e.id and ca.status = 'approved') as approved_candidates,
            (select count(*) from voter_ballots_issued vbi where vbi.election_id = e.id) as ballots_cast
       from elections e
      where e.organization_id = $1
      order by e.created_at desc`,
    [req.user.organization_id]
  );
  res.json(rows);
});

// -------------------------------------------------------------------- member
router.get("/mine/list", requireAuth, requireRole("member", "candidate"), async (req, res) => {
  const { rows } = await pool.query(
    `select e.id, e.title, e.position_name, e.description, e.status,
            e.application_open_at, e.application_close_at, e.voting_open_at, e.voting_close_at,
            e.results_published,
            ca.status as my_application_status,
            (vbi.id is not null) as i_have_voted
       from elections e
       left join candidate_applications ca on ca.election_id = e.id and ca.user_id = $1
       left join voter_ballots_issued vbi on vbi.election_id = e.id and vbi.user_id = $1
      where e.organization_id = $2 and e.status != 'draft'
      order by e.voting_open_at desc`,
    [req.user.id, req.user.organization_id]
  );
  res.json(rows);
});

router.get("/:electionId", requireAuth, tenantScopeElection(), async (req, res) => {
  res.json(req.election);
});

router.patch("/:electionId", requireAuth, requireRole("org_admin"), tenantScopeElection(), async (req, res) => {
  if (req.election.status !== "draft") {
    return res.status(409).json({ error: "Only draft elections can be edited. Close or revert status first." });
  }
  const fields = ["title", "position_name", "description", "eligibility_rules",
                   "application_open_at", "application_close_at", "voting_open_at", "voting_close_at"];
  const updates = [];
  const values = [];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) {
      values.push(req.body[f]);
      updates.push(`${f} = $${values.length}`);
    }
  });
  if (!updates.length) return res.status(400).json({ error: "No fields to update." });

  // Re-validate date ordering with merged values (submitted overrides current).
  const dateFields = ["application_open_at", "application_close_at", "voting_open_at", "voting_close_at"];
  const merged = {};
  for (const f of dateFields) {
    merged[f] = req.body[f] !== undefined ? req.body[f] : req.election[f];
  }
  if (!(
    new Date(merged.application_open_at) < new Date(merged.application_close_at) &&
    new Date(merged.application_close_at) <= new Date(merged.voting_open_at) &&
    new Date(merged.voting_open_at) < new Date(merged.voting_close_at)
  )) {
    return res.status(400).json({ error: "Dates must run: application open < application close <= voting open < voting close." });
  }

  values.push(req.election.id);
  const { rows } = await pool.query(
    `update elections set ${updates.join(", ")} where id = $${values.length} returning *`,
    values
  );
  res.json(rows[0]);
});

router.patch("/:electionId/status", requireAuth, requireRole("org_admin"), tenantScopeElection(), async (req, res) => {
  const { status } = req.body || {};
  if (!STATUS_ORDER.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${STATUS_ORDER.join(", ")}` });
  }
  const currentIdx = STATUS_ORDER.indexOf(req.election.status);
  const nextIdx = STATUS_ORDER.indexOf(status);
  if (nextIdx !== currentIdx + 1) {
    return res.status(409).json({ error: `Elections move forward one step at a time (currently "${req.election.status}").` });
  }
  if (status !== "draft" && req.election.organization_status !== "active") {
    return res.status(403).json({ error: "Your organization must be approved by the platform admin before an election can go live." });
  }
  const { rows } = await pool.query(`update elections set status = $1 where id = $2 returning *`, [status, req.election.id]);
  await logAction(req.user.id, req.user.organization_id, "election.status_changed", { election_id: req.election.id, status });
  res.json(rows[0]);
});

router.patch("/:electionId/publish-results", requireAuth, requireRole("org_admin"), tenantScopeElection(), async (req, res) => {
  if (req.election.status !== "closed") {
    return res.status(409).json({ error: "Results can only be published once voting has closed." });
  }
  const { rows } = await pool.query(
    `update elections set results_published = true where id = $1 returning *`, [req.election.id]
  );
  await logAction(req.user.id, req.user.organization_id, "election.results_published", { election_id: req.election.id });
  res.json(rows[0]);
});

// Deep analytics for an election (turnout, application stats, voting rates)
router.get("/:electionId/analytics", requireAuth, tenantScopeElection(), async (req, res) => {
  const isOrgAdmin = req.user.role === "org_admin" && req.user.organization_id === req.election.organization_id;
  const isSuperAdmin = req.user.role === "super_admin";

  const [eligibleRes, ballotsRes, appStatsRes] = await Promise.all([
    pool.query(
      `select count(*)::int as eligible_voters from users where organization_id = $1 and role in ('member', 'candidate')`,
      [req.election.organization_id]
    ),
    pool.query(
      `select count(*)::int as ballots_cast from voter_ballots_issued where election_id = $1`,
      [req.election.id]
    ),
    pool.query(
      `select status, count(*)::int as count from candidate_applications where election_id = $1 group by status`,
      [req.election.id]
    ),
  ]);

  const eligibleVoters = eligibleRes.rows[0]?.eligible_voters || 0;
  const ballotsCast = ballotsRes.rows[0]?.ballots_cast || 0;
  const turnoutPercent = eligibleVoters > 0 ? Math.min(100, Math.round((ballotsCast / eligibleVoters) * 1000) / 10) : 0;
  const appCounts = Object.fromEntries(appStatsRes.rows.map(r => [r.status, r.count]));

  let candidates = null;
  if (req.election.results_published || isOrgAdmin || isSuperAdmin) {
    const candRes = await pool.query(
      `select ca.id as candidate_application_id, u.full_name as candidate_name, ca.statement,
              ca.photo_url, ca.party_name, ca.party_symbol_url, ca.manifesto,
              count(v.id)::int as vote_count
         from candidate_applications ca
         join users u on u.id = ca.user_id
         left join votes v on v.candidate_application_id = ca.id
        where ca.election_id = $1 and ca.status = 'approved'
        group by ca.id, u.full_name, ca.statement, ca.photo_url, ca.party_name, ca.party_symbol_url, ca.manifesto
        order by vote_count desc, candidate_name asc`,
      [req.election.id]
    );
    candidates = candRes.rows;
  }

  res.json({
    election: req.election,
    eligible_voters: eligibleVoters,
    ballots_cast: ballotsCast,
    turnout_percentage: turnoutPercent,
    applications: {
      total: Object.values(appCounts).reduce((a, b) => a + b, 0),
      pending: appCounts.pending || 0,
      approved: appCounts.approved || 0,
      rejected: appCounts.rejected || 0,
    },
    candidates,
  });
});

router.get("/:electionId/results", requireAuth, tenantScopeElection(), async (req, res) => {
  const isOrgAdmin = req.user.role === "org_admin" && req.user.organization_id === req.election.organization_id;
  if (!req.election.results_published && !isOrgAdmin && req.user.role !== "super_admin") {
    return res.status(403).json({ error: "Results haven't been published yet." });
  }
  const { rows } = await pool.query(
    `select ca.id as candidate_application_id, u.full_name as candidate_name, ca.statement,
            ca.photo_url, ca.party_name, ca.party_symbol_url, ca.manifesto,
            count(v.id)::int as vote_count
       from candidate_applications ca
       join users u on u.id = ca.user_id
       left join votes v on v.candidate_application_id = ca.id
      where ca.election_id = $1 and ca.status = 'approved'
      group by ca.id, u.full_name, ca.statement, ca.photo_url, ca.party_name, ca.party_symbol_url, ca.manifesto
      order by vote_count desc, candidate_name asc`,
    [req.election.id]
  );
  const totalBallots = await pool.query(
    `select count(*)::int as count from voter_ballots_issued where election_id = $1`, [req.election.id]
  );
  res.json({ candidates: rows, ballots_cast: totalBallots.rows[0].count });
});

// CSV export for election results
router.get("/:electionId/export/results", requireAuth, tenantScopeElection(), async (req, res) => {
  const isOrgAdmin = req.user.role === "org_admin" && req.user.organization_id === req.election.organization_id;
  if (!req.election.results_published && !isOrgAdmin && req.user.role !== "super_admin") {
    return res.status(403).json({ error: "Results haven't been published yet." });
  }

  const { rows } = await pool.query(
    `select ca.id as candidate_application_id, u.full_name as candidate_name, ca.statement,
            ca.photo_url, ca.party_name, ca.party_symbol_url, ca.manifesto,
            count(v.id)::int as vote_count
       from candidate_applications ca
       join users u on u.id = ca.user_id
       left join votes v on v.candidate_application_id = ca.id
      where ca.election_id = $1 and ca.status = 'approved'
      group by ca.id, u.full_name, ca.statement, ca.photo_url, ca.party_name, ca.party_symbol_url, ca.manifesto
      order by vote_count desc, candidate_name asc`,
    [req.election.id]
  );

  const totalBallotsRes = await pool.query(
    `select count(*)::int as count from voter_ballots_issued where election_id = $1`, [req.election.id]
  );
  const totalVotes = totalBallotsRes.rows[0].count;

  const exportRows = rows.map(r => ({
    election_title: req.election.title,
    position: req.election.position_name,
    candidate_name: r.candidate_name,
    party_name: r.party_name || "",
    vote_count: r.vote_count,
    vote_percentage: totalVotes > 0 ? ((r.vote_count / totalVotes) * 100).toFixed(1) + "%" : "0.0%",
  }));

  const columns = [
    { key: "election_title", label: "Election Title" },
    { key: "position", label: "Position" },
    { key: "candidate_name", label: "Candidate Name" },
    { key: "party_name", label: "Party / Ticket" },
    { key: "vote_count", label: "Votes Received" },
    { key: "vote_percentage", label: "Vote Share %" },
  ];

  const csv = toCsv(columns, exportRows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="results-${req.election.id}.csv"`);
  res.send(csv);
});

// CSV export for candidate applications
router.get("/:electionId/export/applications", requireAuth, requireRole("org_admin", "super_admin"), tenantScopeElection(), async (req, res) => {
  const { rows } = await pool.query(
    `select ca.id, u.full_name as applicant_name, u.email as applicant_email,
            ca.party_name, ca.party_symbol_url, ca.photo_url, ca.statement, ca.manifesto,
            ca.status, ca.applied_at, ca.reviewed_at, ca.review_note
       from candidate_applications ca
       join users u on u.id = ca.user_id
      where ca.election_id = $1
      order by ca.applied_at asc`,
    [req.election.id]
  );

  const columns = [
    { key: "id", label: "Application ID" },
    { key: "applicant_name", label: "Applicant Name" },
    { key: "applicant_email", label: "Email" },
    { key: "party_name", label: "Party / Ticket" },
    { key: "party_symbol_url", label: "Party Symbol URL" },
    { key: "photo_url", label: "Photo URL" },
    { key: "statement", label: "Statement" },
    { key: "manifesto", label: "Manifesto" },
    { key: "status", label: "Status" },
    { key: "applied_at", label: "Applied At" },
    { key: "reviewed_at", label: "Reviewed At" },
    { key: "review_note", label: "Review Note" },
  ];

  const csv = toCsv(columns, rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="applications-${req.election.id}.csv"`);
  res.send(csv);
});

module.exports = router;
