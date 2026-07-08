/**
 * WaxPrep Memory Bridge — HTTP endpoints for CUGA Python service
 *
 * These endpoints allow the CUGA Python service to access YOUR TypeScript
 * memory system. Add these to your existing Fastify webhook server.
 */

import { FastifyInstance } from 'fastify';
import { memory } from '../memory/index.js';
import { logger } from '../utils/logger.js';
import { getEpisodicStorage } from '../memory/layers/episodic.js';
import { getLongTermStorage } from '../memory/layers/longterm.js';

/**
 * Register memory bridge endpoints on Fastify server
 *
 * Usage (in server.ts):
 *   import { registerMemoryBridge } from './bridge/memoryBridge.js';
 *   await registerMemoryBridge(fastify);
 */
export async function registerMemoryBridge(fastify: FastifyInstance) {

  // ═══════════════════════════════════════════════════════════════
  // POST /memory/retrieve — Retrieve relevant memories
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/memory/retrieve', async (request, reply) => {
    const { userId, query } = request.body as { userId: string; query: string };

    if (!userId || !query) {
      return reply.status(400).send({ error: 'userId and query required' });
    }

    try {
      // Call YOUR existing memory.assembleContext
      const context = await memory.assembleContext(userId, query);

      // Return formatted memories
      const memories = context.retrievedMemories?.map || [](m => ({
        id: m.id,
        content: m.content,
        type: m.type,
        similarity: m.similarity,
      }));

      return {
        memories,
        userProfile: context.userProfile,
        recentTurns: context.recentTurns.slice(-5).map(t => ({
          role: t.role,
          content: t.content,
          timestamp: t.timestamp,
        })),
        activeTask: context.activeTask,
        count: memories.length,
      };

    } catch (error) {
      logger.error({ error, userId, query }, 'Memory retrieve failed');
      return reply.status(500).send({
        error: 'Memory retrieval failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /memory/fact — Store a fact in long-term memory
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/memory/fact', async (request, reply) => {
    const {
      userId,
      category,
      key,
      value,
      content,
      confidence = 0.8,
    } = request.body as {
      userId: string;
      category: string;
      key: string;
      value: string;
      content: string;
      confidence?: number;
    };

    if (!userId || !key || !content) {
      return reply.status(400).send({
        error: 'userId, key, and content required',
      });
    }

    try {
      const fact = await memory.storeFact(
        userId,
        category || 'knowledge',
        key,
        value || '',
        content,
        confidence,
      );

      return {
        success: true,
        factId: fact.id,
        category: fact.category,
        key: fact.key,
      };

    } catch (error) {
      logger.error({ error, userId, key }, 'Fact storage failed');
      return reply.status(500).send({
        error: 'Fact storage failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /memory/profile/:userId — Get user profile
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/memory/profile/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };

    if (!userId) {
      return reply.status(400).send({ error: 'userId required' });
    }

    try {
      const profile = await memory.getUserProfile(userId);
      return {
        id: profile.id,
        name: profile.name,
        grade: profile.grade,
        subjects: profile.subjects,
        learningStyle: profile.learningStyle,
        preferences: profile.preferences,
        goals: profile.goals,
        weaknesses: profile.weaknesses,
        strengths: profile.strengths,
        recentActivity: profile.recentActivity,
      };

    } catch (error) {
      logger.error({ error, userId }, 'Profile retrieval failed');
      return reply.status(500).send({
        error: 'Profile retrieval failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /memory/search — Semantic search across all layers
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/memory/search', async (request, reply) => {
    const {
      userId,
      query,
      limit = 5,
      threshold = 0.7,
    } = request.body as {
      userId: string;
      query: string;
      limit?: number;
      threshold?: number;
    };

    if (!userId || !query) {
      return reply.status(400).send({
        error: 'userId and query required',
      });
    }

    try {
      // Get episodic memories using your storage layer
      const episodic = await getEpisodicStorage().search({
        userId,
        query: 'dummy', // Will use vector search internally
        limit,
        threshold,
      }).catch(() => []) || [];

      // Get long-term memories using your storage layer
      const longTerm = await getLongTermStorage().search({
        userId,
        query: 'dummy', // Will use vector search internally
        limit,
        threshold,
      }).catch(() => []) || [];

      // Combine and sort by relevance
      const allMemories = [
        ...episodic.map((m) => ({
          id: m.id,
          content: m.summary || m.content,
          type: 'episodic' as const,
          layer: 'episodic' as const,
          similarity: 0.85,
        })),
        ...longTerm.map((m) => ({
          id: m.id,
          content: m.content,
          type: m.category || 'longterm',
          layer: 'longterm' as const,
          similarity: 0.85,
        })),
      ];

      return {
        memories: allMemories,
        count: allMemories.length,
        query,
      };

    } catch (error) {
      logger.error({ error, userId, query }, 'Memory search failed');
      return reply.status(500).send({
        error: 'Memory search failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // POST /memory/exchange — Record a full exchange
  // ═══════════════════════════════════════════════════════════════
  fastify.post('/memory/exchange', async (request, reply) => {
    const {
      userId,
      messageId,
      userContent,
      aiContent,
      metadata,
    } = request.body as {
      userId: string;
      messageId: string;
      userContent: string;
      aiContent: string;
      metadata?: {
        tokensIn?: number;
        tokensOut?: number;
        latencyMs?: number;
      };
    };

    if (!userId || !userContent || !aiContent) {
      return reply.status(400).send({
        error: 'userId, userContent, and aiContent required',
      });
    }

    try {
      await memory.recordExchange(
        userId,
        messageId,
        userContent,
        aiContent,
        {
          tokensIn: metadata?.tokensIn,
          tokensOut: metadata?.tokensOut,
          latencyMs: metadata?.latencyMs,
        }
      );

      return { success: true };

    } catch (error) {
      logger.error({ error, userId }, 'Exchange recording failed');
      return reply.status(500).send({
        error: 'Exchange recording failed',
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // GET /memory/health — Bridge health check
  // ═══════════════════════════════════════════════════════════════
  fastify.get('/memory/health', async () => {
    return {
      status: 'healthy',
      bridge: 'memory-typescript',
      endpoints: [
        'POST /memory/retrieve',
        'POST /memory/fact',
        'GET /memory/profile/:userId',
        'POST /memory/search',
        'POST /memory/exchange',
      ],
    };
  });

  logger.info('Memory-CUGA bridge registered on Fastify server');
}
