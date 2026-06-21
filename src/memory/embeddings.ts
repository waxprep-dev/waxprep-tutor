import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * Embeddings turn text into vectors. We use OpenAI's text-embedding-3-small
 * (1536 dimensions, cheap, good quality). The vector represents the MEANING
 * of the text — similar meanings produce similar vectors. This is how
 * semantic search works.
 */

const EMBEDDING_DIM = 1536;

export async function embed(text: string): Promise<number[]> {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/embeddings",
      {
        input: text,
        model: config.openai.embeddingModel,
      },
      {
        headers: {
          Authorization: `Bearer ${config.openai.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
    return response.data.data[0].embedding;
  } catch (err: any) {
    logger.error("Embedding failed", { error: err.response?.data || err.message });
    throw err;
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // For batch embedding (used by background workers for episode consolidation)
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/embeddings",
      {
        input: texts,
        model: config.openai.embeddingModel,
      },
      {
        headers: {
          Authorization: `Bearer ${config.openai.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );
    return response.data.data.map((d: any) => d.embedding);
  } catch (err: any) {
    logger.error("Batch embedding failed", { error: err.response?.data || err.message });
    throw err;
  }
}

export const EMBEDDING_DIMENSIONS = EMBEDDING_DIM;
