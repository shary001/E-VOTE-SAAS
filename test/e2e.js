// One-shot integration test against a running local server + local Postgres.
// Not part of the shipped project — this only exists to prove the core
// mechanics (org approval, election lifecycle, eligibility, anonymity,
// anti-double-voting) actually work before handing the code over.
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const RUN_ID = Date.now();
const ORG_NAME = `MRU Students Guild ${RUN_ID}`;
const ALICE_EMAIL = `alice-${RUN_ID}@example.com`;
const BOB_EMAIL = `bob-${RUN_ID}@example.com`;
const CAROL_EMAIL = `carol-${RUN_ID}@example.com`;
const ZED_EMAIL = `zed-${RUN_ID}@example.com`;

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}
async function api(method, path, body, token) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try { json = await res.json(); } catch {}
      return { status: res.status, body: json };
    } catch (err) {
      if (attempt === 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

let server = null;

(async () => {
  try {
    const res = await fetch(BASE + "/healthz");
    if (!res.ok) throw new Error();
  } catch {
    const app = require("../server/index");
    await new Promise((resolve) => {
      server = app.listen(3000, resolve);
    });
  }

  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:testpass@localhost:5432/voting_test";
  const db = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await db.connect();

  console.log("== registration ==");
  let r = await api("POST", "/api/auth/register", {
    mode: "create_org", organization_name: ORG_NAME,
    full_name: "Alice Admin", email: ALICE_EMAIL, password: "password123",
  });
  check("org_admin registered (201-ish)", r.status === 201);

  const orgRow = (await db.query(`select id from organizations where slug = $1`, [`mru-students-guild-${RUN_ID}`])).rows[0];
  check("organization row created", !!orgRow);

  r = await api("POST", "/api/auth/register", {
    mode: "join_org", organization_id: orgRow.id,
    full_name: "Bob Voter", email: BOB_EMAIL, password: "password123",
  });
  check("member (bob) registered", r.status === 201);

  r = await api("POST", "/api/auth/register", {
    mode: "join_org", organization_id: orgRow.id,
    full_name: "Carol Voter", email: CAROL_EMAIL, password: "password123",
  });
  check("member (carol) registered", r.status === 201);

  // Pull verify tokens straight from the DB (standing in for "click the email link").
  async function verify(email) {
    const { rows } = await db.query(`select email_verify_token from users where email = $1`, [email]);
    if (!rows.length || !rows[0].email_verify_token) return false;
    const tok = rows[0].email_verify_token;
    const res = await api("GET", `/api/auth/verify-email?token=${tok}`);
    return res.status === 200;
  }
  check("alice email verified", await verify(ALICE_EMAIL));
  check("bob email verified", await verify(BOB_EMAIL));
  check("carol email verified", await verify(CAROL_EMAIL));

  console.log("== login ==");
  r = await api("POST", "/api/auth/login", { email: ALICE_EMAIL, password: "password123" });
  const aliceToken = r.body?.token;
  check("alice can log in", r.status === 200 && !!aliceToken);

  r = await api("POST", "/api/auth/login", { email: BOB_EMAIL, password: "password123" });
  const bobToken = r.body?.token;
  check("bob can log in", r.status === 200 && !!bobToken);

  r = await api("POST", "/api/auth/login", { email: CAROL_EMAIL, password: "password123" });
  const carolToken = r.body?.token;
  check("carol can log in", r.status === 200 && !!carolToken);

  r = await api("POST", "/api/auth/login", { email: "superadmin@example.com", password: "ChangeMe123!" });
  const superToken = r.body?.token;
  check("seeded super admin can log in", r.status === 200 && !!superToken);

  console.log("== org approval gate ==");
  const testElectionStart = Date.now();
  r = await api("POST", "/api/elections", {
    title: "Guild President 2026", position_name: "Guild President",
    application_open_at: new Date(testElectionStart).toISOString(),
    application_close_at: new Date(testElectionStart + 12000).toISOString(),
    voting_open_at: new Date(testElectionStart + 12500).toISOString(),
    voting_close_at: new Date(testElectionStart + 60000).toISOString(),
  }, aliceToken);
  const electionId = r.body?.id;
  check("org_admin can create a draft election even while org is pending", r.status === 201 && !!electionId);

  r = await api("PATCH", `/api/elections/${electionId}/status`, { status: "accepting_applications" }, aliceToken);
  check("cannot open applications before super admin approves the org", r.status === 403);

  r = await api("PATCH", `/api/superadmin/organizations/${orgRow.id}/status`, { status: "active" }, superToken);
  check("super admin approves the organization", r.status === 200 && r.body.status === "active");

  r = await api("PATCH", `/api/elections/${electionId}/status`, { status: "accepting_applications" }, aliceToken);
  check("applications can open once org is active", r.status === 200);

  console.log("== candidacy ==");
  r = await api("POST", `/api/elections/${electionId}/apply`, { statement: "I promise to serve the student body with integrity and dedication." }, bobToken);
  const bobAppId = r.body?.id;
  check("bob applies as a candidate", r.status === 201 && !!bobAppId);

  r = await api("POST", `/api/elections/${electionId}/apply`, { statement: "Another attempt to apply for the same election again." }, bobToken);
  check("cannot apply twice to the same election", r.status === 409);

  r = await api("GET", `/api/elections/${electionId}/applications`, null, aliceToken);
  check("org admin sees the pending application", r.status === 200 && r.body.length === 1);

  r = await api("PATCH", `/api/applications/${bobAppId}/decision`, { status: "approved", review_note: "Meets criteria" }, aliceToken);
  check("org admin approves bob's candidacy", r.status === 200 && r.body.status === "approved");

  const bobRoleRow = await db.query(`select role from users where email = $1`, [BOB_EMAIL]);
  check("bob is promoted to role='candidate' on approval", bobRoleRow.rows[0].role === "candidate");

  console.log("== voting window ==");
  const elapsed = Date.now() - testElectionStart;
  const remaining = Math.max(0, 12600 - elapsed);
  if (remaining > 0) await new Promise((res) => setTimeout(res, remaining));
  r = await api("PATCH", `/api/elections/${electionId}/status`, { status: "voting_open" }, aliceToken);
  check("election moves to voting_open", r.status === 200);

  r = await api("GET", `/api/elections/${electionId}/ballot`, null, bobToken);
  check("bob sees exactly one candidate on the ballot", r.status === 200 && r.body.candidates.length === 1);

  r = await api("POST", `/api/elections/${electionId}/vote`, { candidate_application_id: bobAppId }, bobToken);
  check("bob (now role='candidate') can still cast a vote", r.status === 200);

  console.log("== THE important one: anti-double-voting ==");
  r = await api("POST", `/api/elections/${electionId}/vote`, { candidate_application_id: bobAppId }, bobToken);
  check("bob's SECOND vote attempt is rejected (409)", r.status === 409);

  r = await api("GET", `/api/elections/${electionId}/results`, null, carolToken);
  check("a member can't see unpublished results", r.status === 403);

  console.log("== anonymity check, straight against the DB ==");
  const votesCols = (await db.query(
    `select column_name from information_schema.columns where table_name = 'votes'`
  )).rows.map(r => r.column_name);
  check("votes table has NO user/voter column of any kind", !votesCols.some(c => /user|voter/i.test(c)));
  const ballotCount = await db.query(
    `select count(*)::int as c from voter_ballots_issued where election_id = $1 and user_id = $2`,
    [electionId, (await db.query(`select id from users where email = $1`, [BOB_EMAIL])).rows[0].id]
  );
  check("exactly one ballot-issued row for bob (not two)", ballotCount.rows[0].c === 1);
  const voteCount = await db.query(`select count(*)::int as c from votes where election_id = $1`, [electionId]);
  check("exactly one anonymous vote row exists (not two)", voteCount.rows[0].c === 1);

  console.log("== close + results ==");
  r = await api("PATCH", `/api/elections/${electionId}/status`, { status: "closed" }, aliceToken);
  check("election closes", r.status === 200);
  r = await api("PATCH", `/api/elections/${electionId}/publish-results`, {}, aliceToken);
  check("results published", r.status === 200);
  r = await api("GET", `/api/elections/${electionId}/results`, null, carolToken);
  check("published results show bob with 1 vote", r.status === 200 && r.body.candidates[0].vote_count === 1);
  check("ballots_cast in results matches turnout", r.body.ballots_cast === 1);

  console.log("== tenant isolation ==");
  const otherOrg = (await db.query(
    `insert into organizations (name, slug, status) values ($1, $2, 'active') returning id`,
    [`Another School ${RUN_ID}`, `another-school-${RUN_ID}`]
  )).rows[0];
  await db.query(
    `insert into users (organization_id, email, password_hash, full_name, role, email_verified)
     values ($1, $2, $3, 'Zed Admin', 'org_admin', true)`,
    [otherOrg.id, ZED_EMAIL, await bcrypt.hash("password123", 10)]
  );
  check("second organization fixture created", !!otherOrg.id);
  await verify(ZED_EMAIL);
  r = await api("POST", "/api/auth/login", { email: ZED_EMAIL, password: "password123" });
  const zedToken = r.body?.token;
  r = await api("GET", `/api/elections/${electionId}`, null, zedToken);
  check("a different org's admin cannot view this election (403)", r.status === 403);

  console.log("== password reset ==");
  r = await api("POST", "/api/auth/forgot-password", { email: ALICE_EMAIL });
  check("forgot-password accepted", r.status === 200);
  const resetRow = await db.query(`select password_reset_token from users where email = $1`, [ALICE_EMAIL]);
  const resetToken = resetRow.rows[0].password_reset_token;
  check("a reset token was issued", !!resetToken);
  r = await api("POST", "/api/auth/reset-password", { token: resetToken, password: "newpassword456" });
  check("password reset succeeds with a valid token", r.status === 200);
  r = await api("POST", "/api/auth/login", { email: ALICE_EMAIL, password: "password123" });
  check("old password no longer works", r.status === 401);
  r = await api("POST", "/api/auth/login", { email: ALICE_EMAIL, password: "newpassword456" });
  check("new password works", r.status === 200);
  r = await api("POST", "/api/auth/reset-password", { token: resetToken, password: "whatever12345" });
  check("a used/stale reset token is rejected on replay", r.status === 400);

  console.log("== rate limiting (this section takes a few seconds) ==");
  let sawTooManyRequests = false;
  for (let i = 0; i < 15; i++) {
    const attempt = await api("POST", "/api/auth/login", { email: "nobody@example.com", password: "wrong" });
    if (attempt.status === 429) { sawTooManyRequests = true; break; }
  }
  check("repeated login attempts eventually get rate-limited (429)", sawTooManyRequests);

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.end();
  if (server) await new Promise((res) => server.close(res));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("TEST CRASH:", e);
  if (server) server.close();
  process.exit(1);
});
