-- Migration 002: WAX ID identity layer
-- Run with: psql $DATABASE_URL -f src/db/migrations/002_wax_id.sql

-- WAX IDs are the new primary identifier. Phone numbers become platform handles.
-- This is a non-destructive migration: we add WAX ID column, backfill, then rewire.

-- Step 1: Add wax_id column to students
ALTER TABLE students ADD COLUMN IF NOT EXISTS wax_id TEXT UNIQUE;

-- Step 2: Create the wax_ids table (registry + metadata)
CREATE TABLE IF NOT EXISTS wax_ids (
  wax_id TEXT PRIMARY KEY,
  student_phone TEXT NOT NULL REFERENCES students(phone) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  signature TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'wax_v1'
);

CREATE INDEX IF NOT EXISTS idx_wax_ids_phone ON wax_ids(student_phone);
CREATE INDEX IF NOT EXISTS idx_wax_ids_status ON wax_ids(status);

-- Step 3: Platform handles (one WAX ID can have many platform handles)
CREATE TABLE IF NOT EXISTS platform_handles (
  handle_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wax_id TEXT NOT NULL REFERENCES wax_ids(wax_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('whatsapp', 'web', 'mobile', 'sms', 'telegram', 'voice', 'other')),
  handle_value TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_method TEXT,
  verified_at TIMESTAMPTZ,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE(platform, handle_value)
);

CREATE INDEX IF NOT EXISTS idx_platform_handles_wax ON platform_handles(wax_id);
CREATE INDEX IF NOT EXISTS idx_platform_handles_lookup ON platform_handles(platform, handle_value);

-- Step 4: Backfill: create WAX IDs for all existing students
DO $$
DECLARE
  student_record RECORD;
  new_wax_id TEXT;
  new_signature TEXT;
BEGIN
  FOR student_record IN
    SELECT phone FROM students WHERE wax_id IS NULL
  LOOP
    new_wax_id := 'wax_' || encode(gen_random_bytes(16), 'hex');
    new_signature := encode(digest(new_wax_id || student_record.phone, 'sha256'), 'hex');

    INSERT INTO wax_ids (wax_id, student_phone, signature)
    VALUES (new_wax_id, student_record.phone, new_signature);

    UPDATE students SET wax_id = new_wax_id WHERE phone = student_record.phone;

    INSERT INTO platform_handles (wax_id, platform, handle_value, verified, verification_method, verified_at, is_primary)
    VALUES (new_wax_id, 'whatsapp', student_record.phone, TRUE, 'initial_phone', NOW(), TRUE);
  END LOOP;
END $$;

-- Step 5: Consent + identity metadata (NDPR compliance + future-proofing)
CREATE TABLE IF NOT EXISTS wax_id_consent (
  wax_id TEXT PRIMARY KEY REFERENCES wax_ids(wax_id) ON DELETE CASCADE,
  data_retention_consent BOOLEAN NOT NULL DEFAULT FALSE,
  cross_platform_sync_consent BOOLEAN NOT NULL DEFAULT FALSE,
  parental_consent_for_minor BOOLEAN NOT NULL DEFAULT FALSE,
  consent_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_version TEXT NOT NULL DEFAULT 'v1',
  ip_address_at_consent TEXT,
  consent_method TEXT
);

-- Step 6: Identity events (audit log of all identity changes)
CREATE TABLE IF NOT EXISTS wax_id_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wax_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'handle_added', 'handle_verified', 'handle_removed', 'phone_changed', 'suspended', 'reactivated', 'deleted', 'cross_platform_linked')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_wax_id_events_wax ON wax_id_events(wax_id, created_at DESC);
