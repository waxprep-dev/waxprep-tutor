import { config } from "../config";
import { logger } from "../utils/logger";

let model: any = null;
let modelStatus: "unloaded" | "loading" | "ready" | "failed" = "unloaded";
let modelLoadError: string | null = null;
let modelLoadTimeMs: number = 0;
let lastUsedAt: number = 0;

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const PREWARM_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2000,
  warmupText: "The quick brown fox jumps over the lazy dog. This is a warmup sentence to initialize the embedding pipeline.",
  quantized: true,
};

let inferenceCount = 0;
const INFERENCE_LOG_INTERVAL = 100;

export async function embed(text: string): Promise<number[]> {
  if (!text || typeof text !== "string") {
    logger.warn("Empty or invalid text for embedding");
    return [];
  }

  const trimmed = text.trim().slice(0, 1000);

  if (modelStatus !== "ready") {
    logger.info("Model not pre-warmed, loading on-demand");
    await prewarm();
  }

  if (modelStatus === "failed" || !model) {
    logger.error("Embedding model unavailable, returning empty vector");
    return [];
  }

  try {
    const start = Date.now();
    const result = await model(trimmed, { pooling: "mean", normalize: true });
    const latency = Date.now() - start;

    inferenceCount++;
    lastUsedAt = Date.now();

    if (inferenceCount % INFERENCE_LOG_INTERVAL === 0) {
      logger.info("Embedding inference stats", {
        totalInferences: inferenceCount,
        lastLatencyMs: latency,
        modelStatus
      });
    }

    return Array.from(result.data);
  } catch (error: any) {
    logger.error("Embedding inference failed", { error: error.message, textLength: trimmed.length });

    try {
      logger.info("Attempting model recovery after inference failure");
      await reloadModel();
      if (model) {
        const result = await model(trimmed, { pooling: "mean", normalize: true });
        return Array.from(result.data);
      }
    } catch (recoveryError: any) {
      logger.error("Model recovery failed", { error: recoveryError.message });
    }

    return [];
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!model || modelStatus !== "ready") {
    await prewarm();
  }

  const results: number[][] = [];
  for (const text of texts) {
    const embedding = await embed(text);
    if (embedding.length > 0) {
      results.push(embedding);
    }
  }
  return results;
}

export async function prewarm(): Promise<boolean> {
  if (modelStatus === "ready") {
    logger.debug("Model already pre-warmed");
    return true;
  }

  if (modelStatus === "loading") {
    logger.debug("Model pre-warm already in progress, waiting...");
    await waitForModelReady(30000);
    return modelStatus === "ready";
  }

  modelStatus = "loading";
  modelLoadError = null;

  const startTime = Date.now();

  for (let attempt = 1; attempt <= PREWARM_CONFIG.maxRetries; attempt++) {
    try {
      logger.info(`Pre-warming embedding model (attempt ${attempt}/${PREWARM_CONFIG.maxRetries})`, {
        model: MODEL_NAME,
        quantized: PREWARM_CONFIG.quantized
      });

      const { pipeline } = await import("@huggingface/transformers");

      model = await pipeline("feature-extraction", MODEL_NAME, {
        quantized: PREWARM_CONFIG.quantized,
        revision: "main",
      });

      logger.info("Running warmup inference...");
      const warmupResult = await model(PREWARM_CONFIG.warmupText, {
        pooling: "mean",
        normalize: true
      });

      const warmupVector = Array.from(warmupResult.data);
      if (!warmupVector || warmupVector.length === 0) {
        throw new Error("Warmup inference returned empty vector");
      }

      modelStatus = "ready";
      modelLoadTimeMs = Date.now() - startTime;
      lastUsedAt = Date.now();

      logger.info("Embedding model pre-warmed successfully", {
        vectorDimensions: warmupVector.length,
        loadTimeMs: modelLoadTimeMs,
        attempt,
        model: MODEL_NAME
      });

      return true;

    } catch (error: any) {
      modelLoadError = error.message;
      const isLastAttempt = attempt === PREWARM_CONFIG.maxRetries;

      logger.error(`Model pre-warm attempt ${attempt} failed`, {
        error: error.message,
        willRetry: !isLastAttempt
      });

      if (!isLastAttempt) {
        const delay = PREWARM_CONFIG.baseDelayMs * Math.pow(2, attempt - 1);
        logger.info(`Retrying model pre-warm in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  modelStatus = "failed";
  modelLoadTimeMs = Date.now() - startTime;

  logger.error("Model pre-warm failed after all retries", {
    totalTimeMs: modelLoadTimeMs,
    lastError: modelLoadError
  });

  return false;
}

export async function reloadModel(): Promise<boolean> {
  logger.info("Forcing model reload");
  model = null;
  modelStatus = "unloaded";
  return prewarm();
}

export async function shutdownEmbeddings(): Promise<void> {
  logger.info("Shutting down embedding model");
  model = null;
  modelStatus = "unloaded";
  inferenceCount = 0;
}

export interface EmbeddingHealth {
  status: "healthy" | "degraded" | "unhealthy";
  modelStatus: typeof modelStatus;
  vectorDimensions: number;
  loadTimeMs: number;
  inferenceCount: number;
  lastUsedAt: number | null;
  lastError: string | null;
  uptimeMs: number;
}

export async function healthCheck(): Promise<EmbeddingHealth> {
  const canInfer = modelStatus === "ready" && model !== null;
  let vectorDimensions = 0;

  if (canInfer) {
    try {
      const testResult = await model("test", { pooling: "mean", normalize: true });
      vectorDimensions = Array.from(testResult.data).length;
    } catch (e) {
      logger.warn("Health check inference failed", { error: (e as Error).message });
    }
  }

  const status: EmbeddingHealth["status"] =
    modelStatus === "ready" && vectorDimensions > 0 ? "healthy"
    : modelStatus === "loading" ? "degraded"
    : "unhealthy";

  return {
    status,
    modelStatus,
    vectorDimensions,
    loadTimeMs: modelLoadTimeMs,
    inferenceCount,
    lastUsedAt: lastUsedAt || null,
    lastError: modelLoadError,
    uptimeMs: lastUsedAt ? Date.now() - lastUsedAt : 0
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForModelReady(timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (modelStatus === "loading" && Date.now() - start < timeoutMs) {
    await sleep(100);
  }
}
