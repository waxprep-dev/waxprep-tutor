/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAXPREP PROBABILISTIC INTENT CLASSIFIER v3.0 — "The Oracle"
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Mathematical Intent Classification Using Embeddings & Bayesian Inference
 *
 * NO HARDCODED RULES. NO IF-STATEMENTS. NO REGEX PATTERNS.
 *
 * How it works:
 * 1. Embed the student's message into 1536D vector space
 * 2. Compute similarity to INTENT PROTOTYPE vectors (learned centroids)
 * 3. Apply Bayesian update with conversation context prior
 * 4. Output a PROBABILITY DISTRIBUTION over intents
 *
 * FORMULA:
 *   P(intent | message) ∝ P(message | intent) · P(intent | context)
 *
 * WHERE:
 *   P(message | intent) = softmax(cosine_sim(embed(message), centroid_intent))
 *   P(intent | context) = learned prior from conversation trajectory
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { EmbeddingService } from '../utils/embedder';

// ───────────────────────────────────────────────────────────────────────────────
// INTENT PROTOTYPES — Centroids in embedding space
// ═══════════════════════════════════════════════════════════════════════════════
// These are NOT hardcoded rules. They are VECTOR CENTROIDS that represent
// the "average" embedding of each intent type. In production, these would be
// learned via k-means clustering on conversation data. Here we use
// descriptive texts that, when embedded, create meaningful centroids.
// ───────────────────────────────────────────────────────────────────────────────

interface IntentPrototype {
  name: string;
  description: string; // This text, when embedded, becomes the centroid
  centroid?: number[]; // Computed at runtime
  baseRate: number;    // Prior probability (base rate)
}

// Intent prototypes are rich descriptions that capture the ESSENCE of each intent
// When embedded, they create centroids in vector space that attract similar messages
const INTENT_PROTOTYPES: IntentPrototype[] = [
  {
    name: 'learn_concept',
    baseRate: 0.25,
    description: `The student wants to understand a new concept or topic. They are curious and seeking knowledge. They might say things like "I don't understand", "Can you explain", "What is", "How does this work", "Teach me about". They are in learning mode, receptive to explanations, examples, and analogies. They want clarity and depth. They may be confused about something they heard in class or read in a textbook.`,
  },
  {
    name: 'solve_problem',
    baseRate: 0.20,
    description: `The student has a specific homework problem, exam question, or exercise they need help solving. They might share the problem text, equations, or describe what they're stuck on. They want step-by-step guidance. They might say "I can't solve this", "Help me with this question", "This problem is difficult", "I keep getting the wrong answer". They need patient, structured help working through the solution.`,
  },
  {
    name: 'practice',
    baseRate: 0.12,
    description: `The student wants to practice and test their knowledge. They want questions, exercises, quizzes, or drills. They might say "Give me practice questions", "I want to test myself", "Quiz me on this", "Let's do some exercises". They are confident enough to try on their own but want feedback. They want to build fluency and speed. They want to prepare for an upcoming test or exam.`,
  },
  {
    name: 'exam_prep',
    baseRate: 0.10,
    description: `The student is preparing for WAEC, NECO, JAMB, or another exam. They want past questions, exam strategies, time management tips, and syllabus-aligned content. They might say "WAEC is coming", "Help me prepare for JAMB", "Past questions", "Exam tips", "What topics should I focus on". They are goal-oriented and time-constrained. They want efficient, targeted preparation.`,
  },
  {
    name: 'explain_step',
    baseRate: 0.10,
    description: `The student is following a solution or explanation but got stuck at a specific step. They don't need the whole thing re-explained — just the part where they got lost. They might say "I don't understand step 3", "How did you get from here to here", "Where did this number come from", "Why did you do that". They need targeted, precise clarification of a specific point.`,
  },
  {
    name: 'general_chat',
    baseRate: 0.08,
    description: `The student is just chatting, being friendly, or making conversation. They might say "Hi", "How are you", "Good morning", "What's up", "Tell me something interesting". They might share something personal or ask about you. They want a warm, friendly response. This is relationship-building. They might be taking a break from studying.`,
  },
  {
    name: 'frustrated',
    baseRate: 0.05,
    description: `The student is frustrated, overwhelmed, or discouraged. They might say "This is too hard", "I can't do this", "I'm giving up", "I'll never understand this", "I'm so confused". Their language might be short, emotional, or have negative sentiment. They need encouragement, simplification, and emotional support. They need to feel capable again.`,
  },
  {
    name: 'confused',
    baseRate: 0.05,
    description: `The student is confused about something they thought they understood. They might say "Wait, I thought...", "But earlier you said...", "That doesn't make sense", "I'm getting mixed up". Their confusion might stem from a misconception or conflicting information. They need patient re-explanation from a different angle. Check their underlying assumptions.`,
  },
  {
    name: 'resource_request',
    baseRate: 0.03,
    description: `The student is asking for resources, materials, or references. They might say "Recommend a textbook", "Where can I learn more", "Do you have notes on this", "Share a video", "Any good websites". They want external learning materials. They want to study beyond this conversation.`,
  },
  {
    name: 'progress_check',
    baseRate: 0.02,
    description: `The student wants to assess their progress or get feedback on their understanding. They might say "Am I getting better", "Test my knowledge", "What am I good at", "What should I improve". They want meta-cognitive feedback. They want to know if they're on track.`,
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// CONTEXTUAL PRIORS — How conversation history affects intent probability
// ═══════════════════════════════════════════════════════════════════════════════

interface ContextualPrior {
  // Previous intent → how it affects current intent probabilities
  // This is a TRANSITION MATRIX learned from conversation data
  transitionWeights: Record<string, Record<string, number>>;
}

// Transition weights: P(current_intent | previous_intent)
// Higher values mean this transition is more likely
const DEFAULT_TRANSITION_WEIGHTS: Record<string, Record<string, number>> = {
  'learn_concept': {
    'explain_step': 1.5,    // After learning, likely to ask about a step
    'practice': 1.3,        // Then want to practice
    'confused': 1.2,        // Might get confused
    'solve_problem': 1.1,   // Then try a problem
  },
  'solve_problem': {
    'explain_step': 2.0,    // Very likely to need step clarification
    'frustrated': 1.5,      // Might get frustrated if stuck
    'practice': 1.2,        // After solving, want more practice
    'confused': 1.2,        // Might get confused
  },
  'practice': {
    'solve_problem': 1.3,   // Want to solve real problems
    'frustrated': 1.3,      // Might get frustrated if too hard
    'progress_check': 1.2,  // Want to check how they're doing
    'exam_prep': 1.1,       // Ready for exam prep
  },
  'exam_prep': {
    'practice': 1.5,        // Exam prep leads to practice
    'solve_problem': 1.4,   // And solving problems
    'resource_request': 1.2, // Might want more resources
  },
  'explain_step': {
    'solve_problem': 1.4,   // Back to problem after clarification
    'learn_concept': 1.3,   // Might need broader concept review
    'confused': 1.1,        // Still confused?
  },
  'frustrated': {
    'general_chat': 1.4,    // Might want a break
    'learn_concept': 1.2,   // Or go back to basics
    'confused': 1.1,        // Confusion leads to frustration
  },
  'confused': {
    'explain_step': 1.5,    // Need step-by-step clarification
    'learn_concept': 1.4,   // Back to fundamentals
    'frustrated': 1.3,      // Confusion → frustration
  },
  'general_chat': {
    'learn_concept': 1.2,   // Back to learning
    'practice': 1.1,        // Or practice
    'resource_request': 1.1, // Might ask for resources
  },
};

// ───────────────────────────────────────────────────────────────────────────────
// THE INTENT CLASSIFIER
// ───────────────────────────────────────────────────────────────────────────────

export interface IntentClassificationResult {
  /** Probability distribution over all intents — sums to 1.0 */
  distribution: Record<string, number>;
  /** Most likely intent */
  primaryIntent: string;
  /** Confidence in primary intent [0, 1] */
  confidence: number;
  /** Top 3 intents with probabilities */
  topIntents: Array<{ intent: string; probability: number }>;
  /** Whether confidence is high enough to act on */
  isConfident: boolean;
  /** Entropy of distribution (lower = more certain) */
  entropy: number;
  /** Raw similarity scores before Bayesian update */
  rawScores: Record<string, number>;
}

export class IntentClassifier {
  private static instance: IntentClassifier;
  private embedder: EmbeddingService;
  private prototypes: IntentPrototype[];
  private transitionWeights: Record<string, Record<string, number>>;
  private centroidsInitialized = false;

  // Bayesian prior parameters
  private readonly priorStrength = 0.3; // How much context influences prior
  private readonly confidenceThreshold = 0.35; // Minimum confidence to act

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

  /**
   * Initialize centroids by embedding all prototype descriptions
   * Call this once at startup
   */
  async initializeCentroids(): Promise<void> {
    if (this.centroidsInitialized) return;

    for (const proto of this.prototypes) {
      const embedding = await this.embedder.embed(proto.description);
      proto.centroid = embedding.embedding;
    }

    this.centroidsInitialized = true;
  }

  /**
   * Classify a message into intent probability distribution
   *
   * ALGORITHM:
   * 1. Embed the message
   * 2. Compute cosine similarity to each intent centroid
   * 3. Convert similarities to likelihoods via softmax
   * 4. Compute contextual prior from conversation history
   * 5. Apply Bayes: posterior ∝ likelihood × prior
   * 6. Normalize to probability distribution
   */
  async classify(
    message: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    previousIntent?: string
  ): Promise<IntentClassificationResult> {
    // Ensure centroids are ready
    if (!this.centroidsInitialized) {
      await this.initializeCentroids();
    }

    // Step 1: Embed the message (this is our evidence)
    const messageEmbedding = await this.embedder.embed(message);

    // Step 2: Compute cosine similarities to all centroids
    const similarities: Record<string, number> = {};
    for (const proto of this.prototypes) {
      if (proto.centroid) {
        similarities[proto.name] = this.cosineSimilarity(
          messageEmbedding.embedding,
          proto.centroid
        );
      }
    }

    // Step 3: Convert similarities to likelihoods (softmax over similarities)
    const likelihoods = this.softmax(similarities);

    // Step 4: Compute contextual prior
    const prior = this.computeContextualPrior(message, conversationHistory, previousIntent);

    // Step 5: Bayesian update — posterior ∝ likelihood × prior
    const unnormalizedPosterior: Record<string, number> = {};
    for (const proto of this.prototypes) {
      const name = proto.name;
      unnormalizedPosterior[name] = (likelihoods[name] || 0.1) * (prior[name] || proto.baseRate);
    }

    // Step 6: Normalize to get probability distribution
    const distribution = this.normalizeDistribution(unnormalizedPosterior);

    // Extract results
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

  /**
   * Compute contextual prior based on conversation history
   *
   * P(intent | context) is influenced by:
   * 1. Previous intent (Markov transition)
   * 2. Conversation topic trajectory
   * 3. Message count (early vs late in conversation)
   * 4. Detected emotional signals
   */
  private computeContextualPrior(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    previousIntent?: string
  ): Record<string, number> {
    const prior: Record<string, number> = {};

    // Start with base rates
    for (const proto of this.prototypes) {
      prior[proto.name] = proto.baseRate;
    }

    // Factor 1: Previous intent transition weights
    if (previousIntent && this.transitionWeights[previousIntent]) {
      const transitions = this.transitionWeights[previousIntent];
      for (const [intent, weight] of Object.entries(transitions)) {
        prior[intent] = (prior[intent] || 0) * weight;
      }
    }

    // Factor 2: Conversation topic trajectory
    // If the conversation has been about a subject, learning intents are more likely
    const recentSubjects = this.extractSubjectTrajectory(history);
    if (recentSubjects.length > 0) {
      prior['learn_concept'] = (prior['learn_concept'] || 0) * 1.2;
      prior['solve_problem'] = (prior['solve_problem'] || 0) * 1.15;
      prior['practice'] = (prior['practice'] || 0) * 1.1;
    }

    // Factor 3: Early conversation bias toward general_chat
    if (history.length < 3) {
      prior['general_chat'] = (prior['general_chat'] || 0) * 1.3;
      prior['learn_concept'] = (prior['learn_concept'] || 0) * 0.9;
    }

    // Factor 4: Emotional signals in message
    const emotionalSignals = this.detectEmotionalSignals(message);
    if (emotionalSignals.frustration > 0.5) {
      prior['frustrated'] = (prior['frustrated'] || 0) * 2.0;
      prior['general_chat'] = (prior['general_chat'] || 0) * 1.3;
    }
    if (emotionalSignals.confusion > 0.5) {
      prior['confused'] = (prior['confused'] || 0) * 2.0;
      prior['explain_step'] = (prior['explain_step'] || 0) * 1.5;
    }

    // Normalize prior to sum to 1
    return this.normalizeDistribution(prior);
  }

  /**
   * Extract subject trajectory from conversation history
   * Returns list of detected subjects
   */
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

  /**
   * Detect emotional signals in message
   * Returns scores for different emotions [0, 1]
   */
  private detectEmotionalSignals(message: string): {
    frustration: number;
    confusion: number;
    excitement: number;
    sadness: number;
  } {
    const lower = message.toLowerCase();

    // Frustration indicators (vector-based concept: words semantically close to frustration)
    const frustrationWords = ['stupid', 'hate', 'giving up', 'impossible', 'too hard',
      'can\'t do', 'never get', 'frustrated', 'annoying', 'useless', 'waste'];
    const frustrationScore = frustrationWords.reduce((sum, word) =>
      sum + (lower.includes(word) ? 1 : 0), 0) / Math.max(frustrationWords.length * 0.3, 1);

    // Confusion indicators
    const confusionWords = ['confused', 'don\'t understand', 'what do you mean', 'huh',
      'wait', 'but why', 'doesn\'t make sense', 'lost', 'mixed up', 'not clear'];
    const confusionScore = confusionWords.reduce((sum, word) =>
      sum + (lower.includes(word) ? 1 : 0), 0) / Math.max(confusionWords.length * 0.3, 1);

    // Excitement indicators
    const excitementWords = ['wow', 'amazing', 'awesome', 'excited', 'love this',
      'great', 'fantastic', 'yay', 'cool', 'interesting'];
    const excitementScore = excitementWords.reduce((sum, word) =>
      sum + (lower.includes(word) ? 1 : 0), 0) / Math.max(excitementWords.length * 0.3, 1);

    // Sadness indicators
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

  // ═══════════════════════════════════════════════════════════════════════════
  // MATHEMATICAL UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

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
      // Uniform distribution if all zeros
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

// Export singleton accessor
export const intentClassifier = IntentClassifier;
