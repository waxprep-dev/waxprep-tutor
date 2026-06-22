import { query } from "../db/client";
import { logger } from "../utils/logger";
import { callLLM } from "../llm/client";
import { embed, embedBatch } from "../memory/embeddings";
import * as episodes from "../memory/episodes";

const COMPRESSION_THRESHOLD_DAYS = 7;

async function compressOldEpisodes(): Promise<void> {
  const oldEpisodes = await query<any>(
    `SELECT episode_id, student_phone, summary, compression_level
     FROM episodes
     WHERE ended_at IS NOT NULL
       AND ended_at < NOW() - ($1 || ' days')::interval
       AND compression_level < 2
     LIMIT 50`,
    [COMPRESSION_THRESHOLD_DAYS.toString()]
  );

  logger.info(`Found ${oldEpisodes.length} episodes to potentially compress`);

  for (const ep of oldEpisodes) {
    try {
      const response = await callLLM({
        messages: [
          {
            role: "user",
            content: `Compress this tutoring session summary into 1-2 sentences, keeping only what would be useful to recall months from now:\n\n${ep.summary}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
      });

      const newSummary = response.content || ep.summary;
      const newLevel = Math.min(2, ep.compression_level + 1);

      await query(
        `UPDATE episodes SET summary = $1, compression_level = $2 WHERE episode_id = $3`,
        [newSummary, newLevel, ep.episode_id]
      );

      const embedding = await embed(newSummary);
      if (embedding) {
        await episodes.storeEpisodeEmbedding(ep.episode_id, ep.student_phone, embedding, newSummary);
      }

      logger.info("Episode compressed", {
        episode_id: ep.episode_id,
        new_level: newLevel,
      });
    } catch (err: any) {
      logger.error("Failed to compress episode", {
        episode_id: ep.episode_id,
        error: err.message,
      });
    }
  }
}

async function main() {
  logger.info("Consolidation worker started");
  await compressOldEpisodes();
  logger.info("Consolidation worker done");
  process.exit(0);
}

main().catch((err) => {
  logger.error("Consolidation worker crashed", { error: err.message });
  process.exit(1);
});
