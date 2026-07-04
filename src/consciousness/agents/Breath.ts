// FILE: src/consciousness/agents/Breath.ts
// =====================================================
// The Breath — Pacing Oracle of TheVoid
// "Fire without Breath becomes a wildfire."
// One hardcoded law: ABSOLUTE_MAX = 900 characters.
// Everything else is alive: calculated from the student's
// attention span, relationship stage, intent, and silence.
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
    let strategy: BreathBudget["strategy"] = "bite";
    let multiplier = 1.0;

    const stage = perception.social_context?.relationship_stage || "stranger";
    const attention = perception.cognitive_state?.attention_span_estimate || "medium";
    const intent = perception.intent?.primary || "other";
    const msgCount = contextBundle.conversation_state?.message_count_this_episode || 0;
    const vulnerabilityDetected = perception.emotional_state?.vulnerability_detected || false;
    const shameDetected = perception.emotional_state?.shame_detected || false;

    // Relationship stage
    if (stage === "stranger") multiplier *= 0.6;
    else if (stage === "acquaintance") multiplier *= 0.8;
    else if (stage === "close") multiplier *= 1.15;

    // Attention span
    if (attention === "short") multiplier *= 0.5;
    else if (attention === "long") multiplier *= 1.2;

    // Silence detection
    if (minutesSinceLastStudentMessage > 8) {
      strategy = "hook";
      multiplier = 0.35;
    } else if (minutesSinceLastStudentMessage > 3) {
      multiplier *= 0.7;
    }

    // Intent-based strategy
    if (intent === "greeting" || intent === "small_talk" || intent === "casual_chat") {
      strategy = "hook";
      multiplier *= 0.5;
    } else if (intent === "deep_explanation" || intent === "study_plan" || intent === "teaching_request") {
      strategy = "meal";
      multiplier *= 1.3;
    } else if (intent === "emotional_expression") {
      strategy = "bite";
      multiplier *= 0.8;
    } else if (intent === "complaint" || intent === "crisis") {
      strategy = "bite";
      multiplier *= 0.7;
    }

    // Vulnerability and shame - use direct assignment to avoid type narrowing issues
    if (vulnerabilityDetected || shameDetected) {
      if (strategy === "feast") {
        strategy = "meal";
      } else if (strategy === "meal") {
        strategy = "bite";
      }
      multiplier *= 0.7;
    }

    // Early conversation
    if (msgCount < 3) {
      multiplier *= 0.55;
      if (strategy === "meal") {
        strategy = "bite";
      } else if (strategy === "feast") {
        strategy = "meal";
      }
    }

    // Risk flags
    if (perception.risk_flags?.suicidal_ideation ||
        perception.risk_flags?.self_harm ||
        perception.risk_flags?.extreme_distress) {
      strategy = "bite";
      multiplier *= 0.6;
    }

    // Map strategy to target using a simple switch for type safety
    let baseTarget = 280; // default bite
    switch (strategy) {
      case "hook":
        baseTarget = 120;
        break;
      case "bite":
        baseTarget = 280;
        break;
      case "meal":
        baseTarget = 550;
        break;
      case "feast":
        baseTarget = 800;
        break;
    }

    let target = Math.floor(baseTarget * multiplier);
    target = Math.min(target, Breath.ABSOLUTE_MAX);
    target = Math.max(target, Breath.MIN_LENGTH);

    return {
      maxChars: Breath.ABSOLUTE_MAX,
      targetChars: target,
      strategy: strategy,
      why: `stage=${stage}, attention=${attention}, intent=${intent}, msgCount=${msgCount}, silence=${minutesSinceLastStudentMessage}m, vulnerability=${vulnerabilityDetected}, shame=${shameDetected}`,
    };
  }

  enforce(response: string, budget: BreathBudget): { text: string; wasTrimmed: boolean; continuation?: string } {
    if (response.length <= budget.maxChars) {
      return { text: response, wasTrimmed: false };
    }

    let cutIndex = response.lastIndexOf(". ", budget.targetChars);
    if (cutIndex === -1) cutIndex = response.lastIndexOf("! ", budget.targetChars);
    if (cutIndex === -1) cutIndex = response.lastIndexOf("? ", budget.targetChars);
    if (cutIndex === -1) cutIndex = response.lastIndexOf("\n", budget.targetChars);
    if (cutIndex === -1) cutIndex = budget.targetChars;

    const firstPart = response.slice(0, cutIndex + 1).trim();
    const rest = response.slice(cutIndex + 1).trim();

    if (rest.length > 80) {
      return {
        text: firstPart,
        wasTrimmed: true,
        continuation: rest,
      };
    }

    return { text: firstPart, wasTrimmed: true };
  }
}
