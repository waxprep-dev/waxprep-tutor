// FILE: src/consciousness/agents/Mirror.ts
// =====================================================

import { callLLM } from "../../llm/client";
import { Perception, AgentConfig } from "../types";

const MIRROR_PROMPT = `You are The Mirror. You perceive...` // Load from file

export class Mirror {
  private config: AgentConfig = {
    modelTier: "fast",
    maxTokens: 2000,
    temperature: 0.1,
    retryAttempts: 2,
  };

  async perceive(
    studentMessage: string,
    conversationHistory: string[],
    systemPrompt: string
  ): Promise<Perception> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Conversation history:
${conversationHistory.join("\n")}\n\nStudent message: "${studentMessage}"\n\nExtract perception object as JSON only.` },
    ];

    const response = await this.callWithRetry(messages);
    return this.parsePerception(response);
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
    throw new Error("Mirror failed after retries");
  }

  private parsePerception(raw: string): Perception {
    try {
      // Strip markdown code blocks if present
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned); if (!parsed || typeof parsed !== "object") return this.getDefaultPerception(); return parsed;
    } catch (e) {
      console.error("Mirror parse error:", e);
      // Return default perception on parse failure
      return this.getDefaultPerception();
    }
  }

  private getDefaultPerception(): Perception {
    return {
      intent: { primary: "other", confidence: 0.5, sub_intents: [] },
      emotional_state: { primary_emotion: "neutral", intensity: 0.3, emotional_triggers: [], vulnerability_detected: false, shame_detected: false, pride_detected: false },
      cognitive_state: { understanding_level: "beginner", confusion_detected: false, pretending_to_understand: false, engagement_level: "medium", attention_span_estimate: "medium" },
      social_context: { formality_level: "casual", relationship_stage: "stranger", trust_level: "low", power_dynamic: "student_seeks_help" },
      dimensions_detected: { intellectual: true, emotional: false, social: false, economic: false, physical: false, spiritual: false, cultural: false },
      urgency: { level: "none", reason: "default" },
      student_needs: { immediate: "unknown", underlying: "unknown", unstated: "unknown" },
      cultural_signals: { language_used: "english", references: [], world_indicators: [] },
      risk_flags: { suicidal_ideation: false, self_harm: false, abuse_indicators: false, extreme_distress: false, academic_crisis: false },
    };
  }
}

// =====================================================
