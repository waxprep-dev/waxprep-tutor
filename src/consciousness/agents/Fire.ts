// FILE: src/consciousness/agents/Fire.ts
// =====================================================

import { callLLM } from "../../llm/client";
import { ContextBundle, AgentConfig } from "../types";

export class Fire {
  private config: AgentConfig = {
    modelTier: "best",
    maxTokens: 1500,
    temperature: 0.7,
    retryAttempts: 3,
  };

  async generateResponse(
    contextBundle: ContextBundle,
    systemPrompt: string
  ): Promise<string> {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Context Bundle: ${JSON.stringify(contextBundle)}\n\nGenerate the best possible WhatsApp response. Plain text only. No JSON. No markdown headers.` },
    ];

    const response = await this.callWithRetry(messages);
    return this.cleanResponse(response);
  }

  private async callWithRetry(messages: any[]): Promise<string> {
    for (let i = 0; i < this.config.retryAttempts; i++) {
      try {
        return await callLLM(messages, this.config.modelTier);
      } catch (e) {
        if (i === this.config.retryAttempts - 1) throw e;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    throw new Error("Fire failed after retries");
  }

  private cleanResponse(raw: string): string {
    let cleaned = raw;
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, "");
    cleaned = cleaned.replace(/\*\*/g, "*");
    cleaned = cleaned.replace(/`/g, "");
    cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
    cleaned = cleaned.replace(/\$\$?[\s\S]*?\$\$?/g, "");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
    return cleaned;
  }
}

// =====================================================
