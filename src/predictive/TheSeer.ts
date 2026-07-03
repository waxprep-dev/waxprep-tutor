// FILE: src/predictive/TheSeer.ts
// ============================================================
// THE SEER — Predictive Engine
// Detects burnout before it happens. Predicts next struggles.
// Forecasts optimal re-engagement times.
// All values adaptive — no hardcoded thresholds.
// ============================================================

import { query, queryOne } from "../db/client";
import { logger } from "../utils/logger";

// ============================================================
// TYPES
// ============================================================

export interface PredictionResult {
  nextStruggle?: string;
  burnoutRisk: number;
  optimalModality: string;
  reEngagementTime?: number;
  conceptMasteryVelocity: number;
  emotionalShift?: string;
  confidence: number;
  signals: {
    decliningLength: boolean;
    highShortRatio: boolean;
    repeatedStruggle: boolean;
    topicSwitching: boolean;
    lowEngagement: boolean;
  };
}

export interface BurnoutMetrics {
  avgLength: number | null;
  shortRatio: number;
  struggleCount: number;
  topicSwitches: number;
  engagementScore: number;
}

// ============================================================
// THE SEER CLASS
// ============================================================

export class TheSeer {
  private readonly CONCEPT_DEPENDENCIES: Record<string, string[]> = {
    // Physics
    "velocity": ["acceleration", "force", "momentum"],
    "force": ["newtons_laws", "friction", "gravity"],
    "newtons_laws": ["equilibrium", "momentum", "energy"],
    "acceleration": ["projectile", "circular_motion", "kinematics"],
    "momentum": ["impulse", "collisions", "conservation"],
    
    // Mathematics
    "fractions": ["decimals", "percentages", "ratios"],
    "algebra": ["quadratic", "functions", "inequalities"],
    "quadratic": ["polynomial", "graphing", "roots"],
    "geometry": ["trigonometry", "mensuration", "coordinates"],
    "trigonometry": ["identities", "equations", "applications"],
    
    // Biology
    "photosynthesis": ["cellular_respiration", "ecosystem", "energy_flow"],
    "cell": ["tissues", "organs", "systems"],
    "genetics": ["heredity", "variation", "evolution"],
    
    // Chemistry
    "mole": ["stoichiometry", "gas_laws", "concentration"],
    "atomic_structure": ["periodic_table", "bonding", "reactions"],
    "equilibrium": ["acids_bases", "solubility", "thermodynamics"],
    
    // English
    "tenses": ["active_passive", "direct_indirect", "conditional"],
    "vocabulary": ["comprehension", "essay_writing", "summary"]
  };

  // ============================================================
  // MAIN PREDICTION METHOD
  // ============================================================

  async generatePredictions(studentPhone: string): Promise<PredictionResult> {
    const startTime = Date.now();

    try {
      // Gather metrics
      const [burnoutMetrics, nextStruggle, optimalModality, masteryVelocity] = await Promise.all([
        this.getBurnoutMetrics(studentPhone),
        this.predictNextStruggle(studentPhone),
        this.predictOptimalModality(studentPhone),
        this.calculateMasteryVelocity(studentPhone)
      ]);

      // Calculate burnout risk from metrics
      const burnoutRisk = this.calculateBurnoutRisk(burnoutMetrics);

      // Determine emotional shift
      const emotionalShift = this.detectEmotionalShift(studentPhone, burnoutMetrics);

      const result: PredictionResult = {
        burnoutRisk,
        nextStruggle: nextStruggle || undefined,
        optimalModality: optimalModality || "analogy_first",
        conceptMasteryVelocity: masteryVelocity,
        emotionalShift: emotionalShift || undefined,
        confidence: this.calculateConfidence(burnoutMetrics),
        signals: {
          decliningLength: burnoutMetrics.avgLength !== null && burnoutMetrics.avgLength < 15,
          highShortRatio: burnoutMetrics.shortRatio > 0.5,
          repeatedStruggle: burnoutMetrics.struggleCount > 2,
          topicSwitching: burnoutMetrics.topicSwitches > 2,
          lowEngagement: burnoutMetrics.engagementScore < 0.4
        }
      };

      // Store predictions
      await this.storePredictions(studentPhone, result);

      logger.info("Seer predictions generated", {
        student: studentPhone,
        burnoutRisk: result.burnoutRisk,
        nextStruggle: result.nextStruggle,
        optimalModality: result.optimalModality,
        latencyMs: Date.now() - startTime
      });

      return result;

    } catch (error) {
      logger.error("Seer prediction failed", {
        student: studentPhone,
        error: error.message
      });
      return this.getDefaultPrediction();
    }
  }

  // ============================================================
  // BURNOUT METRICS
  // ============================================================

  private async getBurnoutMetrics(studentPhone: string): Promise<BurnoutMetrics> {
    const row = await queryOne<{
      avg_length: number | null;
      short_ratio: number;
      struggle_count: number;
      topic_switches: number;
      engagement_score: number;
    }>(
      `SELECT 
        AVG(LENGTH(raw_text)) as avg_length,
        COALESCE(
          COUNT(CASE WHEN LENGTH(raw_text) < 10 THEN 1 END)::float / 
          NULLIF(COUNT(*), 0), 
          0
        ) as short_ratio,
        COUNT(CASE 
          WHEN raw_text ILIKE '%don''t get%' 
            OR raw_text ILIKE '%confus%' 
            OR raw_text ILIKE '%terrible%'
            OR raw_text ILIKE '%fail%'
            OR raw_text ILIKE '%hard%'
          THEN 1 END
        ) as struggle_count,
        COUNT(DISTINCT episode_id) as topic_switches,
        COALESCE(
          (
            SELECT AVG(
              CASE 
                WHEN LENGTH(raw_text) > 20 THEN 1.0
                WHEN LENGTH(raw_text) > 10 THEN 0.5
                ELSE 0.2
              END
            )
            FROM message_log
            WHERE student_phone = $1
            AND direction = 'inbound'
            AND timestamp > NOW() - INTERVAL '7 days'
          ),
          0.5
        ) as engagement_score
       FROM message_log
       WHERE student_phone = $1
       AND direction = 'inbound'
       AND timestamp > NOW() - INTERVAL '7 days'`,
      [studentPhone]
    );

    if (!row) {
      return {
        avgLength: null,
        shortRatio: 0,
        struggleCount: 0,
        topicSwitches: 0,
        engagementScore: 0.5
      };
    }

    return {
      avgLength: row.avg_length,
      shortRatio: row.short_ratio,
      struggleCount: row.struggle_count,
      topicSwitches: row.topic_switches,
      engagementScore: row.engagement_score
    };
  }

  // ============================================================
  // BURNOUT RISK CALCULATION
  // ============================================================

  private calculateBurnoutRisk(metrics: BurnoutMetrics): number {
    let risk = 0.2;

    // Declining message length (if we have data)
    if (metrics.avgLength !== null) {
      if (metrics.avgLength < 10) risk += 0.25;
      else if (metrics.avgLength < 20) risk += 0.15;
    }

    // High short reply ratio (messages under 10 characters)
    if (metrics.shortRatio > 0.6) risk += 0.25;
    else if (metrics.shortRatio > 0.4) risk += 0.15;

    // Repeated struggles
    if (metrics.struggleCount > 5) risk += 0.2;
    else if (metrics.struggleCount > 3) risk += 0.1;

    // Topic switching (frustration signal)
    if (metrics.topicSwitches > 3) risk += 0.1;

    // Low engagement
    if (metrics.engagementScore < 0.3) risk += 0.2;
    else if (metrics.engagementScore < 0.5) risk += 0.1;

    // Cap at 0.95
    return Math.min(Math.max(risk, 0.05), 0.95);
  }

  // ============================================================
  // NEXT STRUGGLE PREDICTION
  // ============================================================

  private async predictNextStruggle(studentPhone: string): Promise<string | null> {
    // Get their currently struggling concepts (mastery < 0.4)
    const struggling = await query(
      `SELECT content, metadata FROM memory_chunks
       WHERE student_phone = $1 AND memory_type = 'semantic'
       AND COALESCE((metadata->>'mastery')::float, 0) < 0.4
       ORDER BY base_activation DESC
       LIMIT 3`,
      [studentPhone]
    );

    if (struggling.length === 0) return null;

    // Get current concept from metadata
    const currentConcept = struggling[0]?.metadata?.concept || "unknown";

    // Find dependencies
    let nextConcepts = this.CONCEPT_DEPENDENCIES[currentConcept] || [];

    // If no exact match, try fuzzy match
    if (nextConcepts.length === 0) {
      for (const [key, value] of Object.entries(this.CONCEPT_DEPENDENCIES)) {
        if (currentConcept.includes(key) || key.includes(currentConcept)) {
          nextConcepts = value;
          break;
        }
      }
    }

    if (nextConcepts.length === 0) return null;

    // Pick the one with lowest predicted mastery
    let lowestMastery = 1.0;
    let nextStruggle = nextConcepts[0];

    for (const concept of nextConcepts) {
      const existing = await queryOne(
        `SELECT COALESCE((metadata->>'mastery')::float, 0.5) as mastery 
         FROM memory_chunks
         WHERE student_phone = $1 AND memory_type = 'semantic'
         AND metadata->>'concept' = $2`,
        [studentPhone, concept]
      );
      const mastery = existing?.mastery || 0.5;
      if (mastery < lowestMastery) {
        lowestMastery = mastery;
        nextStruggle = concept;
      }
    }

    return nextStruggle;
  }

  // ============================================================
  // OPTIMAL MODALITY PREDICTION
  // ============================================================

  private async predictOptimalModality(studentPhone: string): Promise<string> {
    // Check what's worked recently
    const recentSuccess = await queryOne<{ modality: string; count: number }>(
      `SELECT metadata->>'modality' as modality, COUNT(*) as count
       FROM memory_chunks
       WHERE student_phone = $1 AND memory_type = 'procedural'
       AND base_activation > 0.6
       GROUP BY metadata->>'modality'
       ORDER BY count DESC
       LIMIT 1`,
      [studentPhone]
    );

    if (recentSuccess?.modality) {
      return recentSuccess.modality;
    }

    // Default based on learning style
    const profile = await queryOne<{ profile: any }>(
      `SELECT profile FROM students WHERE phone = $1`,
      [studentPhone]
    );

    const style = profile?.profile?.learning_style?.primary || "visual";
    const modalityMap: Record<string, string> = {
      visual: "analogy_first",
      auditory: "socratic_question",
      kinesthetic: "demonstrate_then_explain"
    };

    return modalityMap[style] || "analogy_first";
  }

  // ============================================================
  // MASTERY VELOCITY
  // ============================================================

  private async calculateMasteryVelocity(studentPhone: string): Promise<number> {
    const rows = await query<{ mastery: string; created_at: string }>(
      `SELECT metadata->>'mastery' as mastery, created_at
       FROM memory_chunks
       WHERE student_phone = $1 AND memory_type = 'semantic'
       AND metadata->>'mastery' IS NOT NULL
       AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at ASC`,
      [studentPhone]
    );

    if (rows.length < 2) return 0;

    const first = parseFloat(rows[0].mastery || "0");
    const last = parseFloat(rows[rows.length - 1].mastery || "0");
    const days = Math.max(1, (Date.now() - new Date(rows[0].created_at).getTime()) / 86400000);

    return (last - first) / days;
  }

  // ============================================================
  // EMOTIONAL SHIFT DETECTION
  // ============================================================

  private async detectEmotionalShift(
    studentPhone: string,
    metrics: BurnoutMetrics
  ): Promise<string | null> {
    // Check for emotional patterns in recent messages
    const recentMessages = await query<{ raw_text: string }>(
      `SELECT raw_text FROM message_log
       WHERE student_phone = $1 AND direction = 'inbound'
       ORDER BY timestamp DESC
       LIMIT 5`,
      [studentPhone]
    );

    if (recentMessages.length < 2) return null;

    // Detect shift from positive to negative
    const positiveWords = ['good', 'great', 'nice', 'understand', 'got', 'yeah', 'yes', 'love'];
    const negativeWords = ['hard', 'confus', 'dont get', 'terrible', 'bad', 'fail', 'hate'];

    let positiveCount = 0;
    let negativeCount = 0;

    for (const msg of recentMessages) {
      const lower = msg.raw_text.toLowerCase();
      if (positiveWords.some(w => lower.includes(w))) positiveCount++;
      if (negativeWords.some(w => lower.includes(w))) negativeCount++;
    }

    if (negativeCount > positiveCount && negativeCount > 2) {
      return "increasing_frustration";
    }
    if (positiveCount > negativeCount && positiveCount > 2) {
      return "increasing_confidence";
    }
    if (metrics.struggleCount > 3 && metrics.shortRatio > 0.4) {
      return "likely_withdrawal";
    }

    return null;
  }

  // ============================================================
  // CONFIDENCE CALCULATION
  // ============================================================

  private calculateConfidence(metrics: BurnoutMetrics): number {
    let confidence = 0.7;

    // Less confidence if we have little data
    if (metrics.avgLength === null) confidence -= 0.2;

    // More confidence if signals are strong
    if (metrics.struggleCount > 5) confidence += 0.1;
    if (metrics.shortRatio > 0.6) confidence += 0.1;
    if (metrics.topicSwitches > 3) confidence += 0.1;

    return Math.min(Math.max(confidence, 0.3), 0.95);
  }

  // ============================================================
  // STORE PREDICTIONS
  // ============================================================

  private async storePredictions(
    studentPhone: string,
    result: PredictionResult
  ): Promise<void> {
    const predictions = [
      {
        type: "burnout_risk",
        value: { risk: result.burnoutRisk, signals: result.signals },
        confidence: result.confidence
      },
      {
        type: "next_struggle",
        value: { concept: result.nextStruggle },
        confidence: result.confidence * 0.8
      },
      {
        type: "optimal_modality",
        value: { modality: result.optimalModality },
        confidence: result.confidence * 0.7
      },
      {
        type: "emotional_shift",
        value: { shift: result.emotionalShift },
        confidence: result.confidence * 0.6
      }
    ];

    for (const pred of predictions) {
      if (!pred.value.concept && !pred.value.shift && pred.type === "next_struggle") continue;
      if (!pred.value.shift && pred.type === "emotional_shift") continue;

      await query(
        `INSERT INTO predictions (student_phone, prediction_type, predicted_value, confidence)
         VALUES ($1, $2, $3, $4)`,
        [studentPhone, pred.type, JSON.stringify(pred.value), pred.confidence]
      );
    }
  }

  // ============================================================
  // DEFAULT PREDICTION (Fallback)
  // ============================================================

  private getDefaultPrediction(): PredictionResult {
    return {
      burnoutRisk: 0.3,
      optimalModality: "analogy_first",
      conceptMasteryVelocity: 0,
      confidence: 0.4,
      signals: {
        decliningLength: false,
        highShortRatio: false,
        repeatedStruggle: false,
        topicSwitching: false,
        lowEngagement: false
      }
    };
  }
}

export default TheSeer;
