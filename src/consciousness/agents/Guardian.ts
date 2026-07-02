// FILE: src/consciousness/agents/Guardian.ts
// =====================================================

import { callLLM } from "../../llm/client";
import { GuardianDecision, Perception, AgentConfig } from "../types";

export class Guardian {
  private config: AgentConfig = {
    modelTier: "fast",
    maxTokens: 1500,
    temperature: 0.1,
    retryAttempts: 2,
  };

  async review(
    fireResponse: string,
    perception: Perception,
    systemPrompt: string
  ): Promise<GuardianDecision> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Fire Response: "${fireResponse}"\n\nPerception: ${JSON.stringify(perception)}\n\nReview and output JSON decision.` },
    ];

    const response = await this.callWithRetry(messages);
    return this.parseDecision(response);
  }

  private async callWithRetry(messages: any[]): Promise<string> {
    for (let i = 0; i < this.config.retryAttempts; i++) {
      try {
        const res = await callLLM({ messages, temperature: 0.3, max_tokens: 500 }); return res.content || "";
      } catch (e) {
        if (i === this.config.retryAttempts - 1) throw e;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    throw new Error("Guardian failed after retries");
  }

  private parseDecision(raw: string): GuardianDecision {
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("Guardian parse error:", e);
      // Default: approve with warning
      return {
        decision: "approve",
        reason: "Guardian parse failed — defaulting to approve",
        modified_response: null,
        quality_checks: {},
        safety_checks: {},
        escalation: { needed: false, reason: "", human_alert: "" },
      };
    }
  }
}

// =====================================================
