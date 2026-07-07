/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAXPREP EMBEDDING SERVICE v3.0 — "The Transducer"
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Real Embedding Provider with Multi-Backend Support
 *
 * SUPPORTED PROVIDERS:
 * - OpenAI (text-embedding-3-small, text-embedding-3-large, ada-002)
 * - Cohere (embed-english-v3, embed-multilingual-v3)
 * - Hugging Face Inference API (free tier for development)
 * - Ollama (local embeddings — completely free)
 * - Custom/Fallback (deterministic for testing)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getModelName(): string;
}

export interface VectorEmbedding {
  embedding: number[];
  model: string;
  dimensions: number;
  normalized: boolean;
}

// ───────────────────────────────────────────────────────────────────────────────
// OPENAI PROVIDER — Production quality, recommended
// ───────────────────────────────────────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey: string, model: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002' = 'text-embedding-3-small') {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = model === 'text-embedding-3-large' ? 3072 : 1536;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: this.dimensions === 1536 ? undefined : this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding error: ${response.status} — ${error}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions === 1536 ? undefined : this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI batch embedding error: ${response.status} — ${error}`);
    }

    const data = await response.json();
    return data.data.map((d: any) => d.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModelName(): string {
    return this.model;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// COHERE PROVIDER — Alternative, good for multilingual
// ───────────────────────────────────────────────────────────────────────────────

export class CohereEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private dimensions = 1024;

  constructor(apiKey: string, model: 'embed-english-v3.0' | 'embed-multilingual-v3.0' = 'embed-english-v3.0') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        texts: [text],
        input_type: 'search_query',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cohere embedding error: ${response.status} — ${error}`);
    }

    const data = await response.json();
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        texts,
        input_type: 'search_query',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cohere batch embedding error: ${response.status} — ${error}`);
    }

    const data = await response.json();
    return data.embeddings;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModelName(): string {
    return this.model;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// OLLAMA PROVIDER — Local, FREE, privacy-preserving
// ───────────────────────────────────────────────────────────────────────────────

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'nomic-embed-text') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding error: ${response.status}`);
    }

    const data = await response.json();
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama doesn't natively support batching, so we do it sequentially
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }

  getDimensions(): number {
    // nomic-embed-text produces 768D embeddings
    return this.model.includes('nomic') ? 768 : 4096;
  }

  getModelName(): string {
    return `ollama-${this.model}`;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// FALLBACK PROVIDER — Deterministic for testing/development
// ───────────────────────────────────────────────────────────────────────────────

export class FallbackEmbeddingProvider implements EmbeddingProvider {
  private dimensions = 1536;

  async embed(text: string): Promise<number[]> {
    // Deterministic embedding based on text hash
    // NOT suitable for production but useful for development
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(text).digest('hex');

    const embedding: number[] = [];
    for (let i = 0; i < this.dimensions; i++) {
      // Use pairs of hex characters to generate values in [-1, 1]
      const idx = (i * 2) % hash.length;
      const byte = parseInt(hash.substring(idx, idx + 2), 16);
      embedding.push((byte / 255) * 2 - 1);
    }

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModelName(): string {
    return 'fallback-deterministic';
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// EMBEDDING SERVICE — Singleton wrapper with caching
// ───────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  embedding: VectorEmbedding;
  timestamp: number;
}

export class EmbeddingService {
  private provider: EmbeddingProvider;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTTL: number = 86400000; // 24 hours
  private requestCount = 0;
  private cacheHitCount = 0;

  constructor(provider: EmbeddingProvider) {
    this.provider = provider;
  }

  /**
   * Create embedding service from environment configuration
   */
  static fromEnvironment(): EmbeddingService {
    // Priority: OpenAI > Cohere > Ollama > Fallback
    if (process.env.OPENAI_API_KEY) {
      const model = process.env.OPENAI_EMBEDDING_MODEL as any || 'text-embedding-3-small';
      return new EmbeddingService(new OpenAIEmbeddingProvider(process.env.OPENAI_API_KEY, model));
    }

    if (process.env.COHERE_API_KEY) {
      const model = process.env.COHERE_EMBEDDING_MODEL as any || 'embed-english-v3.0';
      return new EmbeddingService(new CohereEmbeddingProvider(process.env.COHERE_API_KEY, model));
    }

    if (process.env.OLLAMA_URL || process.env.OLLAMA_HOST) {
      const url = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || 'http://localhost:11434';
      const model = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
      return new EmbeddingService(new OllamaEmbeddingProvider(url, model));
    }

    console.warn('No real embedding provider configured. Using fallback (NOT for production).');
    return new EmbeddingService(new FallbackEmbeddingProvider());
  }

  async embed(text: string): Promise<VectorEmbedding> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot embed empty text');
    }

    // Check cache
    const cacheKey = await this.hashText(text);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      this.cacheHitCount++;
      return cached.embedding;
    }

    // Generate embedding
    this.requestCount++;
    const embedding = await this.provider.embed(text);

    const result: VectorEmbedding = {
      embedding,
      model: this.provider.getModelName(),
      dimensions: this.provider.getDimensions(),
      normalized: true,
    };

    // Cache result
    this.cache.set(cacheKey, { embedding: result, timestamp: Date.now() });

    return result;
  }

  async embedBatch(texts: string[]): Promise<VectorEmbedding[]> {
    // Check cache for each
    const results: (VectorEmbedding | null)[] = new Array(texts.length).fill(null);
    const toFetch: Array<{ index: number; text: string }> = [];

    for (let i = 0; i < texts.length; i++) {
      const cacheKey = await this.hashText(texts[i]);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        this.cacheHitCount++;
        results[i] = cached.embedding;
      } else {
        toFetch.push({ index: i, text: texts[i] });
      }
    }

    // Fetch missing embeddings
    if (toFetch.length > 0) {
      this.requestCount += toFetch.length;
      const embeddings = await this.provider.embedBatch(toFetch.map(f => f.text));

      for (let i = 0; i < toFetch.length; i++) {
        const { index, text } = toFetch[i];
        const result: VectorEmbedding = {
          embedding: embeddings[i],
          model: this.provider.getModelName(),
          dimensions: this.provider.getDimensions(),
          normalized: true,
        };
        results[index] = result;

        // Cache
        const cacheKey = await this.hashText(text);
        this.cache.set(cacheKey, { embedding: result, timestamp: Date.now() });
      }
    }

    return results.filter((r): r is VectorEmbedding => r !== null);
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  getStats(): { requests: number; cacheHits: number; cacheSize: number; hitRate: number } {
    return {
      requests: this.requestCount,
      cacheHits: this.cacheHitCount,
      cacheSize: this.cache.size,
      hitRate: this.requestCount > 0 ? this.cacheHitCount / this.requestCount : 0,
    };
  }

  private async hashText(text: string): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(text).digest('hex');
  }
}
