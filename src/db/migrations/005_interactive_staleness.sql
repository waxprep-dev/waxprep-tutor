-- Tracks the last interactive (button/list) message sent to each student,
-- so we can detect and reject taps on stale/old buttons — specifically
-- ones that would re-trigger mastery updates or quiz grading a second time.
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_interactive_message_id TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_interactive_sent_at TIMESTAMPTZ;
