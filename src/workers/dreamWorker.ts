// ============================================================
// THE DREAM WORKER v2 — Nightly Consolidation & Evolution
// Runs while students sleep. The system heals and grows.
// ============================================================

import { hippocampus } from "../memory/hippocampus";
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
    logger.info("🌙 Dream Worker v2 starting...");

    const jobId = await this.startJob();

    try {
      // Phase 1: Prune working memory
      await query(`SELECT prune_working_memory()`);
      logger.info("Working memory pruned");

      // Phase 2: Consolidate episodic → semantic (per student)
      const students = await query(
        `SELECT DISTINCT student_phone FROM episodic_chunks WHERE consolidation_status = 'fresh'`
      );
      let totalMerged = 0, totalConcepts = 0;
      let chunksPruned = 0;
      for (const s of students) {
        const result = await hippocampus.consolidateEpisodes(s.student_phone);
        totalMerged += result.merged;
        totalConcepts += result.concepts;
        chunksPruned += result.pruned || 0;
      }
      logger.info("Episode consolidation complete", { totalMerged, totalConcepts });

      // Phase 3: Evolve prompt genes
      const genesEvolved = await this.evolvePromptGenes();
      logger.info("Prompt evolution complete", { genesEvolved });

      // Phase 4: Validate predictions
      const predictionsValidated = await this.validatePredictions();
      logger.info("Prediction validation complete", { predictionsValidated });

      // Phase 5: Update circadian profiles
      await this.updateCircadianProfiles();
      logger.info("Circadian profiles updated");

      // Phase 6: Heal systemic issues
      const healed = await this.healSystemicIssues();
      logger.info("Systemic healing complete", { healed });

      // Phase 7: Extract cross-student patterns
      const patternsExtracted = await this.extractPatterns();
      logger.info("Pattern extraction complete", { patternsExtracted });

      const durationMs = Date.now() - startTime;

      await this.completeJob(jobId, { totalMerged, totalConcepts, patternsExtracted, genesEvolved, predictionsValidated });

      logger.info("🌙 Dream complete", { durationMs });

      return {
        chunksProcessed: students.length,
        chunksMerged: totalMerged,
        chunksPruned: chunksPruned,
        patternsExtracted,
        genesEvolved,
        predictionsValidated,
        durationMs
      };

    } catch (error: any) {
      logger.error("Dream worker failed", { error: error.message });
      await this.failJob(jobId, error.message);
      throw error;
    }
  }

  private async evolvePromptGenes(): Promise<number> {
    const winners = await query(
      `SELECT gene_id, gene_name, gene_template, success_score, usage_count 
       FROM prompt_genes 
       WHERE success_score > 0.7 AND usage_count > 10 
       ORDER BY success_score DESC LIMIT 10`
    );
    if (winners.length < 2) return 0;

    let evolved = 0;
    for (const winner of winners) {
      const prompt = `Evolve this successful prompt gene into a variant that might perform even better for Nigerian students.

Gene: ${winner.gene_name}
Current text: ${winner.gene_template}
Success score: ${winner.success_score}

Create a variant that:
- Keeps the core intent
- Tries a different cultural angle or tone
- Is more specific to WhatsApp tutoring
- Output ONLY the new gene text, nothing else.`;

      try {
        const res = await callLLM({ 
          messages: [{ role: "user", content: prompt }], 
          temperature: 0.8, 
          max_tokens: 500 
        });
        const newText = res.content?.trim();
        if (newText && newText.length > 50) {
          await query(
            `INSERT INTO prompt_genes (gene_type, gene_name, gene_template, evolved_from, success_score)
             VALUES ($1, $2, $3, $4, 0.5)`,
            [winner.gene_name.split('_')[0] || 'general', `evolved_${winner.gene_name}_${Date.now()}`, newText, winner.gene_id]
          );
          evolved++;
        }
      } catch (e) {
        // Skip failed evolutions
      }
    }

    // Retire weak genes
    await query(
      `UPDATE prompt_genes SET success_score = success_score * 0.9 
       WHERE success_score < 0.3 AND usage_count > 20`
    );
    return evolved;
  }

  private async validatePredictions(): Promise<number> {
    const unresolved = await query(
      `SELECT * FROM predictions 
       WHERE resolved_at IS NULL AND triggered_at < NOW() - INTERVAL '3 days'`
    );
    let validated = 0;
    for (const pred of unresolved) {
      let wasAccurate = false;
      if (pred.prediction_type === 'burnout_risk') {
        const recent = await queryOne(
          `SELECT COUNT(*) as cnt FROM message_log 
           WHERE student_phone = $1 AND timestamp > $2`,
          [pred.student_phone, pred.triggered_at]
        );
        wasAccurate = recent.cnt === 0;
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

  private async updateCircadianProfiles(): Promise<void> {
    const students = await query(
      `SELECT DISTINCT student_phone FROM message_log 
       WHERE timestamp > NOW() - INTERVAL '1 day'`
    );
    for (const s of students) {
      const hourly = await query(
        `SELECT EXTRACT(HOUR FROM timestamp) as hour, 
                AVG(latency_ms) as avg_latency, 
                AVG(LENGTH(raw_text)) as avg_length
         FROM message_log 
         WHERE student_phone = $1 AND timestamp > NOW() - INTERVAL '7 days'
         GROUP BY EXTRACT(HOUR FROM timestamp)`,
        [s.student_phone]
      );
      const responseTimes: Record<number, number> = {};
      const engagements: Record<number, number> = {};
      for (const row of hourly) {
        responseTimes[parseInt(row.hour)] = parseFloat(row.avg_latency || 0);
        engagements[parseInt(row.hour)] = parseFloat(row.avg_length || 0);
      }
      await query(
        `UPDATE circadian_profiles 
         SET response_time_by_hour = $2, engagement_by_hour = $3, last_updated = NOW()
         WHERE student_phone = $1`,
        [s.student_phone, JSON.stringify(responseTimes), JSON.stringify(engagements)]
      );
    }
  }

  private async healSystemicIssues(): Promise<number> {
    const recurring = await query(
      `SELECT event_type, COUNT(*) as cnt, 
              AVG(EXTRACT(EPOCH FROM (resolved_at - timestamp))) as avg_recovery
       FROM healing_events 
       WHERE timestamp > NOW() - INTERVAL '7 days' AND recovery_success = false
       GROUP BY event_type 
       HAVING COUNT(*) > 3`
    );
    
    let healed = 0;
    for (const issue of recurring) {
      await query(
        `INSERT INTO procedural_rules (rule_type, trigger_condition, action, confidence)
         VALUES ($1, $2, $3, 0.7)
         ON CONFLICT DO NOTHING`,
        [
          'fallback_strategy',
          `Systemic issue: ${issue.event_type} (${issue.cnt} occurrences)`,
          `Apply preventive measure for ${issue.event_type}`
        ]
      );
      healed++;
    }
    return healed;
  }

  private async extractPatterns(): Promise<number> {
    const successful = await query(
      `SELECT rule_type, action, AVG(success_rate) as avg_rate, COUNT(*) as cnt
       FROM procedural_rules 
       WHERE success_rate > 0.7 AND is_active = true
       GROUP BY rule_type, action 
       HAVING COUNT(*) > 1`
    );
    
    let extracted = 0;
    for (const pattern of successful) {
      const patternHash = this.hashPattern(pattern.action);
      const existing = await queryOne(
        `SELECT pattern_id FROM teaching_patterns WHERE pattern_hash = $1`,
        [patternHash]
      );
      if (!existing) {
        await query(
          `INSERT INTO teaching_patterns (pattern_hash, archetype_signature, pattern_type, pattern_data, success_count, success_rate)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            patternHash,
            JSON.stringify({ rule_type: pattern.rule_type }),
            pattern.rule_type || 'approach',
            JSON.stringify({ action: pattern.action, avg_success: pattern.avg_rate }),
            pattern.cnt,
            parseFloat(pattern.avg_rate || 0.5)
          ]
        );
        extracted++;
      }
    }
    return extracted;
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

  private async startJob(): Promise<string> {
    const row = await queryOne(
      `INSERT INTO consolidation_jobs (status) VALUES ('running') RETURNING job_id`
    );
    return row.job_id;
  }

  private async completeJob(jobId: string, stats: any): Promise<void> {
    await query(
      `UPDATE consolidation_jobs 
       SET status = 'completed', completed_at = NOW(), 
           chunks_processed = $2, chunks_merged = $3, patterns_extracted = $4
       WHERE job_id = $1`,
      [jobId, stats.totalMerged, stats.totalConcepts, stats.patternsExtracted]
    );
  }

  private async failJob(jobId: string, error: string): Promise<void> {
    await query(
      `UPDATE consolidation_jobs SET status = 'failed' WHERE job_id = $1`,
      [jobId]
    );
  }
}

export const dreamWorker = new DreamWorker();
