-- Run this ONLY if you already applied the original schema.sql to a live
-- database (e.g. you'd already deployed to Supabase). If you haven't run
-- anything yet, just run the updated schema.sql instead — skip this file.
--
-- Adds: the 'candidate' role, and the columns password reset needs.

alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('super_admin','org_admin','member','candidate'));

alter table users add column if not exists password_reset_token text;
alter table users add column if not exists password_reset_expires timestamptz;
alter table users add column if not exists email_verify_code_hash text;
alter table users add column if not exists email_verify_code_expires timestamptz;
create index if not exists idx_users_password_reset_token on users(password_reset_token);
