-- ============================================================================
-- Migration: Add candidate profile fields
-- Run once against your DATABASE_URL. Safe to re-run (adds columns only if
-- they don't already exist via the ALTER TABLE … ADD COLUMN IF NOT EXISTS form).
-- ============================================================================

-- Candidate profile photo URL (hosted externally, e.g. Cloudinary / Supabase Storage)
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '';

-- Party / ticket name (e.g. "Progress Alliance")
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS party_name TEXT DEFAULT '';

-- Party symbol / logo URL
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS party_symbol_url TEXT DEFAULT '';

-- Extended manifesto (separate from the short `statement` field)
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS manifesto TEXT DEFAULT '';

-- Organization contact metadata for follow-up and support.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS contact_email TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_phone TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

-- Auto-verify all accounts for the simplified workflow.
ALTER TABLE users
  ALTER COLUMN email_verified SET DEFAULT true;
UPDATE users
   SET email_verified = true
 WHERE email_verified = false;
