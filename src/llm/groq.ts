import axios from "axios";
import { config } from "../config";
import {
  ChatMessage,
  LLMRequest,
  LLMResponse,
  ToolCall,
  ToolDefinition,
} from "./types";

// Groq is OpenAI-compatible, so the call shape is identical to Kimi's.
// Docs: https://console.groq.com/docs/api-reference

interface GroqTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

interface GroqMessage {
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

interface GroqRequest {
  model: string;
  messages: GroqMessage[];
  tools?: GroqTool[];
  tool_choice?: string;
  temperature?: number;
  max_tokens?: number;
}

interface GroqResponse {
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

function convertTools(tools: ToolDefinition[] | undefined): GroqTool[] | undefined {
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

function convertMessages(messages: ChatMessage[]): GroqMessage[] {
  return messages.map((m) => {
    const out: GroqMessage = {
      role: m.role,
      content: m.content,
    };
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name) out.name = m.name;
    return out;
  });
}

export async function callGroq(request: LLMRequest): Promise<LLMResponse> {
  const body: GroqRequest = {
    model: config.groq.model,
    messages: convertMessages(request.messages),
    tools: convertTools(request.tools),
    tool_choice: request.tool_choice || "auto",
    temperature: request.temperature ?? 0.7,
    max_tokens: request.max_tokens ?? 2000,
  };

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

  return {
    content: choice.message.content,
    tool_calls: toolCalls,
    model_used: config.groq.model,
    usage: response.data.usage,
    finish_reason: choice.finish_reason,
  };
}
