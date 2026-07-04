import { callLLM } from "../../llm/client";
import { logger } from "../../utils/logger";

export class Witness {
  async reflect(
    studentMessage: string,
    perception: any,
    contextBundle: any,
    fireResponse: string,
    studentNextMessage: string | null,
    systemPrompt: string
  ): Promise<any> {
    try {
      const messages = [
        { role: "system" as const, content: systemPrompt || "You are the Witness. Reflect on this interaction. Output JSON." },
        {
          role: "user" as const,
          content: `Student: "${studentMessage}"\nWax: "${fireResponse}"\nReply: "${studentNextMessage || 'N/A'}"`
        }
      ];

      const response = await callLLM({
        messages,
        temperature: 0.2,
        max_tokens: 800,
        agent: "witness"
      });

      return this.parseReflection(response.content || "");
    } catch (error: any) {
      logger.error("Witness reflection failed", { error: error.message });
      return this.getDefaultReflection();
    }
  }

  private parseReflection(raw: string): any {
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
      logger.error("Witness parse error", { error: e.message, raw: raw.slice(0, 200) });
      return this.getDefaultReflection();
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

  private getDefaultReflection(): any {
    return {
      what_worked: [],
      what_failed: [],
      missed_opportunities: [],
      pattern_detected: null
    };
  }
}
