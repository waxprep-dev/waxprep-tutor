import { LLMRequest, LLMResponse } from "./types";
import { callGroq } from "./groq";
import { callKimi } from "./kimi";
import { logger } from "../utils/logger";

/**
 * The LLM client is the abstraction layer.
 * To add another provider, write a sibling to groq.ts (callClaude, callGpt)
 * and add a case here. The brain doesn't care which provider is used.
 */

export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  // Default routing: Groq for everything
  const provider = request.model || "groq";

  try {
    switch (provider) {
      case "groq":
        return await callGroq(request);
      case "kimi":
        return await callKimi(request);
      // case "claude":
      //   return await callClaude(request);
      // case "gpt":
      //   return await callGpt(request);
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
