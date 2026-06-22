-- Migration 003: interactive features, quizzes, streaks, difficulty signals
-- Run with: psql $DATABASE_URL -f src/db/migrations/003_interactive_features.sql

-- Difficulty signals log
CREATE TABLE IF NOT EXISTS difficulty_signals (
  signal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_phone TEXT NOT NULL,
  concept_id UUID NOT NULL,
  signal TEXT NOT NULL CHECK (signal IN ('got_it', 'confused', 'lost')),
  mastery_before REAL,
  mastery_after REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_difficulty_signals_phone ON difficulty_signals(student_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_difficulty_signals_concept ON difficulty_signals(concept_id);

-- Interactive quizzes
CREATE TABLE IF NOT EXISTS quizzes (
  quiz_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_phone TEXT NOT NULL,
  concept_id UUID,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index INTEGER NOT NULL,
  selected_index INTEGER,
  is_correct BOOLEAN,
  asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_quizzes_phone ON quizzes(student_phone, asked_at DESC);
CREATE INDEX IF NOT EXISTS idx_quizzes_unanswered ON quizzes(student_phone) WHERE selected_index IS NULL;

-- Study streaks
CREATE TABLE IF NOT EXISTS study_streaks (
  student_phone TEXT PRIMARY KEY,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_study_date DATE,
  total_days_studied INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daily check-in log (for analytics)
CREATE TABLE IF NOT EXISTS daily_checkins (
  checkin_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_phone TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded BOOLEAN NOT NULL DEFAULT FALSE,
  response_action TEXT
);

CREATE INDEX IF NOT EXISTS idx_checkins_phone ON daily_checkins(student_phone, sent_at DESC);
