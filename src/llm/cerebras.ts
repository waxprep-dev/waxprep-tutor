import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import {
  ChatMessage,
  LLMRequest,
  LLMResponse,
  ToolCall,
  ToolDefinition,
} from "./types";

interface GroqTool {
  type: "function";
  function: { name: string; description: string; parameters: any };
}

interface GroqMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

interface GroqRequest {
  model: string;
  messages: GroqMessage[];
  tools?: GroqTool[];
  tool_choice?: string;
  temperature?: number;
  max_tokens?: number;
  parallel_tool_calls?: boolean;
}

interface GroqResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function convertTools(tools: ToolDefinition[] | undefined): GroqTool[] | undefined {
  if (!tools) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
  }));
}

function convertMessages(messages: ChatMessage[]): GroqMessage[] {
  return messages.map((m) => {
    const out: GroqMessage = { role: m.role, content: m.content };
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    return out;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 2;

export async function callCerebras(request: LLMRequest, attempt: number = 0): Promise<LLMResponse> {
  const body: GroqRequest = {
    model: config.cerebras.model,
    messages: convertMessages(request.messages),
    tools: convertTools(request.tools),
    tool_choice: request.tool_choice || "auto",
    temperature: request.temperature ?? 0.7,
    max_tokens: request.max_tokens ?? 2000,
    parallel_tool_calls: false,
  };

  try {
    const response = await axios.post<GroqResponse>(
      `${config.cerebras.baseUrl}/chat/completions`,
      body,
      {
        headers: {
          Authorization: `Bearer ${config.cerebras.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const choice = response.data.choices[0];
    const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    const cachedTokens = (response.data.usage as any).prompt_tokens_details?.cached_tokens || 0;
    logger.info("Cerebras usage", {
      prompt_tokens: response.data.usage.prompt_tokens,
      cached_tokens: cachedTokens,
      cache_hit_rate: response.data.usage.prompt_tokens
        ? `${((cachedTokens / response.data.usage.prompt_tokens) * 100).toFixed(1)}%`
        : "0%",
      total_tokens: response.data.usage.total_tokens,
    });

    return {
      content: choice.message.content,
      tool_calls: toolCalls,
      model_used: config.cerebras.model,
      usage: response.data.usage,
      finish_reason: choice.finish_reason,
    };
  } catch (err: any) {
    const status = err.response?.status;

    if (status === 429 && attempt < MAX_RETRIES) {
      const retryAfterHeader = err.response?.headers?.["retry-after"];
      const waitMs = retryAfterHeader
        ? Math.ceil(parseFloat(retryAfterHeader) * 1000) + 250
        : 2000 * (attempt + 1);

      logger.warn("Cerebras rate limited — retrying", {
        attempt: attempt + 1,
        waitMs,
        message: err.response?.data?.error?.message,
      });

      await sleep(waitMs);
      return callCerebras(request, attempt + 1);
    }

    throw err;
  }
}
