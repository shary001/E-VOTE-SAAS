const express = require("express");
const { pool } = require("../db");
const { requireAuth, requireRole, requireVerifiedEmail } = require("../middleware/auth");
const { tenantScopeElection } = require("../middleware/tenantScope");
const { evaluateEligibility } = require("../utils/eligibility");
const { sendApplicationDecisionEmail } = require("../utils/email");
const { logAction } = require("../utils/audit");

const router = express.Router();

// Member applies to run in an election of their own organization.
router.post(
  "/elections/:electionId/apply",
  requireAuth, requireRole("member", "candidate"), requireVerifiedEmail, tenantScopeElection(),
  async (req, res) => {
    const { statement, department } = req.body || {};
    if (req.election.status !== "accepting_applications") {
      return res.status(409).json({ error: "This election isn't accepting applications right now." });
    }
    if (new Date() > new Date(req.election.application_close_at)) {
      return res.status(409).json({ error: "The application window has closed." });
    }
    if (!statement || statement.trim().length < 20) {
      return res.status(400).json({ error: "A candidate statement of at least 20 characters is required." });
    }
    if (statement.trim().length > 2000) {
      return res.status(400).json({ error: "Candidate statement must be 2000 characters or fewer." });
    }

    const { eligible, reasons } = evaluateEligibility(req.election.eligibility_rules, req.user, department);
    if (!eligible) {
      return res.status(403).json({ error: "You don't meet the eligibility rules for this election.", reasons });
    }

    try {
      const { rows } = await pool.query(
        `insert into candidate_applications (election_id, user_id, statement)
         values ($1, $2, $3) returning *`,
        [req.election.id, req.user.id, statement.trim()]
      );
      await logAction(req.user.id, req.user.organization_id, "candidate.applied", { election_id: req.election.id });
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "You've already applied to this election." });
      }
      throw err;
    }
  }
);

// Org admin: list every application for one of their elections.
router.get(
  "/elections/:electionId/applications",
  requireAuth, requireRole("org_admin"), tenantScopeElection(),
  async (req, res) => {
    const { rows } = await pool.query(
      `select ca.*, u.full_name as applicant_name, u.email as applicant_email, u.created_at as applicant_since
         from candidate_applications ca
         join users u on u.id = ca.user_id
        where ca.election_id = $1
        order by ca.applied_at asc`,
      [req.election.id]
    );
    res.json(rows);
  }
);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Org admin: approve or reject one application.
router.patch(
  "/applications/:applicationId/decision",
  requireAuth, requireRole("org_admin"),
  async (req, res) => {
    const { status, review_note } = req.body || {};
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved' or 'rejected'." });
    }
    if (!UUID_REGEX.test(req.params.applicationId)) {
      return res.status(404).json({ error: "Application not found." });
    }

    const { rows: appRows } = await pool.query(
      `select ca.*, e.organization_id, e.title as election_title, u.email as applicant_email, u.full_name as applicant_name
         from candidate_applications ca
         join elections e on e.id = ca.election_id
         join users u on u.id = ca.user_id
        where ca.id = $1`,
      [req.params.applicationId]
    );
    if (!appRows.length) return res.status(404).json({ error: "Application not found." });
    const application = appRows[0];
    if (application.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: "That application isn't part of your organization." });
    }

    const { rows } = await pool.query(
      `update candidate_applications
          set status = $1, review_note = $2, reviewed_at = now(), reviewed_by = $3
        where id = $4 returning *`,
      [status, review_note || "", req.user.id, application.id]
    );

    // A member's first approval promotes them to the 'candidate' role — a
    // standing identity in the org roster, never auto-demoted, and with
    // identical voting rights to a plain member (see requireRole calls on
    // the elections/ballot/voting routes, which accept both).
    if (status === "approved") {
      await pool.query(
        `update users set role = 'candidate' where id = $1 and role = 'member'`,
        [application.user_id]
      );
    }

    await logAction(req.user.id, req.user.organization_id, "candidate.application_reviewed",
      { application_id: application.id, status });
    await sendApplicationDecisionEmail(
      application.applicant_email, application.applicant_name, application.election_title,
      status === "approved", review_note
    );
    res.json(rows[0]);
  }
);

module.exports = router;
