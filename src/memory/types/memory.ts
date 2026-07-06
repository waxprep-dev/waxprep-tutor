/**
 * Memory System Type Definitions
 * Strict TypeScript interfaces for the 4-layer cognitive architecture
 */

// Core memory types
export interface MemoryBase {
  id: string;
  userId: string;
  tenantId?: string;
  layer: MemoryLayer;
  createdAt: number;
  updatedAt: number;
  metadata: {
    createdAt: number;
    updatedAt: number;
    accessCount: number;
    lastAccessedAt: number;
    confidence: number;
    salience: number;
    source: string;
    tags: string[];
  };
}

export type MemoryLayer = 'session' | 'episodic' | 'longterm' | 'procedural';

// Session Memory Types
export interface SessionMemory extends MemoryBase {
  layer: 'session';
  sessionId: string;
  turns: SessionTurn[];
  activeTask?: TaskState;
  metadata: MemoryBase['metadata'] & {
    startTime: number;
    lastActivityAt: number;
    language: string;
    mode: string;
  };
}

export interface SessionTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  metadata?: {
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    sentiment?: 'positive' | 'neutral' | 'negative';
  };
}

export interface TaskState {
  id: string;
  name: string;
  progress: number;
  steps: TaskStep[];
  estimatedCompletion?: number;
}

export interface TaskStep {
  id: string;
  description: string;
  completed: boolean;
  completedAt?: number;
}

// Episodic Memory Types
export interface EpisodicMemory extends MemoryBase {
  layer: 'episodic';
  sessionId: string;
  content: string;
  summary: string;
  keyOutcomes: string[];
  openItems: string[];
  userGoals: string[];
  aiActions: string[];
  durationMs?: number;
  turnCount?: number;
  satisfactionScore?: number;
  vector: VectorEmbedding;
  metadata: MemoryBase['metadata'] & {
    sessionDuration: number;
    turnCount: number;
    topicCoverage: string[];
    difficultyLevel: number;
  };
}

// Long-Term Memory Types
export interface LongTermMemory extends MemoryBase {
  layer: 'longterm';
  category: LongTermMemoryCategory;
  factType: LongTermMemoryFactType;
  key: string;
  value: string;
  content: string;
  context?: string;
  contradictions: string[]; // IDs of conflicting memories
  verificationStatus: VerificationStatus;
  vector: VectorEmbedding;
  metadata: MemoryBase['metadata'] & {
    sourceMessages: string[];
    evidenceStrength: number;
    temporalRelevance: number;
  };
}

export type LongTermMemoryCategory =
  | 'preference'
  | 'profile'
  | 'knowledge'
  | 'goal'
  | 'behavior'
  | 'relationship'
  | 'constraint'
  | 'history'
  | 'skill'
  | 'context';

export type LongTermMemoryFactType =
  | 'static'
  | 'dynamic'
  | 'probabilistic'
  | 'temporal'
  | 'conditional';

export type VerificationStatus =
  | 'unverified'
  | 'verified'
  | 'disputed'
  | 'deprecated';

// Procedural Memory Types
export interface ProceduralMemory extends MemoryBase {
  layer: 'procedural';
  ruleType: RuleType;
  condition: string;
  action: string;
  priority: number; // 1-100, higher wins
  scope: RuleScope;
  version: number;
  effectiveFrom: number;
  effectiveTo?: number;
  auditLog: RuleAuditEntry[];
  metadata: MemoryBase['metadata'] & {
    activationCount: number;
    lastActivation: number;
  };
}

export type RuleType =
  | 'safety'
  | 'business'
  | 'tone'
  | 'escalation'
  | 'compliance'
  | 'routing'
  | 'format';

export type RuleScope = 'global' | 'tenant' | 'user' | 'session';

export interface RuleAuditEntry {
  timestamp: number;
  action: 'created' | 'updated' | 'activated' | 'deactivated' | 'triggered';
  actor: string;
  details?: any;
}

// Vector Embedding Types
export interface VectorEmbedding {
  embedding: number[];
  model: string;
  dimensions: number;
  normalized: boolean;
}

// Context Assembly Types
export interface AssembledContext {
  systemPrompt: string;
  recentTurns: SessionTurn[];
  retrievedMemories: RetrievedMemory[];
  userProfile: UserProfile;
  activeTask?: TaskState;
  assemblyMetadata: {
    durationMs: number;
    tokensUsed: number;
    tokensBudget: number;
    memorySources: {
      session: number;
      episodic: number;
      longTerm: number;
      procedural: number;
    };
  };
}

export interface RetrievedMemory {
  id: string;
  type: MemoryLayer;
  content: string;
  similarity: number;
  metadata: any;
}

export interface UserProfile {
  id: string;
  name?: string;
  grade?: string;
  subjects?: string[];
  learningStyle?: 'visual' | 'auditory' | 'kinesthetic' | 'reading';
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

// Query Parameters
export interface MemoryQueryParams {
  userId: string;
  tenantId?: string;
  categories?: LongTermMemoryCategory[];
  dateRange?: [number, number]; // [start, end] in milliseconds
  limit?: number;
  confidenceThreshold?: number;
  includeInactive?: boolean;
}

export interface SearchParams {
  userId: string;
  query: string;
  limit: number;
  threshold: number;
  categories?: string[];
}
