import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

const LOCAL_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const LOCAL_EMBEDDING_DIM = 384;
export const OPENAI_EMBEDDING_DIM = 1536;

export const EMBEDDING_DIMENSIONS =
  config.embeddingProvider === "openai" ? OPENAI_EMBEDDING_DIM : LOCAL_EMBEDDING_DIM;

let localExtractorPromise: Promise<any> | null = null;

async function getLocalExtractor() {
  if (!localExtractorPromise) {
    localExtractorPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      logger.info("Loading local embedding model (first call only, then cached)", {
        model: LOCAL_MODEL_ID,
      });
      return pipeline("feature-extraction", LOCAL_MODEL_ID, { dtype: "q8" });
    })();
  }
  return localExtractorPromise;
}

async function embedLocal(text: string): Promise<number[]> {
  const extractor = await getLocalExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

async function embedLocalBatch(texts: string[]): Promise<number[][]> {
  const extractor = await getLocalExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}

async function embedOpenAI(text: string): Promise<number[]> {
  const response = await axios.post(
    "https://api.openai.com/v1/embeddings",
    { input: text, model: config.openai.embeddingModel },
    {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );
  return response.data.data[0].embedding;
}

async function embedOpenAIBatch(texts: string[]): Promise<number[][]> {
  const response = await axios.post(
    "https://api.openai.com/v1/embeddings",
    { input: texts, model: config.openai.embeddingModel },
    {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );
  return response.data.data.map((d: any) => d.embedding);
}

export async function embed(text: string): Promise<number[] | null> {
  try {
    if (config.embeddingProvider === "openai") return await embedOpenAI(text);
    return await embedLocal(text);
  } catch (err: any) {
    logger.error("Embedding failed — degrading gracefully, not crashing", {
      provider: config.embeddingProvider,
      error: err.response?.data || err.message,
    });
    return null;
  }
}

export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  try {
    if (config.embeddingProvider === "openai") return await embedOpenAIBatch(texts);
    return await embedLocalBatch(texts);
  } catch (err: any) {
    logger.error("Batch embedding failed — degrading gracefully, not crashing", {
      provider: config.embeddingProvider,
      error: err.response?.data || err.message,
    });
    return null;
  }
}
