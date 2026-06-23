import { callLLM } from "../llm/client";
import { ChatMessage, LLMResponse } from "../llm/types";
import { TOOLS } from "../tools/definitions";
import { executeTool } from "../tools/executor";
import { logger } from "../utils/logger";

const MAX_LOOPS = 8;

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

    const response: LLMResponse = await callLLM({
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.7,
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
      finalResponse = response.content || "";
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
      allToolCalls.push({ name: toolCall.function.name, args, result });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    if (response.finish_reason === "stop") {
      const finalCall = await callLLM({
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.7,
        max_tokens: 700,
      });
      finalResponse = finalCall.content || "";
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
