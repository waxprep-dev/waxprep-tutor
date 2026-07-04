import { callLLM } from "../../llm/client";
import { TOOLS } from "../../tools/definitions";
import { ContextBundle, BreathBudget } from "../types";
import { logger } from "../../utils/logger";

export class Fire {
  private maxRetries = 2;

  async generateResponse(
    contextBundle: ContextBundle,
    systemPrompt: string,
    budget?: BreathBudget
  ): Promise<string> {
    const lengthDirective = budget
      ? `\n\n[LENGTH PROTOCOL]\nYou are on WhatsApp. Your strict budget is ${budget.targetChars} characters (max ${budget.maxChars}).\nStrategy: ${budget.strategy}.\nWhy: ${budget.why}.\nCount your characters. One idea. One question. No lists. No markdown. No headers. Plain text only.`
      : "";

    const messages = [
      { role: "system" as const, content: systemPrompt + lengthDirective },
      {
        role: "user" as const,
        content: `Context Bundle: ${JSON.stringify(contextBundle)}\n\nGenerate the best possible WhatsApp response. Plain text only. No JSON. No markdown headers. No bullet points. No numbered lists.`,
      },
    ];

    const maxTokens = budget ? Math.min(800, Math.ceil(budget.maxChars / 1.8)) : 400;

    try {
      const res = await this.callWithRetry(messages, maxTokens);
      let cleaned = this.cleanResponse(res);

      if (budget && cleaned.length > budget.maxChars) {
        logger.warn("Fire exceeded budget, self-compressing", { length: cleaned.length, budget: budget.targetChars });
        cleaned = await this.compress(cleaned, budget);
      }

      return cleaned;
    } catch (e: any) {
      logger.error("Fire generation failed", { error: e.message });
      return "Give me a moment — trying again.";
    }
  }

  private async callWithRetry(messages: any[], maxTokens?: number): Promise<any> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await callLLM({
          messages,
          tools: TOOLS,
          tool_choice: "auto",
          temperature: 0.7,
          max_tokens: maxTokens || 400,
        });
      } catch (e) {
        if (i === this.maxRetries - 1) throw e;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    throw new Error("Fire failed after retries");
  }

  private cleanResponse(text: string): string {
    if (!text) return "";
    return text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\$\$?[\s\S]*?\$\$?/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private async compress(text: string, budget: BreathBudget): Promise<string> {
    const compressMsg = [
      {
        role: "system" as const,
        content: `You are a ruthless editor. Reduce this text to ${budget.targetChars} characters max. Keep the core message, warmth, and the question at the end. Remove all secondary points. Output ONLY the compressed text. No markdown. No headers. No bullet points. Plain text.`,
      },
      { role: "user" as const, content: text },
    ];
    try {
      const res = await callLLM({
        messages: compressMsg,
        temperature: 0.2,
        max_tokens: Math.ceil(budget.maxChars / 1.8),
      });
      const compressed = (res.content || text).trim();
      return compressed.length > budget.maxChars ? compressed.slice(0, budget.maxChars) : compressed;
    } catch (e) {
      return text.slice(0, budget.targetChars);
    }
  }
}
