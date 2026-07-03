import { query, queryOne } from "../db/client";
import { embed } from "./embeddings";
import { logger } from "../utils/logger";

export interface Episode {
  episode_id: string;
  student_phone: string;
  started_at: string;
  ended_at?: string;
  summary?: string;
  key_moments?: any[];
  message_count: number;
}

export async function getRecentEpisodes(phone: string, limit: number = 3): Promise<Episode[]> {
  return query(
    `SELECT * FROM episodes WHERE student_phone = $1 AND ended_at IS NOT NULL
     ORDER BY ended_at DESC LIMIT $2`,
    [phone, limit]
  );
}

export async function searchEpisodes(phone: string, embedding: number[], limit: number = 5): Promise<any[]> {
  try {
    return query(
      `SELECT episode_id, summary, summary_embedding <=> $2::vector as distance
       FROM episodes
       WHERE student_phone = $1 AND summary_embedding IS NOT NULL
       ORDER BY distance ASC LIMIT $3`,
      [phone, JSON.stringify(embedding), limit]
    );
  } catch (error: any) {
    // Column doesn't exist yet — return empty
    if (error.message?.includes("column \"summary_embedding\" does not exist")) {
      logger.warn("summary_embedding column not found, returning empty results");
      return [];
    }
    throw error;
  }
}

export async function getOrCreateCurrentEpisode(phone: string): Promise<{ episode_id: string }> {
  let episode = await queryOne(
    `SELECT episode_id FROM episodes WHERE student_phone = $1 AND ended_at IS NULL`,
    [phone]
  );

  if (!episode) {
    const result = await queryOne(
      `INSERT INTO episodes (student_phone) VALUES ($1) RETURNING episode_id`,
      [phone]
    );
    episode = result;
  }

  return { episode_id: episode.episode_id };
}

export async function incrementEpisodeMessageCount(episodeId: string): Promise<void> {
  await query(
    `UPDATE episodes SET message_count = message_count + 1 WHERE episode_id = $1`,
    [episodeId]
  );
}

export async function getRecentHistory(
  phone: string,
  episodeId: string,
  excludeMessageId?: string
): Promise<any[]> {
  // FIX: Use raw_text, not content
  let queryText = `
    SELECT raw_text, timestamp, direction
    FROM message_log
    WHERE student_phone = $1 AND episode_id = $2
  `;

  const params: any[] = [phone, episodeId];

  if (excludeMessageId) {
    queryText += ` AND message_id != $3`;
    params.push(excludeMessageId);
  }

  queryText += ` ORDER BY timestamp DESC LIMIT 20`;

  const results = await query(queryText, params);
  
  // Map raw_text to content for compatibility
  return results.map((row: any) => ({
    content: row.raw_text,
    timestamp: row.timestamp,
    direction: row.direction
  }));
}

export async function storeEpisodeEmbedding(
  episodeId: string,
  summary: string
): Promise<void> {
  try {
    const embedding = await embed(summary);
    if (embedding) {
      await query(
        `UPDATE episodes SET summary_embedding = $1 WHERE episode_id = $2`,
        [JSON.stringify(embedding), episodeId]
      );
    }
  } catch (error) {
    logger.error("Failed to store episode embedding", { episodeId, error });
  }
}
