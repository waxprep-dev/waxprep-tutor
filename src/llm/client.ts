import { LLMRequest, LLMResponse } from "./types";
import { callKimi } from "./kimi";
import { logger } from "../utils/logger";

/**
 * The LLM client is the abstraction layer.
 * To add Claude or GPT, you write a sibling to kimi.ts (callClaude, callGpt)
 * and add cases here. The brain doesn't care which provider is used.
 */

export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  // Default routing: Kimi for everything
  // Future: route based on request.model or message complexity
  const provider = request.model || "kimi";

  try {
    switch (provider) {
      case "kimi":
        return await callKimi(request);
      // case "claude":
      //   return await callClaude(request);
      // case "gpt":
      //   return await callGpt(request);
      default:
        return await callKimi(request);
    }
  } catch (err: any) {
    logger.error("LLM call failed", {
      provider,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}
