/**
 * Embedding Service
 * Provides vector embeddings for semantic search and similarity matching
 * Supports multiple providers with caching and fallback mechanisms
 */

import { VectorEmbedding } from '../types/memory.js';
import { config } from '../../config/index.js';
import { getRedis } from '../../storage/idempotency.js';
import { logger } from '../../utils/logger.js';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getModelName(): string;
}

export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private provider: EmbeddingProvider;
  private readonly cacheTTL: number = 86400; // 24 hours
  private readonly cachePrefix: string = 'embedding_cache';

  private constructor(provider: EmbeddingProvider) {
    this.provider = provider;
  }

  static initialize(provider?: EmbeddingProvider): EmbeddingService {
    if (!EmbeddingService.instance) {
      const selectedProvider = provider || new PlaceholderEmbeddingProvider();
      EmbeddingService.instance = new EmbeddingService(selectedProvider);
    }
    return EmbeddingService.instance;
  }

  /**
   * Generate embedding for text with caching
   */
  async embed(text: string): Promise<VectorEmbedding> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot generate embedding for empty text');
    }

    // Create cache key using SHA-256 of the text
    const crypto = await import('crypto');
    const cacheKey = `${this.cachePrefix}:${crypto.createHash('sha256').update(text).digest('hex')}`;

    // Try to get from cache first
    const cached = await this.getCachedEmbedding(cacheKey);
    if (cached) {
      logger.info({ cacheHit: true, textHash: cacheKey }, 'Embedding cache hit');
      return cached;
    }

    // Generate new embedding
    logger.info({ cacheHit: false, textLength: text.length }, 'Generating new embedding');

    const embedding = await this.provider.embed(text);

    // Cache the result
    await this.setCachedEmbedding(cacheKey, embedding);

    return {
      embedding,
      model: this.provider.getModelName(),
      dimensions: this.provider.getDimensions(),
      normalized: true, // Assuming provider returns normalized vectors
    };
  }

  /**
   * Generate embeddings for multiple texts (with individual caching)
   */
  async embedBatch(texts: string[]): Promise<VectorEmbedding[]> {
    const results: VectorEmbedding[] = [];

    for (const text of texts) {
      results.push(await this.embed(text));
    }

    return results;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0; // Vectors are zero vectors
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Calculate Euclidean distance between two embeddings
   */
  euclideanDistance(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      const diff = vecA[i] - vecB[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private async getCachedEmbedding(cacheKey: string): Promise<VectorEmbedding | null> {
    try {
      const redis = getRedis();
      const cached = await redis.get(cacheKey);

      if (cached) {
        const parsed = JSON.parse(cached);
        return {
          embedding: parsed.embedding,
          model: parsed.model,
          dimensions: parsed.dimensions,
          normalized: parsed.normalized,
        };
      }
    } catch (error) {
      logger.warn({ error, cacheKey }, 'Failed to get cached embedding');
    }

    return null;
  }

  private async setCachedEmbedding(cacheKey: string, embedding: number[]): Promise<void> {
    try {
      const redis = getRedis();
      const cacheData = {
        embedding,
        model: this.provider.getModelName(),
        dimensions: this.provider.getDimensions(),
        normalized: true,
      };

      await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(cacheData));
    } catch (error) {
      logger.warn({ error, cacheKey }, 'Failed to cache embedding');
    }
  }

  /**
   * Clear the embedding cache
   */
  async clearCache(): Promise<void> {
    try {
      const redis = getRedis();
      // Use SCAN to find all embedding cache keys
      const pattern = `${this.cachePrefix}:*`;
      const stream = redis.scanStream({ match: pattern });

      const keys: string[] = [];
      for await (const chunk of stream) {
        keys.push(...chunk);
      }

      if (keys.length > 0) {
        await redis.del(keys);
        logger.info({ keysCleared: keys.length }, 'Cleared embedding cache');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to clear embedding cache');
    }
  }
}

/**
 * Placeholder Embedding Provider
 * Replace with actual provider (OpenAI, Cohere, etc.)
 */
class PlaceholderEmbeddingProvider implements EmbeddingProvider {
  private readonly dimensions: number = 1536; // Common dimension for OpenAI ada-002
  private readonly modelName: string = 'placeholder-v1';

  async embed(text: string): Promise<number[]> {
    // This is a placeholder that generates deterministic embeddings
    // based on the text content for consistency in testing
    const crypto = await import('crypto');
    const hash = crypto.createHash('md5').update(text).digest('hex');

    // Convert hash to array of numbers in [-1, 1] range
    const embedding: number[] = [];
    for (let i = 0; i < this.dimensions; i++) {
      // Use pairs of hex characters from hash to generate values
      const byteIndex = (i * 2) % hash.length;
      const bytePair = hash.substr(byteIndex, 2);
      const value = (parseInt(bytePair, 16) / 255) * 2 - 1; // Scale to [-1, 1]
      embedding.push(value);
    }

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModelName(): string {
    return this.modelName;
  }
}

/**
 * Factory function to create embedding service with specific provider
 */
export async function createEmbeddingService(provider?: EmbeddingProvider): Promise<EmbeddingService> {
  return EmbeddingService.initialize(provider);
}

// Export singleton instance
export const embedder = EmbeddingService.initialize();
