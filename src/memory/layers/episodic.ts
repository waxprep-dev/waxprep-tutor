/**
 * Episodic Memory Layer
 * PostgreSQL-backed vector storage for session summaries
 * Uses Supabase with pgvector for semantic search
 */

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { 
  EpisodicMemory, 
  SearchParams, 
  MemoryQueryParams 
} from '../types/memory.js';
import { EpisodicStorage } from '../interfaces/storage.js';
import { config } from '../../config/index.js';
import { embedder } from '../core/embedder.js';
import { logger } from '../../utils/logger.js';

export class EpisodicMemoryLayer implements EpisodicStorage {
  private supabase;
  private readonly tableName: string;

  constructor() {
    this.supabase = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
        },
        db: {
          schema: 'public'
        }
      }
    );
    this.tableName = 'episodic_memories';
  }

  /**
   * Create a new episodic memory
   */
  async create(
    memory: Omit<EpisodicMemory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<EpisodicMemory> {
    const id = `epi_${memory.userId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    // Generate embedding for the content
    const embedding = await embedder.embed(memory.content);
    
    const newMemory: EpisodicMemory = {
      ...memory,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        ...memory.metadata,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now(),
        confidence: memory.metadata.confidence ?? 0.8,
        salience: memory.metadata.salience ?? 0.5,
        source: memory.metadata.source ?? 'session_consolidation',
        tags: memory.metadata.tags ?? ['episodic']
      },
      vector: embedding
    };

    const { error } = await this.supabase
      .from(this.tableName)
      .insert({
        id: newMemory.id,
        user_id: newMemory.userId,
        tenant_id: newMemory.tenantId,
        session_id: newMemory.sessionId,
        content: newMemory.content,
        summary: newMemory.summary,
        key_outcomes: newMemory.keyOutcomes,
        open_items: newMemory.openItems,
        user_goals: newMemory.userGoals,
        ai_actions: newMemory.aiActions,
        duration_ms: newMemory.durationMs,
        turn_count: newMemory.turnCount,
        satisfaction_score: newMemory.satisfactionScore,
        metadata: newMemory.metadata,
        embedding: embedding.embedding,
        created_at: new Date(newMemory.createdAt).toISOString(),
        updated_at: new Date(newMemory.updatedAt).toISOString(),
        last_accessed_at: new Date(newMemory.metadata.lastAccessedAt).toISOString(),
      });

    if (error) {
      logger.error({ error, memoryId: id }, 'Failed to create episodic memory');
      throw new Error(`Failed to create episodic memory: ${error.message}`);
    }

    logger.info({ memoryId: id, userId: newMemory.userId }, 'Created episodic memory');
    
    return newMemory;
  }

  /**
   * Get episodic memory by ID
   */
  async getById(id: string): Promise<EpisodicMemory | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Row not found
        return null;
      }
      logger.error({ error, id }, 'Failed to get episodic memory by ID');
      throw new Error(`Failed to get episodic memory: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return this.mapRowToMemory(data);
  }

  /**
   * Get all episodic memories for a user
   */
  async getByUserId(userId: string, limit?: number): Promise<EpisodicMemory[]> {
    let query = this.supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ error, userId }, 'Failed to get episodic memories by user');
      throw new Error(`Failed to get episodic memories: ${error.message}`);
    }

    return data.map(row => this.mapRowToMemory(row));
  }

  /**
   * Update an episodic memory
   */
  async update(id: string, updates: Partial<EpisodicMemory>): Promise<EpisodicMemory> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Episodic memory not found: ${id}`);
    }

    // Merge updates with existing data
    const updatedMemory: EpisodicMemory = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
      metadata: {
        ...existing.metadata,
        ...updates.metadata,
        updatedAt: Date.now()
      }
    };

    // If content changed, regenerate embedding
    if (updates.content && updates.content !== existing.content) {
      const newEmbedding = await embedder.embed(updates.content);
      updatedMemory.vector = newEmbedding;
    }

    const { error } = await this.supabase
      .from(this.tableName)
      .update({
        content: updatedMemory.content,
        summary: updatedMemory.summary,
        key_outcomes: updatedMemory.keyOutcomes,
        open_items: updatedMemory.openItems,
        user_goals: updatedMemory.userGoals,
        ai_actions: updatedMemory.aiActions,
        duration_ms: updatedMemory.durationMs,
        turn_count: updatedMemory.turnCount,
        satisfaction_score: updatedMemory.satisfactionScore,
        metadata: updatedMemory.metadata,
        embedding: updatedMemory.vector.embedding,
        updated_at: new Date(updatedMemory.updatedAt).toISOString(),
      })
      .eq('id', id);

    if (error) {
      logger.error({ error, id }, 'Failed to update episodic memory');
      throw new Error(`Failed to update episodic memory: ${error.message}`);
    }

    logger.info({ id }, 'Updated episodic memory');
    
    return updatedMemory;
  }

  /**
   * Delete an episodic memory
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      logger.error({ error, id }, 'Failed to delete episodic memory');
      throw new Error(`Failed to delete episodic memory: ${error.message}`);
    }

    logger.info({ id }, 'Deleted episodic memory');
  }

  /**
   * Search episodic memories using vector similarity
   */
  async search(query: SearchParams): Promise<EpisodicMemory[]> {
    // Generate embedding for the search query
    const queryEmbedding = await embedder.embed(query.query);

    // Call the Supabase function we defined in the schema
    const { data, error } = await this.supabase.rpc('match_episodic_memories', {
      query_embedding: queryEmbedding.embedding,
      match_threshold: query.threshold,
      match_count: query.limit,
      filter_user_id: query.userId
    });

    if (error) {
      logger.error({ error, query }, 'Failed to search episodic memories');
      throw new Error(`Failed to search episodic memories: ${error.message}`);
    }

    // Convert the RPC results back to EpisodicMemory objects
    const memories: EpisodicMemory[] = [];
    for (const row of data) {
      const memory = await this.getById(row.id);
      if (memory) {
        memories.push(memory);
      }
    }

    logger.info({ 
      userId: query.userId, 
      results: memories.length, 
      queryLength: query.query.length 
    }, 'Searched episodic memories');

    return memories;
  }

  /**
   * Find similar sessions to a given session
   */
  async findSimilar(sessionId: string, limit: number = 5): Promise<EpisodicMemory[]> {
    // First get the target session
    const targetSession = await this.supabase
      .from(this.tableName)
      .select('embedding')
      .eq('session_id', sessionId)
      .single();

    if (targetSession.error) {
      if (targetSession.error.code === 'PGRST116') {
        return []; // No session found
      }
      logger.error({ error: targetSession.error, sessionId }, 'Failed to get target session for similarity search');
      throw new Error(`Failed to get target session: ${targetSession.error.message}`);
    }

    if (!targetSession.data?.embedding) {
      return []; // No embedding to compare
    }

    // Use the RPC function to find similar embeddings
    const { data, error } = await this.supabase.rpc('match_episodic_memories', {
      query_embedding: targetSession.data.embedding,
      match_threshold: 0.5, // Lower threshold for broader similarity
      match_count: limit,
      filter_user_id: undefined // Find across all users if needed
    });

    if (error) {
      logger.error({ error, sessionId }, 'Failed to find similar sessions');
      throw new Error(`Failed to find similar sessions: ${error.message}`);
    }

    // Convert results back to EpisodicMemory objects
    const similarMemories: EpisodicMemory[] = [];
    for (const row of data) {
      const memory = await this.getById(row.id);
      if (memory) {
        similarMemories.push(memory);
      }
    }

    return similarMemories;
  }

  /**
   * Get statistics for a user
   */
  async getStats(userId: string): Promise<{
    totalCount: number;
    avgSatisfaction: number;
    mostCommonTopics: string[];
  }> {
    // Get all memories for user
    const memories = await this.getByUserId(userId);

    // Calculate stats
    const totalCount = memories.length;
    
    const satisfactionSum = memories
      .filter(m => m.satisfactionScore !== undefined)
      .reduce((sum, m) => sum + (m.satisfactionScore || 0), 0);
    
    const avgSatisfaction = totalCount > 0 
      ? satisfactionSum / memories.filter(m => m.satisfactionScore !== undefined).length
      : 0;

    // Extract and count topics from summaries
    const topicCounts: { [key: string]: number } = {};
    memories.forEach(memory => {
      const words = memory.summary.toLowerCase().split(/\s+/);
      words.forEach(word => {
        if (word.length > 3) { // Filter out short words
          topicCounts[word] = (topicCounts[word] || 0) + 1;
        }
      });
    });

    // Get top 5 most common topics
    const mostCommonTopics = Object.entries(topicCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([topic]) => topic);

    return {
      totalCount,
      avgSatisfaction,
      mostCommonTopics
    };
  }

  /**
   * Map database row to EpisodicMemory object
   */
  private mapRowToMemory(row: any): EpisodicMemory {
    return {
      id: row.id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      layer: 'episodic',
      sessionId: row.session_id,
      content: row.content,
      summary: row.summary,
      keyOutcomes: row.key_outcomes || [],
      openItems: row.open_items || [],
      userGoals: row.user_goals || [],
      aiActions: row.ai_actions || [],
      durationMs: row.duration_ms,
      turnCount: row.turn_count,
      satisfactionScore: row.satisfaction_score,
      vector: {
        embedding: row.embedding,
        model: 'supabase-pgvector', // This would come from a config in a real implementation
        dimensions: row.embedding ? row.embedding.length : 0,
        normalized: true
      },
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      metadata: row.metadata || {
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        accessCount: 0,
        lastAccessedAt: new Date(row.last_accessed_at || row.created_at).getTime(),
        confidence: 0.8,
        salience: 0.5,
        source: 'database',
        tags: ['episodic']
      }
    };
  }
}

// Singleton instance
let episodicStorageInstance: EpisodicMemoryLayer | null = null;

export function getEpisodicStorage(): EpisodicMemoryLayer {
  if (!episodicStorageInstance) {
    episodicStorageInstance = new EpisodicMemoryLayer();
  }
  return episodicStorageInstance;
}

// Export for direct use if needed
export const episodicMemory = getEpisodicStorage();
