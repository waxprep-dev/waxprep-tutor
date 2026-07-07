/**
 * Memory Orchestrator
 * Coordinates all memory operations for the tutoring system
 */
import { ContextAssembler } from './core/assembler.js';
import { logger } from '../utils/logger.js';
import type { AssembledContext, UserProfile, TaskState } from './types/memory.js';

export interface MemoryInterface {
  // Session
  saveTurn(userId: string, role: 'user' | 'assistant', content: string): Promise<void>;
  getRecentTurns(userId: string, limit: number): Promise<Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>>;

  // Episodic
  storeEpisode(userId: string, sessionData: Record<string, unknown>): Promise<void>;

  // Long-term
  storeFact(userId: string, category: string, key: string, value: string, content: string, confidence?: number): Promise<void>;
  getFacts(userId: string, category?: string): Promise<Array<{ key: string; value: string; content: string; confidence: number }>>;

  // Profile
  getUserProfile(userId: string): Promise<UserProfile | Record<string, unknown>>;

  // Context
  assembleContext(userId: string, currentMessage: string): Promise<AssembledContext>;

  // Exchange
  recordExchange(
    userId: string,
    messageId: string,
    userMessage: string,
    assistantMessage: string,
    metadata?: {
      messageType?: string;
      tokensIn?: number;
      tokensOut?: number;
      latencyMs?: number;
      agentUsed?: string;
      intent?: string;
      emotionalState?: Record<string, unknown>;
    }
  ): Promise<void>;
}

class MemoryOrchestrator implements MemoryInterface {
  private assembler: ContextAssembler;
  private userProfiles: Map<string, UserProfile> = new Map();

  constructor() {
    this.assembler = new ContextAssembler();
  }

  async saveTurn(userId: string, role: 'user' | 'assistant', content: string): Promise<void> {
    logger.debug({ userId, role, contentLength: content.length }, 'saveTurn');
    // Implementation would persist to storage
  }

  async getRecentTurns(
    userId: string,
    limit: number = 10,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>> {
    logger.debug({ userId, limit }, 'getRecentTurns');
    return [];
  }

  async storeEpisode(userId: string, sessionData: Record<string, unknown>): Promise<void> {
    logger.debug({ userId, sessionData }, 'storeEpisode');
    // Implementation would persist to storage
  }

  async storeFact(
    userId: string,
    category: string,
    key: string,
    value: string,
    content: string,
    confidence: number = 0.8,
  ): Promise<void> {
    logger.debug({ userId, category, key, confidence }, 'storeFact');
    // Implementation would persist to storage
  }

  async getFacts(
    userId: string,
    category?: string,
  ): Promise<Array<{ key: string; value: string; content: string; confidence: number }>> {
    logger.debug({ userId, category }, 'getFacts');
    return [];
  }

  async getUserProfile(userId: string): Promise<UserProfile | Record<string, unknown>> {
    const cached = this.userProfiles.get(userId);
    if (cached) return cached;

    // Return a default profile structure
    const defaultProfile: Record<string, unknown> = {
      name: '',
      subjects: [],
      learningStyle: 'adaptive',
      proficiencyVector: {},
      engagementScore: 0.5,
      preferences: {
        language: 'en',
        tone: 'friendly',
        complexity: 0.5,
        examplePreference: [],
      },
      goals: [],
      weaknesses: [],
      strengths: [],
      recentActivity: {
        lastSessionAt: Date.now(),
        sessionCount: 1,
        avgSatisfaction: 0.8,
      },
    };

    return defaultProfile;
  }

  async assembleContext(userId: string, currentMessage: string): Promise<AssembledContext> {
    return this.assembler.assemble(userId, currentMessage);
  }

  async recordExchange(
    userId: string,
    messageId: string,
    userMessage: string,
    assistantMessage: string,
    metadata?: {
      messageType?: string;
      tokensIn?: number;
      tokensOut?: number;
      latencyMs?: number;
      agentUsed?: string;
      intent?: string;
      emotionalState?: Record<string, unknown>;
    },
  ): Promise<void> {
    logger.debug({
      userId,
      messageId,
      metadata,
    }, 'recordExchange');

    // Save to session
    await this.saveTurn(userId, 'user', userMessage);
    await this.saveTurn(userId, 'assistant', assistantMessage);

    // Implementation would persist to storage with metadata including agentUsed
  }
}

export const memory = new MemoryOrchestrator();
