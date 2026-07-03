import { LLMRequest, LLMResponse } from "./types";
import { callGroq } from "./groq";
import { callKimi } from "./kimi";
import { callCerebras } from "./cerebras";
import { config } from "../config";
import { logger } from "../utils/logger";

// Agent-specific model configuration
export const AGENT_MODELS: Record<string, string> = {
  "fire": "cerebras",
  "river": "cerebras",
  "witness": "cerebras",
  "oracle": "groq",
  "seer": "groq",
  "mirror": "groq",
  "guardian": "groq",
  "archivist": "groq",
  "default": "cerebras"
};

// Check if error is retryable
function isRetryableError(err: any): boolean {
  if (err.response?.status === 429) return true;
  if (err.response?.status >= 500 && err.response?.status < 600) return true;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true;
  if (err.message?.includes('overloaded')) return true;
  if (err.message?.includes('rate limit')) return true;
  return false;
}

export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const startTime = Date.now();

  let provider = request.model || "cerebras";

  if (!request.model && request.agent) {
    provider = AGENT_MODELS[request.agent] || AGENT_MODELS.default;
  }

  if (request.agent === "fire" && request.tools && request.tools.length > 0) {
    provider = "cerebras";
  }

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`LLM call attempt ${attempt}/${maxRetries}`, {
        provider,
        agent: request.agent,
        tools: request.tools?.length || 0,
        hasToolChoice: !!request.tool_choice
      });

      let response: LLMResponse;

      switch (provider) {
        case "cerebras":
          response = await callCerebras(request);
          break;
        case "groq":
          response = await callGroq(request);
          break;
        case "kimi":
          response = await callKimi(request);
          break;
        default:
          response = await callCerebras(request);
      }

      const latencyMs = Date.now() - startTime;
      logger.info("LLM call successful", {
        provider,
        agent: request.agent,
        latencyMs,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        attempt
      });

      return response;

    } catch (err: any) {
      lastError = err;
      const isRetryable = isRetryableError(err);
      const isLastAttempt = attempt === maxRetries;

      if (isRetryable && !isLastAttempt) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);

        logger.warn(`LLM call failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, {
          provider,
          agent: request.agent,
          error: err.message,
          status: err.response?.status
        });

        await new Promise(resolve => setTimeout(resolve, delay));

        if (attempt === 2 && provider === "cerebras") {
          provider = "groq";
          logger.info("Switching to fallback provider (Groq)");
        }

        continue;
      }

      logger.error("LLM call failed after all retries", {
        provider,
        agent: request.agent,
        attempts: attempt,
        error: err.message,
        status: err.response?.status
      });

      throw err;
    }
  }

  throw lastError || new Error("LLM call failed after retries");
}

// Convenience functions for different agents
export async function callFire(request: LLMRequest): Promise<LLMResponse> {
  return callLLM({
    ...request,
    agent: "fire",
    model: "cerebras",
    temperature: request.temperature || 0.7,
    max_tokens: request.max_tokens || 1100
  });
}

export async function callOracle(request: LLMRequest): Promise<LLMResponse> {
  return callLLM({
    ...request,
    agent: "oracle",
    model: "groq",
    temperature: request.temperature || 0.2,
    max_tokens: request.max_tokens || 1500
  });
}

export async function callSeer(request: LLMRequest): Promise<LLMResponse> {
  return callLLM({
    ...request,
    agent: "seer",
    model: "groq",
    temperature: request.temperature || 0.1,
    max_tokens: request.max_tokens || 800
  });
}

export async function callMirror(request: LLMRequest): Promise<LLMResponse> {
  return callLLM({
    ...request,
    agent: "mirror",
    model: "groq",
    temperature: request.temperature || 0.2,
    max_tokens: request.max_tokens || 800
  });
}

export async function callGuardian(request: LLMRequest): Promise<LLMResponse> {
  return callLLM({
    ...request,
    agent: "guardian",
    model: "groq",
    temperature: request.temperature || 0.1,
    max_tokens: request.max_tokens || 600
  });
}

export async function callRiver(request: LLMRequest): Promise<LLMResponse> {
  return callLLM({
    ...request,
    agent: "river",
    model: "cerebras",
    temperature: request.temperature || 0.2,
    max_tokens: request.max_tokens || 1000
  });
}

export default callLLM;
