import axios from "axios";
import { config } from "../config";
import {
  ChatMessage,
  LLMRequest,
  LLMResponse,
  ToolCall,
  ToolDefinition,
} from "./types";

// Kimi uses an OpenAI-compatible API, so the call format is familiar.
// Docs: https://platform.moonshot.cn/docs/api-reference

interface KimiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

interface KimiMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface KimiRequest {
  model: string;
  messages: KimiMessage[];
  tools?: KimiTool[];
  tool_choice?: string;
  temperature?: number;
  max_tokens?: number;
}

interface KimiResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function convertTools(tools: ToolDefinition[] | undefined): KimiTool[] | undefined {
  if (!tools) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

function convertMessages(messages: ChatMessage[]): KimiMessage[] {
  return messages.map((m) => {
    const out: KimiMessage = {
      role: m.role,
      content: m.content,
    };
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    return out;
  });
}

export async function callKimi(request: LLMRequest): Promise<LLMResponse> {
  const body: KimiRequest = {
    model: config.kimi.model,
    messages: convertMessages(request.messages),
    tools: convertTools(request.tools),
    tool_choice: request.tool_choice || "auto",
    temperature: request.temperature ?? 0.7,
    max_tokens: request.max_tokens ?? 2000,
  };

  const response = await axios.post<KimiResponse>(
    `${config.kimi.baseUrl}/chat/completions`,
    body,
    {
      headers: {
        Authorization: `Bearer ${config.kimi.apiKey}`,
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

  return {
    content: choice.message.content,
    tool_calls: toolCalls,
    model_used: config.kimi.model,
    usage: response.data.usage,
    finish_reason: choice.finish_reason,
  };
}
