// FILE: src/workers/dreamWorker.ts
// ============================================================
// THE DREAM WORKER — Nightly Memory Consolidation
// Runs while students sleep. Consolidates memories.
// Extracts patterns. Evolves prompts. Decays old data.
// ============================================================

import { mindPalace } from "../memory/mindPalace";
import { query, queryOne } from "../db/client";
import { logger } from "../utils/logger";
import { callLLM } from "../llm/client";

export interface DreamResult {
  chunksProcessed: number;
  chunksMerged: number;
  chunksPruned: number;
  patternsExtracted: number;
  genesEvolved: number;
  predictionsValidated: number;
  durationMs: number;
}

export class DreamWorker {
  async run(): Promise<DreamResult> {
    const startTime = Date.now();
    logger.info("🌙 Dream Worker starting...");

    const jobId = await this.startJob();

    try {
      // ============================================================
      // PHASE 1: Memory Decay
      // ============================================================
      const decayResult = await mindPalace.applyDecay();
      logger.info("Phase 1: Memory decay complete", decayResult);

      // ============================================================
      // PHASE 2: Consolidate Episodic → Semantic
      // ============================================================
      let totalMerged = 0;
      let totalCreated = 0;
      let studentsProcessed = 0;

      const students = await query(
        `SELECT DISTINCT student_phone FROM memory_chunks 
         WHERE memory_type = 'episodic' AND consolidation_status = 'fresh'
         AND student_phone IS NOT NULL`
      );

      for (const student of students) {
        const result = await mindPalace.consolidateEpisodes(student.student_phone);
        totalMerged += result.merged;
        totalCreated += result.created;
        studentsProcessed++;
      }

      logger.info("Phase 2: Episode consolidation complete", {
        studentsProcessed,
        totalMerged,
        totalCreated
      });

      // ============================================================
      // PHASE 3: Extract Cross-Student Patterns
      // ============================================================
      const patternsExtracted = await this.extractPatterns();
      logger.info("Phase 3: Pattern extraction complete", { patternsExtracted });

      // ============================================================
      // PHASE 4: Evolve Prompt Genes
      // ============================================================
      const genesEvolved = await this.evolvePromptGenes();
      logger.info("Phase 4: Prompt evolution complete", { genesEvolved });

      // ============================================================
      // PHASE 5: Validate Predictions
      // ============================================================
      const predictionsValidated = await this.validatePredictions();
      logger.info("Phase 5: Prediction validation complete", { predictionsValidated });

      // ============================================================
      // PHASE 6: Update Archetype Statistics
      // ============================================================
      await this.updateArchetypeStats();
      logger.info("Phase 6: Archetype stats updated");

      const durationMs = Date.now() - startTime;

      await this.completeJob(jobId, {
        chunks_processed: studentsProcessed,
        chunks_merged: totalMerged,
        chunks_pruned: decayResult.pruned,
        patterns_extracted: patternsExtracted
      });

      logger.info("🌙 Dream complete", { durationMs });

      return {
        chunksProcessed: studentsProcessed,
        chunksMerged: totalMerged,
        chunksPruned: decayResult.pruned,
        patternsExtracted,
        genesEvolved,
        predictionsValidated,
        durationMs
      };

    } catch (error) {
      logger.error("Dream worker failed", { error: error.message });
      await this.failJob(jobId, error.message);
      throw error;
    }
  }

  // ============================================================
  // JOB TRACKING
  // ============================================================

  private async startJob(): Promise<string> {
    const row = await queryOne(
      `INSERT INTO consolidation_jobs (status) 
       VALUES ('running') 
       RETURNING job_id`
    );
    return row.job_id;
  }

  private async completeJob(jobId: string, stats: any): Promise<void> {
    await query(
      `UPDATE consolidation_jobs 
       SET status = 'completed', 
           completed_at = NOW(), 
           chunks_processed = $2, 
           chunks_merged = $3, 
           chunks_pruned = $4, 
           patterns_extracted = $5
       WHERE job_id = $1`,
      [jobId, stats.chunks_processed, stats.chunks_merged, stats.chunks_pruned, stats.patterns_extracted]
    );
  }

  private async failJob(jobId: string, error: string): Promise<void> {
    await query(
      `UPDATE consolidation_jobs SET status = 'failed' WHERE job_id = $1`,
      [jobId]
    );
  }

  // ============================================================
  // PHASE 3: Extract Patterns
  // ============================================================

  private async extractPatterns(): Promise<number> {
    // Find high-engagement students and their successful procedural memories
    const successfulInteractions = await query(
      `SELECT m.student_phone, m.content, m.metadata, s.profile
       FROM memory_chunks m
       LEFT JOIN students s ON s.phone = m.student_phone
       WHERE m.memory_type = 'procedural'
       AND m.base_activation > 0.7
       AND m.access_count > 3
       AND m.student_phone IS NOT NULL
       LIMIT 50`
    );

    if (successfulInteractions.length === 0) return 0;

    let extracted = 0;
    let processed = 0;

    for (const interaction of successfulInteractions) {
      if (processed >= 20) break; // Limit per run

      const profile = interaction.profile || {};
      const archetype = this.inferArchetype(profile);
      const patternHash = this.hashPattern(interaction.content);

      // Check if pattern already exists
      const existing = await queryOne(
        `SELECT pattern_id FROM teaching_patterns WHERE pattern_hash = $1`,
        [patternHash]
      );

      if (!existing) {
        await query(
          `INSERT INTO teaching_patterns (
            pattern_hash, archetype_signature, pattern_type, pattern_data, success_count, is_anonymized
          ) VALUES ($1, $2, $3, $4, 1, true)`,
          [
            patternHash,
            JSON.stringify(archetype),
            "approach",
            JSON.stringify({
              rule: interaction.content,
              source: "procedural_memory",
              metadata: interaction.metadata
            })
          ]
        );
        extracted++;
      } else {
        // Update success count
        await query(
          `UPDATE teaching_patterns 
           SET success_count = success_count + 1,
               success_rate = (success_count + 1)::float / (success_count + failure_count + 1),
               last_validated = NOW()
           WHERE pattern_hash = $1`,
          [patternHash]
        );
      }
      processed++;
    }

    return extracted;
  }

  private inferArchetype(profile: any): any {
    return {
      learning_style: profile?.learning_style?.primary || "unknown",
      background: profile?.city ? "city" : "village",
      subject: profile?.goals?.[0]?.subject || "any",
      confidence: profile?.confidence_baseline || "medium"
    };
  }

  private hashPattern(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  // ============================================================
  // PHASE 4: Evolve Prompt Genes
  // ============================================================

  private async evolvePromptGenes(): Promise<number> {
    // Find high-performing prompt variants
    const winners = await query(
      `SELECT gene_composition, fitness_score, engagement_lift
       FROM prompt_variants
       WHERE is_active = true
       AND fitness_score > 0.7
       ORDER BY fitness_score DESC
       LIMIT 5`
    );

    if (winners.length < 2) return 0;

    let evolved = 0;

    for (const winner of winners) {
      // Mutate: create new gene combinations
      const genes = winner.gene_composition;
      const newGenes = await this.mutateGenes(genes);

      if (newGenes) {
        await query(
          `INSERT INTO prompt_variants (
            variant_name, gene_composition, fitness_score, is_active
          ) VALUES ($1, $2, 0.5, false)`,
          [`evolved_${Date.now()}`, JSON.stringify(newGenes)]
        );
        evolved++;
      }
    }

    // Retire weak genes
    await query(
      `UPDATE prompt_genes 
       SET success_score = success_score * 0.9
       WHERE success_score < 0.3
       AND usage_count > 10`
    );

    return evolved;
  }

  private async mutateGenes(genes: any): Promise<any | null> {
    try {
      const prompt = `You are a prompt evolution engine. Given these successful prompt genes, generate a NEW variant.

Current genes: ${JSON.stringify(genes, null, 2)}

Rules:
- Keep the core teaching philosophy
- Try a different tone or cultural angle
- Make it more specific to Nigerian students
- Output ONLY the new gene composition as JSON`;

      const response = await callLLM({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 1000,
        model: "groq"
      });

      const cleaned = response.content?.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim() || "";
      return JSON.parse(cleaned);
    } catch (e) {
      logger.warn("Gene mutation failed", { error: e.message });
      return null;
    }
  }

  // ============================================================
  // PHASE 5: Validate Predictions
  // ============================================================

  private async validatePredictions(): Promise<number> {
    const unresolved = await query(
      `SELECT * FROM predictions 
       WHERE resolved_at IS NULL 
       AND triggered_at < NOW() - INTERVAL '3 days'`
    );

    if (unresolved.length === 0) return 0;

    let validated = 0;
    for (const pred of unresolved) {
      let wasAccurate = false;

      if (pred.prediction_type === "burnout_risk") {
        // Check if they stopped messaging after high risk prediction
        const risk = pred.predicted_value?.risk || 0;
        if (risk > 0.7) {
          const recent = await queryOne(
            `SELECT COUNT(*) as msg_count FROM message_log
             WHERE student_phone = $1 AND direction = 'inbound'
             AND timestamp > $2`,
            [pred.student_phone, pred.triggered_at]
          );
          // If they stopped messaging, burnout prediction was accurate
          wasAccurate = recent.msg_count === 0;
        } else {
          // Low risk prediction → they should still be messaging
          const recent = await queryOne(
            `SELECT COUNT(*) as msg_count FROM message_log
             WHERE student_phone = $1 AND direction = 'inbound'
             AND timestamp > $2`,
            [pred.student_phone, pred.triggered_at]
          );
          wasAccurate = recent.msg_count > 0;
        }
      } else if (pred.prediction_type === "next_struggle") {
        // Check if they struggled with the predicted concept
        const concept = pred.predicted_value?.concept || "";
        if (concept) {
          const struggled = await queryOne(
            `SELECT COUNT(*) as count FROM memory_chunks
             WHERE student_phone = $1 AND memory_type = 'semantic'
             AND metadata->>'concept' = $2
             AND COALESCE((metadata->>'mastery')::float, 0) < 0.4
             AND created_at > $3`,
            [pred.student_phone, concept, pred.triggered_at]
          );
          wasAccurate = struggled.count > 0;
        }
      }

      await query(
        `UPDATE predictions SET resolved_at = NOW(), was_accurate = $2 
         WHERE prediction_id = $1`,
        [pred.prediction_id, wasAccurate]
      );
      validated++;
    }

    return validated;
  }

  // ============================================================
  // PHASE 6: Update Archetype Statistics
  // ============================================================

  private async updateArchetypeStats(): Promise<void> {
    await query(
      `UPDATE student_archetypes SET
        student_count = (
          SELECT COUNT(*) FROM students 
          WHERE profile IS NOT NULL
        ),
        avg_engagement = (
          SELECT AVG(message_count_in) FROM students 
          WHERE message_count_in IS NOT NULL
        )
       WHERE archetype_id IN (SELECT archetype_id FROM student_archetypes)`
    );
  }
}

export default new DreamWorker();
