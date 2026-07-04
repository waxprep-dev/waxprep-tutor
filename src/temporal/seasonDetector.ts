// ============================================================
// THE SEASON DETECTOR — Automatic Conversation Arc Detection
// Knows when a season ends and a new one begins
// ============================================================

import { query, queryOne } from "../db/client";
import { embed } from "../memory/embeddings";
import { logger } from "../utils/logger";

export class SeasonDetector {
  // ============================================================
  // CHECK IF SEASON SHOULD END
  // ============================================================
  async checkSeasonEnd(
    studentPhone: string,
    currentMessage: string,
    currentEpisodeId: string
  ): Promise<{ shouldEnd: boolean; reason: string; summary?: string; nextSeasonTrigger?: string }> {
    const currentSeason = await queryOne(
      `SELECT * FROM conversation_seasons 
       WHERE student_phone = $1 AND is_active = true
       ORDER BY season_number DESC LIMIT 1`,
      [studentPhone]
    );

    if (!currentSeason) {
      return { shouldEnd: false, reason: "No active season" };
    }

    const checks = await Promise.all([
      this.checkTopicShift(studentPhone, currentMessage, currentSeason),
      this.checkTimeGap(studentPhone, currentSeason),
      this.checkCompletionSignals(currentMessage),
      this.checkEmotionalArc(studentPhone, currentSeason),
      this.checkMessageCount(currentSeason)
    ]);

    // If any check says end, end the season
    for (const check of checks) {
      if (check.shouldEnd) {
        const summary = await this.generateSeasonSummary(studentPhone, currentSeason.season_id);
        return {
          shouldEnd: true,
          reason: check.reason,
          summary,
          nextSeasonTrigger: currentMessage
        };
      }
    }

    return { shouldEnd: false, reason: "Season continues" };
  }

  // ============================================================
  // END SEASON — Generate summary, mark inactive, create new season
  // ============================================================
  async endSeason(
    studentPhone: string,
    seasonId: string,
    summary: string,
    triggerMessage: string
  ): Promise<{ newSeasonId: string; seasonNumber: number }> {
    const season = await queryOne(
      `SELECT season_number FROM conversation_seasons WHERE season_id = $1`,
      [seasonId]
    );

    // Mark old season as ended
    await query(
      `UPDATE conversation_seasons 
       SET ended_at = NOW(), is_active = false, summary = $2, trigger_message = $3
       WHERE season_id = $1`,
      [seasonId, summary, triggerMessage]
    );

    // Create new season
    const newSeason = await queryOne<{ season_id: string; season_number: number }>(
      `INSERT INTO conversation_seasons (student_phone, season_number, is_active)
       VALUES ($1, $2, true)
       RETURNING season_id, season_number`,
      [studentPhone, (season?.season_number || 0) + 1]
    );

    if (!newSeason) {
      throw new Error(`Failed to create new season for student ${studentPhone}`);
    }

    return { newSeasonId: newSeason.season_id, seasonNumber: newSeason.season_number };
  }

  // ============================================================
  // CHECK 1: Topic Shift Detection
  // ============================================================
  private async checkTopicShift(
    studentPhone: string,
    currentMessage: string,
    currentSeason: any
  ): Promise<{ shouldEnd: boolean; reason: string }> {
    const seasonMessages = await query(
      `SELECT content FROM episodic_chunks
       WHERE student_phone = $1 AND episode_id IN (
         SELECT episode_id FROM message_log WHERE season_id = $2
       )
       ORDER BY sequence_number DESC LIMIT 10`,
      [studentPhone, currentSeason.season_id]
    );

    if (seasonMessages.length < 3) return { shouldEnd: false, reason: "Not enough context" };

    const currentEmbedding = await embed(currentMessage);
    const seasonEmbedding = await embed(seasonMessages.map((m: any) => m.content).join(" "));

    if (!currentEmbedding || !seasonEmbedding) return { shouldEnd: false, reason: "Embedding failed" };

    const similarity = this.cosineSimilarity(currentEmbedding, seasonEmbedding);

    if (similarity < 0.6) {
      return { shouldEnd: true, reason: `Topic shift detected (similarity: ${similarity.toFixed(2)})` };
    }

    return { shouldEnd: false, reason: "Topic consistent" };
  }

  // ============================================================
  // CHECK 2: Time Gap Detection
  // ============================================================
  private async checkTimeGap(studentPhone: string, currentSeason: any): Promise<{ shouldEnd: boolean; reason: string }> {
    const lastMessage = await queryOne(
      `SELECT timestamp FROM message_log
       WHERE student_phone = $1 AND season_id = $2
       ORDER BY timestamp DESC LIMIT 1`,
      [studentPhone, currentSeason.season_id]
    );

    if (!lastMessage) return { shouldEnd: false, reason: "No messages in season" };

    const hoursSinceLastMessage = (Date.now() - new Date(lastMessage.timestamp).getTime()) / 3600000;

    if (hoursSinceLastMessage > 24) {
      return { shouldEnd: true, reason: `24+ hour gap (${hoursSinceLastMessage.toFixed(1)}h)` };
    }

    return { shouldEnd: false, reason: "Recent activity" };
  }

  // ============================================================
  // CHECK 3: Completion Signals
  // ============================================================
  private checkCompletionSignals(message: string): { shouldEnd: boolean; reason: string } {
    const completionPhrases = [
      "thank you", "thanks", "i'm done", "got it", "understood", "clear now",
      "that helps", "makes sense", "i get it", "finished", "completed",
      "no more questions", "i'm good", "all clear", "sabi now", "e don set"
    ];

    const lower = message.toLowerCase();
    for (const phrase of completionPhrases) {
      if (lower.includes(phrase)) {
        return { shouldEnd: true, reason: `Completion signal: "${phrase}"` };
      }
    }

    return { shouldEnd: false, reason: "No completion signal" };
  }

  // ============================================================
  // CHECK 4: Emotional Arc Completion
  // ============================================================
  private async checkEmotionalArc(studentPhone: string, currentSeason: any): Promise<{ shouldEnd: boolean; reason: string }> {
    const chunks = await query(
      `SELECT emotional_valence, cognitive_load FROM episodic_chunks
       WHERE student_phone = $1 AND episode_id IN (
         SELECT episode_id FROM message_log WHERE season_id = $2
       )
       ORDER BY sequence_number ASC`,
      [studentPhone, currentSeason.season_id]
    );

    if (chunks.length < 5) return { shouldEnd: false, reason: "Not enough emotional data" };

    const firstThird = chunks.slice(0, Math.floor(chunks.length / 3));
    const lastThird = chunks.slice(Math.floor(chunks.length * 2 / 3));

    const startValence = firstThird.reduce((s: number, c: any) => s + (c.emotional_valence || 0), 0) / firstThird.length;
    const endValence = lastThird.reduce((s: number, c: any) => s + (c.emotional_valence || 0), 0) / lastThird.length;
    const startLoad = firstThird.reduce((s: number, c: any) => s + (c.cognitive_load || 0), 0) / firstThird.length;
    const endLoad = lastThird.reduce((s: number, c: any) => s + (c.cognitive_load || 0), 0) / lastThird.length;

    if (endValence > startValence + 0.3 && endLoad < startLoad - 0.2) {
      return { shouldEnd: true, reason: `Emotional arc complete: confused(${startValence.toFixed(2)}) → confident(${endValence.toFixed(2)})` };
    }

    return { shouldEnd: false, reason: "Emotional arc incomplete" };
  }

  // ============================================================
  // CHECK 5: Message Count
  // ============================================================
  private async checkMessageCount(currentSeason: any): Promise<{ shouldEnd: boolean; reason: string }> {
    const count = await queryOne(
      `SELECT COUNT(*) as cnt FROM message_log WHERE season_id = $1`,
      [currentSeason.season_id]
    );

    if (count && count.cnt > 50) {
      return { shouldEnd: true, reason: `Season too long (${count.cnt} messages) — time to consolidate` };
    }

    return { shouldEnd: false, reason: "Season length OK" };
  }

  // ============================================================
  // GENERATE SEASON SUMMARY
  // ============================================================
  private async generateSeasonSummary(studentPhone: string, seasonId: string): Promise<string> {
    try {
      const chunks = await query(
        `SELECT content, speaker, emotional_valence FROM episodic_chunks
         WHERE student_phone = $1 AND episode_id IN (
           SELECT episode_id FROM message_log WHERE season_id = $2
         )
         ORDER BY sequence_number ASC`,
        [studentPhone, seasonId]
      );

      const keyConcepts = await query(
        `SELECT DISTINCT concept_name FROM semantic_concepts
         WHERE student_phone = $1 AND first_encountered > (
           SELECT started_at FROM conversation_seasons WHERE season_id = $2
         )`,
        [studentPhone, seasonId]
      );

      const concepts = keyConcepts.map((c: any) => c.concept_name).join(", ");
      const emotionalJourney = this.describeEmotionalJourney(chunks);

      return concepts ? `Learned ${concepts}. Emotional journey: ${emotionalJourney}.` : `Emotional journey: ${emotionalJourney}.`;
    } catch (error) {
      logger.warn("Season summary generation failed", { error: error instanceof Error ? error.message : String(error) });
      return "Season completed.";
    }
  }

  private describeEmotionalJourney(chunks: any[]): string {
    if (chunks.length === 0) return "unknown";

    const valences = chunks.map(c => c.emotional_valence || 0);
    const start = valences[0];
    const end = valences[valences.length - 1];
    const min = Math.min(...valences);
    const max = Math.max(...valences);

    if (end > start + 0.3) return `struggled(${min.toFixed(1)}) → breakthrough(${end.toFixed(1)})`;
    if (end < start - 0.3) return `started well(${start.toFixed(1)}) → frustrated(${end.toFixed(1)})`;
    return `steady(${start.toFixed(1)} → ${end.toFixed(1)})`;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }
}

export const seasonDetector = new SeasonDetector();
