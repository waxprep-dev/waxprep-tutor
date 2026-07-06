/**
 * Unified Memory System
 * 
 * Single entry point for all memory operations.
 * Your team calls these functions from the message worker.
 * 
 * Usage:
 *   const memory = await MemorySystem.initialize();
 *   const context = await memory.assembleContext(userId, message);
 *   // ... send context to Gamma 4 / Kimi 4.3 ...
 *   await memory.recordExchange(userId, message, aiResponse);
 */

import { getSessionStorage } from './layers/session.js';
import { getEpisodicStorage } from './layers/episodic.js';
import { getLongTermStorage } from './layers/longterm.js';
import { getProceduralStorage } from './layers/procedural.js';
import { getEmbeddingService, embedder } from './core/embedder.js';
import { 
  assembleContext, 
  recordUserTurn, 
  recordAssistantTurn,
  ContextAssembler
} from './core/assembler.js';
import { 
  AssembledContext, 
  SessionTurn, 
  LongTermMemory, 
  ProceduralMemory,
  UserProfile,
  TaskState
} from './types/memory.js';
import { startConsolidationWorker } from './workers/consolidationWorker.js';

export class MemorySystem {
  private static instance: MemorySystem | null = null;

  static initialize(): MemorySystem {
    if (!MemorySystem.instance) {
      MemorySystem.instance = new MemorySystem();
    }
    return MemorySystem.instance;
  }

  // =====================================================================
  // CONTEXT ASSEMBLY (Call this before every AI generation)
  // =====================================================================

  async assembleContext(
    userId: string,
    currentMessage: string,
    tenantId?: string
  ): Promise<AssembledContext> {
    return assembleContext(userId, currentMessage, tenantId);
  }

  // =====================================================================
  // EXCHANGE RECORDING (Call this after every turn)
  // =====================================================================

  async recordUserMessage(
    userId: string,
    messageId: string,
    content: string,
    messageType: string = 'text'
  ): Promise<void> {
    await recordUserTurn(userId, messageId, content, messageType);
  }

  async recordAIResponse(
    userId: string,
    content: string,
    metadata: {
      tokensIn?: number;
      tokensOut?: number;
      latencyMs?: number;
    } = {}
  ): Promise<void> {
    await recordAssistantTurn(userId, content, metadata);
  }

  /**
   * Convenience: records both user message and AI response
   */
  async recordExchange(
    userId: string,
    messageId: string,
    userContent: string,
    aiContent: string,
    metadata: {
      messageType?: string;
      tokensIn?: number;
      tokensOut?: number;
      latencyMs?: number;
    } = {}
  ): Promise<void> {
    await this.recordUserMessage(userId, messageId, userContent, metadata.messageType || 'text');
    await this.recordAIResponse(userId, aiContent, {
      tokensIn: metadata.tokensIn,
      tokensOut: metadata.tokensOut,
      latencyMs: metadata.latencyMs,
    });
  }

  // =====================================================================
  // DIRECT MEMORY OPERATIONS (For advanced use)
  // =====================================================================

  async storeFact(
    userId: string,
    category: LongTermMemory['category'],
    key: string,
    value: string,
    content: string,
    confidence: number = 0.8,
    factType: LongTermMemory['factType'] = 'dynamic'
  ): Promise<LongTermMemory> {
    const storage = getLongTermStorage();

    const embedding = await embedder.embed(content);

    const memory: LongTermMemory = {
      id: `ltm_${userId}_${key}_${Date.now()}`,
      userId,
      layer: 'longterm',
      category,
      factType,
      key,
      value,
      content,
      verificationStatus: 'unverified',
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now(),
        confidence,
        salience: 0.5,
        source: 'user_explicit',
        tags: [category, factType],
      },
      vector: {
        embedding,
        model: embedder.getModelName(),
        dimensions: embedder.getDimensions(),
        normalized: true,
      },
    };

    return storage.create(memory);
  }

  async getFact(userId: string, key: string): Promise<LongTermMemory | null> {
    return getLongTermStorage().getByKey(userId, key);
  }

  async addRule(
    ruleType: ProceduralMemory['ruleType'],
    condition: string,
    action: string,
    priority: number,
    scope: ProceduralMemory['scope'] = 'global',
    userId?: string,
    tenantId?: string
  ): Promise<ProceduralMemory> {
    const storage = getProceduralStorage();

    const rule: ProceduralMemory = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      userId: userId || 'global',
      tenantId,
      layer: 'procedural',
      ruleType,
      condition,
      action,
      priority,
      scope,
      version: 1,
      effectiveFrom: Date.now(),
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now(),
        confidence: 1,
        salience: 1,
        source: 'system_derived',
        tags: [ruleType, scope],
      },
      auditLog: [{
        timestamp: Date.now(),
        action: 'created',
        actor: 'system',
      }],
    };

    return storage.create(rule);
  }

  // =====================================================================
  // SESSION MANAGEMENT
  // =====================================================================

  async closeSession(userId: string, summary?: string): Promise<void> {
    const sessionStorage = getSessionStorage();
    const session = await sessionStorage.getActiveSession(userId);
    if (session) {
      await sessionStorage.closeSession(session.sessionId, summary);
    }
  }

  async getSessionHistory(userId: string, turnCount: number = 10): Promise<SessionTurn[]> {
    const sessionStorage = getSessionStorage();
    const session = await sessionStorage.getActiveSession(userId);
    if (!session) return [];
    return session.turns.slice(-turnCount);
  }

  // =====================================================================
  // USER PROFILE MANAGEMENT
  // =====================================================================

  async getUserProfile(userId: string): Promise<UserProfile> {
    const assembler = ContextAssembler.initialize();
    const emptyContext = await assembler.assembleContext(userId, '', undefined);
    return emptyContext.userProfile;
  }

  // =====================================================================
  // TASK MANAGEMENT
  // =====================================================================

  async setActiveTask(userId: string, task: TaskState): Promise<void> {
    const sessionStorage = getSessionStorage();
    const session = await sessionStorage.getActiveSession(userId);
    if (session) {
      await sessionStorage.updateTask(session.sessionId, task);
    }
  }

  async getActiveTask(userId: string): Promise<TaskState | undefined> {
    const sessionStorage = getSessionStorage();
    const session = await sessionStorage.getActiveSession(userId);
    return session?.activeTask;
  }

  // =====================================================================
  // EMBEDDING OPERATIONS
  // =====================================================================

  async getEmbedding(text: string): Promise<number[]> {
    const embedding = await embedder.embed(text);
    return embedding.embedding;
  }

  async calculateSimilarity(text1: string, text2: string): Promise<number> {
    const [emb1, emb2] = await Promise.all([
      embedder.embed(text1),
      embedder.embed(text2)
    ]);
    return embedder.cosineSimilarity(emb1.embedding, emb2.embedding);
  }

  // =====================================================================
  // CONSOLIDATION TRIGGER
  // =====================================================================

  async triggerConsolidation(sessionId: string, userId: string): Promise<string> {
    const consolidationWorker = startConsolidationWorker();
    return consolidationWorker.queueConsolidation(sessionId, userId, 'manual');
  }
}

// Export singleton instance
export const memory = MemorySystem.initialize();

// Export the main functions for direct use
export {
  assembleContext,
  recordUserTurn,
  recordAssistantTurn,
  getEmbeddingService,
  startConsolidationWorker
};
