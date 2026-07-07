/**
 * WaxPrep Emotional Intelligence v3.0
 * Mathematical Emotional State Detection & Response Calibration
 */

import { EmbeddingService } from '../utils/embedder.js';

export interface EmotionalState {
  valence: number;
  arousal: number;
  dominance: number;
  confidence: number;
  category: EmotionalCategory;
  assessedAt: number;
}

export type EmotionalCategory =
  | 'excited'
  | 'content'
  | 'angry'
  | 'anxious'
  | 'sad'
  | 'bored'
  | 'confident'
  | 'frustrated'
  | 'curious'
  | 'neutral';

interface EmotionalWord {
  word: string;
  valence: number;
  arousal: number;
  dominance: number;
  weight: number;
}

const EMOTIONAL_VOCABULARY: EmotionalWord[] = [
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
  { word: "can't", valence: -0.60, arousal: 0.55, dominance: -0.50, weight: 0.6 },
  { word: "don't understand", valence: -0.65, arousal: 0.60, dominance: -0.45, weight: 0.8 },
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
  { word: 'easy', valence: 0.60, arousal: 0.50, dominance: 0.70, weight: 0.6 },
  { word: 'simple', valence: 0.55, arousal: 0.40, dominance: 0.65, weight: 0.5 },
  { word: 'i know', valence: 0.50, arousal: 0.45, dominance: 0.75, weight: 0.6 },
  { word: 'obviously', valence: 0.40, arousal: 0.50, dominance: 0.80, weight: 0.7 },
  { word: 'of course', valence: 0.55, arousal: 0.50, dominance: 0.70, weight: 0.6 },
  { word: 'sure', valence: 0.50, arousal: 0.40, dominance: 0.60, weight: 0.4 },
];

interface BehavioralSignals {
  lengthRatio: number;
  exclamationDensity: number;
  questionDensity: number;
  ellipsisDensity: number;
  capsRatio: number;
  responseTimeMs?: number;
}

export class EmotionalIntelligence {
  private static instance: EmotionalIntelligence;
  private embedder: EmbeddingService;
  private vocabulary: EmotionalWord[];
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

  async assessEmotionalState(
    message: string,
    userId: string,
    behavioralSignals?: Partial<BehavioralSignals>
  ): Promise<EmotionalState> {
    const lexicalState = this.lexicalAnalysis(message);
    const behavioralState = this.behavioralAnalysis(message, behavioralSignals);
    const history = this.emotionalHistory.get(userId) || [];
    const trajectoryState = this.trajectoryAnalysis(history);

    const lexicalWeight = lexicalState.confidence;
    const behavioralWeight = 0.5;
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

    const agreementScore = this.computeAgreement(
      lexicalState, behavioralState, trajectoryState
    );

    const category = this.vadToCategory(fusedValence, fusedArousal, fusedDominance);

    const state: EmotionalState = {
      valence: this.clamp(fusedValence, -1, 1),
      arousal: this.clamp(fusedArousal, 0, 1),
      dominance: this.clamp(fusedDominance, -1, 1),
      confidence: Math.min(agreementScore * 1.2, 1.0),
      category,
      assessedAt: Date.now(),
    };

    if (!this.emotionalHistory.has(userId)) {
      this.emotionalHistory.set(userId, []);
    }
    this.emotionalHistory.get(userId)!.push(state);

    const userHistory = this.emotionalHistory.get(userId)!;
    if (userHistory.length > 20) {
      this.emotionalHistory.set(userId, userHistory.slice(-20));
    }

    return state;
  }

  generateCalibrationGuidance(state: EmotionalState): string {
    const { valence, arousal, dominance } = state;

    const warmth = (valence + 1) / 2;
    const energy = arousal;
    const directness = (dominance + 1) / 2;

    const guidance: string[] = [];

    if (warmth < 0.3) {
      guidance.push(
        `EMOTIONAL STATE: ${state.category.toUpperCase()} (valence: ${valence.toFixed(2)})\n` +
        `The student is experiencing negative emotions. Your response must be:\n` +
        `- Extra warm and supportive\n` +
        `- Validate their feelings\n` +
        `- Emphasize effort over ability\n` +
        `- Offer a small win`
      );
    } else if (warmth > 0.7) {
      guidance.push(
        `EMOTIONAL STATE: ${state.category.toUpperCase()} (valence: ${valence.toFixed(2)})\n` +
        `The student is feeling positive! Your response should:\n` +
        `- Match their energy and enthusiasm\n` +
        `- Celebrate their progress\n` +
        `- Build on this positive momentum`
      );
    } else {
      guidance.push(
        `EMOTIONAL STATE: ${state.category.toUpperCase()}\n` +
        `The student is emotionally neutral. Your response should:\n` +
        `- Maintain steady, friendly energy\n` +
        `- Focus on the learning content\n` +
        `- Include gentle encouragement`
      );
    }

    if (energy > 0.7) {
      guidance.push(`\nENERGY LEVEL: HIGH - Match their energy!`);
    } else if (energy < 0.3) {
      guidance.push(`\nENERGY LEVEL: LOW - Keep things calm and steady.`);
    }

    if (directness < 0.3) {
      guidance.push(`\nCONFIDENCE LEVEL: LOW - Provide more hand-holding.`);
    } else if (directness > 0.7) {
      guidance.push(`\nCONFIDENCE LEVEL: HIGH - Challenge with harder questions.`);
    }

    return guidance.join('\n');
  }

  needsIntervention(state: EmotionalState): boolean {
    if (state.valence < -0.5) return true;
    if (state.valence < -0.3 && state.arousal > 0.7 && state.dominance < -0.3) return true;
    if (state.valence < -0.6 && state.dominance < -0.6) return true;
    if (state.valence < -0.3 && state.arousal > 0.6) return true;
    return false;
  }

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

    return { states: history, trend, averageValence: avgValence };
  }

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
      return { valence: 0, arousal: 0.5, dominance: 0, confidence: 0.2 };
    }

    return {
      valence: totalValence / totalWeight,
      arousal: totalArousal / totalWeight,
      dominance: totalDominance / totalWeight,
      confidence: Math.min(matchCount / 2, 1.0),
    };
  }

  private behavioralAnalysis(
    message: string,
    signals?: Partial<BehavioralSignals>
  ): { valence: number; arousal: number; dominance: number } {
    let valenceShift = 0;
    let arousalShift = 0;
    let dominanceShift = 0;

    const exclamationCount = (message.match(/!/g) || []).length;
    const questionCount = (message.match(/\?/g) || []).length;
    const ellipsisCount = (message.match(/\.{3,}/g) || []).length;
    const capsCount = (message.match(/[A-Z]{2,}/g) || []).length;

    if (exclamationCount > 0) {
      valenceShift += 0.1 * Math.min(exclamationCount, 3);
      arousalShift += 0.15 * Math.min(exclamationCount, 3);
    }

    if (questionCount > 0) {
      valenceShift -= 0.05 * Math.min(questionCount, 3);
      arousalShift += 0.1 * Math.min(questionCount, 3);
      dominanceShift -= 0.1 * Math.min(questionCount, 3);
    }

    if (ellipsisCount > 0) {
      dominanceShift -= 0.15;
      arousalShift -= 0.1;
    }

    if (capsCount > 0) {
      valenceShift -= 0.2 * Math.min(capsCount, 3);
      arousalShift += 0.15 * Math.min(capsCount, 3);
    }

    const wordCount = message.split(/\s+/).length;
    if (wordCount < 3) {
      valenceShift -= 0.1;
      dominanceShift -= 0.1;
    } else if (wordCount > 100) {
      arousalShift += 0.1;
    }

    if (signals?.responseTimeMs && signals.responseTimeMs > 300000) {
      arousalShift -= 0.1;
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

    const recent = history.slice(-3);
    const valenceTrend = recent[recent.length - 1].valence - recent[0].valence;
    const arousalTrend = recent[recent.length - 1].arousal - recent[0].arousal;

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

    const maxDist = Math.sqrt(12);
    const avgDist = (d_lex_beh + d_lex_traj) / 2;
    return Math.max(0, 1 - avgDist / maxDist);
  }

  private vadToCategory(valence: number, arousal: number, dominance: number): EmotionalCategory {
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

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}

export const emotionalIntelligence = EmotionalIntelligence;
