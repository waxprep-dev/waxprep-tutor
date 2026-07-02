// FILE: src/consciousness/agents/Witness.ts
// =====================================================

import { callLLM } from "../../llm/client";
import { Reflection, Perception, ContextBundle, AgentConfig } from "../types";

export class Witness {
  private config: AgentConfig = {
    modelTier: "capable",
    maxTokens: 2500,
    temperature: 0.2,
    retryAttempts: 2,
  };

  async reflect(
    studentMessage: string,
    perception: Perception,
    contextBundle: ContextBundle,
    fireResponse: string,
    studentNextMessage: string | null,
    systemPrompt: string
  ): Promise<Reflection> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Student Message: "${studentMessage}"\n\nPerception: ${JSON.stringify(perception)}\n\nContext Bundle: ${JSON.stringify(contextBundle)}\n\nFire Response: "${fireResponse}"\n\nStudent Next Message: "${studentNextMessage || "N/A"}"\n\nGenerate reflection as JSON only.` },
    ];

    const response = await this.callWithRetry(messages);
    return this.parseReflection(response);
  }

  private async callWithRetry(messages: any[]): Promise<string> {
    for (let i = 0; i < this.config.retryAttempts; i++) {
      try {
        return await callLLM(messages, this.config.modelTier);
      } catch (e) {
        if (i === this.config.retryAttempts - 1) throw e;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    throw new Error("Witness failed after retries");
  }

  private parseReflection(raw: string): Reflection {
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("Witness parse error:", e);
      return {
        interaction_quality: { score: 0.5, assessment: "adequate", reason: "parse failed" },
        what_worked: [],
        what_failed: [],
        missed_opportunities: [],
        emotional_missed: [],
        cognitive_missed: [],
        pattern_detected: { pattern_type: "none", description: "parse failed", confidence: 0, recommended_action: "none" },
        teaching_effectiveness: { concept_understood: false, student_engaged: false, would_student_return: false, risk_of_churn: 0.5 },
        system_improvements: [],
      };
    }
  }
}

// =====================================================
