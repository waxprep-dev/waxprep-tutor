import { query, queryOne } from "../db/client";
import { ChatMessage } from "../llm/types";

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

export async function getRecentEpisodes(phone: string, n: number = 3): Promise<Episode[]> {
  return query<Episode>(
    `SELECT * FROM episodes
     WHERE student_phone = $1 AND ended_at IS NOT NULL AND summary IS NOT NULL
     ORDER BY ended_at DESC LIMIT $2`,
    [phone, n]
  );
}

export async function getRecentHistory(
  phone: string,
  episodeId: string,
  excludeMessageId: string,
  limit: number = 16
): Promise<ChatMessage[]> {
  const rows = await query<{
    direction: string;
    raw_text: string;
    ai_response: string | null;
  }>(
    `SELECT direction, raw_text, ai_response FROM (
       SELECT direction, raw_text, ai_response, timestamp, message_id
       FROM message_log
       WHERE student_phone = $1 AND episode_id = $2 AND message_id != $3
       ORDER BY timestamp DESC
       LIMIT $4
     ) recent
     ORDER BY timestamp ASC`,
    [phone, episodeId, excludeMessageId, limit]
  );

  return rows.map((r) => ({
    role: r.direction === "inbound" ? "user" : "assistant",
    content: r.direction === "inbound" ? r.raw_text : r.ai_response || r.raw_text,
  })) as ChatMessage[];
}

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
