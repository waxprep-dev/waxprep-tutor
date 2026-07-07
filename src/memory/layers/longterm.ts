/**
 * Long-Term Memory Layer
 * PostgreSQL-backed storage for persistent facts and knowledge
 * Uses Supabase with pgvector for semantic search and contradiction detection
 */

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import {
  LongTermMemory,
  SearchParams,
  MemoryQueryParams,
  VerificationStatus,
  LongTermMemoryCategory,
  LongTermMemoryFactType
} from '../types/memory.js';
import { LongTermStorage } from '../interfaces/storage.js';
import { config } from '../../config/index.js';
import { embedder } from '../core/embedder.js';
import { logger } from '../../utils/logger.js';

export class LongTermMemoryLayer implements LongTermStorage {
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
    this.tableName = 'long_term_memories';
  }

  /**
   * Create a new long-term memory
   */
  async create(
    memory: Omit<LongTermMemory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<LongTermMemory> {
    const id = `ltm_${memory.userId}_${memory.key}_${Date.now()}`;

    // Generate embedding for the content
    const embedding = await embedder.embed(memory.content);

    const newMemory: LongTermMemory = {
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
        source: memory.metadata.source ?? 'user_input',
        tags: memory.metadata.tags ?? [memory.category, memory.factType]
      },
      vector: embedding,
      contradictions: memory.contradictions ?? [],
      verificationStatus: memory.verificationStatus ?? 'unverified'
    };

    const { error } = await this.supabase
      .from(this.tableName)
      .insert({
        id: newMemory.id,
        user_id: newMemory.userId,
        tenant_id: newMemory.tenantId,
        category: newMemory.category,
        fact_type: newMemory.factType,
        key: newMemory.key,
        value: newMemory.value,
        content: newMemory.content,
        context: newMemory.context,
        contradictions: newMemory.contradictions,
        verification_status: newMemory.verificationStatus,
        metadata: newMemory.metadata,
        embedding: embedding.embedding,
        created_at: new Date(newMemory.createdAt).toISOString(),
        updated_at: new Date(newMemory.updatedAt).toISOString(),
        last_accessed_at: new Date(newMemory.metadata.lastAccessedAt).toISOString(),
      });

    if (error) {
      logger.error({ error, memoryId: id }, 'Failed to create long-term memory');
      throw new Error(`Failed to create long-term memory: ${error.message}`);
    }

    logger.info({ memoryId: id, userId: newMemory.userId, category: newMemory.category }, 'Created long-term memory');

    return newMemory;
  }

  /**
   * Get long-term memory by ID
   */
  async getById(id: string): Promise<LongTermMemory | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Row not found
        return null;
      }
      logger.error({ error, id }, 'Failed to get long-term memory by ID');
      throw new Error(`Failed to get long-term memory: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return this.mapRowToMemory(data);
  }

  /**
   * Get all long-term memories for a user with optional filtering
   */
  async getByUserId(userId: string, params?: MemoryQueryParams): Promise<LongTermMemory[]> {
    let query = this.supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId);

    // Apply filters if provided
    if (params?.categories && params.categories.length > 0) {
      query = query.in('category', params.categories);
    }

    if (params?.dateRange) {
      const [start, end] = params.dateRange;
      query = query.gte('created_at', new Date(start).toISOString())
                .lte('created_at', new Date(end).toISOString());
    }

    if (params?.confidenceThreshold) {
      query = query.gte('metadata->>confidence', params.confidenceThreshold.toString());
    }

    query = query.order('created_at', { ascending: false });

    if (params?.limit) {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ error, userId, params }, 'Failed to get long-term memories by user');
      throw new Error(`Failed to get long-term memories: ${error.message}`);
    }

    return data.map(row => this.mapRowToMemory(row));
  }

  /**
   * Get a specific memory by user ID and key
   */
  async getByKey(userId: string, key: string): Promise<LongTermMemory | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .eq('key', key)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Row not found
        return null;
      }
      logger.error({ error, userId, key }, 'Failed to get long-term memory by key');
      throw new Error(`Failed to get long-term memory: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return this.mapRowToMemory(data);
  }

  /**
   * Update a long-term memory
   */
  async update(id: string, updates: Partial<LongTermMemory>): Promise<LongTermMemory> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Long-term memory not found: ${id}`);
    }

    // Merge updates with existing data
    const updatedMemory: LongTermMemory = {
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
        value: updatedMemory.value,
        category: updatedMemory.category,
        fact_type: updatedMemory.factType,
        context: updatedMemory.context,
        contradictions: updatedMemory.contradictions,
        verification_status: updatedMemory.verificationStatus,
        metadata: updatedMemory.metadata,
        embedding: updatedMemory.vector.embedding,
        updated_at: new Date(updatedMemory.updatedAt).toISOString(),
      })
      .eq('id', id);

    if (error) {
      logger.error({ error, id }, 'Failed to update long-term memory');
      throw new Error(`Failed to update long-term memory: ${error.message}`);
    }

    logger.info({ id, category: updatedMemory.category }, 'Updated long-term memory');

    return updatedMemory;
  }

  /**
   * Delete a long-term memory
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      logger.error({ error, id }, 'Failed to delete long-term memory');
      throw new Error(`Failed to delete long-term memory: ${error.message}`);
    }

    logger.info({ id }, 'Deleted long-term memory');
  }

  /**
   * Mark a memory as deprecated (soft delete)
   */
  async markDeprecated(id: string): Promise<LongTermMemory> {
    const updatedMemory = await this.update(id, {
      verificationStatus: 'deprecated',
      metadata: {
        ...this.getById(id)?.metadata,
        updatedAt: Date.now()
      }
    });

    logger.info({ id }, 'Marked long-term memory as deprecated');

    return updatedMemory;
  }

  /**
   * Search long-term memories using vector similarity
   */
  async search(query: SearchParams): Promise<LongTermMemory[]> {
    // Generate embedding for the search query
    const queryEmbedding = await embedder.embed(query.query);

    // Call the Supabase function we defined in the schema
    const { data, error } = await this.supabase.rpc('match_long_term_memories', {
      query_embedding: queryEmbedding.embedding,
      match_threshold: query.threshold,
      match_count: query.limit,
      filter_user_id: query.userId,
      filter_categories: query.categories || null
    });

    if (error) {
      logger.error({ error, query }, 'Failed to search long-term memories');
      throw new Error(`Failed to search long-term memories: ${error.message}`);
    }

    // Convert the RPC results back to LongTermMemory objects
    const memories: LongTermMemory[] = [];
    for (const row of data) {
      const memory = await this.getById(row.id);
      if (memory) {
        memories.push(memory);
      }
    }

    logger.info({
      userId: query.userId,
      results: memories.length,
      queryLength: query.query.length,
      categories: query.categories
    }, 'Searched long-term memories');

    return memories;
  }

  /**
   * Find related memories for a user in a specific category
   */
  async findRelated(userId: string, category: string, limit: number = 5): Promise<LongTermMemory[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .eq('category', category)
      .neq('verification_status', 'deprecated') // Exclude deprecated
      .order('metadata->>confidence', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ error, userId, category }, 'Failed to find related memories');
      throw new Error(`Failed to find related memories: ${error.message}`);
    }

    return data.map(row => this.mapRowToMemory(row));
  }

  /**
   * Find contradictions for a specific key
   */
  async findContradictions(userId: string, key: string): Promise<LongTermMemory[]> {
    // First, get the base memory
    const baseMemory = await this.getByKey(userId, key);
    if (!baseMemory) {
      return [];
    }

    // Then find memories that contradict it
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .contains('contradictions', [baseMemory.id]) // Find memories that list this as contradiction
      .neq('verification_status', 'deprecated');

    if (error) {
      logger.error({ error, userId, key }, 'Failed to find contradictions');
      throw new Error(`Failed to find contradictions: ${error.message}`);
    }

    // Also find memories with the same key but different content/value
    const { data: sameKeyData, error: sameKeyError } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .eq('key', key)
      .neq('id', baseMemory.id) // Exclude the base memory itself
      .neq('verification_status', 'deprecated');

    if (sameKeyError) {
      logger.error({ sameKeyError, userId, key }, 'Failed to find same-key contradictions');
      throw new Error(`Failed to find same-key contradictions: ${sameKeyError.message}`);
    }

    // Combine both sets of potential contradictions
    const allPotentialContradictions = [...data, ...sameKeyData];

    // Filter out the ones that are actually contradictory
    const actualContradictions: LongTermMemory[] = [];
    for (const potentialContradiction of allPotentialContradictions) {
      if (this.isContradictory(baseMemory, this.mapRowToMemory(potentialContradiction))) {
        actualContradictions.push(this.mapRowToMemory(potentialContradiction));
      }
    }

    logger.info({
      userId,
      key,
      contradictionCount: actualContradictions.length
    }, 'Found contradictions');

    return actualContradictions;
  }

  /**
   * Resolve contradictions by selecting the winner
   */
  async resolveContradiction(memoryIds: string[], winnerId: string): Promise<void> {
    // Verify all memories exist and belong to the same user
    const memories = await Promise.all(
      memoryIds.map(id => this.getById(id))
    );

    if (!memories.every(m => m)) {
      throw new Error('One or more memories not found');
    }

    // Get the user ID from the first memory (they should all be the same)
    const userId = memories[0]?.userId;
    if (!userId) {
      throw new Error('Could not determine user ID');
    }

    // Update all other memories to mark them as contradicted by the winner
    for (const memory of memories) {
      if (memory && memory.id !== winnerId) {
        // Add the winner as a contradiction in this memory
        const updatedContradictions = [...memory.contradictions, winnerId];

        await this.update(memory.id, {
          contradictions: updatedContradictions,
          verificationStatus: 'disputed',
          metadata: {
            ...memory.metadata,
            updatedAt: Date.now()
          }
        });
      }
    }

    // Update the winner to mark the others as contradicted
    const winner = await this.getById(winnerId);
    if (winner) {
      const loserIds = memoryIds.filter(id => id !== winnerId);
      const updatedContradictions = [...winner.contradictions, ...loserIds];

      await this.update(winnerId, {
        contradictions: updatedContradictions,
        verificationStatus: 'verified', // Winner is now verified
        metadata: {
          ...winner.metadata,
          updatedAt: Date.now()
        }
      });
    }

    logger.info({
      userId,
      resolvedIds: memoryIds,
      winnerId
    }, 'Resolved contradictions');
  }

  /**
   * Bulk upsert multiple memories
   */
  async bulkUpsert(memories: Omit<LongTermMemory, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<LongTermMemory[]> {
    const results: LongTermMemory[] = [];

    for (const memory of memories) {
      try {
        // Check if a memory with the same user and key already exists
        const existing = await this.getByKey(memory.userId, memory.key);

        if (existing) {
          // Update existing memory
          const updated = await this.update(existing.id, {
            ...memory,
            metadata: {
              ...memory.metadata,
              updatedAt: Date.now()
            }
          });
          results.push(updated);
        } else {
          // Create new memory
          const created = await this.create(memory);
          results.push(created);
        }
      } catch (error) {
        logger.error({ error, userId: memory.userId, key: memory.key }, 'Failed to upsert memory');
        // Continue with other memories instead of failing completely
      }
    }

    logger.info({ upsertedCount: results.length }, 'Bulk upserted long-term memories');

    return results;
  }

  /**
   * Bulk update multiple memories
   */
  async bulkUpdate(updates: { id: string; updates: Partial<LongTermMemory> }[]): Promise<LongTermMemory[]> {
    const results: LongTermMemory[] = [];

    for (const update of updates) {
      try {
        const updated = await this.update(update.id, update.updates);
        results.push(updated);
      } catch (error) {
        logger.error({ error, id: update.id }, 'Failed to update memory in bulk');
        // Continue with other updates instead of failing completely
      }
    }

    logger.info({ updatedCount: results.length }, 'Bulk updated long-term memories');

    return results;
  }

  /**
   * Check if two memories are contradictory
   */
  private isContradictory(memoryA: LongTermMemory, memoryB: LongTermMemory): boolean {
    // Basic contradiction check - can be made more sophisticated
    if (memoryA.key !== memoryB.key) {
      return false; // Different keys can't be contradictory
    }

    // If they have the same key but significantly different content/values
    if (memoryA.value !== memoryB.value) {
      // More sophisticated checks could involve semantic analysis
      return true;
    }

    return false;
  }

  /**
   * Map database row to LongTermMemory object
   */
  private mapRowToMemory(row: Record<string, unknown>): LongTermMemory {
    return {
      id: row.id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      layer: 'longterm',
      category: row.category as LongTermMemoryCategory,
      factType: row.fact_type as LongTermMemoryFactType,
      key: row.key,
      value: row.value,
      content: row.content,
      context: row.context,
      contradictions: row.contradictions || [],
      verificationStatus: row.verification_status as VerificationStatus,
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
        tags: [row.category, row.fact_type]
      }
    };
  }
}

// Singleton instance
let longTermStorageInstance: LongTermMemoryLayer | null = null;

export function getLongTermStorage(): LongTermMemoryLayer {
  if (!longTermStorageInstance) {
    longTermStorageInstance = new LongTermMemoryLayer();
  }
  return longTermStorageInstance;
}

// Export for direct use if needed
export const longTermMemory = getLongTermStorage();
