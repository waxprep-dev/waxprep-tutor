// ============================================================
// EMBEDDINGS — Local model
// ============================================================

import { config } from "../config";
import { logger } from "../utils/logger";

let model: any = null;
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2"; // Using local model

export async function embed(text: string): Promise<number[]> {
  if (!text || typeof text !== "string") {
    logger.warn("Empty or invalid text for embedding");
    return [];
  }
  
  const trimmed = text.trim().slice(0, 1000);
  
  try {
    return await embedLocal(trimmed);
  } catch (error: any) {
    logger.error("Embedding failed", { error: error.message });
    return [];
  }
}

async function embedLocal(text: string): Promise<number[]> {
  try {
    const { pipeline } = await import("@huggingface/transformers");
    
    if (!model) {
      logger.info("Loading local embedding model", { model: MODEL_NAME });
      model = await pipeline("feature-extraction", MODEL_NAME);
    }
    
    const result = await model(text, { pooling: "mean", normalize: true });
    return Array.from(result.data);
  } catch (error: any) {
    logger.error("Local embedding failed", { error: error.message });
    throw error;
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    const embedding = await embed(text);
    if (embedding.length > 0) {
      results.push(embedding);
    }
  }
  return results;
}
