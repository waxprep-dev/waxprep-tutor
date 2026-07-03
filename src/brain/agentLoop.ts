import { ChatMessage, ToolCall } from "../llm/types";
import { callLLM } from "../llm/client";
import { executeTool } from "../tools/executor";
import { logger } from "../utils/logger";

export async function runAgentLoop(
  messages: ChatMessage[],
  ctx: { phone: string; episodeId: string }
): Promise<{
  finalResponse: string;
  allToolCalls: ToolCall[];
  totalTokens?: number;
  modelUsed?: string;
}> {
  const maxIterations = 5;
  let currentMessages = [...messages];
  const allToolCalls: ToolCall[] = [];
  let totalTokens = 0;
  let modelUsed = "cerebras";
  let finalResponse = "";

  try {
    for (let i = 0; i < maxIterations; i++) {
      const response = await callLLM({
        messages: currentMessages,
        model: "cerebras",
        temperature: 0.7,
        max_tokens: 1100,
        tools: [],
        agent: "fire"
      });

      if (response.usage) {
        totalTokens += response.usage.total_tokens || 0;
      }
      if (response.model_used) {
        modelUsed = response.model_used;
      }

      const toolCalls = response.tool_calls || [];
      const content = response.content || "";

      if (toolCalls.length === 0) {
        finalResponse = content;
        break;
      }

      // Execute tool calls
      for (const toolCall of toolCalls) {
        allToolCalls.push(toolCall);
        const result = await executeTool(toolCall, { phone: ctx.phone, episodeId: ctx.episodeId });
        currentMessages.push({
          role: "assistant",
          content: content,
          tool_calls: [toolCall]
        });
        currentMessages.push({
          role: "tool",
          content: result,
          tool_call_id: toolCall.id
        });
      }

      if (i === maxIterations - 1) {
        finalResponse = content || "I've processed what I can. Let's continue.";
      }
    }

    return {
      finalResponse: finalResponse || "I couldn't generate a response. Please try again.",
      allToolCalls,
      totalTokens,
      modelUsed
    };
  } catch (error: any) {
    logger.error("Agent loop error", { error: error.message });
    throw error;
  }
}
