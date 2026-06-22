-- Migration 004: switch embeddings from OpenAI (1536-dim) to a free local
-- model (384-dim) so the tutor never goes down from an embedding bill again.
-- See src/memory/embeddings.ts for the reasoning.
--
-- Old 1536-dim vectors are mathematically meaningless next to new 384-dim
-- ones — there's no valid conversion between two different models' vector
-- spaces, so we wipe and recreate rather than try to convert. This only
-- affects the SEARCH index, not your students' actual episode summaries
-- (those live in the `episodes` table, untouched). Embeddings repopulate
-- naturally as the consolidation worker re-runs.

DROP INDEX IF EXISTS idx_episode_embeddings_vector;

TRUNCATE TABLE episode_embeddings;

ALTER TABLE episode_embeddings DROP COLUMN embedding;
ALTER TABLE episode_embeddings ADD COLUMN embedding vector(384) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_episode_embeddings_vector
  ON episode_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
