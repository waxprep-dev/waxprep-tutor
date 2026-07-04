// ============================================================
// EMBEDDINGS — Uses config.embeddingProvider
// ============================================================

import { config } from "../config";
import { logger } from "../utils/logger";

let model: any = null;
let modelName = config.embeddingModel || "Xenova/all-MiniLM-L6-v2";

export async function embed(text: string): Promise<number[]> {
  if (!text || typeof text !== "string") {
    logger.warn("Empty or invalid text for embedding");
    return [];
  }
  
  const trimmed = text.trim().slice(0, 1000);
  
  try {
    const provider = config.embeddingProvider || "local";
    
    if (provider === "openai") {
      return await embedOpenAI(trimmed);
    } else {
      return await embedLocal(trimmed);
    }
  } catch (error: any) {
    logger.error("Embedding failed", { error: error.message, provider: config.embeddingProvider });
    return [];
  }
}

async function embedLocal(text: string): Promise<number[]> {
  try {
    const { pipeline } = await import("@huggingface/transformers");
    
    if (!model) {
      logger.info("Loading local embedding model", { model: modelName });
      model = await pipeline("feature-extraction", modelName);
    }
    
    const result = await model(text, { pooling: "mean", normalize: true });
    return Array.from(result.data);
  } catch (error: any) {
    logger.error("Local embedding failed", { error: error.message });
    throw error;
  }
}

async function embedOpenAI(text: string): Promise<number[]> {
  const apiKey = config.openai?.apiKey;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }
  
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openai.embeddingModel || "text-embedding-3-small",
      input: text,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding failed: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return data.data?.[0]?.embedding || [];
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
