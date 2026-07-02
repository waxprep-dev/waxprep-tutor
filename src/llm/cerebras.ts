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

interface CerebrasTool {
  type: "function";
  function: { name: string; description: string; parameters: any };
}

interface CerebrasMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

interface CerebrasRequest {
  model: string;
  messages: CerebrasMessage[];
  tools?: CerebrasTool[];
  tool_choice?: string;
  temperature?: number;
  max_tokens?: number;
  parallel_tool_calls?: boolean;
}

interface CerebrasResponse {
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

function convertTools(tools: ToolDefinition[] | undefined): CerebrasTool[] | undefined {
  if (!tools) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
  }));
}

function convertMessages(messages: ChatMessage[]): CerebrasMessage[] {
  return messages.map((m) => {
    const out: CerebrasMessage = { role: m.role, content: m.content };
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    return out;
  });
}

export async function callCerebras(request: LLMRequest): Promise<LLMResponse> {
  const hasTools = request.tools && request.tools.length > 0;

  const body: CerebrasRequest = {
    model: config.cerebras.model,
    messages: convertMessages(request.messages),
    tools: convertTools(request.tools),
    temperature: request.temperature ?? 0.7,
    max_tokens: request.max_tokens ?? 2000,
    parallel_tool_calls: false,
  };

  if (hasTools) {
    body.tool_choice = request.tool_choice || "auto";
  }

  const response = await axios.post<CerebrasResponse>(
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
}
