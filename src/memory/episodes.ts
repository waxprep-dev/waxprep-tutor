import { query, queryOne, withTransaction } from "../db/client";
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
  status: string;
}

export async function getRecentEpisodes(phone: string, limit: number = 3): Promise<Episode[]> {
  return query(
    `SELECT * FROM episodes 
     WHERE student_phone = $1 AND status = 'closed'
     ORDER BY ended_at DESC NULLS LAST 
     LIMIT $2`,
    [phone, limit]
  );
}

export async function searchEpisodes(
  phone: string, 
  embedding: number[], 
  limit: number = 5
): Promise<any[]> {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return [];
  }
  
  if (!embedding.every(n => typeof n === "number" && !isNaN(n))) {
    logger.warn("Embedding contains non-numeric values", { phone });
    return [];
  }

  const vectorLiteral = `[${embedding.join(",")}]`;

  return query(
    `SELECT episode_id, summary, summary_embedding <=> $2::vector as distance
     FROM episodes
     WHERE student_phone = $1 AND summary_embedding IS NOT NULL
     ORDER BY distance ASC LIMIT $3`,
    [phone, vectorLiteral, limit]
  );
}

export async function getOrCreateCurrentEpisode(phone: string): Promise<{ episode_id: string }> {
  return withTransaction(async (client) => {
    const active = await client.query(
      `SELECT episode_id, message_count, started_at 
       FROM episodes 
       WHERE student_phone = $1 AND status = 'active'
       ORDER BY started_at DESC
       LIMIT 1
       FOR UPDATE`,
      [phone]
    );

    if (active.rows.length > 0) {
      const episode = active.rows[0];
      
      if (episode.message_count >= 50) {
        await client.query(
          `UPDATE episodes SET status = 'closed', ended_at = NOW(), ended_reason = 'length'
           WHERE episode_id = $1`,
          [episode.episode_id]
        );
      } else {
        const startedAt = new Date(episode.started_at);
        const hoursElapsed = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);
        if (hoursElapsed > 6) {
          await client.query(
            `UPDATE episodes SET status = 'closed', ended_at = NOW(), ended_reason = 'timeout'
             WHERE episode_id = $1`,
            [episode.episode_id]
          );
        } else {
          return { episode_id: episode.episode_id };
        }
      }
    }

    const result = await client.query(
      `INSERT INTO episodes (student_phone) VALUES ($1) RETURNING episode_id`,
      [phone]
    );
    
    return { episode_id: result.rows[0].episode_id };
  });
}

export async function closeEpisode(
  episodeId: string, 
  reason: "timeout" | "length" | "manual" | "system" = "manual",
  summary?: string
): Promise<void> {
  await query(
    `UPDATE episodes 
     SET status = 'closed', 
         ended_at = NOW(), 
         ended_reason = $2,
         summary = COALESCE($3, summary)
     WHERE episode_id = $1`,
    [episodeId, reason, summary]
  );
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
  excludeMessageId?: string,
  maxMessages: number = 20
): Promise<any[]> {
  const limit = Math.min(Math.max(maxMessages, 1), 50);
  
  let queryText = `
    SELECT raw_text as content, timestamp, direction
    FROM message_log
    WHERE student_phone = $1 AND episode_id = $2
  `;
  
  const params: any[] = [phone, episodeId];

  if (excludeMessageId) {
    queryText += ` AND message_id != $3`;
    params.push(excludeMessageId.slice(0, 256));
  }

  queryText += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  return query(queryText, params);
}

export async function storeEpisodeEmbedding(
  episodeId: string,
  summary: string
): Promise<void> {
  if (!summary || summary.trim().length === 0) {
    return;
  }
  
  try {
    const embedding = await embed(summary);
    if (embedding && Array.isArray(embedding)) {
      const vectorLiteral = `[${embedding.join(",")}]`;
      await query(
        `UPDATE episodes SET summary_embedding = $1::vector WHERE episode_id = $2`,
        [vectorLiteral, episodeId]
      );
    }
  } catch (error: any) {
    logger.error("Failed to store episode embedding", { episodeId, error: error.message });
  }
}
