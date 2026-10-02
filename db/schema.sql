-- ============================================================================
-- Multi-Tenant Voting SaaS — Schema
-- Run this once in the Supabase SQL editor (or `psql` against your DATABASE_URL).
-- ============================================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- ORGANIZATIONS (tenants)
-- ----------------------------------------------------------------------------
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,               -- url-safe identifier, e.g. "mru-guild"
  status        text not null default 'pending'      -- pending | active | suspended
                  check (status in ('pending','active','suspended')),
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- USERS
-- super_admin  -> organization_id is null, sees/monitors the whole platform
-- org_admin    -> runs elections for exactly one organization
-- member       -> a verified person inside an organization: votes by default,
--                 and can apply to be a candidate in any of that
--                 organization's elections (see candidate_applications).
-- candidate    -> a member whose candidacy has been approved at least once.
--                 Promoted automatically on first approval (see
--                 candidates.js) and never demoted automatically — it's a
--                 standing "has run for something here" identity, kept
--                 separate from plain members in the org roster, but with
--                 IDENTICAL voting rights to a member. Being a candidate in
--                 one election never restricts voting in any other.
-- ----------------------------------------------------------------------------
create table users (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid references organizations(id) on delete cascade,
  email               text not null unique,
  password_hash       text not null,
  full_name           text not null,
  role                text not null default 'member'
                        check (role in ('super_admin','org_admin','member','candidate')),
  email_verified      boolean not null default false,
  email_verify_token  text,
  email_verify_expires timestamptz,
  email_verify_code_hash text,
  email_verify_code_expires timestamptz,
  password_reset_token   text,
  password_reset_expires timestamptz,
  created_at          timestamptz not null default now(),
  constraint org_admin_and_member_need_org
    check (role = 'super_admin' or organization_id is not null)
);
create index idx_users_org on users(organization_id);
create index idx_users_email_verify_token on users(email_verify_token);
create index idx_users_password_reset_token on users(password_reset_token);

-- ----------------------------------------------------------------------------
-- ELECTIONS
-- eligibility_rules is a small, explicit JSON contract (not free-form magic):
--   {
--     "min_account_age_days": 0,        -- how long you must have been a member
--     "allowed_departments": [],         -- [] = no department restriction
--     "criteria_text": "..."             -- human-readable rule org_admin checks
--                                            manually when reviewing an application
--   }
-- Automated fields are enforced by the API at application time; criteria_text
-- is judgement-based and is why every application has a reviewer + a reason.
-- ----------------------------------------------------------------------------
create table elections (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  title                  text not null,
  position_name          text not null,               -- the seat/role being contested
  description            text default '',
  eligibility_rules      jsonb not null default '{"min_account_age_days":0,"allowed_departments":[],"criteria_text":""}',
  application_open_at    timestamptz not null,
  application_close_at   timestamptz not null,
  voting_open_at         timestamptz not null,
  voting_close_at        timestamptz not null,
  status                 text not null default 'draft'
                           check (status in ('draft','accepting_applications','voting_open','closed')),
  results_published      boolean not null default false,
  created_by             uuid not null references users(id),
  created_at             timestamptz not null default now(),
  constraint sane_windows check (
    application_open_at < application_close_at
    and application_close_at <= voting_open_at
    and voting_open_at < voting_close_at
  )
);
create index idx_elections_org on elections(organization_id);
create index idx_elections_status on elections(status);

-- ----------------------------------------------------------------------------
-- CANDIDATE APPLICATIONS
-- A member applies once per election; org_admin approves/rejects with a note.
-- Only approved rows ever appear on a ballot.
-- ----------------------------------------------------------------------------
create table candidate_applications (
  id             uuid primary key default gen_random_uuid(),
  election_id    uuid not null references elections(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  statement      text not null default '',
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  review_note    text default '',
  applied_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid references users(id),
  unique (election_id, user_id)
);
create index idx_candidate_apps_election on candidate_applications(election_id);

-- ----------------------------------------------------------------------------
-- VOTER ANONYMITY, IN TWO TABLES
--
-- voter_ballots_issued: proves a specific member voted in a specific election.
--   This is what the unique constraint below uses to make double voting
--   impossible at the database level. It records THAT you voted, never WHAT
--   you voted for.
--
-- votes: the anonymous ballots themselves. Deliberately has no voter_id / user
--   column of any kind, so nothing in this table can be joined back to a
--   person. The two tables are only ever written together, inside one
--   transaction, at the moment a vote is cast (see server/routes/votes.js) —
--   there is no stored relationship between a row here and a row above.
--
-- Honest limit: this defeats casual/DB-browsing re-identification, which is
-- the threat the "separate identity from ballot" brief is about. It is not
-- cryptographic anonymity (a party with raw DB access and precise write-time
-- logs could still attempt timing correlation). Treat it as strong hygiene,
-- not a formal guarantee — see README "Security notes".
-- ----------------------------------------------------------------------------
create table voter_ballots_issued (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null references elections(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  issued_at     timestamptz not null default now(),
  unique (election_id, user_id)          -- <-- the actual "no double voting" guarantee
);

create table votes (
  id                       uuid primary key default gen_random_uuid(),
  election_id              uuid not null references elections(id) on delete cascade,
  candidate_application_id uuid not null references candidate_applications(id) on delete cascade,
  cast_at                  timestamptz not null default now()
  -- no user_id / voter reference on this table, by design
);
create index idx_votes_election on votes(election_id);
create index idx_votes_candidate on votes(candidate_application_id);

-- ----------------------------------------------------------------------------
-- AUDIT LOG — coarse, platform-wide activity trail for the super admin.
-- Never logs ballot content, only actions ("election X moved to voting_open").
-- ----------------------------------------------------------------------------
create table audit_log (
  id               uuid primary key default gen_random_uuid(),
  actor_user_id    uuid references users(id),
  organization_id  uuid references organizations(id),
  action           text not null,
  meta             jsonb not null default '{}',
  created_at       timestamptz not null default now()
);
create index idx_audit_org on audit_log(organization_id);
create index idx_audit_created on audit_log(created_at desc);

-- ----------------------------------------------------------------------------
-- Seed a super admin so you can log in on first boot.
-- Password below is "ChangeMe123!" hashed with bcrypt (cost 10) — log in once,
-- then change it. Generate your own with: node -e "console.log(require('bcryptjs').hashSync('yourpassword',10))"
-- ----------------------------------------------------------------------------
insert into users (email, password_hash, full_name, role, email_verified)
values (
  'superadmin@example.com',
  '$2b$10$1ousr.BmiLrEq4n6yLp9Eut3O3/9Ahd/pjuOTjVHWkC3VwsaV09L6',
  'Platform Super Admin',
  'super_admin',
  true
);
