/**
 * WaxPrep Probabilistic Intent Classifier v3.0
 * Mathematical Intent Classification Using Embeddings & Bayesian Inference
 */

import { EmbeddingService } from '../utils/embedder.js';

interface IntentPrototype {
  name: string;
  description: string;
  centroid?: number[];
  baseRate: number;
}

const INTENT_PROTOTYPES: IntentPrototype[] = [
  {
    name: 'learn_concept',
    baseRate: 0.25,
    description: `The student wants to understand a new concept or topic. They are curious and seeking knowledge. They might say things like "I don't understand", "Can you explain", "What is", "How does this work", "Teach me about". They are in learning mode, receptive to explanations, examples, and analogies.`,
  },
  {
    name: 'solve_problem',
    baseRate: 0.20,
    description: `The student has a specific homework problem, exam question, or exercise they need help solving. They might share the problem text, equations, or describe what they're stuck on. They want step-by-step guidance.`,
  },
  {
    name: 'practice',
    baseRate: 0.12,
    description: `The student wants to practice and test their knowledge. They want questions, exercises, quizzes, or drills. They might say "Give me practice questions", "I want to test myself", "Quiz me on this".`,
  },
  {
    name: 'exam_prep',
    baseRate: 0.10,
    description: `The student is preparing for WAEC, NECO, JAMB, or another exam. They want past questions, exam strategies, time management tips, and syllabus-aligned content.`,
  },
  {
    name: 'explain_step',
    baseRate: 0.10,
    description: `The student is following a solution or explanation but got stuck at a specific step. They don't need the whole thing re-explained -- just the part where they got lost.`,
  },
  {
    name: 'general_chat',
    baseRate: 0.08,
    description: `The student is just chatting, being friendly, or making conversation. They might say "Hi", "How are you", "Good morning", "What's up".`,
  },
  {
    name: 'frustrated',
    baseRate: 0.05,
    description: `The student is frustrated, overwhelmed, or discouraged. They might say "This is too hard", "I can't do this", "I'm giving up". They need encouragement, simplification, and emotional support.`,
  },
  {
    name: 'confused',
    baseRate: 0.05,
    description: `The student is confused about something they thought they understood. They might say "Wait, I thought...", "But earlier you said...", "That doesn't make sense".`,
  },
  {
    name: 'resource_request',
    baseRate: 0.03,
    description: `The student is asking for resources, materials, or references. They might say "Recommend a textbook", "Where can I learn more", "Do you have notes on this".`,
  },
  {
    name: 'progress_check',
    baseRate: 0.02,
    description: `The student wants to assess their progress or get feedback on their understanding. They might say "Am I getting better", "Test my knowledge", "What am I good at".`,
  },
];

const DEFAULT_TRANSITION_WEIGHTS: Record<string, Record<string, number>> = {
  'learn_concept': {
    'explain_step': 1.5,
    'practice': 1.3,
    'confused': 1.2,
    'solve_problem': 1.1,
  },
  'solve_problem': {
    'explain_step': 2.0,
    'frustrated': 1.5,
    'practice': 1.2,
    'confused': 1.2,
  },
  'practice': {
    'solve_problem': 1.3,
    'frustrated': 1.3,
    'progress_check': 1.2,
    'exam_prep': 1.1,
  },
  'exam_prep': {
    'practice': 1.5,
    'solve_problem': 1.4,
    'resource_request': 1.2,
  },
  'explain_step': {
    'solve_problem': 1.4,
    'learn_concept': 1.3,
    'confused': 1.1,
  },
  'frustrated': {
    'general_chat': 1.4,
    'learn_concept': 1.2,
    'confused': 1.1,
  },
  'confused': {
    'explain_step': 1.5,
    'learn_concept': 1.4,
    'frustrated': 1.3,
  },
  'general_chat': {
    'learn_concept': 1.2,
    'practice': 1.1,
    'resource_request': 1.1,
  },
};

export interface IntentClassificationResult {
  distribution: Record<string, number>;
  primaryIntent: string;
  confidence: number;
  topIntents: Array<{ intent: string; probability: number }>;
  isConfident: boolean;
  entropy: number;
  rawScores: Record<string, number>;
}

export class IntentClassifier {
  private static instance: IntentClassifier;
  private embedder: EmbeddingService;
  private prototypes: IntentPrototype[];
  private transitionWeights: Record<string, Record<string, number>>;
  private centroidsInitialized = false;

  private readonly priorStrength = 0.3;
  private readonly confidenceThreshold = 0.35;

  private constructor(embedder: EmbeddingService) {
    this.embedder = embedder;
    this.prototypes = INTENT_PROTOTYPES.map(p => ({ ...p }));
    this.transitionWeights = JSON.parse(JSON.stringify(DEFAULT_TRANSITION_WEIGHTS));
  }

  static getInstance(embedder?: EmbeddingService): IntentClassifier {
    if (!IntentClassifier.instance) {
      if (!embedder) throw new Error('Embedder required for first initialization');
      IntentClassifier.instance = new IntentClassifier(embedder);
    }
    return IntentClassifier.instance;
  }

  async initializeCentroids(): Promise<void> {
    if (this.centroidsInitialized) return;

    for (const proto of this.prototypes) {
      const embedding = await this.embedder.embed(proto.description);
      proto.centroid = embedding.embedding;
    }

    this.centroidsInitialized = true;
  }

  async classify(
    message: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    previousIntent?: string
  ): Promise<IntentClassificationResult> {
    if (!this.centroidsInitialized) {
      await this.initializeCentroids();
    }

    const messageEmbedding = await this.embedder.embed(message);

    const similarities: Record<string, number> = {};
    for (const proto of this.prototypes) {
      if (proto.centroid) {
        similarities[proto.name] = this.cosineSimilarity(
          messageEmbedding.embedding,
          proto.centroid
        );
      }
    }

    const likelihoods = this.softmax(similarities);
    const prior = this.computeContextualPrior(message, conversationHistory, previousIntent);

    const unnormalizedPosterior: Record<string, number> = {};
    for (const proto of this.prototypes) {
      const name = proto.name;
      unnormalizedPosterior[name] = (likelihoods[name] || 0.1) * (prior[name] || proto.baseRate);
    }

    const distribution = this.normalizeDistribution(unnormalizedPosterior);

    const sortedIntents = Object.entries(distribution)
      .sort((a, b) => b[1] - a[1]);

    const primaryIntent = sortedIntents[0][0];
    const confidence = sortedIntents[0][1];

    return {
      distribution,
      primaryIntent,
      confidence,
      topIntents: sortedIntents.slice(0, 3).map(([intent, probability]) => ({
        intent,
        probability: Math.round(probability * 1000) / 1000,
      })),
      isConfident: confidence >= this.confidenceThreshold,
      entropy: this.computeEntropy(distribution),
      rawScores: similarities,
    };
  }

  private computeContextualPrior(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    previousIntent?: string
  ): Record<string, number> {
    const prior: Record<string, number> = {};

    for (const proto of this.prototypes) {
      prior[proto.name] = proto.baseRate;
    }

    if (previousIntent && this.transitionWeights[previousIntent]) {
      const transitions = this.transitionWeights[previousIntent];
      for (const [intent, weight] of Object.entries(transitions)) {
        prior[intent] = (prior[intent] || 0) * weight;
      }
    }

    const recentSubjects = this.extractSubjectTrajectory(history);
    if (recentSubjects.length > 0) {
      prior['learn_concept'] = (prior['learn_concept'] || 0) * 1.2;
      prior['solve_problem'] = (prior['solve_problem'] || 0) * 1.15;
      prior['practice'] = (prior['practice'] || 0) * 1.1;
    }

    if (history.length < 3) {
      prior['general_chat'] = (prior['general_chat'] || 0) * 1.3;
      prior['learn_concept'] = (prior['learn_concept'] || 0) * 0.9;
    }

    const emotionalSignals = this.detectEmotionalSignals(message);
    if (emotionalSignals.frustration > 0.5) {
      prior['frustrated'] = (prior['frustrated'] || 0) * 2.0;
      prior['general_chat'] = (prior['general_chat'] || 0) * 1.3;
    }
    if (emotionalSignals.confusion > 0.5) {
      prior['confused'] = (prior['confused'] || 0) * 2.0;
      prior['explain_step'] = (prior['explain_step'] || 0) * 1.5;
    }

    return this.normalizeDistribution(prior);
  }

  private extractSubjectTrajectory(
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): string[] {
    const subjects = [
      'mathematics', 'physics', 'chemistry', 'biology', 'english',
      'literature', 'government', 'economics', 'geography', 'history',
      'agriculture', 'commerce', 'further mathematics', 'technical drawing',
    ];

    const found: string[] = [];
    const text = history.map(h => h.content).join(' ').toLowerCase();

    for (const subject of subjects) {
      if (text.includes(subject)) {
        found.push(subject);
      }
    }

    return found;
  }

  private detectEmotionalSignals(message: string): {
    frustration: number;
    confusion: number;
    excitement: number;
    sadness: number;
  } {
    const lower = message.toLowerCase();

    const frustrationWords = ['stupid', 'hate', 'giving up', 'impossible', 'too hard',
      "can't do", 'never get', 'frustrated', 'annoying', 'useless', 'waste'];
    const frustrationScore = frustrationWords.reduce((sum, word) =>
      sum + (lower.includes(word) ? 1 : 0), 0) / Math.max(frustrationWords.length * 0.3, 1);

    const confusionWords = ['confused', "don't understand", 'what do you mean', 'huh',
      'wait', 'but why', "doesn't make sense", 'lost', 'mixed up', 'not clear'];
    const confusionScore = confusionWords.reduce((sum, word) =>
      sum + (lower.includes(word) ? 1 : 0), 0) / Math.max(confusionWords.length * 0.3, 1);

    const excitementWords = ['wow', 'amazing', 'awesome', 'excited', 'love this',
      'great', 'fantastic', 'yay', 'cool', 'interesting'];
    const excitementScore = excitementWords.reduce((sum, word) =>
      sum + (lower.includes(word) ? 1 : 0), 0) / Math.max(excitementWords.length * 0.3, 1);

    const sadnessWords = ['sad', 'depressed', 'worried', 'scared', 'anxious',
      'nervous', 'stressed', 'pressure', 'afraid', 'hopeless'];
    const sadnessScore = sadnessWords.reduce((sum, word) =>
      sum + (lower.includes(word) ? 1 : 0), 0) / Math.max(sadnessWords.length * 0.3, 1);

    return {
      frustration: Math.min(frustrationScore, 1),
      confusion: Math.min(confusionScore, 1),
      excitement: Math.min(excitementScore, 1),
      sadness: Math.min(sadnessScore, 1),
    };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private softmax(scores: Record<string, number>): Record<string, number> {
    const entries = Object.entries(scores);
    const maxScore = Math.max(...entries.map(([, s]) => s));

    const expScores = entries.map(([key, score]) => ({
      key,
      value: Math.exp(score - maxScore),
    }));

    const sumExp = expScores.reduce((sum, { value }) => sum + value, 0);

    const result: Record<string, number> = {};
    for (const { key, value } of expScores) {
      result[key] = value / sumExp;
    }

    return result;
  }

  private normalizeDistribution(dist: Record<string, number>): Record<string, number> {
    const entries = Object.entries(dist);
    const sum = entries.reduce((s, [, v]) => s + v, 0);

    if (sum === 0) {
      const uniform = 1 / entries.length;
      const result: Record<string, number> = {};
      for (const [key] of entries) {
        result[key] = uniform;
      }
      return result;
    }

    const result: Record<string, number> = {};
    for (const [key, value] of entries) {
      result[key] = value / sum;
    }
    return result;
  }

  private computeEntropy(dist: Record<string, number>): number {
    return -Object.values(dist).reduce((sum, p) => {
      if (p <= 0) return sum;
      return sum + p * Math.log2(p);
    }, 0);
  }
}

export const intentClassifier = IntentClassifier;
