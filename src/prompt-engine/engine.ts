/**
 * WaxPrep Dynamic Prompt Engine v3.0
 * Mathematical Prompt Assembly Using Vector Embeddings & Attention Mechanisms
 */

import { EmbeddingService } from '../utils/embedder.js';
import { MemoryRetrievalResult } from '../utils/types.js';

const DIMENSIONS = 1536;
const TEMPERATURE = 0.7;

type PromptComponentType =
  | 'personality'
  | 'intent'
  | 'memory'
  | 'curriculum'
  | 'emotional'
  | 'tools'
  | 'reasoning'
  | 'conversation';

interface PromptComponent {
  type: PromptComponentType;
  embedding: number[];
  content: string;
  attentionScore: number;
  weight: number;
  confidence: number;
  generatedAt: number;
}

interface PromptEngineUserProfile {
  name?: string;
  grade?: string;
  subjects: string[];
  learningStyle: 'visual' | 'auditory' | 'kinesthetic' | 'reading' | 'adaptive';
  proficiencyVector: Record<string, number>;
  engagementScore: number;
  preferences: {
    language: string;
    tone: string;
    complexity: number;
    examplePreference: string[];
  };
  goals: Array<{ id: string; description: string; progress: number; priority: number; status: string }>;
  weaknesses: string[];
  strengths: string[];
  recentActivity: {
    lastSessionAt: number;
    sessionCount: number;
    avgSatisfaction: number;
  };
}

interface ConversationState {
  currentMessage: string;
  messageEmbedding: number[];
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  episodicMemories: MemoryRetrievalResult[];
  longTermFacts: MemoryRetrievalResult[];
  intentDistribution: Record<string, number>;
  emotionalState: [number, number, number];
  userProfile: PromptEngineUserProfile;
  session: {
    messageCount: number;
    startTime: number;
    subjectTrajectory: string[];
  };
}

export interface AssembledPrompt {
  systemPrompt: string;
  components: PromptComponent[];
  weights: Record<string, number>;
  metadata: {
    attentionEntropy: number;
    dominantComponent: string;
    promptConfidence: number;
    vectorNorm: number;
  };
}

class AttentionProjections {
  private W_Q: number[][];
  private W_K: number[][];
  private W_V: number[][];
  private readonly d_k: number = 64;

  constructor(seed: number = 42) {
    this.W_Q = this.initializeProjection(DIMENSIONS, this.d_k, seed);
    this.W_K = this.initializeProjection(DIMENSIONS, this.d_k, seed + 1);
    this.W_V = this.initializeProjection(DIMENSIONS, DIMENSIONS, seed + 2);
  }

  projectQuery(stateEmbedding: number[]): number[] {
    return this.matrixVectorMul(this.W_Q, stateEmbedding);
  }

  projectKey(componentEmbedding: number[]): number[] {
    return this.matrixVectorMul(this.W_K, componentEmbedding);
  }

  projectValue(componentEmbedding: number[]): number[] {
    return this.matrixVectorMul(this.W_V, componentEmbedding);
  }

  private initializeProjection(rows: number, cols: number, seed: number): number[][] {
    const scale = Math.sqrt(2.0 / (rows + cols));
    const matrix: number[][] = [];
    const rng = this.seededRandom(seed);
    for (let i = 0; i < rows; i++) {
      const row: number[] = [];
      for (let j = 0; j < cols; j++) {
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

export class DynamicPromptEngine {
  private static instance: DynamicPromptEngine;
  private embedder: EmbeddingService;
  private projections: AttentionProjections;
  private componentCache: Map<string, PromptComponent> = new Map();
  private readonly cacheTTL = 60000;

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

  async assemblePrompt(state: ConversationState): Promise<AssembledPrompt> {
    const components = await this.generateAllComponents(state);
    const stateEmbedding = this.computeStateEmbedding(state);
    const query = this.projections.projectQuery(stateEmbedding);

    const scoredComponents = components.map(comp => {
      const key = this.projections.projectKey(comp.embedding);
      const score = this.dotProduct(query, key) / Math.sqrt(64);
      return { ...comp, attentionScore: score };
    });

    const weights = this.softmax(
      scoredComponents.map(c => c.attentionScore),
      TEMPERATURE
    );

    const weightedComponents = scoredComponents.map((comp, i) => ({
      ...comp,
      weight: weights[i],
    }));

    const sortedComponents = [...weightedComponents].sort((a, b) => b.weight - a.weight);
    const systemPrompt = this.renderPromptFromComponents(sortedComponents, state);

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

    const results = await Promise.allSettled(generators.map(g => g()));
    return results
      .filter((r): r is PromiseFulfilledResult<PromptComponent> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  private async generatePersonalityComponent(state: ConversationState): Promise<PromptComponent> {
    const { userProfile } = state;
    const [valence, arousal] = state.emotionalState;

    const warmth = 0.5 + 0.3 * userProfile.engagementScore + 0.2 * valence;
    const formality = 0.7 - 0.3 * userProfile.engagementScore;
    const enthusiasm = 0.6 + 0.2 * userProfile.engagementScore + 0.2 * (arousal > 0 ? arousal : 0);
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

  private async generateIntentComponent(state: ConversationState): Promise<PromptComponent> {
    const intents = state.intentDistribution;
    const sortedIntents = Object.entries(intents).sort((a, b) => b[1] - a[1]);
    const topIntent = sortedIntents[0];

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

  private async generateMemoryComponent(state: ConversationState): Promise<PromptComponent> {
    const allMemories = [
      ...state.episodicMemories.map(m => ({ ...m, type: 'episodic' as const })),
      ...state.longTermFacts.map(m => ({ ...m, type: 'longterm' as const })),
    ];

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

  private async generateCurriculumComponent(state: ConversationState): Promise<PromptComponent> {
    const { userProfile } = state;
    const topIntent = Object.entries(state.intentDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

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

  private async generateEmotionalComponent(state: ConversationState): Promise<PromptComponent> {
    const [valence, arousal, dominance] = state.emotionalState;
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

  private async generateToolsComponent(state: ConversationState): Promise<PromptComponent> {
    const topIntent = Object.entries(state.intentDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
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

  private renderPersonalityVector(
    warmth: number,
    formality: number,
    enthusiasm: number,
    socraticLevel: number,
    profile: PromptEngineUserProfile
  ): string {
    const warmthDesc = warmth > 0.8 ? 'warm and friendly' :
                       warmth > 0.5 ? 'friendly and approachable' : 'professional and respectful';
    const formalityDesc = formality > 0.7 ? 'formal' :
                          formality > 0.4 ? 'semi-formal' : 'casual and conversational';
    const enthusiasmDesc = enthusiasm > 0.8 ? 'enthusiastic and energetic' :
                           enthusiasm > 0.5 ? 'encouraging' : 'calm and steady';
    const socraticDesc = socraticLevel > 0.7 ? 'Guide through questions. Never give full answers immediately.' :
                           socraticLevel > 0.4 ? 'Balance explanation with questions.' :
                           'Explain clearly, then ask follow-up questions.';

    return `[PERSONA: Wax -- Adaptive AI Tutor]\nYou are Wax, an intelligent AI tutor for Nigerian students. You are ${warmthDesc}, ${formalityDesc}, and ${enthusiasmDesc}.\n\nCORE IDENTITY:\n- You are a dedicated learning companion\n- You speak like a knowledgeable older sibling or mentor\n- You understand Nigerian culture, education, and daily life\n- You are patient and celebrate every small win\n\nTEACHING APPROACH (${(socraticLevel * 100).toFixed(0)}% Socratic):\n${socraticDesc}\n\nSTUDENT:\n- Name: ${profile.name || 'student'}\n- Grade: ${profile.grade || 'unknown'}\n- Style: ${profile.learningStyle}\n- Engagement: ${(profile.engagementScore * 100).toFixed(0)}%`;
  }

  private renderIntentVector(sortedIntents: [string, number][], topIntent?: [string, number]): string {
    if (!topIntent || topIntent[1] < 0.3) {
      return '[INTENT: Unclear -- Ask clarifying question]';
    }

    const intentGuidance: Record<string, string> = {
      'learn_concept': 'Student wants to understand a concept. Use explanation + examples.',
      'solve_problem': 'Student has a problem to solve. Guide step-by-step. Do NOT give the answer.',
      'practice': 'Student wants practice. Generate relevant questions.',
      'exam_prep': 'Exam prep mode. Focus on WAEC/NECO/JAMB patterns.',
      'explain_step': 'Student stuck on a step. Provide targeted hint.',
      'general_chat': 'Casual conversation. Build rapport.',
      'frustrated': 'Student is frustrated. Be extra patient. Break into smaller pieces.',
      'confused': 'Student is confused. Simplify. Use different angle.',
    };

    return `[INTENT: ${topIntent[0]} -- ${(topIntent[1] * 100).toFixed(1)}%]\n${intentGuidance[topIntent[0]] || 'Respond naturally.'}\n\nDistribution: ${sortedIntents.map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(', ')}`;
  }

  private renderMemoryVector(memories: Array<MemoryRetrievalResult & { compositeScore: number }>): string {
    if (memories.length === 0) {
      return '[MEMORY: No relevant memories]';
    }

    const memoryText = memories.map((m, i) =>
      `[M${i + 1}] ${m.content} (relevance: ${(m.compositeScore * 100).toFixed(1)}%)`
    ).join('\n');

    return `[MEMORY: ${memories.length} retrieved]\n${memoryText}`;
  }

  private renderCurriculumVector(subject: string, examType: string, grade?: string): string {
    if (!subject) {
      return '[CURRICULUM: General Nigerian Education]';
    }

    return `[CURRICULUM: Nigerian Education]\nSubject: ${subject}\nTarget Exam: ${examType}\nGrade: ${grade || 'adaptive'}\n\n- Use Nigerian curriculum terminology\n- Reference WAEC/NECO/JAMB syllabus\n- Use local examples\n- Think: "How would a Nigerian teacher explain this?"`;
  }

  private renderEmotionalVector(encouragement: number, energy: string, directness: string, valence: number): string {
    const encouragementText = encouragement > 0.7
      ? 'Student needs strong encouragement. Acknowledge effort explicitly.'
      : encouragement > 0.4
      ? 'Offer moderate encouragement.'
      : 'Normal tone. Student seems neutral.';

    return `[EMOTIONAL CALIBRATION]\nState: valence=${valence.toFixed(2)}\n\n${encouragementText}\nEnergy: ${energy}\nApproach: ${directness}`;
  }

  private renderToolsVector(tools: Array<{ name: string; relevance: number; description: string }>, intent: string): string {
    if (tools.length === 0) {
      return '[TOOLS: None required]';
    }

    const toolText = tools.map((t, i) =>
      `[TOOL ${i + 1}] ${t.name} (${(t.relevance * 100).toFixed(0)}%) -- ${t.description}`
    ).join('\n');

    return `[TOOLS: Ranked for "${intent}"]\n${toolText}`;
  }

  private renderReasoningVector(mode: string, complexity: number, learningStyle: string): string {
    const modeInstructions: Record<string, string> = {
      'chain_of_thought': `THINKING MODE: Step-by-Step\nComplexity: ${(complexity * 100).toFixed(1)}%\n1. Break into clear steps\n2. Show reasoning\n3. Use -> for progression\n4. For ${learningStyle} learners`,
      'socratic': `THINKING MODE: Socratic\nComplexity: ${(complexity * 100).toFixed(1)}%\n1. NEVER give answer directly\n2. Ask guiding questions\n3. For ${learningStyle} learners`,
      'direct_explanation': `THINKING MODE: Direct\nComplexity: ${(complexity * 100).toFixed(1)}%\n1. Explain clearly\n2. Use simple language\n3. For ${learningStyle} learners`,
      'analogical': `THINKING MODE: Analogical\nComplexity: ${(complexity * 100).toFixed(1)}%\n1. Use Nigerian daily life analogies\n2. Connect abstract to concrete\n3. For ${learningStyle} learners`,
    };

    return modeInstructions[mode] || modeInstructions['direct_explanation'];
  }

  private renderPromptFromComponents(components: PromptComponent[], state: ConversationState): string {
    const significantComponents = components.filter(c => c.weight > 0.05);
    const sections: string[] = [];

    const personality = significantComponents.find(c => c.type === 'personality');
    if (personality) sections.push(personality.content);

    const intent = significantComponents.find(c => c.type === 'intent');
    if (intent && intent.confidence > 0.3) sections.push(intent.content);

    const reasoning = significantComponents.find(c => c.type === 'reasoning');
    if (reasoning) sections.push(reasoning.content);

    const curriculum = significantComponents.find(c => c.type === 'curriculum');
    if (curriculum && curriculum.confidence > 0.5) sections.push(curriculum.content);

    const emotional = significantComponents.find(c => c.type === 'emotional');
    if (emotional) sections.push(emotional.content);

    const memory = significantComponents.find(c => c.type === 'memory');
    if (memory && memory.confidence > 0.4) sections.push(memory.content);

    const tools = significantComponents.find(c => c.type === 'tools');
    if (tools && tools.confidence > 0.5) sections.push(tools.content);

    const conversation = significantComponents.find(c => c.type === 'conversation');
    if (conversation) sections.push(conversation.content);

    sections.push(`[INSTRUCTION]\nYou are Wax. Respond naturally. Be helpful, warm, and educational.\n\nStudent's message: "${state.currentMessage}"\n\nRespond:`);

    return sections.join('\n\n===\n\n');
  }

  private computeStateEmbedding(state: ConversationState): number[] {
    const messageEmb = state.messageEmbedding;
    const emotionalProjection = this.projectEmotionalToEmbedding(state.emotionalState);

    return messageEmb.map((v, i) =>
      0.7 * v + 0.2 * (state.recentTurns.length > 0 ? v : 0) + 0.1 * emotionalProjection[i]
    );
  }

  private projectEmotionalToEmbedding(emotionalState: [number, number, number]): number[] {
    const [v, a, d] = emotionalState;
    const embedding: number[] = [];
    const seed = Math.abs(Math.floor((v + 1) * 1000 + (a) * 100 + (d + 1) * 10));
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
    const avgComponentConfidence = components.reduce((sum, c) => sum + c.confidence, 0) / components.length;
    const intentEntropy = this.computeEntropy(Object.values(state.intentDistribution));
    const intentConfidence = 1 - Math.min(intentEntropy / Math.log2(Object.keys(state.intentDistribution).length || 2), 1);
    const memoryQuality = state.episodicMemories.length + state.longTermFacts.length > 0
      ? ((state.episodicMemories[0]?.similarity || 0) + (state.longTermFacts[0]?.similarity || 0)) / 2
      : 0.5;

    return 0.4 * avgComponentConfidence + 0.3 * intentConfidence + 0.3 * memoryQuality;
  }

  private extractSubject(intent: string, profile: PromptEngineUserProfile): string {
    const subjects = ['mathematics', 'physics', 'chemistry', 'biology', 'english',
                      'literature', 'government', 'economics', 'commerce',
                      'agricultural science', 'geography', 'history',
                      'further mathematics', 'technical drawing'];

    const intentLower = intent.toLowerCase();
    for (const subj of subjects) {
      if (intentLower.includes(subj)) return subj;
    }

    if (profile.subjects.length > 0) return profile.subjects[0];
    return '';
  }

  private inferExamType(grade?: string): string {
    if (!grade) return 'General';
    const gradeMap: Record<string, string> = {
      'SS3': 'WAEC/NECO', 'SS2': 'WAEC/NECO Prep', 'SS1': 'Junior WAEC',
      'JSS3': 'Junior WAEC', 'JSS2': 'Basic Education', 'JSS1': 'Basic Education',
    };
    return gradeMap[grade] || 'General';
  }

  private analyzeMessageComplexity(message: string): number {
    const features = this.extractComplexityFeatures(message);
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

    return Math.min(Math.max(score, 0), 1);
  }

  private extractComplexityFeatures(message: string): Record<string, number> {
    const words = message.split(/\s+/).filter(w => w.length > 0);
    const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);

    return {
      length: Math.min(message.length / 1000, 1),
      sentenceCount: Math.min(sentences.length / 10, 1),
      avgWordLength: Math.min(words.reduce((sum, w) => sum + w.length, 0) / (words.length || 1) / 10, 1),
      mathSymbols: Math.min((message.match(/[+\-*/^=√∫∑πθΣΔ]/g) || []).length / 5, 1),
      questionWords: Math.min((message.match(/\b(how|why|what|when|where|explain|derive|prove|solve)\b/gi) || []).length / 3, 1),
      stepIndicators: Math.min((message.match(/\b(step|first|then|next|after|finally|process)\b/gi) || []).length / 3, 1),
      conceptualWords: Math.min((message.match(/\b(concept|theory|principle|law|theorem|hypothesis|analysis)\b/gi) || []).length / 3, 1),
      negationCount: Math.min((message.match(/\b(not|no|never|don't|doesn't|isn't|can't)\b/gi) || []).length / 3, 1),
    };
  }

  private selectReasoningMode(complexity: number, learningStyle: string): string {
    const modes = ['chain_of_thought', 'socratic', 'direct_explanation', 'analogical'];

    const scores: Record<string, number> = {
      'chain_of_thought': complexity > 0.6 ? 0.8 : complexity > 0.3 ? 0.5 : 0.2,
      'socratic': learningStyle === 'kinesthetic' ? 0.9 : complexity > 0.4 ? 0.7 : 0.5,
      'direct_explanation': complexity < 0.3 ? 0.9 : learningStyle === 'reading' ? 0.7 : 0.4,
      'analogical': learningStyle === 'visual' ? 0.8 : complexity > 0.5 ? 0.6 : 0.4,
    };

    const temp = 0.3;
    const noise = modes.map(() => (Math.random() - 0.5) * 0.1);
    const adjustedScores = modes.map((mode, i) => scores[mode] + noise[i]);

    const expScores = adjustedScores.map(s => Math.exp(s / temp));
    const total = expScores.reduce((sum, s) => sum + s, 0);
    const probs = expScores.map(s => s / total);

    const rand = Math.random();
    let cumsum = 0;
    for (let i = 0; i < modes.length; i++) {
      cumsum += probs[i];
      if (rand <= cumsum) return modes[i];
    }

    return modes[0];
  }

  private rankToolsByIntent(intent: string): Array<{ name: string; relevance: number; description: string }> {
    const allTools = [
      { name: 'web_search', description: 'Search the internet for current information' },
      { name: 'calculate', description: 'Perform mathematical calculations' },
      { name: 'memory_retrieve', description: 'Search student personal memory' },
      { name: 'memory_store', description: 'Save learning moments' },
      { name: 'curriculum_lookup', description: 'Nigerian curriculum standards' },
      { name: 'diagram_generator', description: 'Generate visual aid descriptions' },
      { name: 'practice_question', description: 'Generate practice questions' },
      { name: 'explain_like_im_5', description: 'Simplify explanation' },
    ];

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

export const promptEngine = DynamicPromptEngine;
