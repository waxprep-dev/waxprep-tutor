import { LLMRequest, LLMResponse } from "./types";
import { callGroq } from "./groq";
import { callKimi } from "./kimi";
import { callCerebras } from "./cerebras";
import { config } from "../config";
import { logger } from "../utils/logger";

export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const provider = request.model || "groq";

  try {
    switch (provider) {
      case "groq":
        try {
          return await callGroq(request);
        } catch (err: any) {
          if (err.response?.status === 429 && config.cerebras.apiKey) {
            logger.warn("Groq exhausted — falling back to Cerebras for this request");
            return await callCerebras(request);
          }
          throw err;
        }
      case "kimi":
        return await callKimi(request);
      default:
        return await callGroq(request);
    }
  } catch (err: any) {
    logger.error("LLM call failed", {
      provider,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}
