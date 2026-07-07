/**
 * WaxPrep Shared Types - Core Type Definitions for All Modules
 */

// Memory Types
export interface MemoryRetrievalResult {
  id: string;
  content: string;
  type: 'episodic' | 'longterm';
  similarity: number;
  metadata?: {
    confidence?: number;
    recencyWeight?: number;
    createdAt?: number;
    accessCount?: number;
    [key: string]: unknown;
  };
}

export interface VectorEmbedding {
  embedding: number[];
  model: string;
  dimensions: number;
  normalized: boolean;
}

// User Profile
export interface UserProfile {
  id?: string;
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
  goals: UserGoal[];
  weaknesses: string[];
  strengths: string[];
  recentActivity: {
    lastSessionAt: number;
    sessionCount: number;
    avgSatisfaction: number;
  };
}

export interface UserGoal {
  id: string;
  description: string;
  targetDate?: number;
  progress: number;
  priority: number;
  status: 'planned' | 'in-progress' | 'completed' | 'stalled';
}

// Intent Classification
export interface IntentClassificationResult {
  distribution: Record<string, number>;
  primaryIntent: string;
  confidence: number;
  topIntents: Array<{ intent: string; probability: number }>;
  isConfident: boolean;
  entropy: number;
  rawScores: Record<string, number>;
}

// Emotional State
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

export interface EmotionalState {
  valence: number;
  arousal: number;
  dominance: number;
  confidence: number;
  category: EmotionalCategory;
  assessedAt: number;
}

// Prompt Engine
export type PromptComponentType =
  | 'personality'
  | 'intent'
  | 'memory'
  | 'curriculum'
  | 'emotional'
  | 'tools'
  | 'reasoning'
  | 'conversation';

export interface PromptComponent {
  type: PromptComponentType;
  embedding: number[];
  content: string;
  attentionScore: number;
  weight: number;
  confidence: number;
  generatedAt: number;
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

// Multi-Agent
export interface AgentResponse {
  text: string;
  confidence: number;
  agentName: string;
  reasoningMode: string;
  toolsUsed: string[];
  tokensUsed: { prompt: number; completion: number };
  latencyMs: number;
  responseEmbedding?: number[];
  activatedSpecialties: string[];
}

export interface AgentScore {
  agentName: string;
  response: AgentResponse;
  compositeScore: number;
  components: {
    confidence: number;
    relevance: number;
    diversity: number;
    speed: number;
    quality: number;
  };
  weights: {
    alpha: number;
    beta: number;
    gamma: number;
    delta: number;
  };
}

// Tool System
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
  embedding?: number[];
  activationThreshold: number;
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  description: string;
  required: boolean;
  enum?: string[];
}

export interface ToolContext {
  userId: string;
  userProfile: Record<string, unknown>;
  conversationHistory: Array<{ role: string; content: string }>;
  intent: string;
  subject?: string;
}

export interface ToolResult {
  success: boolean;
  data: unknown;
  toolName: string;
  latencyMs: number;
  error?: string;
}

// Curriculum
export interface CurriculumTopic {
  name: string;
  code: string;
  examTypes: ('WAEC' | 'NECO' | 'JAMB' | 'Junior WAEC')[];
  gradeLevels: string[];
  prerequisites: string[];
  subtopics: string[];
  commonQuestionTypes: string[];
  estimatedStudyHours: number;
}

export interface NigerianCurriculum {
  subject: string;
  topics: CurriculumTopic[];
  examSyllabus: Record<string, string[]>;
}
