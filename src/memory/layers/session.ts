/**
 * Session Memory Layer
 * Redis-backed working memory for active conversations
 * Fast, ephemeral storage for current session state
 */

import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import {
  SessionMemory,
  SessionTurn,
  TaskState,
  MemoryLayer
} from '../types/memory.js';
import { SessionStorage } from '../interfaces/storage.js';
import { config } from '../../config/index.js';
import { getRedis } from '../../storage/idempotency.js';
import { logger } from '../../utils/logger.js';

export class SessionMemoryLayer implements SessionStorage {
  private redis: Redis;
  private readonly sessionPrefix: string;
  private readonly sessionExpiry: number; // in seconds

  constructor(redis?: Redis) {
    this.redis = redis || getRedis();
    this.sessionPrefix = `${config.queue.prefix}:session`;
    this.sessionExpiry = 24 * 60 * 60; // 24 hours default
  }

  /**
   * Create a new session for a user
   */
  async createSession(userId: string, initialTurn?: SessionTurn): Promise<SessionMemory> {
    const sessionId = `sess_${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const session: SessionMemory = {
      id: sessionId,
      userId,
      layer: 'session',
      sessionId,
      turns: initialTurn ? [initialTurn] : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now(),
        confidence: 1.0,
        salience: 1.0,
        source: 'session_creation',
        tags: ['session', 'active'],
        startTime: Date.now(),
        lastActivityAt: initialTurn ? initialTurn.timestamp : Date.now(),
        language: 'en',
        mode: 'tutoring'
      }
    };

    // Store in Redis with expiry
    await this.redis.setex(
      `${this.sessionPrefix}:${sessionId}`,
      this.sessionExpiry,
      JSON.stringify(session)
    );

    logger.info({ userId, sessionId }, 'Created new session');

    return session;
  }

  /**
   * Get active session for a user
   */
  async getActiveSession(userId: string): Promise<SessionMemory | null> {
    // Get user's current session ID
    const currentSessionId = await this.redis.get(`${this.sessionPrefix}:current:${userId}`);

    if (!currentSessionId) {
      return null;
    }

    // Get session data
    const sessionData = await this.redis.get(`${this.sessionPrefix}:${currentSessionId}`);

    if (!sessionData) {
      // Clean up stale reference
      await this.redis.del(`${this.sessionPrefix}:current:${userId}`);
      return null;
    }

    try {
      const session: SessionMemory = JSON.parse(sessionData);

      // Update access stats
      session.metadata.accessCount += 1;
      session.metadata.lastAccessedAt = Date.now();
      session.metadata.updatedAt = Date.now();

      // Update in Redis
      await this.redis.setex(
        `${this.sessionPrefix}:${session.id}`,
        this.sessionExpiry,
        JSON.stringify(session)
      );

      return session;
    } catch (error) {
      logger.error({ error, userId, currentSessionId }, 'Failed to parse session data');
      return null;
    }
  }

  /**
   * Add a turn to the session
   */
  async addTurnToSession(sessionId: string, turn: SessionTurn): Promise<SessionMemory> {
    const sessionKey = `${this.sessionPrefix}:${sessionId}`;
    const sessionData = await this.redis.get(sessionKey);

    if (!sessionData) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    try {
      const session: SessionMemory = JSON.parse(sessionData);

      // Add turn to session
      session.turns.push(turn);
      session.metadata.lastActivityAt = Date.now();
      session.metadata.updatedAt = Date.now();

      // Update session metadata
      if (turn.role === 'user') {
        session.metadata.tags.push('user_interaction');
      } else {
        session.metadata.tags.push('ai_response');
      }

      // Update in Redis
      await this.redis.setex(
        sessionKey,
        this.sessionExpiry,
        JSON.stringify(session)
      );

      logger.debug({ sessionId, turnId: turn.id, role: turn.role }, 'Added turn to session');

      return session;
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to add turn to session');
      throw error;
    }
  }

  /**
   * Update the active task in session
   */
  async updateTask(sessionId: string, task: TaskState): Promise<SessionMemory> {
    const sessionKey = `${this.sessionPrefix}:${sessionId}`;
    const sessionData = await this.redis.get(sessionKey);

    if (!sessionData) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    try {
      const session: SessionMemory = JSON.parse(sessionData);

      // Update task in session
      session.activeTask = task;
      session.metadata.updatedAt = Date.now();

      // Update in Redis
      await this.redis.setex(
        sessionKey,
        this.sessionExpiry,
        JSON.stringify(session)
      );

      logger.debug({ sessionId, taskId: task.id }, 'Updated task in session');

      return session;
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to update task in session');
      throw error;
    }
  }

  /**
   * Close session and optionally add summary
   */
  async closeSession(sessionId: string, summary?: string): Promise<SessionMemory> {
    const sessionKey = `${this.sessionPrefix}:${sessionId}`;
    const sessionData = await this.redis.get(sessionKey);

    if (!sessionData) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    try {
      const session: SessionMemory = JSON.parse(sessionData);

      // Mark as inactive
      session.metadata.tags = session.metadata.tags.filter(tag => tag !== 'active');
      session.metadata.tags.push('closed');
      session.metadata.updatedAt = Date.now();

      // Add summary if provided
      if (summary) {
        session.metadata.tags.push('summarized');
      }

      // Update in Redis
      await this.redis.setex(
        sessionKey,
        this.sessionExpiry, // Keep for a while for potential consolidation
        JSON.stringify(session)
      );

      logger.info({ sessionId }, 'Closed session');

      return session;
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to close session');
      throw error;
    }
  }

  /**
   * Delete session completely
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionKey = `${this.sessionPrefix}:${sessionId}`;
    await this.redis.del(sessionKey);

    // Also remove from user's current session reference
    const session: SessionMemory | null = await this.getSessionById(sessionId);
    if (session) {
      await this.redis.del(`${this.sessionPrefix}:current:${session.userId}`);
    }

    logger.info({ sessionId }, 'Deleted session');
  }

  /**
   * Get all sessions for a user
   */
  async getSessionsByUser(userId: string, limit: number = 10): Promise<SessionMemory[]> {
    // This is a simplified implementation
    // In a real system, you'd maintain a list of user's sessions
    const sessions: SessionMemory[] = [];

    // For now, just return the active session if it exists
    const activeSession = await this.getActiveSession(userId);
    if (activeSession) {
      sessions.push(activeSession);
    }

    return sessions;
  }

  /**
   * Get recent turns for a user
   */
  async getRecentTurns(userId: string, count: number = 10): Promise<SessionTurn[]> {
    const session = await this.getActiveSession(userId);
    if (!session) {
      return [];
    }

    // Return last N turns
    return session.turns.slice(-count);
  }

  /**
   * Helper to get session by ID
   */
  private async getSessionById(sessionId: string): Promise<SessionMemory | null> {
    const sessionData = await this.redis.get(`${this.sessionPrefix}:${sessionId}`);
    if (!sessionData) return null;

    try {
      return JSON.parse(sessionData);
    } catch {
      return null;
    }
  }
}

// Singleton instance
let sessionStorageInstance: SessionMemoryLayer | null = null;

export function getSessionStorage(): SessionMemoryLayer {
  if (!sessionStorageInstance) {
    sessionStorageInstance = new SessionMemoryLayer();
  }
  return sessionStorageInstance;
}

// Export for direct use if needed
export const sessionMemory = getSessionStorage();
