// FILE: src/workers/consolidation.ts
// MEMORY CONSOLIDATION WORKER

import { query, queryOne } from "../db/client";
import { mindPalace } from "../memory/mindPalace";
import { logger } from "../utils/logger";

export async function consolidateMemories(): Promise<void> {
  logger.info("Starting memory consolidation...");

  try {
    // Get students with fresh episodic memories
    const students = await query(
      `SELECT DISTINCT student_phone FROM memory_chunks 
       WHERE memory_type = 'episodic' AND consolidation_status = 'fresh'
       AND student_phone IS NOT NULL`
    );

    let totalMerged = 0;
    let totalCreated = 0;

    for (const student of students) {
      const result = await mindPalace.consolidateEpisodes(student.student_phone);
      totalMerged += result.merged;
      totalCreated += result.created;
    }

    // Apply decay
    const decayResult = await mindPalace.applyDecay();

    logger.info("Memory consolidation complete", {
      studentsProcessed: students.length,
      totalMerged,
      totalCreated,
      pruned: decayResult.pruned
    });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Memory consolidation failed", { error: errMsg });
    throw error;
  }
}
