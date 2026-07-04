// FILE: src/consciousness/agents/Resonance.ts
// =====================================================
// The Resonance — Spiritual Attractor of TheVoid
// "When the student drifts, do not pull. Vibrate at their frequency."
// =====================================================

import { Perception, ContextBundle } from "../types";

export interface ResonancePulse {
  shouldInject: boolean;
  suggestion: string;
  tone: "warmer" | "playful" | "deeper" | "silent";
  reason: string;
}

export class Resonance {
  detect(
    studentNextMessage: string | null,
    perception: Perception,
    contextBundle: ContextBundle
  ): ResonancePulse {
    if (!studentNextMessage) {
      return {
        shouldInject: true,
        suggestion: "Send a warm, low-pressure check-in. One sentence. A question about their day, not their studies.",
        tone: "warmer",
        reason: "Student ghosted — no reply to last message",
      };
    }

    const msg = studentNextMessage.toLowerCase().trim();
    const deathWords = ["ok", "nice", "cool", "alright", "k", "kk", "okay", "hmm", "wow", "true"];
    const engagement = perception.cognitive_state?.engagement_level || "medium";

    if (deathWords.includes(msg)) {
      return {
        shouldInject: true,
        suggestion: "Do not continue the lesson. Pivot completely. Ask about their favorite musician, their worst teacher, or what they ate today. Rebuild the pulse.",
        tone: "playful",
        reason: "Student used a conversational death word",
      };
    }

    if (msg.length < 15 && engagement === "low") {
      return {
        shouldInject: true,
        suggestion: "Acknowledge the short reply with warmth. Ask something absurdly easy to answer — 'Rice or beans?' — then bridge back to topic.",
        tone: "warmer",
        reason: "Short reply + low engagement",
      };
    }

    if (engagement === "high" && msg.length > 50) {
      return {
        shouldInject: false,
        suggestion: "",
        tone: "silent",
        reason: "Student is flowing. Do not interrupt.",
      };
    }

    return {
      shouldInject: false,
      suggestion: "",
      tone: "silent",
      reason: "No drift detected",
    };
  }
}
