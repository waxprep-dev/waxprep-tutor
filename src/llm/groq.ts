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

export async function callGroq(request: LLMRequest, attempt: number = 0): Promise<LLMResponse> {
  const body: GroqRequest = {
    model: config.groq.model,
    messages: convertMessages(request.messages),
    tools: convertTools(request.tools),
    tool_choice: request.tools && request.tools.length > 0 ? (request.tool_choice || "auto") : undefined,
    temperature: request.temperature ?? 0.7,
    max_tokens: request.max_tokens ?? 2000,
    parallel_tool_calls: false,
  };

  try {
    const response = await axios.post<GroqResponse>(
      `${config.groq.baseUrl}/chat/completions`,
      body,
      {
        headers: {
          Authorization: `Bearer ${config.groq.apiKey}`,
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
    logger.info("Groq usage", {
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
      model_used: config.groq.model,
      usage: response.data.usage,
      finish_reason: choice.finish_reason,
    };
  } catch (err: any) {
    const status = err.response?.status;
    const errorMessage = err.response?.data?.error?.message || "";

    // If it's a daily limit (TPD), throw immediately so client.ts can fall back to Cerebras.
    // No point retrying — we're locked out for hours.
    if (status === 429 && errorMessage.includes("per day")) {
      logger.warn("Groq daily limit reached — throwing to fallback provider");
      throw err;
    }

    // Per-minute limit (TPM) — retry with backoff
    if (status === 429 && attempt < MAX_RETRIES) {
      const retryAfterHeader = err.response?.headers?.["retry-after"];
      const waitMs = retryAfterHeader
        ? Math.ceil(parseFloat(retryAfterHeader) * 1000) + 250
        : 2000 * (attempt + 1);

      logger.warn("Groq rate limited — retrying", {
        attempt: attempt + 1,
        waitMs,
        message: errorMessage,
      });

      await sleep(waitMs);
      return callGroq(request, attempt + 1);
    }

    throw err;
  }
}
