// FILE: src/workers/dreamCron.ts
// ============================================================
// DREAM CRON — Scheduled entry point for the Dream Worker
// Run this as a Render cron job or scheduled function at 2 AM
// ============================================================

import dreamWorker from "./dreamWorker";
import { logger } from "../utils/logger";

/**
 * Main entry point for the cron job.
 * Runs the Dream Worker and logs the result.
 */
export async function runDream(): Promise<void> {
  const startTime = Date.now();
  logger.info("🕐 Dream cron triggered at", { time: new Date().toISOString() });

  try {
    const result = await dreamWorker.run();

    logger.info("✅ Dream cron completed successfully", {
      durationMs: result.durationMs,
      chunksProcessed: result.chunksProcessed,
      chunksMerged: result.chunksMerged,
      chunksPruned: result.chunksPruned,
      patternsExtracted: result.patternsExtracted,
      genesEvolved: result.genesEvolved,
      predictionsValidated: result.predictionsValidated
    });

  } catch (error) {
    logger.error("❌ Dream cron failed", {
      error: error.message,
      stack: error.stack,
      durationMs: Date.now() - startTime
    });
    throw error;
  }
}

// ============================================================
// STANDALONE EXECUTION (if run directly via node/ts-node)
// ============================================================

if (require.main === module) {
  runDream()
    .then(() => {
      logger.info("Dream completed successfully — exiting");
      process.exit(0);
    })
    .catch((err) => {
      logger.error("Dream failed with error:", err);
      process.exit(1);
    });
}
