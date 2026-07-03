import { ContextBundle } from "./types";
import { callLLM } from "../../llm/client";
import { logger } from "../../utils/logger";

export class Fire {
  async generateResponse(
    contextBundle: ContextBundle,
    systemPrompt: string,
    studentMessage: string  // ← ADDED
  ): Promise<string> {
    try {
      const messages = [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: `Student just said: "${studentMessage}"\n\nContext Bundle: ${JSON.stringify(contextBundle)}\n\nGenerate the best possible WhatsApp response. Plain text only. No JSON. No markdown headers.` 
        },
      ];

      const response = await callLLM({
        messages,
        agent: "fire",
        temperature: 0.7,
        max_tokens: 1100
      });

      return response.content || "";
    } catch (error: any) {
      logger.error("Fire generation failed", { error: error.message });
      return "Omo, network wahala — send that again when you can.";
    }
  }
}
