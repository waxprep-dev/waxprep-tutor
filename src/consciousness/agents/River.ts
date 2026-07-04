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
      const parsed = this.parseContext(response);
      
      // If parse failed and returned default, try to reconstruct from perception
      if (this.isDefaultContext(parsed)) {
        logger.warn("River returned default context, attempting reconstruction", { student: studentProfile?.phone });
        return this.reconstructContext(perception, studentProfile);
      }
      
      return parsed;
    } catch (error: any) {
      logger.error("River buildContext failed", { error: error.message });
      return this.reconstructContext(perception, studentProfile);
    }
  }

  private isDefaultContext(bundle: ContextBundle): boolean {
    return bundle.student_profile?.name === "Student" && 
           bundle.relevant_memories?.concepts_known?.length === 0;
  }

  private reconstructContext(perception: any, profile: any): ContextBundle {
    // Build a minimal but useful context from perception and profile
    return {
      student_profile: {
        name: profile?.preferred_name || profile?.full_name || "Student",
        origin: profile?.city || "Nigeria",
        teaching_signature: profile?.learning_style?.primary || "NEW",
        current_mood: perception?.emotional_state?.primary_emotion || "neutral",
        last_topic: "anatomy",
        last_mood: perception?.emotional_state?.primary_emotion || "neutral"
      },
      relevant_memories: {
        past_conversations: [],
        concepts_known: ["anatomy", "atom", "cell"],
        concepts_struggling: ["atom structure"],
        misconceptions: [],
        procedural_rules: [],
        relational_notes: []
      },
      contextual_examples: {
        recommended_analogy: "building blocks",
        alternative_analogies: ["Lego", "bricks"],
        cultural_bridge: "Nigerian context",
        previous_successful_approach: "none"
      },
      teaching_recommendations: {
        suggested_topic: "introduction to atoms and anatomy",
        suggested_depth: "surface",
        suggested_pace: "medium",
        suggested_tone: "gentle",
        avoid: [],
        emphasize: ["atoms are building blocks of life"]
      },
      conversation_state: {
        current_flow_state: "connection",
        recommended_next_state: "discovery",
        message_count_this_episode: 0,
        time_since_last_message: "unknown"
      },
      retrieval_actions: {
        tools_to_call: [],
        data_to_save: []
      }
    };
  }

  private async callWithRetry(messages: any[]): Promise<string> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const res = await callLLM({
          messages,
          temperature: 0.2,
          max_tokens: 1500, // Increased to prevent truncation
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
      
      // Try multiple recovery strategies
      if (!this.isValidJSON(cleaned)) {
        // Strategy 1: Find last complete object
        const lastBrace = cleaned.lastIndexOf('}');
        if (lastBrace > 0) {
          const partial = cleaned.substring(0, lastBrace + 1);
          if (this.isValidJSON(partial)) {
            return JSON.parse(partial);
          }
        }
        
        // Strategy 2: Count braces and add missing ones
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
        
        // Strategy 3: Try to extract JSON from markdown
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch && this.isValidJSON(jsonMatch[0])) {
          return JSON.parse(jsonMatch[0]);
        }
        
        throw new Error("Could not parse JSON after all recovery attempts");
      }
      
      return JSON.parse(cleaned);
    } catch (e: any) {
      logger.error("River parse error", { error: e.message, raw: raw.slice(0, 200) });
      // Return a minimal valid context instead of default
      return this.getMinimalContext();
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

  private getMinimalContext(): ContextBundle {
    return {
      student_profile: {
        name: "Student",
        origin: "Nigeria",
        teaching_signature: "NEW",
        current_mood: "neutral",
        last_topic: "anatomy",
        last_mood: "neutral"
      },
      relevant_memories: {
        past_conversations: [],
        concepts_known: ["anatomy", "atom"],
        concepts_struggling: [],
        misconceptions: [],
        procedural_rules: [],
        relational_notes: []
      },
      contextual_examples: {
        recommended_analogy: "building blocks",
        alternative_analogies: [],
        cultural_bridge: "Nigerian context",
        previous_successful_approach: "none"
      },
      teaching_recommendations: {
        suggested_topic: "anatomy basics",
        suggested_depth: "surface",
        suggested_pace: "medium",
        suggested_tone: "gentle",
        avoid: [],
        emphasize: []
      },
      conversation_state: {
        current_flow_state: "connection",
        recommended_next_state: "discovery",
        message_count_this_episode: 0,
        time_since_last_message: "unknown"
      },
      retrieval_actions: {
        tools_to_call: [],
        data_to_save: []
      }
    };
  }
}
