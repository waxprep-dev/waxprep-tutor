import { callLLM } from "../../llm/client";
import { logger } from "../../utils/logger";

export class Archivist {
  async evolve(
    reflection: any,
    currentSignature: any,
    currentMemory: any,
    systemPrompt: string
  ): Promise<any> {
    try {
      const messages = [
        { role: "system" as const, content: systemPrompt || "You are the Archivist. Update memory based on reflection. Output JSON." },
        {
          role: "user",
          content: `Reflection: ${JSON.stringify(reflection)}`
        }
      ];

      const response = await callLLM({
        messages,
        temperature: 0.1,
        max_tokens: 800,  // Increased from default
        agent: "archivist"
      });

      return this.parseOutput(response.content || "");
    } catch (error: any) {
      logger.error("Archivist evolution failed", { error: error.message });
      return this.getDefaultOutput();
    }
  }

  private parseOutput(raw: string): any {
    try {
      let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      
      if (!this.isValidJSON(cleaned)) {
        const lastBrace = cleaned.lastIndexOf('}');
        if (lastBrace > 0) {
          const partial = cleaned.substring(0, lastBrace + 1);
          if (this.isValidJSON(partial)) {
            return JSON.parse(partial);
          }
        }
        let attempt = cleaned;
        let braceCount = (cleaned.match(/{/g) || []).length - (cleaned.match(/}/g) || []).length;
        for (let i = 0; i < braceCount; i++) {
          attempt += '}';
        }
        if (this.isValidJSON(attempt)) {
          return JSON.parse(attempt);
        }
        throw new Error("Could not parse JSON after recovery attempts");
      }
      
      return JSON.parse(cleaned);
    } catch (e: any) {
      logger.error("Archivist parse error", { error: e.message, raw: raw.slice(0, 200) });
      return this.getDefaultOutput();
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

  private getDefaultOutput(): any {
    return {
      memory_updates: [],
      signature_evolution: { changes_made: [] },
      new_patterns: [],
      alerts: []
    };
  }
}
