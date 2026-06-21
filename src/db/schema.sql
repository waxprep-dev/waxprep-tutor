-- Enable pgvector extension (requires PostgreSQL 15+ with pgvector installed)
CREATE EXTENSION IF NOT EXISTS vector;

-- Students: Layer 1 (profile)
CREATE TABLE IF NOT EXISTS students (
  phone TEXT PRIMARY KEY,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_count_in INTEGER NOT NULL DEFAULT 0,
  message_count_out INTEGER NOT NULL DEFAULT 0,
  consent_flags JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_students_last_active ON students(last_active_at);

-- Episodes: Layer 2 (episodic memory)
CREATE TABLE IF NOT EXISTS episodes (
  episode_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_phone TEXT NOT NULL REFERENCES students(phone) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  message_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  key_moments JSONB NOT NULL DEFAULT '[]'::jsonb,
  subjects_covered TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  concepts_touched UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  full_transcript_ref TEXT,
  compression_level INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_episodes_student ON episodes(student_phone, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_unended ON episodes(student_phone) WHERE ended_at IS NULL;

-- Concepts: Layer 3 (concept memory with mastery)
CREATE TABLE IF NOT EXISTS concepts (
  concept_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_phone TEXT NOT NULL REFERENCES students(phone) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  mastery_score REAL NOT NULL DEFAULT 0.0 CHECK (mastery_score >= 0 AND mastery_score <= 1),
  mastery_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reviewed TIMESTAMPTZ,
  review_count INTEGER NOT NULL DEFAULT 0,
  common_misconceptions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  examples_used TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  prerequisite_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  related_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  UNIQUE(student_phone, name, subject)
);

CREATE INDEX IF NOT EXISTS idx_concepts_student ON concepts(student_phone, mastery_score);
CREATE INDEX IF NOT EXISTS idx_concepts_subject ON concepts(student_phone, subject);

-- Procedural rules: Layer 4
CREATE TABLE IF NOT EXISTS procedural_rules (
  rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_phone TEXT NOT NULL REFERENCES students(phone) ON DELETE CASCADE,
  rule_text TEXT NOT NULL,
  trigger_condition TEXT,
  evidence TEXT,
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_procedural_student ON procedural_rules(student_phone, confidence DESC);

-- Relational notes: Layer 5
CREATE TABLE IF NOT EXISTS relational_notes (
  note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_phone TEXT NOT NULL REFERENCES students(phone) ON DELETE CASCADE,
  category TEXT NOT NULL,
  note_text TEXT NOT NULL,
  emotional_sensitivity TEXT NOT NULL DEFAULT 'low' CHECK (emotional_sensitivity IN ('low', 'medium', 'high')),
  mentioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_referenced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_relational_student ON relational_notes(student_phone, mentioned_at DESC);

-- Message log (audit trail, raw messages)
CREATE TABLE IF NOT EXISTS message_log (
  message_id TEXT PRIMARY KEY,
  student_phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  raw_text TEXT NOT NULL,
  ai_tool_calls JSONB,
  ai_response TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  episode_id UUID REFERENCES episodes(episode_id) ON DELETE SET NULL,
  latency_ms INTEGER,
  model_used TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_student_time ON message_log(student_phone, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_episode ON message_log(episode_id);

-- Episode embeddings (for semantic search of past conversations)
CREATE TABLE IF NOT EXISTS episode_embeddings (
  episode_id UUID PRIMARY KEY REFERENCES episodes(episode_id) ON DELETE CASCADE,
  student_phone TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  summary_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episode_embeddings_student ON episode_embeddings(student_phone);
CREATE INDEX IF NOT EXISTS idx_episode_embeddings_vector ON episode_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Review queue (for spaced repetition)
CREATE TABLE IF NOT EXISTS review_queue (
  review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id UUID NOT NULL REFERENCES concepts(concept_id) ON DELETE CASCADE,
  student_phone TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_review_queue_due ON review_queue(scheduled_for) WHERE completed = FALSE;

-- Safety incidents log
CREATE TABLE IF NOT EXISTS safety_incidents (
  incident_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_phone TEXT NOT NULL,
  incident_type TEXT NOT NULL,
  description TEXT,
  message_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_safety_unreviewed ON safety_incidents(created_at DESC) WHERE reviewed = FALSE;
