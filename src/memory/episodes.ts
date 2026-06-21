import { query, queryOne } from "../db/client";

export interface Episode {
  episode_id: string;
  student_phone: string;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  summary: string | null;
  key_moments: any[];
  subjects_covered: string[];
  concepts_touched: string[];
  full_transcript_ref: string | null;
  compression_level: number;
}

/**
 * Get the student's currently-open episode (the one they're in right now),
 * or start a new one. An "episode" is one continuous conversation —
 * a gap of more than 30 minutes counts as a new episode.
 */
export async function getOrCreateCurrentEpisode(phone: string): Promise<Episode> {
  const open = await queryOne<Episode>(
    `SELECT * FROM episodes
     WHERE student_phone = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [phone]
  );

  if (open) return open;

  const created = await queryOne<Episode>(
    `INSERT INTO episodes (student_phone) VALUES ($1) RETURNING *`,
    [phone]
  );
  return created!;
}

/**
 * Get the most recent N ended episodes for a student (for context).
 */
export async function getRecentEpisodes(phone: string, n: number = 3): Promise<Episode[]> {
  return query<Episode>(
    `SELECT * FROM episodes
     WHERE student_phone = $1 AND ended_at IS NOT NULL AND summary IS NOT NULL
     ORDER BY ended_at DESC LIMIT $2`,
    [phone, n]
  );
}

/**
 * Update an episode with a summary and key moments. Called by the AI
 * via the save_episode tool.
 */
export async function endEpisode(
  episodeId: string,
  summary: string,
  keyMoments: any[]
): Promise<void> {
  await query(
    `UPDATE episodes
     SET ended_at = NOW(),
         summary = $1,
         key_moments = $2,
         compression_level = 0
     WHERE episode_id = $3`,
    [summary, JSON.stringify(keyMoments), episodeId]
  );
}

export async function incrementEpisodeMessageCount(episodeId: string): Promise<void> {
  await query(
    `UPDATE episodes SET message_count = message_count + 1 WHERE episode_id = $1`,
    [episodeId]
  );
}

/**
 * Store the embedding of an episode's summary for semantic search.
 */
export async function storeEpisodeEmbedding(
  episodeId: string,
  phone: string,
  embedding: number[],
  summaryText: string
): Promise<void> {
  await query(
    `INSERT INTO episode_embeddings (episode_id, student_phone, embedding, summary_text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (episode_id) DO UPDATE SET embedding = EXCLUDED.embedding, summary_text = EXCLUDED.summary_text`,
    [episodeId, phone, JSON.stringify(embedding), summaryText]
  );
}

/**
 * Semantic search: find past episodes that are most similar to a query.
 * This is the heart of "the tutor remembers."
 */
export async function searchEpisodes(
  phone: string,
  queryEmbedding: number[],
  topK: number = 5
): Promise<Array<{ episode_id: string; summary_text: string; similarity: number; summary: string; key_moments: any[]; ended_at: string }>> {
  return query(
    `SELECT
       e.episode_id,
       ee.summary_text,
       1 - (ee.embedding <=> $2::vector) AS similarity,
       e.summary,
       e.key_moments,
       e.ended_at
     FROM episode_embeddings ee
     JOIN episodes e ON e.episode_id = ee.episode_id
     WHERE ee.student_phone = $1
     ORDER BY ee.embedding <=> $2::vector
     LIMIT $3`,
    [phone, JSON.stringify(queryEmbedding), topK]
  );
}
