/**
 * Memory Storage Interface Abstraction
 * Defines contracts for all storage implementations
 * Allows swapping between Redis, Supabase, etc. without changing business logic
 */

import {
  SessionMemory,
  EpisodicMemory,
  LongTermMemory,
  ProceduralMemory,
  MemoryQueryParams,
  SearchParams,
  SessionTurn,
  TaskState
} from '../types/memory.js';

export interface SessionStorage {
  /**
   * Session Operations
   */
  createSession(userId: string, initialTurn?: SessionTurn): Promise<SessionMemory>;
  getActiveSession(userId: string): Promise<SessionMemory | null>;
  addTurnToSession(sessionId: string, turn: SessionTurn): Promise<SessionMemory>;
  updateTask(sessionId: string, task: TaskState): Promise<SessionMemory>;
  closeSession(sessionId: string, summary?: string): Promise<SessionMemory>;
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Session Queries
   */
  getSessionsByUser(userId: string, limit?: number): Promise<SessionMemory[]>;
  getRecentTurns(userId: string, count: number): Promise<SessionTurn[]>;
}

export interface EpisodicStorage {
  /**
   * Episodic Memory Operations
   */
  create(memory: Omit<EpisodicMemory, 'id' | 'createdAt' | 'updatedAt'>): Promise<EpisodicMemory>;
  getById(id: string): Promise<EpisodicMemory | null>;
  getByUserId(userId: string, limit?: number): Promise<EpisodicMemory[]>;
  update(id: string, updates: Partial<EpisodicMemory>): Promise<EpisodicMemory>;
  delete(id: string): Promise<void>;

  /**
   * Vector Search
   */
  search(query: SearchParams): Promise<EpisodicMemory[]>;
  findSimilar(sessionId: string, limit?: number): Promise<EpisodicMemory[]>;

  /**
   * Analytics
   */
  getStats(userId: string): Promise<{
    totalCount: number;
    avgSatisfaction: number;
    mostCommonTopics: string[];
  }>;
}

export interface LongTermStorage {
  /**
   * Long-Term Memory Operations
   */
  create(memory: Omit<LongTermMemory, 'id' | 'createdAt' | 'updatedAt'>): Promise<LongTermMemory>;
  getById(id: string): Promise<LongTermMemory | null>;
  getByUserId(userId: string, params?: MemoryQueryParams): Promise<LongTermMemory[]>;
  getByKey(userId: string, key: string): Promise<LongTermMemory | null>;
  update(id: string, updates: Partial<LongTermMemory>): Promise<LongTermMemory>;
  delete(id: string): Promise<void>;
  markDeprecated(id: string): Promise<LongTermMemory>;

  /**
   * Vector Search
   */
  search(query: SearchParams): Promise<LongTermMemory[]>;
  findRelated(userId: string, category: string, limit?: number): Promise<LongTermMemory[]>;

  /**
   * Contradiction Management
   */
  findContradictions(userId: string, key: string): Promise<LongTermMemory[]>;
  resolveContradiction(memoryIds: string[], winnerId: string): Promise<void>;

  /**
   * Batch Operations
   */
  bulkUpsert(memories: Omit<LongTermMemory, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<LongTermMemory[]>;
  bulkUpdate(updates: { id: string; updates: Partial<LongTermMemory> }[]): Promise<LongTermMemory[]>;
}

export interface ProceduralStorage {
  /**
   * Procedural Memory Operations
   */
  create(rule: Omit<ProceduralMemory, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProceduralMemory>;
  getById(id: string): Promise<ProceduralMemory | null>;
  getByUserId(userId: string): Promise<ProceduralMemory[]>;
  getByScope(scope: 'global' | 'tenant' | 'user', userId?: string, tenantId?: string): Promise<ProceduralMemory[]>;
  getByType(ruleType: string): Promise<ProceduralMemory[]>;
  update(id: string, updates: Partial<ProceduralMemory>): Promise<ProceduralMemory>;
  deactivate(id: string): Promise<ProceduralMemory>;
  delete(id: string): Promise<void>;

  /**
   * Rule Activation
   */
  getActiveRules(userId: string, context?: Record<string, unknown>): Promise<ProceduralMemory[]>;
  activateRule(id: string): Promise<ProceduralMemory>;
  incrementActivation(id: string): Promise<void>;

  /**
   * Audit Trail
   */
  getAuditTrail(id: string): Promise<import('../types/memory.js').RuleAuditEntry[]>;
  logActivation(ruleId: string, context?: Record<string, unknown>): Promise<void>;
}

/**
 * Unified Memory Storage Interface
 * Coordinates all storage layers
 */
export interface MemoryStorage {
  session: SessionStorage;
  episodic: EpisodicStorage;
  longTerm: LongTermStorage;
  procedural: ProceduralStorage;

  /**
   * Cross-layer operations
   */
  migrateSessionToEpisodic(sessionId: string): Promise<EpisodicMemory>;
  cleanupExpiredMemories(cutoffDate: number): Promise<void>;
  exportUserData(userId: string): Promise<Record<string, unknown>>;
  importUserData(userId: string, data: Record<string, unknown>): Promise<void>;
}
