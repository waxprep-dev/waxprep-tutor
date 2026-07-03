import { callLLM } from "../../llm/client";
import { Perception } from "../types";

const MIRROR_PROMPT = `You are The Mirror. You perceive the student. Read their message and detect intent, emotion, shame signals, risk flags, and cultural signals. Output a structured perception. Never speak to the student.`;

export class Mirror {
  private maxRetries = 2;

  async perceive(
    studentMessage: string,
    conversationHistory: string[],
    systemPrompt: string
  ): Promise<Perception> {
    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Conversation history:\n${conversationHistory.join("\n")}\n\nStudent message: "${studentMessage}"\n\nExtract perception object as JSON only.`,
      },
    ];

    const response = await this.callWithRetry(messages);
    return this.parsePerception(response);
  }

  private async callWithRetry(messages: any[]): Promise<string> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const res = await callLLM({ messages, temperature: 0.3, max_tokens: 500 });
        return res.content || "";
      } catch (e) {
        if (i === this.maxRetries - 1) throw e;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    return "";
  }

  private parsePerception(raw: string): Perception {
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      if (!cleaned) return this.getDefaultPerception();

      const parsed = JSON.parse(cleaned);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return this.getDefaultPerception();
      }

      const defaults = this.getDefaultPerception();
      return this.mergeWithDefaults(defaults, parsed);
    } catch (e) {
      console.error("Mirror parse error:", e);
      return this.getDefaultPerception();
    }
  }

  private mergeWithDefaults(defaults: any, parsed: any): any {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return defaults;
    }

    const result: any = {};
    for (const key of Object.keys(defaults)) {
      if (
        parsed[key] !== undefined &&
        parsed[key] !== null &&
        typeof parsed[key] === typeof defaults[key]
      ) {
        if (typeof defaults[key] === "object" && !Array.isArray(defaults[key])) {
          result[key] = this.mergeWithDefaults(defaults[key], parsed[key]);
        } else {
          result[key] = parsed[key];
        }
      } else {
        result[key] = defaults[key];
      }
    }
    return result;
  }

  private getDefaultPerception(): Perception {
    return {
      intent: { primary: "other", confidence: 0.5, sub_intents: [] },
      emotional_state: {
        primary_emotion: "neutral",
        intensity: 0.3,
        emotional_triggers: [],
        vulnerability_detected: false,
        shame_detected: false,
        pride_detected: false,
      },
      cognitive_state: {
        understanding_level: "beginner",
        confusion_detected: false,
        pretending_to_understand: false,
        engagement_level: "medium",
        attention_span_estimate: "medium",
      },
      social_context: {
        formality_level: "casual",
        relationship_stage: "stranger",
        trust_level: "low",
        power_dynamic: "student_seeks_help",
      },
      dimensions_detected: {
        intellectual: true,
        emotional: false,
        social: false,
        economic: false,
        physical: false,
        spiritual: false,
        cultural: false,
      },
      urgency: { level: "none", reason: "default" },
      student_needs: { immediate: "unknown", underlying: "unknown", unstated: "unknown" },
      cultural_signals: { language_used: "english", references: [], world_indicators: [] },
      risk_flags: {
        suicidal_ideation: false,
        self_harm: false,
        abuse_indicators: false,
        extreme_distress: false,
        academic_crisis: false,
      },
    };
  }
}
