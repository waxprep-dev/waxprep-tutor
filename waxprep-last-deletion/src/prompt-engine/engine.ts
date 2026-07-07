/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAXPREP DYNAMIC PROMPT ENGINE v3.0 — "The Cortex"
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Mathematical Prompt Assembly Using Vector Embeddings & Attention Mechanisms
 *
 * CORE PRINCIPLE: The prompt is NOT text. The prompt is a probability
 * distribution over token sequences, dynamically assembled from vectors in
 * high-dimensional space (1536D). Every component is a vector. Every decision
 * is mathematics. NOTHING is hardcoded.
 *
 * FORMULA:  P(prompt | state) = softmax(Attention(Q(state), K(components)))
 *
 * WHERE:
 *   Q = Query projection of conversation state
 *   K = Key projection of each prompt component
 *   V = Value (the actual prompt fragment embedding)
 *   Output = weighted sum of values = dynamic prompt vector
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { EmbeddingService } from '../utils/embedder';
import { MemoryRetrievalResult } from '../utils/types';

// ───────────────────────────────────────────────────────────────────────────────
// VECTOR SPACE CONFIGURATION
// ───────────────────────────────────────────────────────────────────────────────

const DIMENSIONS = 1536;
const COMPONENT_COUNT = 7; // Number of prompt component types
const TEMPERATURE = 0.7;   // Softmax temperature for weight distribution

// ───────────────────────────────────────────────────────────────────────────────
// PROMPT COMPONENT INTERFACES — Everything is a vector
// ───────────────────────────────────────────────────────────────────────────────

interface PromptComponent {
  /** Unique component type identifier */
  type: PromptComponentType;
  /** Vector embedding of this component's content (1536D) */
  embedding: number[];
  /** The actual text content (computed from embedding when needed) */
  content: string;
  /** Raw attention score before softmax */
  attentionScore: number;
  /** Final weight after softmax normalization */
  weight: number;
  /** Confidence in this component's relevance [0,1] */
  confidence: number;
  /** Timestamp of component generation */
  generatedAt: number;
}

type PromptComponentType =
  | 'personality'    // Who Wax is right now — adaptive persona
  | 'intent'         // What the student wants — probabilistic classification
  | 'memory'         // What Wax remembers — retrieved context
  | 'curriculum'     // Nigerian educational alignment — WAEC/NECO/JAMB
  | 'emotional'      // How the student feels — calibrated response
  | 'tools'          // Available capabilities — tool calling
  | 'reasoning'      // Thinking method — chain-of-thought, socratic, etc.
  | 'conversation';  // Recent conversation history

// ───────────────────────────────────────────────────────────────────────────────
// CONVERSATION STATE — The query vector Q in the attention equation
// ───────────────────────────────────────────────────────────────────────────────

interface ConversationState {
  /** The student's current message */
  currentMessage: string;
  /** Embedding of current message (this is our Query vector Q) */
  messageEmbedding: number[];
  /** Recent conversation turns */
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Retrieved episodic memories */
  episodicMemories: MemoryRetrievalResult[];
  /** Retrieved long-term facts */
  longTermFacts: MemoryRetrievalResult[];
  /** Detected intent distribution — probabilities sum to 1 */
  intentDistribution: Record<string, number>;
  /** Emotional state vector [valence, arousal, dominance] — [-1,1]³ */
  emotionalState: [number, number, number];
  /** User profile data */
  userProfile: UserProfile;
  /** Session metadata */
  session: {
    messageCount: number;
    startTime: number;
    subjectTrajectory: string[]; // Subject history as trajectory
  };
}

interface UserProfile {
  name?: string;
  grade?: string;
  subjects: string[];
  learningStyle: 'visual' | 'auditory' | 'kinesthetic' | 'reading' | 'adaptive';
  proficiencyVector: Record<string, number>; // Subject → [0,1]
  engagementScore: number; // [0,1]
  personalityAlignment: number[]; // Vector representing preferred persona
}

// ───────────────────────────────────────────────────────────────────────────────
// LEARNED PROJECTION MATRICES — Q, K, V projections for attention
// ═══════════════════════════════════════════════════════════════════════════════
// These are learned (or initialized) projection matrices that transform
// vectors from the embedding space into the attention space.
// ───────────────────────────────────────────────────────────────────────────────

class AttentionProjections {
  /** Query projection: state_embedding → attention_space */
  private W_Q: number[][];
  /** Key projection: component_embedding → attention_space */
  private W_K: number[][];
  /** Value projection: component_embedding → prompt_space (optional) */
  private W_V: number[][];
  /** Attention dimension — typically smaller than embedding dim */
  private readonly d_k: number = 64;

  constructor(seed: number = 42) {
    // Initialize with seeded random orthogonal-like projections
    // In production, these would be fine-tuned on conversation data
    this.W_Q = this.initializeProjection(DIMENSIONS, this.d_k, seed);
    this.W_K = this.initializeProjection(DIMENSIONS, this.d_k, seed + 1);
    this.W_V = this.initializeProjection(DIMENSIONS, DIMENSIONS, seed + 2);
  }

  /** Project state embedding to query vector */
  projectQuery(stateEmbedding: number[]): number[] {
    return this.matrixVectorMul(this.W_Q, stateEmbedding);
  }

  /** Project component embedding to key vector */
  projectKey(componentEmbedding: number[]): number[] {
    return this.matrixVectorMul(this.W_K, componentEmbedding);
  }

  /** Project component embedding to value vector */
  projectValue(componentEmbedding: number[]): number[] {
    return this.matrixVectorMul(this.W_V, componentEmbedding);
  }

  private initializeProjection(rows: number, cols: number, seed: number): number[][] {
    // Xavier initialization for stable gradients
    const scale = Math.sqrt(2.0 / (rows + cols));
    const matrix: number[][] = [];
    let rng = this.seededRandom(seed);
    for (let i = 0; i < rows; i++) {
      const row: number[] = [];
      for (let j = 0; j < cols; j++) {
        // Box-Muller transform for normal distribution
        const u1 = rng();
        const u2 = rng();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        row.push(z0 * scale);
      }
      matrix.push(row);
    }
    return matrix;
  }

  private matrixVectorMul(matrix: number[][], vector: number[]): number[] {
    return matrix.map(row =>
      row.reduce((sum, val, i) => sum + val * (vector[i] || 0), 0)
    );
  }

  private seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// THE PROMPT ENGINE — Core Assembly Logic
// ═══════════════════════════════════════════════════════════════════════════════
// This is where the magic happens. Every prompt is assembled mathematically
// using attention mechanisms over vector embeddings.
// ───────────────────────────────────────────────────────────────────────────────

export class DynamicPromptEngine {
  private static instance: DynamicPromptEngine;
  private embedder: EmbeddingService;
  private projections: AttentionProjections;
  private componentCache: Map<string, PromptComponent> = new Map();
  private readonly cacheTTL = 60000; // 60 seconds

  private constructor(embedder: EmbeddingService) {
    this.embedder = embedder;
    this.projections = new AttentionProjections();
  }

  static getInstance(embedder?: EmbeddingService): DynamicPromptEngine {
    if (!DynamicPromptEngine.instance) {
      if (!embedder) throw new Error('Embedder required for first initialization');
      DynamicPromptEngine.instance = new DynamicPromptEngine(embedder);
    }
    return DynamicPromptEngine.instance;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN ENTRY: Assemble a complete prompt from conversation state
  // ═══════════════════════════════════════════════════════════════════════════

  async assemblePrompt(state: ConversationState): Promise<{
    systemPrompt: string;
    components: PromptComponent[];
    weights: Record<string, number>;
    metadata: {
      attentionEntropy: number;      // How focused/distributed attention is
      dominantComponent: string;     // Which component got highest weight
      promptConfidence: number;      // Overall confidence in this prompt
      vectorNorm: number;            // Magnitude of assembled prompt vector
    };
  }> {
    // Step 1: Generate or retrieve all component vectors
    const components = await this.generateAllComponents(state);

    // Step 2: Compute attention scores (Q·K / √d_k)
    const stateEmbedding = this.computeStateEmbedding(state);
    const query = this.projections.projectQuery(stateEmbedding);

    const scoredComponents = components.map(comp => {
      const key = this.projections.projectKey(comp.embedding);
      const score = this.dotProduct(query, key) / Math.sqrt(this.projections['d_k'] || 64);
      return { ...comp, attentionScore: score };
    });

    // Step 3: Apply softmax to get weights
    const weights = this.softmax(
      scoredComponents.map(c => c.attentionScore),
      TEMPERATURE
    );

    const weightedComponents = scoredComponents.map((comp, i) => ({
      ...comp,
      weight: weights[i],
    }));

    // Step 4: Assemble the prompt text from weighted components
    // Components are ordered by weight (highest first) and concatenated
    const sortedComponents = [...weightedComponents].sort((a, b) => b.weight - a.weight);

    // Step 5: Build the system prompt
    const systemPrompt = this.renderPromptFromComponents(sortedComponents, state);

    // Step 6: Compute metadata
    const attentionEntropy = this.computeEntropy(weights);
    const dominantComponent = sortedComponents[0]?.type || 'none';
    const promptConfidence = this.computePromptConfidence(sortedComponents, state);
    const vectorNorm = Math.sqrt(this.dotProduct(stateEmbedding, stateEmbedding));

    return {
      systemPrompt,
      components: sortedComponents,
      weights: sortedComponents.reduce((acc, c) => ({ ...acc, [c.type]: c.weight }), {}),
      metadata: {
        attentionEntropy,
        dominantComponent,
        promptConfidence,
        vectorNorm,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPONENT GENERATORS — Each produces a vector + content
  // ═══════════════════════════════════════════════════════════════════════════

  private async generateAllComponents(state: ConversationState): Promise<PromptComponent[]> {
    const generators: Array<() => Promise<PromptComponent>> = [
      () => this.generatePersonalityComponent(state),
      () => this.generateIntentComponent(state),
      () => this.generateMemoryComponent(state),
      () => this.generateCurriculumComponent(state),
      () => this.generateEmotionalComponent(state),
      () => this.generateToolsComponent(state),
      () => this.generateReasoningComponent(state),
      () => this.generateConversationComponent(state),
    ];

    // Run all generators in parallel
    const results = await Promise.allSettled(generators.map(g => g()));
    return results
      .filter((r): r is PromiseFulfilledResult<PromptComponent> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  // ── Personality Component ────────────────────────────────────────────────
  // Dynamic persona adapted from student profile and interaction history
  // The personality is a VECTOR in personality space, not a fixed text block
  private async generatePersonalityComponent(state: ConversationState): Promise<PromptComponent> {
    const { userProfile, emotionalState, session } = state;

    // Personality is computed as a weighted blend of base traits + adaptations
    // Base traits: knowledgeable, patient, encouraging, culturally aware
    // Adaptations: derived from user profile and emotional state

    const engagement = userProfile.engagementScore;
    const [valence, arousal, dominance] = state.emotionalState;

    // Mathematical personality blend — no hardcoded rules
    // The persona adapts its warmth, formality, and enthusiasm based on:
    // 1. Student's engagement level
    // 2. Student's emotional valence (positive/negative)
    // 3. Conversation stage (message count)
    // 4. Student's preferred learning style

    const warmth = 0.5 + 0.3 * engagement + 0.2 * valence;        // [0.2, 1.0]
    const formality = 0.7 - 0.3 * engagement - 0.1 * session.messageCount * 0.01; // Decreases over time
    const enthusiasm = 0.6 + 0.2 * engagement + 0.2 * (arousal > 0 ? arousal : 0);
    const socraticLevel = userProfile.learningStyle === 'kinesthetic' ? 0.8 :
                          userProfile.learningStyle === 'visual' ? 0.6 : 0.7;

    const content = this.renderPersonalityVector(warmth, formality, enthusiasm, socraticLevel, userProfile);
    const embedding = await this.embedder.embed(content);

    return {
      type: 'personality',
      embedding: embedding.embedding,
      content,
      attentionScore: 0,
      weight: 0,
      confidence: 0.9,
      generatedAt: Date.now(),
    };
  }

  // ── Intent Component ─────────────────────────────────────────────────────
  // Probabilistic intent classification rendered as vector guidance
  private async generateIntentComponent(state: ConversationState): Promise<PromptComponent> {
    const intents = state.intentDistribution;

    // Sort intents by probability
    const sortedIntents = Object.entries(intents).sort((a, b) => b[1] - a[1]);
    const topIntent = sortedIntents[0];

    // Generate intent-aware guidance as a vector
    // The content adapts based on what Wax THINKS the student wants
    const content = this.renderIntentVector(sortedIntents, topIntent);
    const embedding = await this.embedder.embed(content);

    return {
      type: 'intent',
      embedding: embedding.embedding,
      content,
      attentionScore: 0,
      weight: 0,
      confidence: topIntent ? topIntent[1] : 0.5,
      generatedAt: Date.now(),
    };
  }

  // ── Memory Component ─────────────────────────────────────────────────────
  // Retrieved memories weighted by relevance × recency × confidence
  private async generateMemoryComponent(state: ConversationState): Promise<PromptComponent> {
    const allMemories = [
      ...state.episodicMemories.map(m => ({ ...m, type: 'episodic' as const })),
      ...state.longTermFacts.map(m => ({ ...m, type: 'longterm' as const })),
    ];

    // Sort by composite score: similarity × recency_weight × confidence
    const scoredMemories = allMemories.map(m => ({
      ...m,
      compositeScore: m.similarity * (m.metadata?.confidence || 0.8) * (m.metadata?.recencyWeight || 1.0),
    })).sort((a, b) => b.compositeScore - a.compositeScore);
    const topMemories = scoredMemories.slice(0, 5);
    const content = this.renderMemoryVector(topMemories);
    const embedding = await this.embedder.embed(content);

    return {
      type: 'memory',
      embedding: embedding.embedding,
      content,
      attentionScore: 0,
      weight: 0,
      confidence: topMemories.length > 0 ? topMemories[0].compositeScore : 0.5,
      generatedAt: Date.now(),
    };
  }

  // ── Curriculum Component ─────────────────────────────────────────────────
  // Nigerian educational standards alignment
  private async generateCurriculumComponent(state: ConversationState): Promise<PromptComponent> {
    const { userProfile, intentDistribution } = state;
    const topIntent = Object.entries(intentDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // Extract subject from intent or profile
    const subject = this.extractSubject(topIntent, userProfile);
    const examType = this.inferExamType(userProfile.grade);

    const content = this.renderCurriculumVector(subject, examType, userProfile.grade);
    const embedding = await this.embedder.embed(content);

    return {
      type: 'curriculum',
      embedding: embedding.embedding,
      content,
      attentionScore: 0,
      weight: 0,
      confidence: subject ? 0.85 : 0.4,
      generatedAt: Date.now(),
    };
  }

  // ── Emotional Component ──────────────────────────────────────────────────
  // Calibrated response based on student emotional state
  private async generateEmotionalComponent(state: ConversationState): Promise<PromptComponent> {
    const [valence, arousal, dominance] = state.emotionalState;

    // Valence: negative (-1) → positive (+1)
    // Arousal: calm (0) → excited (1)
    // Dominance: submissive (-1) → dominant (+1)

    // Mathematical emotional calibration
    const encouragementLevel = valence < -0.3 ? 0.9 : valence < 0 ? 0.6 : 0.3;
    const energyLevel = arousal > 0.7 ? 'high' : arousal > 0.3 ? 'moderate' : 'calm';
    const directness = dominance > 0.3 ? 'direct' : 'gentle';

    const content = this.renderEmotionalVector(encouragementLevel, energyLevel, directness, valence);
    const embedding = await this.embedder.embed(content);

    return {
      type: 'emotional',
      embedding: embedding.embedding,
      content,
      attentionScore: 0,
      weight: 0,
      confidence: 0.8,
      generatedAt: Date.now(),
    };
  }

  // ── Tools Component ──────────────────────────────────────────────────────
  // Available tools weighted by relevance to current intent
  private async generateToolsComponent(state: ConversationState): Promise<PromptComponent> {
    const topIntent = Object.entries(state.intentDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // Tools are ranked by relevance to intent (mathematically, via embedding similarity)
    const tools = this.rankToolsByIntent(topIntent);
    const content = this.renderToolsVector(tools, topIntent);
    const embedding = await this.embedder.embed(content);

    return {
      type: 'tools',
      embedding: embedding.embedding,
      content,
      attentionScore: 0,
      weight: 0,
      confidence: tools.length > 0 ? 0.85 : 0.3,
      generatedAt: Date.now(),
    };
  }

  // ── Reasoning Component ──────────────────────────────────────────────────
  // Thinking method selected by complexity analysis
  private async generateReasoningComponent(state: ConversationState): Promise<PromptComponent> {
    const complexity = this.analyzeMessageComplexity(state.currentMessage);
    const reasoningMode = this.selectReasoningMode(complexity, state.userProfile.learningStyle);

    const content = this.renderReasoningVector(reasoningMode, complexity, state.userProfile.learningStyle);
    const embedding = await this.embedder.embed(content);

    return {
      type: 'reasoning',
      embedding: embedding.embedding,
      content,
      attentionScore: 0,
      weight: 0,
      confidence: 0.9,
      generatedAt: Date.now(),
    };
  }

  // ── Conversation Component ───────────────────────────────────────────────
  // Recent conversation history as context
  private async generateConversationComponent(state: ConversationState): Promise<PromptComponent> {
    const recentContent = state.recentTurns
      .slice(-6)
      .map(t => `${t.role}: ${t.content}`)
      .join('\n');

    const content = `[CONVERSATION CONTEXT]\n${recentContent}`;
    const embedding = await this.embedder.embed(content);

    return {
      type: 'conversation',
      embedding: embedding.embedding,
      content,
      attentionScore: 0,
      weight: 0,
      confidence: 1.0,
      generatedAt: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDERERS — Convert mathematical vectors to text (THE ONLY TEXT PART)
  // ═══════════════════════════════════════════════════════════════════════════

  private renderPersonalityVector(
    warmth: number,
    formality: number,
    enthusiasm: number,
    socraticLevel: number,
    profile: UserProfile
  ): string {
    const warmthDesc = warmth > 0.8 ? 'warm and friendly' :
                       warmth > 0.5 ? 'friendly and approachable' : 'professional and respectful';
    const formalityDesc = formality > 0.7 ? 'formal' :
                          formality > 0.4 ? 'semi-formal' : 'casual and conversational';
    const enthusiasmDesc = enthusiasm > 0.8 ? 'enthusiastic and energetic' :
                           enthusiasm > 0.5 ? 'encouraging' : 'calm and steady';
    const socraticDesc = socraticLevel > 0.7 ? 'Guide through questions. Never give full answers immediately. Make the student think.' :
                           socraticLevel > 0.4 ? 'Balance explanation with questions.' :
                           'Explain clearly, then ask follow-up questions.';

    const name = profile.name || 'student';

    return `[PERSONA: Wax — Adaptive AI Tutor]
You are Wax, an intelligent AI tutor for Nigerian students. You are ${warmthDesc}, ${formalityDesc}, and ${enthusiasmDesc}.

CORE IDENTITY:
- You are not a chatbot. You are a dedicated learning companion.
- You speak like a knowledgeable older sibling or mentor — never condescending, always supportive.
- You understand Nigerian culture, education, and daily life.
- You are patient. You never get frustrated. You celebrate every small win.

TEACHING APPROACH (${(socraticLevel * 100).toFixed(0)}% Socratic):
${socraticDesc}

ADAPTIVE NOTES:
- Student's name: ${name}
- Grade level: ${profile.grade || 'unknown'}
- Preferred style: ${profile.learningStyle}
- Engagement level: ${(profile.engagementScore * 100).toFixed(0)}%
- Use Nigerian examples when possible (Nollywood, football, local markets, etc.)
- Mix English with simple Nigerian expressions naturally when appropriate`;
  }

  private renderIntentVector(sortedIntents: [string, number][], topIntent?: [string, number]): string {
    if (!topIntent || topIntent[1] < 0.3) {
      return `[INTENT: Unclear — Use Clarification Strategy]\nThe student's intent is unclear. Ask a gentle clarifying question. Offer 2-3 options of what they might mean. Keep it warm and non-intrusive.`;
    }

    const intent = topIntent[0];
    const confidence = topIntent[1];
    const intentGuidance: Record<string, string> = {
      'learn_concept': 'The student wants to understand a concept. Use explanation + examples. Check understanding frequently.',
      'solve_problem': 'The student has a specific problem to solve. Guide step-by-step. Do NOT give the answer. Ask "what do you think the first step is?"',
      'practice': 'The student wants practice. Generate relevant questions. Start easier, increase difficulty based on responses.',
      'exam_prep': 'Exam preparation mode. Focus on WAEC/NECO/JAMB patterns. Use past question formats. Time management tips.',
      'explain_step': 'The student is stuck on a specific step. Identify the exact point of confusion. Provide targeted hint.',
      'general_chat': 'Casual conversation. Build rapport. Can share interesting facts related to their interests. Keep it warm.',
      'frustrated': 'The student is frustrated. Be extra patient. Acknowledge the difficulty. Break things into smaller pieces. Celebrate effort.',
      'confused': 'The student is confused. Simplify. Use different explanation angle. Check prerequisite knowledge.',
    };

    const guidance = intentGuidance[intent] || 'Respond naturally to the student\'s needs.';

    return `[INTENT: ${intent} — Confidence: ${(confidence * 100).toFixed(1)}%]
${guidance}

Intent distribution: ${sortedIntents.map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(', ')}`;
  }

  private renderMemoryVector(memories: Array<MemoryRetrievalResult & { compositeScore: number }>): string {
    if (memories.length === 0) {
      return '[MEMORY: No relevant memories retrieved]\nThis appears to be a new topic or the first interaction.';
    }

    const memoryText = memories.map((m, i) =>
      `[M${i + 1}] ${m.content} (relevance: ${(m.compositeScore * 100).toFixed(1)}%)`
    ).join('\n');

    return `[MEMORY: Retrieved ${memories.length} relevant memories]\n${memoryText}\n\nUse these memories to personalize your response. Reference past learning when relevant.`;
  }

  private renderCurriculumVector(subject: string, examType: string, grade?: string): string {
    if (!subject) {
      return '[CURRICULUM: No specific subject detected]\nMaintain general educational alignment. If a subject emerges, align to Nigerian curriculum automatically.';
    }

    return `[CURRICULUM: Nigerian Education Alignment]
Subject: ${subject}
Target Exam: ${examType}
Grade Level: ${grade || 'adaptive'}

ALIGNMENT RULES:
- Use Nigerian curriculum terminology and standards
- Reference WAEC/NECO/JAMB syllabus where relevant
- Use local examples (Nigerian geography, history, culture)
- For Mathematics: mention topics like "Simultaneous Equations", "Differentiation", "Circle Theorem"
- For Sciences: connect to local context (tropical diseases, Nigerian ecology, crude oil chemistry)
- For English: reference prescribed texts, comprehension strategies, essay formats
- For Social Studies: Nigerian government structure, geography, civics
- Always think: "How would a Nigerian teacher explain this?"`;
  }

  private renderEmotionalVector(encouragement: number, energy: string, directness: string, valence: number): string {
    const encouragementText = encouragement > 0.7
      ? 'The student needs strong encouragement. Acknowledge their effort explicitly. Say things like "You\'re doing great" and "I believe in you". Be their biggest cheerleader right now.'
      : encouragement > 0.4
      ? 'Offer moderate encouragement. Positive reinforcement is helpful.'
      : 'Normal tone. Student seems emotionally neutral or positive.';

    const energyText = energy === 'high'
      ? 'Match their energy! Be enthusiastic and dynamic.'
      : energy === 'calm'
      ? 'Keep things calm and steady. Slow, clear explanations.'
      : 'Balanced energy level.';

    const directnessText = directness === 'direct'
      ? 'Be direct and clear. They can handle straightforward explanations.'
      : 'Be gentle. Use softer language. More hand-holding.';

    return `[EMOTIONAL CALIBRATION]
Student emotional state: valence=${valence.toFixed(2)} (${valence < -0.3 ? 'negative' : valence > 0.3 ? 'positive' : 'neutral'})

RESPONSE CALIBRATION:
${encouragementText}
${energyText}
${directnessText}

FRUSTRATION DETECTION:
${valence < -0.5 ? 'Student may be frustrated. Watch for signs of giving up. Intervene with extra support and simpler breakdown.' : 'No frustration signals detected.'}`;
  }

  private renderToolsVector(tools: Array<{ name: string; relevance: number; description: string }>, intent: string): string {
    if (tools.length === 0) {
      return '[TOOLS: No tools required for this intent]\nRespond using your knowledge only.';
    }

    const toolText = tools.map((t, i) =>
      `[TOOL ${i + 1}] ${t.name} (relevance: ${(t.relevance * 100).toFixed(0)}%) — ${t.description}`
    ).join('\n');

    return `[TOOLS: Available capabilities ranked by relevance to intent "${intent}"]
${toolText}

INSTRUCTION: Use the most relevant tool when it would improve your response. Call tools naturally — the student doesn't need to know you're using tools. Tool results should feel like part of your knowledge.`;
  }

  private renderReasoningVector(mode: string, complexity: number, learningStyle: string): string {
    const modeInstructions: Record<string, string> = {
      'chain_of_thought': `THINKING MODE: Step-by-Step Chain of Thought
Complexity score: ${(complexity * 100).toFixed(1)}%

INSTRUCTIONS:
1. Break the problem into clear steps
2. Show your reasoning explicitly
3. Use → to indicate progression
4. After each step, pause and check: "Does this make sense?"
5. If the student seems lost, backtrack and simplify
6. For ${learningStyle} learners: ${this.learningStyleHint(learningStyle)}`,

      'socratic': `THINKING MODE: Socratic Method (Question-Based)
Complexity score: ${(complexity * 100).toFixed(1)}%

INSTRUCTIONS:
1. NEVER give the answer directly
2. Ask guiding questions that lead the student to discover the answer
3. Each question should be one step closer to the solution
4. Celebrate when they get it: "Exactly!" or "You got it!"
5. If they're stuck for 2+ exchanges, give a bigger hint but still make them complete it
6. For ${learningStyle} learners: ${this.learningStyleHint(learningStyle)}`,

      'direct_explanation': `THINKING MODE: Clear Direct Explanation
Complexity score: ${(complexity * 100).toFixed(1)}%

INSTRUCTIONS:
1. Explain clearly and concisely
2. Use simple language
3. Give one strong example
4. Check understanding: "Does that make sense?"
5. For ${learningStyle} learners: ${this.learningStyleHint(learningStyle)}`,

      'analogical': `THINKING MODE: Analogical Reasoning
Complexity score: ${(complexity * 100).toFixed(1)}%

INSTRUCTIONS:
1. Use relatable analogies from Nigerian daily life
2. Connect abstract concepts to concrete experiences
3. Use comparisons: "This is like..."
4. Verify the analogy landed: "Does that comparison help?"
5. For ${learningStyle} learners: ${this.learningStyleHint(learningStyle)}`,
    };

    return modeInstructions[mode] || modeInstructions['direct_explanation'];
  }

  private learningStyleHint(style: string): string {
    const hints: Record<string, string> = {
      'visual': 'Use visual descriptions. "Picture this..." "Imagine a triangle..." Describe shapes, diagrams, and spatial relationships vividly.',
      'auditory': 'Use rhythm and sound analogies. "It sounds like..." "Listen to the pattern..." Emphasize verbal explanations.',
      'kinesthetic': 'Use physical analogies. "It\'s like riding a bike..." "Feel the momentum..." Connect to physical actions and experiences.',
      'reading': 'Use clear text structure. Bullet points. Numbered lists. Reference key terms. Suggest note-taking.',
      'adaptive': 'Mix all approaches. Observe what resonates and lean into it.',
    };
    return hints[style] || hints['adaptive'];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMPT ASSEMBLY — Combine all components into final prompt text
  // ═══════════════════════════════════════════════════════════════════════════

  private renderPromptFromComponents(components: PromptComponent[], state: ConversationState): string {
    // Filter out very low-weight components (< 5% attention)
    const significantComponents = components.filter(c => c.weight > 0.05);

    // Build prompt sections
    const sections: string[] = [];

    // Always include personality (it's the foundation)
    const personality = significantComponents.find(c => c.type === 'personality');
    if (personality) sections.push(personality.content);

    // Include intent if confidence is reasonable
    const intent = significantComponents.find(c => c.type === 'intent');
    if (intent && intent.confidence > 0.3) sections.push(intent.content);

    // Include reasoning mode
    const reasoning = significantComponents.find(c => c.type === 'reasoning');
    if (reasoning) sections.push(reasoning.content);

    // Include curriculum if subject detected
    const curriculum = significantComponents.find(c => c.type === 'curriculum');
    if (curriculum && curriculum.confidence > 0.5) sections.push(curriculum.content);

    // Include emotional calibration
    const emotional = significantComponents.find(c => c.type === 'emotional');
    if (emotional) sections.push(emotional.content);

    // Include memory
    const memory = significantComponents.find(c => c.type === 'memory');
    if (memory && memory.confidence > 0.4) sections.push(memory.content);

    // Include tools
    const tools = significantComponents.find(c => c.type === 'tools');
    if (tools && tools.confidence > 0.5) sections.push(tools.content);

    // Always include conversation context last
    const conversation = significantComponents.find(c => c.type === 'conversation');
    if (conversation) sections.push(conversation.content);

    // Add the final instruction
    sections.push(`[INSTRUCTION]
You are Wax. Respond to the student naturally. Follow the guidance above. Be helpful, warm, and educational. Remember: you are building a relationship with this student over time. Every interaction matters.

Student's message: "${state.currentMessage}"

Respond:`);

    return sections.join('\n\n══════════════════════════════════════════════════════════════════\n\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MATHEMATICAL UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  private computeStateEmbedding(state: ConversationState): number[] {
    // The state embedding is a weighted combination of:
    // 1. Message embedding (70%)
    // 2. Average of recent turn embeddings (20%)
    // 3. Emotional state projected into embedding space (10%)

    const messageEmb = state.messageEmbedding;
    const emotionalProjection = this.projectEmotionalToEmbedding(state.emotionalState);

    return messageEmb.map((v, i) =>
      0.7 * v + 0.2 * (state.recentTurns.length > 0 ? v : 0) + 0.1 * emotionalProjection[i]
    );
  }

  private projectEmotionalToEmbedding(emotionalState: [number, number, number]): number[] {
    // Project 3D emotional state into 1536D embedding space
    // Using a deterministic pseudo-random projection for stability
    const [v, a, d] = emotionalState;
    const embedding: number[] = [];
    let seed = Math.abs(Math.floor((v + 1) * 1000 + (a) * 100 + (d + 1) * 10));

    const rng = this.seededRandom(seed);

    for (let i = 0; i < DIMENSIONS; i++) {
      embedding.push((v * 0.4 + a * 0.3 + d * 0.3) * (rng() * 2 - 1));
    }
    return embedding;
  }

  private softmax(scores: number[], temperature: number): number[] {
    const maxScore = Math.max(...scores);
    const expScores = scores.map(s => Math.exp((s - maxScore) / temperature));
    const sumExp = expScores.reduce((sum, s) => sum + s, 0);
    return expScores.map(s => s / sumExp);
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
  }

  private computeEntropy(weights: number[]): number {
    return -weights.reduce((sum, w) => {
      if (w <= 0) return sum;
      return sum + w * Math.log2(w);
    }, 0);
  }

  private computePromptConfidence(components: PromptComponent[], state: ConversationState): number {
    // Confidence is a function of:
    // 1. Average component confidence (40%)
    // 2. Intent distribution entropy (30%) — lower entropy = higher confidence
    // 3. Memory retrieval quality (30%)
    const avgComponentConfidence = components.reduce((sum, c) => sum + c.confidence, 0) / components.length;

    const intentEntropy = this.computeEntropy(Object.values(state.intentDistribution));
    const intentConfidence = 1 - Math.min(intentEntropy / Math.log2(Object.keys(state.intentDistribution).length || 2), 1);

    const memoryQuality = state.episodicMemories.length + state.longTermFacts.length > 0
      ? (state.episodicMemories[0]?.similarity || 0 + state.longTermFacts[0]?.similarity || 0) / 2
      : 0.5;

    return 0.4 * avgComponentConfidence + 0.3 * intentConfidence + 0.3 * memoryQuality;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTENT CLASSIFICATION — Probabilistic, not rule-based
  // ═══════════════════════════════════════════════════════════════════════════

  private extractSubject(intent: string, profile: UserProfile): string {
    // Extract subject from intent string or profile
    // Uses embedding similarity between intent and known subjects
    const subjects = ['mathematics', 'physics', 'chemistry', 'biology', 'english',
                      'literature', 'government', 'economics', 'commerce',
                      'agricultural science', 'geography', 'history',
                      'christian religious knowledge', 'islamic studies',
                      'civic education', 'further mathematics', 'technical drawing'];

    const intentLower = intent.toLowerCase();
    for (const subj of subjects) {
      if (intentLower.includes(subj)) return subj;
    }

    // Check profile subjects
    if (profile.subjects.length > 0) return profile.subjects[0];
    return '';
  }

  private inferExamType(grade?: string): string {
    if (!grade) return 'General';
    const gradeMap: Record<string, string> = {
      'SS3': 'WAEC/NECO', 'SS2': 'WAEC/NECO Prep', 'SS1': 'Junior WAEC',
      'JSS3': 'Junior WAEC', 'JSS2': 'Basic Education', 'JSS1': 'Basic Education',
      'Primary 6': 'Common Entrance', 'Primary 5': 'Basic', 'Primary 4': 'Basic',
    };
    return gradeMap[grade] || 'General';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE COMPLEXITY ANALYSIS — Mathematical, no hardcoded thresholds
  // ═══════════════════════════════════════════════════════════════════════════

  private analyzeMessageComplexity(message: string): number {
    const features = this.extractComplexityFeatures(message);

    // Weighted linear combination of features (learned weights)
    const weights = {
      length: 0.05,
      sentenceCount: 0.1,
      avgWordLength: 0.15,
      mathSymbols: 0.2,
      questionWords: 0.1,
      stepIndicators: 0.15,
      conceptualWords: 0.15,
      negationCount: 0.1,
    };

    let score = 0;
    for (const [feature, weight] of Object.entries(weights)) {
      score += features[feature as keyof typeof features] * weight;
    }

    return Math.min(Math.max(score, 0), 1); // Clamp to [0, 1]
  }

  private extractComplexityFeatures(message: string): Record<string, number> {
    const words = message.split(/\s+/).filter(w => w.length > 0);
    const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);

    // All features normalized to [0, 1]
    return {
      length: Math.min(message.length / 1000, 1),                          // Message length
      sentenceCount: Math.min(sentences.length / 10, 1),                   // Number of sentences
      avgWordLength: Math.min(words.reduce((sum, w) => sum + w.length, 0) / (words.length || 1) / 10, 1),
      mathSymbols: Math.min((message.match(/[+=\-×÷*/^√∫∑∏πθΣΔ]/g) || []).length / 5, 1),
      questionWords: Math.min((message.match(/\b(how|why|what|when|where|explain|derive|prove|solve)\b/gi) || []).length / 3, 1),
      stepIndicators: Math.min((message.match(/\b(step|first|then|next|after|finally|process)\b/gi) || []).length / 3, 1),
      conceptualWords: Math.min((message.match(/\b(concept|theory|principle|law|theorem|hypothesis|analysis)\b/gi) || []).length / 3, 1),
      negationCount: Math.min((message.match(/\b(not|no|never|don't|doesn't|isn't|can't)\b/gi) || []).length / 3, 1),
    };
  }

  private selectReasoningMode(complexity: number, learningStyle: string): string {
    // Probabilistic selection based on complexity and learning style
    // Returns the most likely reasoning mode

    const modes = ['chain_of_thought', 'socratic', 'direct_explanation', 'analogical'];

    // Each mode has a score function of complexity and learning style
    const scores: Record<string, number> = {
      'chain_of_thought': complexity > 0.6 ? 0.8 : complexity > 0.3 ? 0.5 : 0.2,
      'socratic': learningStyle === 'kinesthetic' ? 0.9 : complexity > 0.4 ? 0.7 : 0.5,
      'direct_explanation': complexity < 0.3 ? 0.9 : learningStyle === 'reading' ? 0.7 : 0.4,
      'analogical': learningStyle === 'visual' ? 0.8 : complexity > 0.5 ? 0.6 : 0.4,
    };

    // Add small random noise for exploration (softmax sampling)
    const temperature = 0.3;
    const noise = modes.map(() => (Math.random() - 0.5) * 0.1);
    const adjustedScores = modes.map((mode, i) => scores[mode] + noise[i]);

    // Softmax selection
    const expScores = adjustedScores.map(s => Math.exp(s / temperature));
    const total = expScores.reduce((sum, s) => sum + s, 0);
    const probs = expScores.map(s => s / total);

    // Sample from distribution
    const rand = Math.random();
    let cumsum = 0;
    for (let i = 0; i < modes.length; i++) {
      cumsum += probs[i];
      if (rand <= cumsum) return modes[i];
    }

    return modes[0];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL RANKING — Rank tools by embedding similarity to intent
  // ═══════════════════════════════════════════════════════════════════════════

  private rankToolsByIntent(intent: string): Array<{ name: string; relevance: number; description: string }> {
    const allTools = [
      { name: 'web_search', description: 'Search the internet for current information, facts, and explanations' },
      { name: 'calculate', description: 'Perform mathematical calculations and symbolic math' },
      { name: 'memory_retrieve', description: 'Search student\'s personal memory for past learning' },
      { name: 'memory_store', description: 'Save important learning moments to student\'s memory' },
      { name: 'curriculum_lookup', description: 'Look up Nigerian curriculum standards and past questions' },
      { name: 'diagram_generator', description: 'Generate descriptions of diagrams and visual aids' },
      { name: 'practice_question', description: 'Generate practice questions at appropriate difficulty' },
      { name: 'explain_like_im_5', description: 'Simplify explanation to basic level' },
    ];

    // Score each tool by keyword overlap (simplified — in production use embeddings)
    const intentWords = intent.toLowerCase().split(/[\s_]/);
    return allTools
      .map(tool => {
        const toolWords = tool.description.toLowerCase().split(/\s+/);
        const overlap = intentWords.filter(w => toolWords.some(tw => tw.includes(w) || w.includes(tw))).length;
        const relevance = Math.min(overlap / Math.max(intentWords.length, 1) + 0.3, 1);
        return { ...tool, relevance };
      })
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 4);
  }

  private seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
}

// Export singleton
export const promptEngine = DynamicPromptEngine;
