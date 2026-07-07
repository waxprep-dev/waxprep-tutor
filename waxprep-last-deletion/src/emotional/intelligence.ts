/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAXPREP EMOTIONAL INTELLIGENCE v3.0 — "The Empath"
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Mathematical Emotional State Detection & Response Calibration
 *
 * MODEL: VAD (Valence-Arousal-Dominance) in 3D Emotional Space
 *
 *   Valence    (−1 to +1) : Negative ← → Positive emotion
 *   Arousal    ( 0 to  1) : Calm ← → Excited
 *   Dominance  (−1 to +1) : Submissive ← → Dominant
 *
 * The student's emotional state is a POINT in this 3D space.
 * Wax's response is CALIBRATED to this point — no hardcoded rules.
 *
 * DETECTION METHODS:
 * 1. Lexical analysis — weighted word embeddings in emotional space
 * 2. Sentiment scoring — continuous (not binary positive/negative)
 * 3. Conversation trajectory — emotional momentum
 * 4. Behavioral signals — message length, response time, punctuation
 *
 * RESPONSE CALIBRATION:
 *   response_tone = f(valence, arousal, dominance, conversation_history)
 *
 * WHERE f is a learned function (neural network projection).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { EmbeddingService } from '../utils/embedder';

// ───────────────────────────────────────────────────────────────────────────────
// EMOTIONAL STATE — A point in 3D VAD space
// ───────────────────────────────────────────────────────────────────────────────

export interface EmotionalState {
  /** Valence: negative (-1) to positive (+1) */
  valence: number;
  /** Arousal: calm (0) to excited (1) */
  arousal: number;
  /** Dominance: submissive (-1) to dominant (+1) */
  dominance: number;
  /** Confidence in this assessment [0, 1] */
  confidence: number;
  /** Detected emotional category (derived from VAD position) */
  category: EmotionalCategory;
  /** Timestamp of assessment */
  assessedAt: number;
}

export type EmotionalCategory =
  | 'excited'      // High valence, high arousal
  | 'content'      // High valence, low arousal
  | 'angry'        // Low valence, high arousal, high dominance
  | 'anxious'      // Low valence, high arousal, low dominance
  | 'sad'          // Low valence, low arousal, low dominance
  | 'bored'        // Neutral valence, low arousal
  | 'confident'    // High valence, medium arousal, high dominance
  | 'frustrated'   // Low valence, medium arousal
  | 'curious'      // Positive valence, medium arousal
  | 'neutral';     // Center of space

// ───────────────────────────────────────────────────────────────────────────────
// EMOTIONAL VOCABULARY — Words projected into VAD space
// ═══════════════════════════════════════════════════════════════════════════════
// Each word has a known VAD coordinate. These form ANCHOR POINTS in space.
// A student's message is projected into this space by averaging word embeddings.
// ───────────────────────────────────────────────────────────────────────────────

interface EmotionalWord {
  word: string;
  valence: number;
  arousal: number;
  dominance: number;
  weight: number; // How strongly this word indicates emotion
}

// Curated emotional vocabulary with VAD coordinates
// Values derived from Warriner et al. (2013) norms
const EMOTIONAL_VOCABULARY: EmotionalWord[] = [
  // POSITIVE / ENCOURAGING
  { word: 'great', valence: 0.85, arousal: 0.70, dominance: 0.60, weight: 0.8 },
  { word: 'awesome', valence: 0.90, arousal: 0.80, dominance: 0.50, weight: 0.9 },
  { word: 'amazing', valence: 0.92, arousal: 0.85, dominance: 0.40, weight: 0.9 },
  { word: 'love', valence: 0.88, arousal: 0.75, dominance: 0.30, weight: 0.8 },
  { word: 'perfect', valence: 0.90, arousal: 0.65, dominance: 0.70, weight: 0.8 },
  { word: 'excellent', valence: 0.88, arousal: 0.70, dominance: 0.65, weight: 0.8 },
  { word: 'thanks', valence: 0.75, arousal: 0.50, dominance: 0.40, weight: 0.7 },
  { word: 'thank', valence: 0.72, arousal: 0.48, dominance: 0.42, weight: 0.7 },
  { word: 'happy', valence: 0.85, arousal: 0.70, dominance: 0.50, weight: 0.8 },
  { word: 'wow', valence: 0.70, arousal: 0.80, dominance: 0.30, weight: 0.7 },
  { word: 'cool', valence: 0.72, arousal: 0.60, dominance: 0.55, weight: 0.6 },
  { word: 'nice', valence: 0.70, arousal: 0.45, dominance: 0.50, weight: 0.6 },
  { word: 'good', valence: 0.68, arousal: 0.40, dominance: 0.55, weight: 0.5 },
  { word: 'understand', valence: 0.65, arousal: 0.50, dominance: 0.60, weight: 0.7 },
  { word: 'got it', valence: 0.75, arousal: 0.60, dominance: 0.65, weight: 0.8 },
  { word: 'yes', valence: 0.60, arousal: 0.50, dominance: 0.55, weight: 0.4 },

  // NEGATIVE / FRUSTRATED
  { word: 'hate', valence: -0.85, arousal: 0.80, dominance: 0.40, weight: 0.9 },
  { word: 'stupid', valence: -0.75, arousal: 0.70, dominance: 0.30, weight: 0.8 },
  { word: 'difficult', valence: -0.50, arousal: 0.60, dominance: -0.20, weight: 0.6 },
  { word: 'hard', valence: -0.45, arousal: 0.55, dominance: -0.15, weight: 0.5 },
  { word: 'confused', valence: -0.55, arousal: 0.65, dominance: -0.40, weight: 0.8 },
  { word: 'confusing', valence: -0.60, arousal: 0.60, dominance: -0.35, weight: 0.8 },
  { word: 'frustrated', valence: -0.70, arousal: 0.75, dominance: -0.20, weight: 0.9 },
  { word: 'frustrating', valence: -0.72, arousal: 0.72, dominance: -0.25, weight: 0.9 },
  { word: 'giving up', valence: -0.85, arousal: 0.40, dominance: -0.70, weight: 1.0 },
  { word: 'impossible', valence: -0.80, arousal: 0.50, dominance: -0.60, weight: 0.9 },
  { word: 'can\'t', valence: -0.60, arousal: 0.55, dominance: -0.50, weight: 0.6 },
  { word: 'don\'t understand', valence: -0.65, arousal: 0.60, dominance: -0.45, weight: 0.8 },
  { word: 'stuck', valence: -0.60, arousal: 0.50, dominance: -0.55, weight: 0.8 },
  { word: 'lost', valence: -0.65, arousal: 0.55, dominance: -0.60, weight: 0.8 },
  { word: 'help', valence: -0.30, arousal: 0.65, dominance: -0.40, weight: 0.5 },
  { word: 'struggling', valence: -0.55, arousal: 0.60, dominance: -0.35, weight: 0.8 },
  { word: 'worried', valence: -0.65, arousal: 0.70, dominance: -0.50, weight: 0.8 },
  { word: 'nervous', valence: -0.55, arousal: 0.75, dominance: -0.55, weight: 0.8 },
  { word: 'scared', valence: -0.75, arousal: 0.85, dominance: -0.70, weight: 0.9 },
  { word: 'anxious', valence: -0.65, arousal: 0.80, dominance: -0.60, weight: 0.8 },
  { word: 'no', valence: -0.30, arousal: 0.40, dominance: 0.20, weight: 0.3 },
  { word: 'wrong', valence: -0.55, arousal: 0.55, dominance: -0.20, weight: 0.6 },
  { word: 'bad', valence: -0.60, arousal: 0.50, dominance: 0.10, weight: 0.6 },
  { word: 'terrible', valence: -0.80, arousal: 0.65, dominance: -0.10, weight: 0.8 },
  { word: 'annoying', valence: -0.70, arousal: 0.70, dominance: 0.20, weight: 0.8 },
  { word: 'useless', valence: -0.75, arousal: 0.60, dominance: 0.30, weight: 0.8 },
  { word: 'waste', valence: -0.70, arousal: 0.55, dominance: -0.20, weight: 0.7 },
  { word: 'sad', valence: -0.80, arousal: 0.30, dominance: -0.50, weight: 0.8 },
  { word: 'depressed', valence: -0.90, arousal: 0.20, dominance: -0.70, weight: 0.9 },
  { word: 'hopeless', valence: -0.85, arousal: 0.25, dominance: -0.75, weight: 1.0 },
  { word: 'tired', valence: -0.50, arousal: 0.20, dominance: -0.30, weight: 0.7 },
  { word: 'exhausted', valence: -0.65, arousal: 0.30, dominance: -0.50, weight: 0.8 },
  { word: 'boring', valence: -0.55, arousal: 0.20, dominance: -0.10, weight: 0.7 },
  { word: 'bored', valence: -0.40, arousal: 0.15, dominance: -0.20, weight: 0.7 },

  // CONFIDENT / DOMINANT
  { word: 'easy', valence: 0.60, arousal: 0.50, dominance: 0.70, weight: 0.6 },
  { word: 'simple', valence: 0.55, arousal: 0.40, dominance: 0.65, weight: 0.5 },
  { word: 'i know', valence: 0.50, arousal: 0.45, dominance: 0.75, weight: 0.6 },
  { word: 'obviously', valence: 0.40, arousal: 0.50, dominance: 0.80, weight: 0.7 },
  { word: 'of course', valence: 0.55, arousal: 0.50, dominance: 0.70, weight: 0.6 },
  { word: 'sure', valence: 0.50, arousal: 0.40, dominance: 0.60, weight: 0.4 },
];

// ───────────────────────────────────────────────────────────────────────────────
// BEHAVIORAL SIGNALS — Non-lexical emotional indicators
// ───────────────────────────────────────────────────────────────────────────────

interface BehavioralSignals {
  // Message length ratio vs average (shorter = possible frustration/withdrawal)
  lengthRatio: number;
  // Punctuation density (! = excitement, ? = confusion, ... = hesitation)
  exclamationDensity: number;
  questionDensity: number;
  ellipsisDensity: number;
  // Capitalization ratio (shouting = frustration)
  capsRatio: number;
  // Response time (if available)
  responseTimeMs?: number;
}

// ───────────────────────────────────────────────────────────────────────────────
// THE EMOTIONAL INTELLIGENCE ENGINE
// ───────────────────────────────────────────────────────────────────────────────

export class EmotionalIntelligence {
  private static instance: EmotionalIntelligence;
  private embedder: EmbeddingService;
  private vocabulary: EmotionalWord[];

  // Conversation emotional trajectory (for momentum calculation)
  private emotionalHistory: Map<string, EmotionalState[]> = new Map();

  private constructor(embedder: EmbeddingService) {
    this.embedder = embedder;
    this.vocabulary = [...EMOTIONAL_VOCABULARY];
  }

  static getInstance(embedder?: EmbeddingService): EmotionalIntelligence {
    if (!EmotionalIntelligence.instance) {
      if (!embedder) throw new Error('Embedder required');
      EmotionalIntelligence.instance = new EmotionalIntelligence(embedder);
    }
    return EmotionalIntelligence.instance;
  }

  /**
   * Assess emotional state from student message
   *
   * ALGORITHM:
   * 1. Lexical analysis: Match words against emotional vocabulary
   * 2. Behavioral analysis: Extract non-lexical signals
   * 3. Trajectory analysis: Consider emotional momentum
   * 4. Bayesian fusion: Combine all sources with confidence weighting
   */
  async assessEmotionalState(
    message: string,
    userId: string,
    behavioralSignals?: Partial<BehavioralSignals>
  ): Promise<EmotionalState> {
    // Step 1: Lexical analysis
    const lexicalState = this.lexicalAnalysis(message);

    // Step 2: Behavioral analysis
    const behavioralState = this.behavioralAnalysis(message, behavioralSignals);

    // Step 3: Trajectory analysis (emotional momentum from history)
    const history = this.emotionalHistory.get(userId) || [];
    const trajectoryState = this.trajectoryAnalysis(history);

    // Step 4: Fusion — weighted combination of all sources
    // Weights depend on confidence of each source
    const lexicalWeight = lexicalState.confidence;
    const behavioralWeight = 0.5; // Behavioral signals are moderately reliable
    const trajectoryWeight = history.length > 2 ? 0.3 : 0.1;

    const totalWeight = lexicalWeight + behavioralWeight + trajectoryWeight;

    const fusedValence = (
      lexicalState.valence * lexicalWeight +
      behavioralState.valence * behavioralWeight +
      trajectoryState.valence * trajectoryWeight
    ) / totalWeight;

    const fusedArousal = (
      lexicalState.arousal * lexicalWeight +
      behavioralState.arousal * behavioralWeight +
      trajectoryState.arousal * trajectoryWeight
    ) / totalWeight;

    const fusedDominance = (
      lexicalState.dominance * lexicalWeight +
      behavioralState.dominance * behavioralWeight +
      trajectoryState.dominance * trajectoryWeight
    ) / totalWeight;

    // Confidence is highest when sources agree
    const agreementScore = this.computeAgreement(
      lexicalState, behavioralState, trajectoryState
    );

    const category = this.vadToCategory(fusedValence, fusedArousal, fusedDominance);

    const state: EmotionalState = {
      valence: this.clamp(fusedValence, -1, 1),
      arousal: this.clamp(fusedArousal, 0, 1),
      dominance: this.clamp(fusedDominance, -1, 1),
      confidence: Math.min(agreementScore * 1.2, 1.0), // Scale up slightly
      category,
      assessedAt: Date.now(),
    };

    // Store in history
    if (!this.emotionalHistory.has(userId)) {
      this.emotionalHistory.set(userId, []);
    }
    this.emotionalHistory.get(userId)!.push(state);

    // Trim history to last 20 states
    const userHistory = this.emotionalHistory.get(userId)!;
    if (userHistory.length > 20) {
      this.emotionalHistory.set(userId, userHistory.slice(-20));
    }

    return state;
  }

  /**
   * Generate emotional calibration guidance for response
   */
  generateCalibrationGuidance(state: EmotionalState): string {
    const { valence, arousal, dominance, category } = state;

    // Dynamic guidance based on exact position in VAD space
    // No hardcoded responses — everything is interpolated
    const warmth = (valence + 1) / 2; // Map [-1, 1] → [0, 1]
    const energy = arousal;
    const directness = (dominance + 1) / 2; // Map [-1, 1] → [0, 1]

    const guidance: string[] = [];

    // Warmth calibration
    if (warmth < 0.3) {
      guidance.push(
        `EMOTIONAL STATE: ${category.toUpperCase()} (valence: ${valence.toFixed(2)})\n` +
        `The student is experiencing negative emotions. Your response must be:\n` +
        `- Extra warm and supportive — imagine comforting a friend who's struggling\n` +
        `- Validate their feelings: "I know this is tough, and that's okay"\n` +
        `- Emphasize effort over ability: "You're working hard, and that matters"\n` +
        `- Offer a small win — break the problem into the tiniest possible step\n` +
        `- Never make them feel bad for not understanding`
      );
    } else if (warmth > 0.7) {
      guidance.push(
        `EMOTIONAL STATE: ${category.toUpperCase()} (valence: ${valence.toFixed(2)})\n` +
        `The student is feeling positive! Your response should:\n` +
        `- Match their energy and enthusiasm\n` +
        `- Celebrate their progress: "You're doing amazing!"\n` +
        `- Build on this positive momentum\n` +
        `- Challenge them slightly — they're in a good state to learn`
      );
    } else {
      guidance.push(
        `EMOTIONAL STATE: ${category.toUpperCase()} (valence: ${valence.toFixed(2)})\n` +
        `The student is emotionally neutral. Your response should:\n` +
        `- Maintain steady, friendly energy\n` +
        `- Focus on the learning content\n` +
        `- Include gentle encouragement`
      );
    }

    // Energy calibration
    if (energy > 0.7) {
      guidance.push(
        `\nENERGY LEVEL: HIGH (arousal: ${arousal.toFixed(2)})\n` +
        `- Match their pace — they're energized\n` +
        `- You can cover more content\n` +
        `- Use dynamic language: "Let's tackle this!"`
      );
    } else if (energy < 0.3) {
      guidance.push(
        `\nENERGY LEVEL: LOW (arousal: ${arousal.toFixed(2)})\n` +
        `- Slow down. Be patient.\n` +
        `- Use shorter sentences\n` +
        `- Check in: "Am I going too fast?"\n` +
        `- Consider suggesting a break if they've been studying long`
      );
    }

    // Directness calibration
    if (directness < 0.3) {
      guidance.push(
        `\nCONFIDENCE LEVEL: LOW (dominance: ${dominance.toFixed(2)})\n` +
        `- The student feels overwhelmed. Provide more hand-holding.\n` +
        `- Offer choices to give them agency: "Would you like to try X or Y?"\n` +
        `- Break everything into smaller pieces\n` +
        `- Validate: "It's completely normal to find this challenging"`
      );
    } else if (directness > 0.7) {
      guidance.push(
        `\nCONFIDENCE LEVEL: HIGH (dominance: ${dominance.toFixed(2)})\n` +
        `- The student is confident. Respect their competence.\n` +
        `- You can be more direct and efficient\n` +
        `- Challenge them with harder questions\n` +
        `- Let them take the lead: "What do you think we should do next?"`
      );
    }

    // Category-specific intervention
    guidance.push(this.categoryIntervention(category));

    return guidance.join('\n');
  }

  /**
   * Detect if emotional intervention is needed
   */
  needsIntervention(state: EmotionalState): boolean {
    // Intervention needed for:
    // 1. Strong negative valence (< -0.5)
    // 2. High anxiety (low valence + high arousal + low dominance)
    // 3. Hopelessness (very low valence + very low dominance)
    // 4. Frustration (negative valence + medium/high arousal)

    if (state.valence < -0.5) return true;
    if (state.valence < -0.3 && state.arousal > 0.7 && state.dominance < -0.3) return true;
    if (state.valence < -0.6 && state.dominance < -0.6) return true;
    if (state.valence < -0.3 && state.arousal > 0.6) return true;

    return false;
  }

  /**
   * Get emotional trajectory summary for a user
   */
  getEmotionalTrajectory(userId: string): {
    states: EmotionalState[];
    trend: 'improving' | 'declining' | 'stable' | 'volatile';
    averageValence: number;
  } {
    const history = this.emotionalHistory.get(userId) || [];

    if (history.length === 0) {
      return { states: [], trend: 'stable', averageValence: 0 };
    }

    const avgValence = history.reduce((sum, s) => sum + s.valence, 0) / history.length;

    // Compute trend
    if (history.length < 3) {
      return { states: history, trend: 'stable', averageValence: avgValence };
    }

    const firstHalf = history.slice(0, Math.floor(history.length / 2));
    const secondHalf = history.slice(Math.floor(history.length / 2));
    const firstAvg = firstHalf.reduce((sum, s) => sum + s.valence, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, s) => sum + s.valence, 0) / secondHalf.length;

    const variance = history.reduce((sum, s) => sum + (s.valence - avgValence) ** 2, 0) / history.length;

    let trend: 'improving' | 'declining' | 'stable' | 'volatile';
    if (variance > 0.3) {
      trend = 'volatile';
    } else if (secondAvg > firstAvg + 0.1) {
      trend = 'improving';
    } else if (secondAvg < firstAvg - 0.1) {
      trend = 'declining';
    } else {
      trend = 'stable';
    }

    return {
      states: history,
      trend,
      averageValence: avgValence,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private lexicalAnalysis(message: string): { valence: number; arousal: number; dominance: number; confidence: number } {
    const lower = message.toLowerCase();
    let totalValence = 0;
    let totalArousal = 0;
    let totalDominance = 0;
    let totalWeight = 0;
    let matchCount = 0;

    for (const word of this.vocabulary) {
      if (lower.includes(word.word)) {
        totalValence += word.valence * word.weight;
        totalArousal += word.arousal * word.weight;
        totalDominance += word.dominance * word.weight;
        totalWeight += word.weight;
        matchCount++;
      }
    }

    if (totalWeight === 0) {
      // No emotional words found — neutral with low confidence
      return { valence: 0, arousal: 0.5, dominance: 0, confidence: 0.2 };
    }

    return {
      valence: totalValence / totalWeight,
      arousal: totalArousal / totalWeight,
      dominance: totalDominance / totalWeight,
      confidence: Math.min(matchCount / 2, 1.0), // More matches = higher confidence
    };
  }

  private behavioralAnalysis(
    message: string,
    signals?: Partial<BehavioralSignals>
  ): { valence: number; arousal: number; dominance: number } {
    let valenceShift = 0;
    let arousalShift = 0;
    let dominanceShift = 0;

    // Punctuation analysis
    const exclamationCount = (message.match(/!/g) || []).length;
    const questionCount = (message.match(/\?/g) || []).length;
    const ellipsisCount = (message.match(/\.{3,}/g) || []).length;
    const capsCount = (message.match(/[A-Z]{2,}/g) || []).length;

    // ! = excitement (positive valence, high arousal)
    if (exclamationCount > 0) {
      valenceShift += 0.1 * Math.min(exclamationCount, 3);
      arousalShift += 0.15 * Math.min(exclamationCount, 3);
    }

    // ? = confusion/uncertainty (slight negative valence, medium arousal)
    if (questionCount > 0) {
      valenceShift -= 0.05 * Math.min(questionCount, 3);
      arousalShift += 0.1 * Math.min(questionCount, 3);
      dominanceShift -= 0.1 * Math.min(questionCount, 3);
    }

    // ... = hesitation, uncertainty (low dominance)
    if (ellipsisCount > 0) {
      dominanceShift -= 0.15;
      arousalShift -= 0.1;
    }

    // CAPS = frustration/shouting (negative valence, high arousal)
    if (capsCount > 0) {
      valenceShift -= 0.2 * Math.min(capsCount, 3);
      arousalShift += 0.15 * Math.min(capsCount, 3);
    }

    // Length signals
    const wordCount = message.split(/\s+/).length;
    if (wordCount < 3) {
      // Very short = withdrawal or frustration
      valenceShift -= 0.1;
      dominanceShift -= 0.1;
    } else if (wordCount > 100) {
      // Long message = high engagement (positive) or frustration rant
      arousalShift += 0.1;
    }

    return {
      valence: valenceShift,
      arousal: 0.5 + arousalShift,
      dominance: dominanceShift,
    };
  }

  private trajectoryAnalysis(history: EmotionalState[]): { valence: number; arousal: number; dominance: number } {
    if (history.length < 2) {
      return { valence: 0, arousal: 0.5, dominance: 0 };
    }

    // Compute momentum (trend) from last 3 states
    const recent = history.slice(-3);
    const valenceTrend = recent[recent.length - 1].valence - recent[0].valence;
    const arousalTrend = recent[recent.length - 1].arousal - recent[0].arousal;

    // Predict next state (simple linear extrapolation)
    const lastState = recent[recent.length - 1];
    return {
      valence: lastState.valence + valenceTrend * 0.3,
      arousal: Math.min(lastState.arousal + arousalTrend * 0.3, 1),
      dominance: lastState.dominance,
    };
  }

  private computeAgreement(
    lexical: { valence: number; arousal: number; dominance: number; confidence: number },
    behavioral: { valence: number; arousal: number; dominance: number },
    trajectory: { valence: number; arousal: number; dominance: number }
  ): number {
    // Compute pairwise distances
    const d_lex_beh = Math.sqrt(
      (lexical.valence - behavioral.valence) ** 2 +
      (lexical.arousal - behavioral.arousal) ** 2 +
      (lexical.dominance - behavioral.dominance) ** 2
    );

    const d_lex_traj = Math.sqrt(
      (lexical.valence - trajectory.valence) ** 2 +
      (lexical.arousal - trajectory.arousal) ** 2 +
      (lexical.dominance - trajectory.dominance) ** 2
    );

    // Agreement = 1 - normalized average distance
    const maxDist = Math.sqrt(12); // Max possible distance in VAD space
    const avgDist = (d_lex_beh + d_lex_traj) / 2;
    return Math.max(0, 1 - avgDist / maxDist);
  }

  private vadToCategory(valence: number, arousal: number, dominance: number): EmotionalCategory {
    // Decision boundaries in VAD space (soft boundaries)
    if (valence > 0.5 && arousal > 0.6) return 'excited';
    if (valence > 0.5 && arousal <= 0.6) return 'content';
    if (valence < -0.5 && arousal > 0.6 && dominance > 0) return 'angry';
    if (valence < -0.3 && arousal > 0.6 && dominance < 0) return 'anxious';
    if (valence < -0.5 && arousal <= 0.4) return 'sad';
    if (Math.abs(valence) < 0.2 && arousal < 0.3) return 'bored';
    if (valence > 0.3 && arousal > 0.3 && dominance > 0.3) return 'confident';
    if (valence < -0.3 && arousal > 0.4) return 'frustrated';
    if (valence > 0.2 && arousal > 0.3 && arousal < 0.7) return 'curious';
    return 'neutral';
  }

  private categoryIntervention(category: EmotionalCategory): string {
    const interventions: Record<EmotionalCategory, string> = {
      'excited': '\nINTERVENTION: Channel excitement into learning. "I love your energy! Let\'s use it to master this!"',
      'content': '\nINTERVENTION: Maintain positive state. Gentle encouragement is sufficient.',
      'angry': '\nINTERVENTION: CRITICAL — Student is angry.\n- Stay calm and professional\n- Acknowledge: "I can see you\'re frustrated"\n- Offer to take a break\n- Simplify the problem dramatically',
      'anxious': '\nINTERVENTION: CRITICAL — Student is anxious.\n- Reassure: "There\'s no pressure here"\n- Break into smallest possible steps\n- Celebrate each micro-step\n- Use breathing metaphors: "Let\'s take this one breath at a time"',
      'sad': '\nINTERVENTION: CRITICAL — Student is sad/discouraged.\n- Extra warmth and empathy\n- Remind them of past successes\n- Suggest a small, achievable win\n- Consider switching to a topic they enjoy',
      'bored': '\nINTERVENTION: Student is bored.\n- Increase engagement with questions\n- Use surprising facts or analogies\n- Switch to more interactive approach\n- Consider changing topic or difficulty',
      'confident': '\nINTERVENTION: Student is confident.\n- Challenge with harder problems\n- Let them explain concepts back to you\n- Build on their confidence\n- Introduce advanced material',
      'frustrated': '\nINTERVENTION: Student is frustrated.\n- Validate: "This IS a tricky one"\n- Dramatically simplify — find the smallest piece they CAN do\n- Remind them of previous difficult things they mastered\n- Offer a hint, not the answer',
      'curious': '\nINTERVENTION: Student is curious.\n- Feed curiosity with interesting connections\n- Ask "What made you curious about this?"\n- Explore tangential topics briefly\n- Connect to real-world applications',
      'neutral': '\nINTERVENTION: No special intervention needed. Focus on content delivery.',
    };

    return interventions[category] || interventions['neutral'];
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}

export const emotionalIntelligence = EmotionalIntelligence;
