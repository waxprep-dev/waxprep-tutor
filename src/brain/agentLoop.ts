import { callLLM } from "../llm/client";
import { ChatMessage, LLMResponse } from "../llm/types";
import { TOOLS } from "../tools/definitions";
import { executeTool } from "../tools/executor";
import { logger } from "../utils/logger";
import { safeJsonParse, safeJsonStringify, secureRandomInt } from "../utils/security";
import { config } from "../config";

const MAX_LOOPS = 5;
const RETRY_ATTEMPTS = 3;
const TOTAL_TIMEOUT_MS = 45000;
const MAX_LLM_CONTENT_LENGTH = 10000;

export interface AgentLoopResult {
  finalResponse: string;
  allToolCalls: Array<{ name: string; args: any; result: any }>;
  modelUsed: string;
  totalTokens: number;
  loopCount: number;
}

function stripOmegaThinking(text: string): string {
  if (!text) return text;
  
  let cleaned = text;
  const closeTag = "</omega_thinking>";
  const openTag = "<omega_thinking>";
  
  let idx = cleaned.indexOf(closeTag);
  while (idx !== -1) {
    const openIdx = cleaned.lastIndexOf(openTag, idx);
    if (openIdx !== -1) {
      cleaned = cleaned.slice(0, openIdx) + cleaned.slice(idx + closeTag.length);
    } else {
      cleaned = cleaned.slice(0, idx) + cleaned.slice(idx + closeTag.length);
    }
    idx = cleaned.indexOf(closeTag);
  }
  
  cleaned = cleaned.replace(/<\/?omega_thinking>/gi, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  
  return cleaned;
}

function sanitizeResponse(text: string): string {
  if (!text) return text;
  let cleaned = text;
  
  const functionStart = cleaned.indexOf("<function");
  if (functionStart !== -1) {
    const functionEnd = cleaned.indexOf("</function>");
    if (functionEnd !== -1) {
      cleaned = cleaned.slice(0, functionStart) + cleaned.slice(functionEnd + 11);
    }
  }
  
  cleaned = cleaned.replace(/\[[a-z_]+\]\s*$/gi, "");
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");
  cleaned = cleaned.replace(/\*\*/g, "*");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  
  if (cleaned.length > config.MAX_MESSAGE_LENGTH) {
    cleaned = cleaned.slice(0, config.MAX_MESSAGE_LENGTH);
  }
  
  return cleaned;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callLLMWithRetry(request: any, attempt: number = 1): Promise<LLMResponse> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("LLM call timeout")), config.WEBHOOK_TIMEOUT_MS || 15000);
    });
    
    return await Promise.race([callLLM(request), timeoutPromise]);
  } catch (error: any) {
    if (attempt < RETRY_ATTEMPTS) {
      const delay = Math.min(Math.pow(2, attempt - 1) * 1000, 8000);
      logger.warn("LLM call failed, retrying", { attempt, delay, error: error.message });
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
  return fallbacks[secureRandomInt(fallbacks.length)];
}

export async function runAgentLoop(
  initialMessages: ChatMessage[],
  context: { phone: string; episodeId: string }
): Promise<AgentLoopResult> {
  const startTime = Date.now();
  const messages: ChatMessage[] = [...initialMessages];
  const allToolCalls: Array<{ name: string; args: any; result: any }> = [];
  let totalTokens = 0;
  let loopCount = 0;
  let finalResponse = "";
  let modelUsed = "";

  const timeoutGuard = setTimeout(() => {
    logger.error("Agent loop total timeout exceeded", { phone: context.phone });
    throw new Error("AGENT_LOOP_TIMEOUT");
  }, TOTAL_TIMEOUT_MS);

  try {
    while (loopCount < MAX_LOOPS) {
      loopCount++;
      
      if (Date.now() - startTime > TOTAL_TIMEOUT_MS - 5000) {
        logger.warn("Agent loop approaching timeout", { loopCount, phone: context.phone });
        finalResponse = generateFallbackResponse();
        break;
      }

      const response: LLMResponse = await callLLMWithRetry({
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.4,
        max_tokens: 1100,
      });

      modelUsed = response.model_used || modelUsed;
      totalTokens += response.usage?.total_tokens || 0;

      if (response.content && response.content.length > MAX_LLM_CONTENT_LENGTH) {
        logger.warn("LLM returned excessively long content, truncating", { 
          length: response.content.length,
          phone: context.phone 
        });
        response.content = response.content.slice(0, MAX_LLM_CONTENT_LENGTH);
      }

      logger.info("LLM response", {
        loop: loopCount,
        finish_reason: response.finish_reason,
        tool_calls: response.tool_calls?.length || 0,
        content_length: response.content?.length || 0,
        tokens: response.usage?.total_tokens || 0,
      });

      if (!response.tool_calls || response.tool_calls.length === 0) {
        finalResponse = sanitizeResponse(stripOmegaThinking(response.content || ""));
        break;
      }

      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
      });

      for (const toolCall of response.tool_calls) {
        let args: any;
        try {
          args = safeJsonParse(toolCall.function?.arguments || "{}");
        } catch (parseError: any) {
          logger.error("Invalid tool arguments from LLM", { 
            tool: toolCall.function?.name,
            error: parseError.message,
            arguments_preview: toolCall.function?.arguments?.slice(0, 200)
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: "Invalid tool arguments format" }),
          });
          continue;
        }

        logger.info("Executing tool", { tool: toolCall.function?.name, args });

        try {
          const toolResult = await executeTool(toolCall, context);
          // executeTool returns { success: boolean, result: any, error?: string }
          const result = toolResult.result || toolResult;
          allToolCalls.push({ name: toolCall.function.name, args, result });

          const content = typeof result === "string" 
            ? result 
            : safeJsonStringify(result);

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: content.slice(0, 8000),
          });
        } catch (toolError: any) {
          const safeError = toolError.message?.replace(
            /(password|secret|token|key|api[_-]?key)\s*[:=]\s*\S+/gi, 
            "$1=[REDACTED]"
          );
          
          logger.error("Tool execution failed", { 
            tool: toolCall.function?.name, 
            error: safeError 
          });
          
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
        totalTokens += finalCall.usage?.total_tokens || 0;
        modelUsed = finalCall.model_used || modelUsed;
        break;
      }
      
      if (response.finish_reason === "length") {
        logger.warn("LLM hit length limit, aborting loop", { loopCount });
        finalResponse = generateFallbackResponse();
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
  } finally {
    clearTimeout(timeoutGuard);
  }
}
