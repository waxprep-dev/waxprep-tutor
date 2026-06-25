import { LLMRequest, LLMResponse } from "./types";
import { callGroq } from "./groq";
import { callKimi } from "./kimi";
import { callCerebras } from "./cerebras";
import { config } from "../config";
import { logger } from "../utils/logger";

export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const provider = request.model || "cerebras";

  try {
    switch (provider) {
      case "cerebras":
        try {
          return await callCerebras(request);
        } catch (err: any) {
          if (err.response?.status === 429 && config.groq.apiKey) {
            logger.warn("Cerebras exhausted — falling back to Groq for this request");
            return await callGroq(request);
          }
          throw err;
        }
      case "groq":
        return await callGroq(request);
      case "kimi":
        return await callKimi(request);
      default:
        return await callCerebras(request);
    }
  } catch (err: any) {
    logger.error("LLM call failed", {
      provider,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}
