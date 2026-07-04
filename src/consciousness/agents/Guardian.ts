import { callLLM } from "../../llm/client";
import { Perception, GuardianDecision, BreathBudget } from "../types";
import { logger } from "../../utils/logger";

export class Guardian {
  private maxRetries = 2;

  async review(
    fireResponse: string,
    perception: Perception,
    systemPrompt: string,
    budget?: BreathBudget
  ): Promise<GuardianDecision> {
    const lengthContext = budget
      ? `\n\nLENGTH AUDIT: The Fire response is ${fireResponse.length} characters. Budget: ${budget.targetChars} (max ${budget.maxChars}).`
      : "";

    const messages = [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: `Fire Response: "${fireResponse}"\n\nPerception: ${JSON.stringify(perception)}${lengthContext}\n\nReview and output JSON decision.`,
      },
    ];

    try {
      const res = await this.callWithRetry(messages);
      return this.parseDecision(res);
    } catch (e: any) {
      logger.error("Guardian review failed", { error: e.message });
      return {
        decision: "approve",
        reason: "Guardian parse failed",
        modified_response: null,
        quality_checks: {},
        safety_checks: {},
        escalation: { needed: false, reason: "", human_alert: "" },
      };
    }
  }

  private async callWithRetry(messages: any[]): Promise<string> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const res = await callLLM({ messages, temperature: 0.1, max_tokens: 600 });
        return res.content || "";
      } catch (e) {
        if (i === this.maxRetries - 1) throw e;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    return "";
  }

  private parseDecision(raw: string): GuardianDecision {
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        decision: parsed.decision || "approve",
        reason: parsed.reason || "",
        modified_response: parsed.modified_response || null,
        quality_checks: parsed.quality_checks || {},
        safety_checks: parsed.safety_checks || {},
        escalation: parsed.escalation || { needed: false, reason: "", human_alert: "" },
      };
    } catch (e) {
      return {
        decision: "approve",
        reason: "Guardian parse failed",
        modified_response: null,
        quality_checks: {},
        safety_checks: {},
        escalation: { needed: false, reason: "", human_alert: "" },
      };
    }
  }
}
