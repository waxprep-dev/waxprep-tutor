// FILE: src/consciousness/agents/Breath.ts
// =====================================================
// The Breath — Pacing Oracle of TheVoid
// =====================================================

import { Perception, ContextBundle } from "../types";

export interface BreathBudget {
  targetChars: number;
  maxChars: number;
  strategy: "hook" | "bite" | "meal" | "feast";
  why: string;
}

export class Breath {
  private static readonly ABSOLUTE_MAX = 900;
  private static readonly MIN_LENGTH = 60;

  calculate(
    perception: Perception,
    contextBundle: ContextBundle,
    historyLength: number,
    minutesSinceLastStudentMessage: number
  ): BreathBudget {
    let multiplier = 1.0;

    const stage = perception.social_context?.relationship_stage || "stranger";
    const attention = perception.cognitive_state?.attention_span_estimate || "medium";
    const intent = perception.intent?.primary || "other";
    const msgCount = contextBundle.conversation_state?.message_count_this_episode || 0;

    let rawStrategy: "hook" | "bite" | "meal" | "feast" = "hook";

    if (intent === "greeting" || intent === "small_talk") {
      rawStrategy = "hook";
    } else if (intent === "deep_explanation" || intent === "study_plan") {
      rawStrategy = "meal";
    } else if (intent === "crisis" || perception.risk_flags?.extreme_distress) {
      rawStrategy = "bite";
    }

    if (minutesSinceLastStudentMessage > 8) {
      rawStrategy = "hook";
      multiplier = 0.35;
    }

    if (stage === "stranger") multiplier *= 0.6;
    if (stage === "close") multiplier *= 1.2;

    if (attention === "short") multiplier *= 0.5;
    if (attention === "long") multiplier *= 1.2;

    let strategy: "hook" | "bite" | "meal" | "feast" = rawStrategy;

    if (msgCount < 3) {
      multiplier *= 0.55;
      const downgrade: Record<"hook" | "bite" | "meal" | "feast", "hook" | "bite" | "meal"> = {
        hook: "hook",
        bite: "bite",
        meal: "bite",
        feast: "meal",
      };
      strategy = downgrade[strategy];
    }

    const baseTargets: Record<"hook" | "bite" | "meal" | "feast", number> = {
      hook: 120,
      bite: 280,
      meal: 550,
      feast: 800,
    };

    let target = Math.floor(baseTargets[strategy] * multiplier);
    target = Math.min(target, Breath.ABSOLUTE_MAX);
    target = Math.max(target, Breath.MIN_LENGTH);

    return {
      maxChars: Breath.ABSOLUTE_MAX,
      targetChars: target,
      strategy,
      why: `stage=${stage}, attention=${attention}, intent=${intent}, msgCount=${msgCount}, silence=${minutesSinceLastStudentMessage}m`,
    };
  }

  enforce(response: string, budget: BreathBudget): { text: string; wasTrimmed: boolean; continuation?: string } {
    if (!response || typeof response !== "string") {
      return { text: "I'm here. What would you like to talk about?", wasTrimmed: true };
    }

    if (response.length <= budget.maxChars) {
      return { text: response, wasTrimmed: false };
    }

    let cutIndex = response.lastIndexOf(". ", budget.targetChars);
    if (cutIndex === -1) cutIndex = response.lastIndexOf("! ", budget.targetChars);
    if (cutIndex === -1) cutIndex = response.lastIndexOf("? ", budget.targetChars);
    if (cutIndex === -1) cutIndex = response.lastIndexOf("\n", budget.targetChars);
    if (cutIndex === -1 || cutIndex < budget.targetChars * 0.5) {
      cutIndex = budget.targetChars;
    }

    const firstPart = response.slice(0, cutIndex + 1).trim();
    const rest = response.slice(cutIndex + 1).trim();

    if (rest.length > 80) {
      return {
        text: firstPart + " …",
        wasTrimmed: true,
        continuation: rest,
      };
    }

    return { text: firstPart, wasTrimmed: true };
  }
}
