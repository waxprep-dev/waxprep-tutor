// FILE: src/workers/dreamCron.ts
// DREAM CRON — Scheduled entry point for the Dream Worker

import dreamWorker from "./dreamWorker";
import { logger } from "../utils/logger";

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

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    
    // FIX: Create proper object
    const logPayload: Record<string, any> = {
      error: errMsg,
      durationMs: Date.now() - startTime
    };
    if (errStack) {
      logPayload.stack = errStack;
    }
    logger.error("❌ Dream cron failed", logPayload);
    throw error;
  }
}

if (require.main === module) {
  runDream()
    .then(() => {
      logger.info("Dream completed successfully — exiting");
      process.exit(0);
    })
    .catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("Dream failed with error:", errMsg);
      process.exit(1);
    });
}
