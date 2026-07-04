import { callLLM } from "../../llm/client";
import { Perception, ContextBundle } from "../types";
import { logger } from "../../utils/logger";

export class River {
  private maxRetries = 2;

  async buildContext(
    perception: Perception,
    studentProfile: any,
    availableMemory: any,
    systemPrompt: string
  ): Promise<ContextBundle> {
    try {
      const messages = [
        { role: "system" as const, content: systemPrompt },
        {
          role: "user" as const,
          content: `Perception: ${JSON.stringify(perception)}\nProfile: ${JSON.stringify(studentProfile)}\nMemory: ${JSON.stringify(availableMemory)}\n\nBuild context bundle as JSON.`
        }
      ];

      const response = await this.callWithRetry(messages);
      return this.parseContext(response);
    } catch (error: any) {
      logger.error("River buildContext failed", { error: error.message });
      return this.getDefaultContextBundle();
    }
  }

  private async callWithRetry(messages: any[]): Promise<string> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const res = await callLLM({
          messages,
          temperature: 0.2,
          max_tokens: 800, // Increased from default
          agent: "river"
        });
        return res.content || "";
      } catch (e) {
        if (i === this.maxRetries - 1) throw e;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    return "";
  }

  private parseContext(raw: string): ContextBundle {
    try {
      let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      
      // Try to fix truncated JSON
      if (!this.isValidJSON(cleaned)) {
        const lastBrace = cleaned.lastIndexOf('}');
        if (lastBrace > 0) {
          const partial = cleaned.substring(0, lastBrace + 1);
          if (this.isValidJSON(partial)) {
            return JSON.parse(partial);
          }
        }
        // Try adding closing braces
        let attempt = cleaned;
        let openBraces = (cleaned.match(/{/g) || []).length;
        let closeBraces = (cleaned.match(/}/g) || []).length;
        let missing = openBraces - closeBraces;
        for (let i = 0; i < missing; i++) {
          attempt += '}';
        }
        if (this.isValidJSON(attempt)) {
          return JSON.parse(attempt);
        }
        throw new Error("Could not parse JSON after recovery");
      }
      
      return JSON.parse(cleaned);
    } catch (e: any) {
      logger.error("River parse error", { error: e.message, raw: raw.slice(0, 200) });
      return this.getDefaultContextBundle();
    }
  }

  private isValidJSON(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  private getDefaultContextBundle(): ContextBundle {
    return {
      student_profile: { name: "Student", origin: "Unknown", teaching_signature: "NEW", current_mood: "neutral", last_topic: "none", last_mood: "neutral" },
      relevant_memories: { past_conversations: [], concepts_known: [], concepts_struggling: [], misconceptions: [], procedural_rules: [], relational_notes: [] },
      contextual_examples: { recommended_analogy: "danfo bus", alternative_analogies: [], cultural_bridge: "Nigerian context", previous_successful_approach: "none" },
      teaching_recommendations: { suggested_topic: "introduction", suggested_depth: "surface", suggested_pace: "medium", suggested_tone: "gentle", avoid: [], emphasize: [] },
      conversation_state: { current_flow_state: "connection", recommended_next_state: "discovery", message_count_this_episode: 0, time_since_last_message: "unknown" },
      retrieval_actions: { tools_to_call: [], data_to_save: [] }
    };
  }
}
