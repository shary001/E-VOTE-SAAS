# Civic Ledger — multi-tenant voting platform

A voting SaaS: a platform-wide super admin approves organizations; each
organization's admin runs its own elections, sets candidate eligibility
rules, and reviews applications; members vote once per election, with their
identity kept separate from their ballot at the database level.

Stack: **Node.js/Express + PostgreSQL (Supabase)**, JWT auth, vanilla
HTML/CSS/JS frontend served by the same Express app — no build step, no
frontend framework, one thing to deploy.

## Why this architecture

**Roles.** `super_admin` (no organization, platform-wide), `org_admin` (runs
one organization), `member` (votes, and can apply to be a candidate — there
is no separate "candidate" account type at signup; candidacy is something a
member applies for per election). On first approval, a member is promoted
to `candidate` — a standing identity kept separate from plain voters in the
org roster (`/orgadmin/roster.html`), never auto-demoted, with **identical
voting rights to a member** in every election, including ones they're not
running in.

**Anti-double-voting.** Enforced by a database `unique(election_id,
user_id)` constraint on `voter_ballots_issued`, not just app logic — even a
bug in the API can't let it through. See `server/routes/votes.js`.

**Voter anonymity.** Two tables, written together in one transaction:
`voter_ballots_issued` proves *that* someone voted (and blocks a second
vote); `votes` records the anonymous ballot and has **no voter/user column
at all**, so nothing in that table can be joined back to a person. Read the
comment block above both tables in `db/schema.sql` — it's also honest about
the limits of this approach (it defeats casual DB-browsing re-identification;
it is not cryptographic anonymity).

**Multi-tenancy.** Every org-scoped query filters by `organization_id`; the
`tenantScopeElection` middleware (`server/middleware/tenantScope.js`) loads
an election and 403s if it doesn't belong to the caller's organization
before any route handler touches it.

**Org gatekeeping.** A newly registered organization starts `pending`. Its
admin can build elections in `draft`, but can't move one to
`accepting_applications` or `voting_open` until a super admin sets the
organization to `active`. That's the platform admin's actual lever, not
just a read-only dashboard.

This has been tested end-to-end (`npm run test:e2e` — 40 checks: full
election lifecycle, the eligibility gate, the anonymity guarantee, the
candidate-role promotion + continued voting rights, password reset, and
rate limiting) against a real local Postgres instance, not just eyeballed.

## What's here vs. what you still need to decide

Built and tested: registration (create-org / join-org), six-digit email OTP
verification, login, org approval, election CRUD, eligibility rules
(automated + manually-reviewed), candidate applications with approve/reject +
email notification, the voting flow itself, results tallying, a platform-wide
audit log, password reset, authenticated password changes, configurable JWT
expiry, and rate limiting on the endpoints someone could actually abuse.

Deliberately left as a next step, because they're judgment calls specific to
your actual election, not generic code: fine-grained voter eligibility
beyond "any verified member" (e.g. year-of-study-based voter rolls, not just
candidate rolls), CSV export of results, JWT revocation before its 7-day
expiry (would need a token blocklist or short-lived tokens + refresh), and —
if this ever needs to survive real adversarial scrutiny — a professional
review of the anonymity model rather than the good-hygiene version here.

## Already deployed the old schema?

Run `db/migrate_v1_to_v2.sql` instead of re-running `schema.sql` — it adds
the `candidate` role, password-reset columns, and email OTP columns without
touching your existing data. (If you haven't deployed anything yet, ignore
this — just run the current `schema.sql`.)

## Local setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, SMTP_* (see below)
# Run db/schema.sql once against your database (see "Database" below)
npm run dev
```

Visit `http://localhost:3000`. A super admin is seeded by the schema:
`superadmin@example.com` / `ChangeMe123!` — log in and change this password
from the Account page before any hosted demo.

## Hosting — free tier, verified September 2026

You need three things. Supabase covers one of them; people conflate it with
"hosting" because it's a Firebase-style all-in-one, but it's the *database*,
not somewhere to put your Express server.

| Piece | Recommendation | Free tier reality |
|---|---|---|
| **Database** | [Supabase](https://supabase.com) Postgres | 500 MB DB, 50k monthly active users, unlimited API requests — plenty for a student election. **Catch:** the project pauses after 7 days with no traffic and needs a manual resume from the dashboard. If your election runs, then goes quiet before grading/demo day, ping it the day before. |
| **App server** | [Render](https://render.com) free Web Service | Real, no-card Node hosting — `npm install && npm start`, done. **Catch:** it sleeps after 15 minutes idle; the first request after that takes 30–60s to wake up. Don't let a live demo be the *first* request of the day — load the site yourself a minute before you present. |
| **Outgoing email** | Gmail SMTP (app password) to start | Zero setup friction, no domain needed, works immediately for verification/decision emails. Gmail's own sending caps (~500/day) are irrelevant at student-election scale. **Upgrade path:** once you own a domain, switch to [Resend](https://resend.com) (3,000 emails/month free, better deliverability) — only `server/utils/email.js` needs to change. |

Steps:
1. **Supabase:** create a project, run `db/schema.sql` in SQL Editor, and
   copy the pooler or direct URI into Render's `DATABASE_URL` environment
   variable. For an existing database, run `db/migrate_v1_to_v2.sql` too.
2. **Gmail app password:** enable 2-Step Verification, create an App
   Password, and set `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in Render.
3. **Render:** connect this repository. Render can use [`render.yaml`](render.yaml)
   as a Blueprint, or configure build `npm install` and start `npm start`
   manually. Set `APP_URL` to the final HTTPS Render URL.
4. Keep `NODE_ENV=production`, use a new random `JWT_SECRET`, and never copy
   local `.env` values into source control. Production startup rejects missing
   database, JWT, URL, or SMTP settings.
5. After deploy, open `/healthz`, register a test account, verify it with the
   six-digit email code, and test password change before inviting voters.

## Security notes, read before you demo this as "production-ready"

- Passwords are hashed with bcrypt; never logged or returned by the API.
- JWTs expire after the configured `JWT_EXPIRES_IN` value, defaulting to 2
   hours. Immediate revocation of an already-issued token is not implemented;
   use a short expiry and rotate `JWT_SECRET` if an active token is exposed.
- Rate limiting is applied to `/api/auth/login`, `/register`,
  `/resend-verification` and `/forgot-password` (`server/middleware/rateLimit.js`)
  — keyed by IP via the default in-memory store, which is fine for Render's
  single free instance but won't share state if you ever scale to multiple
  instances (swap in a Redis store at that point).
- The anonymity model is described honestly above — don't oversell it as
  cryptographically anonymous in a report; describe it as what it is.