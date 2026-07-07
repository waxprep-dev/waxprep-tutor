/**
 * WaxPrep AI Brain — TypeScript CUGA Client
 * Connects YOUR message worker to the CUGA Python service
 */

import { AssembledContext, SessionTurn, RetrievedMemory } from './memory/types/memory.js';

// NEW IMPORTS — Add at the top of cugaClient.ts
import { promptEngine } from './prompt-engine/engine.js';
import { intentClassifier } from './intent/classifier.js';
import { emotionalIntelligence } from './emotional/intelligence.js';
import { multiAgentOrchestrator } from './orchestration/multi-agent.js';
import { toolSystem } from './tools/index.js';
import { EmbeddingService } from './utils/embedder.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

interface CugaConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

interface TutorRequest {
  message: string;
  user_id: string;
  context: Record<string, any>;
  mode: 'fast' | 'balanced' | 'accurate';
}

interface TutorResponse {
  answer: string;
  agent_used: string;
  tools_used: string[];
  confidence: number;
  mode: string;
  tokens_used: {
    prompt: number;
    completion: number;
  };
  routing?: {
    detected_subject: string;
    agent_name: string;
  };
  emotional_state: {
    valence: number;
    arousal: number;
    dominance: number;
    category: string;
    confidence: number;
  };
  intent: {
    primary_intent: string;
    confidence: number;
    distribution: Record<string, number>;
  };
  latency_ms: number;
}

// ═══════════════════════════════════════════════════════════════
// CUGA CLIENT
// ═══════════════════════════════════════════════════════════════

export class CugaClient {
  private config: CugaConfig;

  constructor(config: Partial<CugaConfig> = {}) {
    this.config = {
      baseUrl: process.env.CUGA_SERVICE_URL || 'http://localhost:8000',
      apiKey: process.env.CUGA_API_KEY || '',
      timeoutMs: 30000,
      ...config,
    };
  }

  /**
   * Main tutoring call — replaces processWithAI() in messageWorker.ts
   */
  async tutor(
    message: string,
    userId: string,
    context: AssembledContext,
    mode: 'fast' | 'balanced' | 'accurate' = 'balanced'
  ): Promise<TutorResponse> {
    const request: TutorRequest = {
      message,
      user_id: userId,
      context: this.serializeContext(context),
      mode,
    };

    const response = await fetch(`${this.config.baseUrl}/tutor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new CugaError(`CUGA tutor error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Streaming tutor call — for real-time token delivery
   */
  async *tutorStream(
    message: string,
    userId: string,
    context: AssembledContext,
    mode: 'fast' | 'balanced' | 'accurate' = 'balanced'
  ): AsyncGenerator<string, void, unknown> {
    const request: TutorRequest = {
      message,
      user_id: userId,
      context: this.serializeContext(context),
      mode,
    };

    const response = await fetch(`${this.config.baseUrl}/tutor/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new CugaError(`CUGA stream error (${response.status}): ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new CugaError('No response body for stream');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;
            if (data) yield data;
          }
        }
      }

      // Process remaining buffer
      if (buffer.startsWith('data: ')) {
        const data = buffer.slice(6).trim();
        if (data && data !== '[DONE]') yield data;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; version: string; services: any }> {
    const response = await fetch(`${this.config.baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new CugaError('Health check failed');
    }

    return response.json();
  }

  /**
   * List available tutoring agents
   */
  async listAgents(): Promise<Record<string, { name: string; description: string; specialties: string[] }>> {
    const response = await fetch(`${this.config.baseUrl}/agents`, {
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new CugaError('Failed to list agents');
    }

    const data = await response.json();
    return data.agents;
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  private serializeContext(context: AssembledContext): Record<string, any> {
    return {
      userProfile: context.userProfile,
      recentTurns: context.recentTurns.slice(-10).map((turn: SessionTurn) => ({
        role: turn.role,
        content: turn.content,
        timestamp: turn.timestamp,
      })),
      retrievedMemories: context.retrievedMemories.map((mem: RetrievedMemory) => ({
        content: mem.content,
        type: mem.type,
        similarity: mem.similarity,
      })),
      activeTask: context.activeTask,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// CUSTOM ERROR CLASS
// ═══════════════════════════════════════════════════════════════

export class CugaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CugaError';
  }
}

// ═══════════════════════════════════════════════════════════════
// COMPLEXITY ANALYSIS (Mathematical — No Hardcoded Rules)
// ═══════════════════════════════════════════════════════════════

export function analyzeComplexity(message: string): number {
  let score = 0;
  const lower = message.toLowerCase();

  // Length factor (longer messages tend to be more complex)
  score += Math.min(message.length / 500, 0.3);

  // Mathematical notation detection
  const mathPatterns = [
    { pattern: /[\^\√∫∑∏∂∇πθ]/g, weight: 0.15 },
    { pattern: /[xXyZ][\s]*[=+\-]/g, weight: 0.15 },
    { pattern: /\d+\s*[+\-×÷*/=]/g, weight: 0.1 },
    { pattern: /(solve|prove|derive|integrate|differentiate|calculate|find the)/gi, weight: 0.12 },
    { pattern: /(quadratic|calculus|derivative|integral|theorem|formula|equation)/gi, weight: 0.12 },
  ];

  for (const { pattern, weight } of mathPatterns) {
    const matches = lower.match(pattern);
    if (matches) score += weight * Math.min(matches.length, 2);
  }

  // Multi-step indicators
  const stepPatterns = [
    { pattern: /(step|first|then|next|finally|after that)/gi, weight: 0.08 },
    { pattern: /(how do|show me|explain|why is|what if)/gi, weight: 0.05 },
  ];

  for (const { pattern, weight } of stepPatterns) {
    if (pattern.test(lower)) score += weight;
  }

  // Vocabulary sophistication (words > 8 characters)
  const longWords = message.split(/\s+/).filter(w => w.length > 8);
  score += Math.min(longWords.length * 0.03, 0.15);

  return Math.min(score, 1.0);
}

export function determineReasoningMode(message: string): 'fast' | 'balanced' | 'accurate' {
  const complexity = analyzeComplexity(message);

  if (complexity < 0.25) return 'fast';       // Simple: greeting, FAQ
  if (complexity > 0.65) return 'accurate';   // Complex: proofs, derivations
  return 'balanced';                           // Default
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP FORMATTER
// ═══════════════════════════════════════════════════════════════

export function formatForWhatsApp(text: string): string {
  let formatted = text;

  // Convert markdown bold to WhatsApp bold
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Convert markdown italic to WhatsApp italic
  formatted = formatted.replace(/__(.+?)__/g, '_$1_');

  // Convert markdown code to WhatsApp code
  formatted = formatted.replace(/`(.+?)`/g, '```$1```');

  // Limit length for WhatsApp (4096 char limit)
  if (formatted.length > 4000) {
    formatted = formatted.substring(0, 4000) +
      '\n\n_...[Reply "more" to continue]_';
  }

  // Ensure no double newlines that waste space on mobile
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

  return formatted;
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

export const cugaClient = new CugaClient();
EOF
