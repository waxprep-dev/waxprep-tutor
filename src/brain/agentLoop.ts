import { callLLM } from "../llm/client";
import { ChatMessage, LLMResponse } from "../llm/types";
import { TOOLS } from "../tools/definitions";
import { executeTool } from "../tools/executor";
import { logger } from "../utils/logger";

const MAX_LOOPS = 5;
const RETRY_ATTEMPTS = 3;

export interface AgentLoopResult {
  finalResponse: string;
  allToolCalls: Array<{ name: string; args: any; result: any }>;
  modelUsed: string;
  totalTokens: number;
  loopCount: number;
}

function stripOmegaThinking(text: string): string {
  if (!text) return text;
  return text
    .replace(/<omega_thinking>[\s\S]*?<\/omega_thinking>/gi, "")
    .replace(/<\/?omega_thinking>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeResponse(text: string): string {
  if (!text) return text;
  let cleaned = text;
  cleaned = cleaned.replace(/<function=[^>]*>[\s\S]*?<\/function>/g, "");
  cleaned = cleaned.replace(/\[[a-z_]+\]\s*$/gi, "");
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");
  cleaned = cleaned.replace(/\*\*/g, "*");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callLLMWithRetry(request: any, attempt: number = 1): Promise<LLMResponse> {
  try {
    return await callLLM(request);
  } catch (error: any) {
    if (attempt < RETRY_ATTEMPTS) {
      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.warn("LLM call failed, retrying", { attempt, delay });
      await sleep(delay);
      return callLLMWithRetry(request, attempt + 1);
    }
    throw error;
  }
}

function generateFallbackResponse(): string {
  const fallbacks = [
    "Omo, network wahala — send that again when you can.",
    "My brain hiccuped. Say that one more time?",
    "Wait, that message got lost in the matrix. What did you say?",
    "You know what, let me think about that properly. Give me a minute.",
    "Ah, my phone is acting up. Send that again?",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

export async function runAgentLoop(
  initialMessages: ChatMessage[],
  context: { phone: string; episodeId: string }
): Promise<AgentLoopResult> {
  const messages: ChatMessage[] = [...initialMessages];
  const allToolCalls: Array<{ name: string; args: any; result: any }> = [];
  let totalTokens = 0;
  let loopCount = 0;
  let finalResponse = "";
  let modelUsed = "";

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    const response: LLMResponse = await callLLMWithRetry({
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 1100,
    });

    modelUsed = response.model_used;
    totalTokens += response.usage.total_tokens;

    logger.info("LLM response", {
      loop: loopCount,
      finish_reason: response.finish_reason,
      tool_calls: response.tool_calls.length,
      content_length: response.content?.length || 0,
      tokens: response.usage.total_tokens,
    });

    if (response.tool_calls.length === 0) {
      finalResponse = sanitizeResponse(stripOmegaThinking(response.content || ""));
      break;
    }

    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.tool_calls,
    });

    for (const toolCall of response.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      logger.info("Executing tool", { tool: toolCall.function.name, args });

      try {
        const { result } = await executeTool(toolCall, context);
        allToolCalls.push({ name: toolCall.function.name, args, result });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      } catch (toolError: any) {
        logger.error("Tool execution failed", { tool: toolCall.function.name, error: toolError.message });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: "Tool temporarily unavailable" }),
        });
      }
    }

    if (response.finish_reason === "stop") {
      const finalCall = await callLLMWithRetry({
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.4,
        max_tokens: 1100,
      });
      finalResponse = sanitizeResponse(stripOmegaThinking(finalCall.content || ""));
      totalTokens += finalCall.usage.total_tokens;
      modelUsed = finalCall.model_used;
      break;
    }
  }

  if (!finalResponse && loopCount >= MAX_LOOPS) {
    logger.warn("Agent loop hit max iterations", { phone: context.phone });
    finalResponse = generateFallbackResponse();
  }

  return {
    finalResponse,
    allToolCalls,
    modelUsed,
    totalTokens,
    loopCount,
  };
}
