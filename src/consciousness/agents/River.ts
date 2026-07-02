// FILE: src/consciousness/agents/River.ts
// =====================================================

import { callLLM } from "../../llm/client";
import { ContextBundle, Perception, AgentConfig } from "../types";

export class River {
  private config: AgentConfig = {
    modelTier: "capable",
    maxTokens: 3000,
    temperature: 0.2,
    retryAttempts: 2,
  };

  async buildContext(
    perception: Perception,
    studentProfile: any,
    availableMemory: any,
    systemPrompt: string
  ): Promise<ContextBundle> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Perception: ${JSON.stringify(perception)}\n\nStudent Profile: ${JSON.stringify(studentProfile)}\n\nAvailable Memory: ${JSON.stringify(availableMemory)}\n\nBuild context bundle as JSON only.` },
    ];

    const response = await this.callWithRetry(messages);
    return this.parseContext(response);
  }

  private async callWithRetry(messages: any[]): Promise<string> {
    for (let i = 0; i < this.config.retryAttempts; i++) {
      try {
        const res = await callLLM({ messages, tools: [], tool_choice: "auto", temperature: 0.3, max_tokens: 500 }); return res.content || "";
      } catch (e) {
        if (i === this.config.retryAttempts - 1) throw e;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    throw new Error("River failed after retries");
  }

  private parseContext(raw: string): ContextBundle {
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("River parse error:", e);
      return this.getDefaultContext();
    }
  }

  private getDefaultContext(): ContextBundle {
    return {
      student_profile: { name: "Student", origin: "Unknown", teaching_signature: "NEW", current_mood: "neutral", last_topic: "none", last_mood: "neutral" },
      relevant_memories: { past_conversations: [], concepts_known: [], concepts_struggling: [], misconceptions: [], procedural_rules: [], relational_notes: [] },
      contextual_examples: { recommended_analogy: "danfo bus", alternative_analogies: [], cultural_bridge: "Nigerian context", previous_successful_approach: "none" },
      teaching_recommendations: { suggested_topic: "introduction", suggested_depth: "surface", suggested_pace: "medium", suggested_tone: "gentle", avoid: [], emphasize: [] },
      conversation_state: { current_flow_state: "connection", recommended_next_state: "discovery", message_count_this_episode: 0, time_since_last_message: "unknown" },
      retrieval_actions: { tools_to_call: [], data_to_save: [] },
    };
  }
}

// =====================================================
