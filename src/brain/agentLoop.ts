import { callLLM } from "../llm/client";
import { executeTool } from "./executor";
import { Message } from "../types";
import { config } from "../config";
import { logMessage } from "../memory/messageLog";

const MAX_LOOPS = 5;
const RETRY_ATTEMPTS = 3;

export interface AgentResult {
  response: string;
  toolsCalled: string[];
  loopCount: number;
  error?: string;
}

/**
 * Run the agent loop with the new adaptive prompt.
 * The AI decides everything: when to teach, when to ask, when to use tools.
 * No state machine. No hardcoded flows. Just the AI, the context, and the student.
 */
export async function runAgentLoop(
  studentId: string,
  messages: Message[],
  contextBundle: any,
  systemPrompt: string
): Promise<AgentResult> {
  let currentMessages = [...messages];
  let toolsCalled: string[] = [];
  let loopCount = 0;

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    try {
      // Call LLM with retry logic
      const llmResponse = await callLLMWithRetry(
        systemPrompt,
        currentMessages,
        contextBundle.availableTools
      );

      if (!llmResponse) {
        throw new Error("LLM returned empty response");
      }

      // Strip thinking tags (internal reasoning should never reach student)
      const cleanedResponse = stripThinkingTags(llmResponse.content);

      // Check for tool calls
      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        // Execute tools silently
        const toolResults = await Promise.all(
          llmResponse.toolCalls.map(async (toolCall: any) => {
            toolsCalled.push(toolCall.name);

            try {
              const result = await executeTool(toolCall.name, toolCall.arguments, studentId);
              return {
                role: "tool" as const,
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              };
            } catch (toolError: any) {
              // Tool failed — log it but don't break the conversation
              console.error(`Tool ${toolCall.name} failed:`, toolError);
              return {
                role: "tool" as const,
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: "Tool temporarily unavailable" }),
              };
            }
          })
        );

        // Add tool results to conversation
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: cleanedResponse },
          ...toolResults,
        ];

        // Continue loop — let AI see tool results and respond
        continue;
      }

      // No tool calls — this is the final response
      // Sanitize and return
      const finalResponse = sanitizeResponse(cleanedResponse);

      // Log the interaction
      await logMessage(studentId, "assistant", finalResponse, {
        toolsCalled,
        loopCount,
      });

      return {
        response: finalResponse,
        toolsCalled,
        loopCount,
      };

    } catch (error: any) {
      console.error(`Agent loop error (loop ${loopCount}):`, error);

      // If we've used all loops, return fallback
      if (loopCount >= MAX_LOOPS) {
        return {
          response: generateFallbackResponse(),
          toolsCalled,
          loopCount,
          error: error.message,
        };
      }

      // Otherwise retry silently
      continue;
    }
  }

  // Should never reach here, but just in case
  return {
    response: generateFallbackResponse(),
    toolsCalled,
    loopCount,
  };
}

/**
 * Call LLM with silent retry logic.
 * The student never sees failures.
 */
async function callLLMWithRetry(
  systemPrompt: string,
  messages: Message[],
  tools: any[],
  attempt: number = 1
): Promise<any> {
  try {
    return await callLLM(systemPrompt, messages, tools);
  } catch (error: any) {
    if (attempt < RETRY_ATTEMPTS) {
      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      await sleep(delay);
      return callLLMWithRetry(systemPrompt, messages, tools, attempt + 1);
    }
    throw error;
  }
}

/**
 * Strip <thinking> tags and their contents.
 * Internal reasoning must NEVER reach the student.
 */
function stripThinkingTags(text: string): string {
  // Remove <thinking>...</thinking> blocks
  let cleaned = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  // Remove any stray <thinking> or </thinking> tags
  cleaned = cleaned.replace(/<\/?thinking>/gi, "");
  // Clean up extra whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

/**
 * Sanitize response for WhatsApp.
 * Remove any markdown that might leak through.
 */
function sanitizeResponse(text: string): string {
  let cleaned = text;

  // Remove markdown headers
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");

  // Replace double asterisks with single
  cleaned = cleaned.replace(/\*\*/g, "*");

  // Remove backticks
  cleaned = cleaned.replace(/`/g, "");

  // Remove code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");

  // Remove LaTeX
  cleaned = cleaned.replace(/\$\$?[\s\S]*?\$\$?/g, "");

  // Clean up extra whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
}

/**
 * Generate fallback response that preserves Wax's personality.
 * This is the LAST resort — only after all retries fail.
 */
function generateFallbackResponse(): string {
  const fallbacks = [
    "Omo, network wahala — send that again when you can.",
    "My brain hiccuped. Say that one more time?",
    "Wait, that message got lost in the matrix. What did you say?",
    "You know what, let me think about that properly. Give me a minute.",
    "Ah, my phone is acting up. Send that again?",
  ];

  // Pick randomly so it doesn't feel scripted
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safe wrapper that catches ALL errors and returns a human response.
 * The webhook calls this, not runAgentLoop directly.
 */
export async function runAgentLoopSafely(
  studentId: string,
  messages: Message[],
  contextBundle: any,
  systemPrompt: string
): Promise<string> {
  try {
    const result = await runAgentLoop(studentId, messages, contextBundle, systemPrompt);
    return result.response;
  } catch (error: any) {
    console.error("Agent loop completely failed:", error);
    // Even total failure gets a human response
    return generateFallbackResponse();
  }
}
