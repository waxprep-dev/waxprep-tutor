import { callLLM } from "../llm/client";
import { executeTool } from "../tools/executor";
import { Mirror } from "./agents/Mirror";
import { River } from "./agents/River";
import { Fire } from "./agents/Fire";
import { Guardian } from "./agents/Guardian";
import { Breath, BreathBudget } from "./agents/Breath";
import { Perception, ContextBundle, GuardianDecision } from "./types";
import { logger } from "../utils/logger";

export interface VoidResult {
  response: string;
  toolsCalled: string[];
  latencyMs: number;
  breathBudget?: BreathBudget;
}

export class TheVoid {
  private mirror: Mirror;
  private river: River;
  private fire: Fire;
  private guardian: Guardian;
  private breath: Breath;

  private mirrorPrompt: string;
  private riverPrompt: string;
  private firePrompt: string;
  private guardianPrompt: string;

  constructor() {
    this.mirror = new Mirror();
    this.river = new River();
    this.fire = new Fire();
    this.guardian = new Guardian();
    this.breath = new Breath();

    this.mirrorPrompt = "You are The Mirror. You perceive the student. Read their message and detect intent, emotion, shame signals, risk flags, and cultural signals. Output a structured perception as JSON. Never speak to the student.";
    this.riverPrompt = "You are The River. You retrieve and build context. Output a context bundle as JSON. Never speak to the student.";

    this.firePrompt = `You are Wax. Generate responses to the student using the perception and context.
Acknowledge emotion. Use examples from their world. Teach naturally.

CRITICAL WHATSAPP RULES:
- You are texting. Not writing an essay. Not a professor. A smart friend.
- One idea per message. One question at the end.
- No bullet points. No numbered lists. No "Here are 4 things." No book recommendations unless explicitly asked.
- If the student says "I want to study X", your job is to make them CURIOUS about X, not to teach them X in one message.
- Plain text only. No markdown. No headers. No bold. No LaTeX. No tables.
- Match the student's message length. Short message → short reply.`;

    this.guardianPrompt = `You are The Guardian. Review every response before it reaches the student.
Check for: harmful content, leaked tool names, markdown formatting, inappropriate tone, cultural insensitivity, missed distress signals.

NEW — LENGTH GUARDIAN:
- If the response exceeds the given budget, return decision: "compress" with a shortened version.
- If the response has bullet points or lists on WhatsApp, return decision: "modify" to rewrite as flowing text.
- If the response tries to teach everything in one message, return decision: "modify" to ask a question instead.

Output JSON: { decision: "approve" | "modify" | "compress" | "block" | "escalate", reason: string, modified_response: string | null }`;
  }

  async processMessage(
    studentId: string,
    studentMessage: string,
    conversationHistory: string[],
    studentProfile: any,
    availableMemory: any
  ): Promise<VoidResult> {
    const startTime = Date.now();
    const toolsCalled: string[] = [];

    try {
      console.log(`[Void] Calling Mirror for student ${studentId}`);
      const perception = await this.mirror.perceive(studentMessage, conversationHistory, this.mirrorPrompt);
      toolsCalled.push("mirror");

      if (perception?.risk_flags?.suicidal_ideation ||
          perception?.risk_flags?.self_harm ||
          perception?.risk_flags?.extreme_distress) {
        return {
          response: "Hey. You are not alone. Please reach out to someone you trust. I'm here with you.",
          toolsCalled,
          latencyMs: Date.now() - startTime,
        };
      }

      console.log(`[Void] Calling River for student ${studentId}`);
      const contextBundle = await this.river.buildContext(perception, studentProfile, availableMemory, conversationHistory.join("\n"), this.riverPrompt);
      toolsCalled.push("river");

      const minutesSinceLast = this.estimateMinutesSinceLast(conversationHistory);
      const breathBudget = this.breath.calculate(perception, contextBundle, conversationHistory.length, minutesSinceLast);
      console.log(`[Void] Breath budget: ${breathBudget.targetChars} chars (${breathBudget.strategy}) — ${breathBudget.why}`);

      console.log(`[Void] Calling Fire for student ${studentId}`);
      const fireResponse = await this.fire.generateResponse(contextBundle, this.firePrompt, breathBudget);
      toolsCalled.push("fire");

      console.log(`[Void] Calling Guardian for student ${studentId}`);
      const guardianDecision = await this.guardian.review(fireResponse, perception, this.guardianPrompt, breathBudget);
      toolsCalled.push("guardian");

      let finalResponse: string;
      switch (guardianDecision.decision) {
        case "approve":
          finalResponse = fireResponse;
          break;
        case "modify":
        case "compress":
          finalResponse = guardianDecision.modified_response || fireResponse;
          break;
        case "block":
          finalResponse = "I'm here. What would you like to talk about?";
          break;
        case "escalate":
          finalResponse = "Hey. You are not alone. Please reach out to someone you trust. I'm here with you.";
          break;
        default:
          finalResponse = fireResponse;
      }

      const enforced = this.breath.enforce(finalResponse, breathBudget);
      if (enforced.wasTrimmed) {
        console.log(`[Void] Response trimmed from ${finalResponse.length} to ${enforced.text.length} chars`);
      }
      finalResponse = enforced.text;

      return {
        response: finalResponse,
        toolsCalled,
        latencyMs: Date.now() - startTime,
        breathBudget,
      };

    } catch (error: any) {
      logger.error(`[Void] Orchestration failed for student ${studentId}:`, error);
      return {
        response: "Omo, network wahala — try again.",
        toolsCalled,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  private estimateMinutesSinceLast(history: string[]): number {
    if (!history || history.length === 0) return 10;
    return 2;
  }
}

export default TheVoid;
