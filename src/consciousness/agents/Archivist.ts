// FILE: src/consciousness/agents/Archivist.ts
// =====================================================

import { callLLM } from "../../llm/client";
import { ArchivistOutput, Reflection, AgentConfig } from "../types";

export class Archivist {
  private config: AgentConfig = {
    modelTier: "fast",
    maxTokens: 2000,
    temperature: 0.1,
    retryAttempts: 2,
  };

  async evolve(
    reflection: Reflection,
    currentSignature: any,
    currentMemory: any,
    systemPrompt: string
  ): Promise<ArchivistOutput> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Reflection: ${JSON.stringify(reflection)}\n\nCurrent Signature: ${JSON.stringify(currentSignature)}\n\nCurrent Memory: ${JSON.stringify(currentMemory)}\n\nGenerate evolution output as JSON only.` },
    ];

    const response = await this.callWithRetry(messages);
    return this.parseOutput(response);
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
    throw new Error("Archivist failed after retries");
  }

  private parseOutput(raw: string): ArchivistOutput {
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("Archivist parse error:", e);
      return {
        memory_updates: [],
        signature_evolution: { changes_made: [], new_patterns_detected: [], system_learning: { what_the_system_learned: "", what_to_try_next: "", what_to_avoid: "" } },
        new_patterns: [],
        procedural_rules: [],
        alerts: [],
      };
    }
  }
}

// =====================================================
