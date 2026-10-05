const express = require("express");
const { pool, withTransaction } = require("../db");
const { requireAuth, requireRole, requireVerifiedEmail } = require("../middleware/auth");
const { tenantScopeElection } = require("../middleware/tenantScope");
const { logAction } = require("../utils/audit");

const router = express.Router();

const rateLimit = require("express-rate-limit");

const voteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many voting attempts from this IP. Please wait a moment." },
});

// Ballot view: election details + the list of approved candidates a member
// can vote for. Does NOT reveal whether the member has already voted for a
// *specific* candidate (that's not knowable from this data — only whether
// they've voted at all, which the elections/mine/list endpoint already shows).
router.get(
  "/elections/:electionId/ballot",
  requireAuth, requireRole("member", "candidate"), requireVerifiedEmail, tenantScopeElection(),
  async (req, res) => {
    if (req.election.status !== "voting_open") {
      return res.status(409).json({ error: "Voting isn't open for this election." });
    }
    const already = await pool.query(
      `select 1 from voter_ballots_issued where election_id = $1 and user_id = $2`,
      [req.election.id, req.user.id]
    );
    if (already.rows.length) {
      return res.status(409).json({ error: "You've already voted in this election." });
    }
    const { rows } = await pool.query(
      `select ca.id as candidate_application_id, u.full_name as candidate_name, ca.statement,
              ca.photo_url, ca.party_name, ca.party_symbol_url, ca.manifesto
         from candidate_applications ca join users u on u.id = ca.user_id
        where ca.election_id = $1 and ca.status = 'approved'
        order by u.full_name asc`,
      [req.election.id]
    );
    res.json({ election: { id: req.election.id, title: req.election.title, position_name: req.election.position_name, eligibility_rules: req.election.eligibility_rules }, candidates: rows });
  }
);

router.post(
  "/elections/:electionId/vote",
  voteLimiter, requireAuth, requireRole("member", "candidate"), requireVerifiedEmail, tenantScopeElection(),
  async (req, res) => {
    const { candidate_application_id } = req.body || {};
    if (!candidate_application_id) return res.status(400).json({ error: "candidate_application_id is required." });

    if (req.election.status !== "voting_open") {
      return res.status(409).json({ error: "Voting isn't open for this election." });
    }
    const now = new Date();
    if (now < new Date(req.election.voting_open_at) || now > new Date(req.election.voting_close_at)) {
      return res.status(409).json({ error: "Outside the voting window." });
    }

    const candidateCheck = await pool.query(
      `select id from candidate_applications where id = $1 and election_id = $2 and status = 'approved'`,
      [candidate_application_id, req.election.id]
    );
    if (!candidateCheck.rows.length) {
      return res.status(400).json({ error: "That candidate isn't on this ballot." });
    }

    try {
      await withTransaction(async (client) => {
        // This insert is the entire "no double voting" guarantee — a second
        // attempt hits the unique(election_id, user_id) constraint and throws
        // 23505, which we catch below and turn into a 409. Nothing about a
        // person's choice is written to this table.
        await client.query(
          `insert into voter_ballots_issued (election_id, user_id) values ($1, $2)`,
          [req.election.id, req.user.id]
        );
        // The anonymous ballot itself — no voter_id column exists on this
        // table, so this row can never be traced back to req.user by anyone
        // querying the database, including the app's own code.
        await client.query(
          `insert into votes (election_id, candidate_application_id) values ($1, $2)`,
          [req.election.id, candidate_application_id]
        );
      });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "You've already voted in this election." });
      }
      throw err;
    }

    // Logged deliberately without candidate_application_id — the audit trail
    // proves turnout, never choice.
    await logAction(req.user.id, req.user.organization_id, "vote.cast", { election_id: req.election.id });
    res.json({ message: "Your vote has been recorded. Thank you for voting." });
  }
);

module.exports = router;
