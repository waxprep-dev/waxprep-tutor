import { callLLM } from "../llm/client";
import { ChatMessage, LLMResponse } from "../llm/types";
import { TOOLS } from "../tools/definitions";
import { executeTool } from "../tools/executor";
import { logger } from "../utils/logger";

const MAX_LOOPS = 5;

const INTERACTIVE_TOOLS = new Set([
  "send_topic_picker",
  "send_quick_replies",
  "send_difficulty_check",
  "send_quiz_question",
  "send_concept_card",
]);

function sanitizeResponse(text: string): string {
  if (!text) return text;
  return text
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/g, "")
    .replace(/<function=[\s\S]*$/g, "")
    .trim();
}

function trimToolResult(toolName: string, result: any): any {
  if (toolName === "get_or_create_concept" && result && typeof result === "object") {
    return {
      concept_id: result.concept_id,
      name: result.name,
      subject: result.subject,
      mastery_score: result.mastery_score,
      common_misconceptions: result.common_misconceptions,
    };
  }
  if (toolName === "get_student_profile" && result && typeof result === "object") {
    return {
      preferred_name: result.preferred_name,
      current_level: result.current_level,
      learning_style: result.learning_style,
      pace: result.pace,
      confidence_baseline: result.confidence_baseline,
      goals: result.goals,
    };
  }
  if (toolName === "search_past_conversations" && Array.isArray(result)) {
    return result.slice(0, 3).map((e: any) => ({ summary: e.summary_text, similarity: e.similarity }));
  }
  return result;
}

async function callLLMWithRetry(request: any, alreadyRetried = false): Promise<LLMResponse> {
  try {
    return await callLLM(request);
  } catch (err: any) {
    const code = err.response?.data?.error?.code;
    if (code === "tool_use_failed" && !alreadyRetried) {
      logger.warn("Model produced a malformed tool call — retrying once", {
        error: err.response?.data?.error?.message,
      });
      return callLLMWithRetry(request, true);
    }
    throw err;
  }
}

export interface AgentLoopResult {
  finalResponse: string;
  allToolCalls: Array<{ name: string; args: any; result: any }>;
  modelUsed: string;
  totalTokens: number;
  loopCount: number;
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
      max_tokens: 700,
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
      finalResponse = sanitizeResponse(response.content || "");
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

      const { result } = await executeTool(toolCall, context);
      const trimmedResult = trimToolResult(toolCall.function.name, JSON.parse(result));
      allToolCalls.push({ name: toolCall.function.name, args, result: trimmedResult });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(trimmedResult),
      });
    }

    const sentInteractive = response.tool_calls.some((tc) => INTERACTIVE_TOOLS.has(tc.function.name));
    if (sentInteractive) {
      finalResponse = "";
      break;
    }

    if (response.finish_reason === "stop") {
      const finalCall = await callLLMWithRetry({
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.4,
        max_tokens: 700,
      });
      finalResponse = sanitizeResponse(finalCall.content || "");
      totalTokens += finalCall.usage.total_tokens;
      modelUsed = finalCall.model_used;
      break;
    }
  }

  if (!finalResponse && loopCount >= MAX_LOOPS) {
    logger.warn("Agent loop hit max iterations", { phone: context.phone });
    finalResponse = "Give me a sec, I'm thinking about this properly…";
  }

  return {
    finalResponse,
    allToolCalls,
    modelUsed,
    totalTokens,
    loopCount,
  };
}
