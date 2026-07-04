-- ============================================================
-- WAXPREP TUTOR — PRODUCTION SCHEMA FIXES
-- Adds crisis tables, dead-letter queue, evolution log
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ENUMS
DO $$ BEGIN
    CREATE TYPE message_direction AS ENUM ('inbound', 'outbound', 'system');
    CREATE TYPE consent_status AS ENUM ('pending', 'granted', 'revoked', 'expired');
    CREATE TYPE risk_level AS ENUM ('none', 'low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- TABLE: students (add missing columns)
ALTER TABLE students ADD COLUMN IF NOT EXISTS consent_status consent_status DEFAULT 'pending';
ALTER TABLE students ADD COLUMN IF NOT EXISTS consent_granted_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS consent_revoked_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_escalation_count INTEGER DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_risk_assessment TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS teaching_signature JSONB DEFAULT '{}';
ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

-- TABLE: episodes (add missing columns)
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived'));
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS ended_reason TEXT CHECK (ended_reason IN ('timeout', 'length', 'manual', 'system'));
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS token_count INTEGER DEFAULT 0;

-- TABLE: crisis_escalations
CREATE TABLE IF NOT EXISTS crisis_escalations (
    escalation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL REFERENCES students(phone) ON DELETE CASCADE,
    episode_id UUID REFERENCES episodes(episode_id) ON DELETE SET NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    risk_level risk_level NOT NULL,
    risk_flags JSONB NOT NULL,
    ai_response_sent TEXT,
    human_notified_at TIMESTAMPTZ,
    human_resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'false_positive'))
);

CREATE INDEX IF NOT EXISTS idx_crisis_open ON crisis_escalations(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_crisis_student ON crisis_escalations(student_phone, detected_at DESC);

-- TABLE: webhook_dead_letter
CREATE TABLE IF NOT EXISTS webhook_dead_letter (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload JSONB NOT NULL,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_deadletter_unresolved ON webhook_dead_letter(resolved, created_at) WHERE resolved = FALSE;

-- TABLE: memory_evolution_log
CREATE TABLE IF NOT EXISTS memory_evolution_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL REFERENCES students(phone) ON DELETE CASCADE,
    episode_id UUID REFERENCES episodes(episode_id) ON DELETE SET NULL,
    agent_name TEXT NOT NULL,
    action TEXT NOT NULL,
    table_name TEXT,
    record_id TEXT,
    reason TEXT,
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evolution_student ON memory_evolution_log(student_phone, created_at DESC);

-- FUNCTIONS
CREATE OR REPLACE FUNCTION close_stale_episodes(max_age_hours INTEGER DEFAULT 6)
RETURNS INTEGER AS $$
DECLARE
    closed_count INTEGER;
BEGIN
    UPDATE episodes
    SET ended_at = NOW(), status = 'closed', ended_reason = 'timeout'
    WHERE status = 'active'
      AND started_at < NOW() - (max_age_hours || ' hours')::INTERVAL;
    
    GET DIAGNOSTICS closed_count = ROW_COUNT;
    RETURN closed_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rotate_episode_if_needed(p_phone TEXT, max_messages INTEGER DEFAULT 50)
RETURNS UUID AS $$
DECLARE
    current_episode RECORD;
    new_episode_id UUID;
BEGIN
    SELECT episode_id, message_count INTO current_episode
    FROM episodes
    WHERE student_phone = p_phone AND status = 'active'
    ORDER BY started_at DESC
    LIMIT 1;
    
    IF current_episode IS NULL OR current_episode.message_count >= max_messages THEN
        IF current_episode IS NOT NULL THEN
            UPDATE episodes 
            SET status = 'closed', ended_at = NOW(), ended_reason = 'length'
            WHERE episode_id = current_episode.episode_id;
        END IF;
        
        INSERT INTO episodes (student_phone) VALUES (p_phone) RETURNING episode_id INTO new_episode_id;
        RETURN new_episode_id;
    END IF;
    
    RETURN current_episode.episode_id;
END;
$$ LANGUAGE plpgsql;
