import axios from "axios";
import { LLMRequest, LLMResponse, ChatMessage, ToolCall } from "./types";
import { config } from "../config";
import { logger } from "../utils/logger";

export async function callKimi(request: LLMRequest): Promise<LLMResponse> {
  const url = "https://api.moonshot.cn/v1/chat/completions";
  const apiKey = config.kimi?.apiKey;

  if (!apiKey) {
    throw new Error("Kimi API key not configured");
  }

  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const body: any = {
    model: request.model || "moonshot-v1-8k",
    messages: request.messages.map((msg: ChatMessage) => ({
      role: msg.role,
      content: msg.content,
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
      ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
      ...(msg.name ? { name: msg.name } : {}),
    })),
    temperature: request.temperature ?? 0.7,
    max_tokens: request.max_tokens ?? 1100,
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
    if (request.tool_choice) {
      body.tool_choice = request.tool_choice;
    }
  }

  try {
    const response = await axios.post(url, body, { headers, timeout: 30000 });
    const data = response.data;

    const toolCalls: ToolCall[] | undefined = data.choices[0]?.message?.tool_calls?.map((tc: any) => ({
      id: tc.id || `call_${Date.now()}`,
      type: "function",
      function: {
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "{}",
      },
    }));

    return {
      content: data.choices[0]?.message?.content || "",
      tool_calls: toolCalls,
      finish_reason: data.choices[0]?.finish_reason,
      model_used: data.model,
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0,
      },
    };
  } catch (error: any) {
    logger.error("Kimi API error", {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error;
  }
}
