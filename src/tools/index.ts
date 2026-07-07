/**
 * WaxPrep Tool System v3.0
 * Mathematical Tool Selection & Execution Framework
 */

import { EmbeddingService } from '../utils/embedder.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
  embedding?: number[];
  activationThreshold: number;
}

interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  description: string;
  required: boolean;
  enum?: string[];
}

interface ToolContext {
  userId: string;
  userProfile: Record<string, unknown>;
  conversationHistory: Array<{ role: string; content: string }>;
  intent: string;
  subject?: string;
}

export interface ToolResult {
  success: boolean;
  data: unknown;
  toolName: string;
  latencyMs: number;
  error?: string;
}

const webSearchTool: ToolDefinition = {
  name: 'web_search',
  activationThreshold: 0.4,
  description: `Search the internet for current information, facts, definitions. Use for current events, recent discoveries, facts that might have changed.`,
  parameters: [
    { name: 'query', type: 'string', description: 'The search query', required: true },
    { name: 'num_results', type: 'number', description: 'Number of results (1-5)', required: false },
  ],
  execute: async (params, _context) => {
    const startTime = Date.now();
    try {
      const apiKey = process.env.SERPER_API_KEY || process.env.BING_API_KEY;
      if (!apiKey) {
        return { success: false, toolName: 'web_search', data: null, latencyMs: Date.now() - startTime, error: 'Search API key not configured' };
      }

      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: params.query, num: params.num_results || 3 }),
      });

      if (!response.ok) throw new Error(`Search API error: ${response.status}`);

      const data = await response.json() as { organic?: Array<{ title: string; snippet: string; link: string }>; answerBox?: unknown };

      return {
        success: true,
        toolName: 'web_search',
        latencyMs: Date.now() - startTime,
        data: {
          query: params.query,
          results: (data.organic || []).map(r => ({ title: r.title, snippet: r.snippet, url: r.link })),
          answerBox: data.answerBox || null,
        },
      };
    } catch (error) {
      return { success: false, toolName: 'web_search', data: null, latencyMs: Date.now() - startTime, error: error instanceof Error ? error.message : 'Search failed' };
    }
  },
};

const calculatorTool: ToolDefinition = {
  name: 'calculator',
  activationThreshold: 0.35,
  description: `Perform mathematical calculations, solve equations. Use for numerical calculations, checking answers, unit conversions.`,
  parameters: [
    { name: 'expression', type: 'string', description: 'Math expression', required: true },
    { name: 'show_steps', type: 'boolean', description: 'Show step-by-step', required: false },
  ],
  execute: async (params, _context) => {
    const startTime = Date.now();
    try {
      const expression = String(params.expression);
      const sanitized = expression
        .replace(/[^0-9+\-*/().\s^√πe]/g, '')
        .replace(/\^/g, '**')
        .replace(/√/g, 'Math.sqrt')
        .replace(/π/g, 'Math.PI');

      let result: number;
      try {
        result = Function(`"use strict"; return (${sanitized})`)();
      } catch {
        result = NaN;
      }

      return {
        success: true,
        toolName: 'calculator',
        latencyMs: Date.now() - startTime,
        data: { expression, result: isNaN(result) ? 'Could not evaluate' : result, showSteps: params.show_steps || false },
      };
    } catch (error) {
      return { success: false, toolName: 'calculator', data: null, latencyMs: Date.now() - startTime, error: error instanceof Error ? error.message : 'Calculation failed' };
    }
  },
};

const memoryRetrieveTool: ToolDefinition = {
  name: 'memory_retrieve',
  activationThreshold: 0.3,
  description: `Search student personal learning memory for past conversations, learned concepts, known weaknesses.`,
  parameters: [
    { name: 'query', type: 'string', description: 'What to search for', required: true },
    { name: 'limit', type: 'number', description: 'Max memories to retrieve', required: false },
  ],
  execute: async (params, context) => {
    const startTime = Date.now();
    try {
      const memoryApiUrl = process.env.MEMORY_API_URL || 'http://localhost:3000';
      const response = await fetch(`${memoryApiUrl}/memory/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: context.userId, query: params.query, limit: params.limit || 5 }),
      });

      if (!response.ok) throw new Error(`Memory API error: ${response.status}`);
      const data = await response.json() as { memories?: unknown[]; userProfile?: unknown; count?: number };

      return { success: true, toolName: 'memory_retrieve', latencyMs: Date.now() - startTime, data: { memories: data.memories || [], userProfile: data.userProfile || {}, count: data.count || 0 } };
    } catch (error) {
      return { success: false, toolName: 'memory_retrieve', data: null, latencyMs: Date.now() - startTime, error: error instanceof Error ? error.message : 'Memory retrieval failed' };
    }
  },
};

const memoryStoreTool: ToolDefinition = {
  name: 'memory_store',
  activationThreshold: 0.25,
  description: `Save important learning moments, student preferences, or new information to long-term memory.`,
  parameters: [
    { name: 'category', type: 'enum', description: 'Type of memory', required: true, enum: ['skill', 'preference', 'goal', 'knowledge', 'behavior', 'weakness', 'strength'] },
    { name: 'content', type: 'string', description: 'What to remember', required: true },
    { name: 'confidence', type: 'number', description: 'Confidence (0-1)', required: false },
  ],
  execute: async (params, context) => {
    const startTime = Date.now();
    try {
      const memoryApiUrl = process.env.MEMORY_API_URL || 'http://localhost:3000';
      const response = await fetch(`${memoryApiUrl}/memory/fact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: context.userId, category: params.category, key: `auto_${Date.now()}`, value: params.content, content: params.content, confidence: params.confidence || 0.8 }),
      });

      if (!response.ok) throw new Error(`Memory store API error: ${response.status}`);
      return { success: true, toolName: 'memory_store', latencyMs: Date.now() - startTime, data: { stored: true, category: String(params.category) } };
    } catch (error) {
      return { success: false, toolName: 'memory_store', data: null, latencyMs: Date.now() - startTime, error: error instanceof Error ? error.message : 'Memory storage failed' };
    }
  },
};

const curriculumLookupTool: ToolDefinition = {
  name: 'curriculum_lookup',
  activationThreshold: 0.35,
  description: `Look up Nigerian curriculum standards for WAEC, NECO, JAMB.`,
  parameters: [
    { name: 'subject', type: 'string', description: 'Subject name', required: true },
    { name: 'topic', type: 'string', description: 'Topic', required: true },
    { name: 'exam_type', type: 'enum', description: 'Target exam', required: false, enum: ['WAEC', 'NECO', 'JAMB', 'Junior WAEC'] },
  ],
  execute: async (params, _context) => {
    const startTime = Date.now();
    const curriculumData = getCurriculumData(String(params.subject), String(params.topic), params.exam_type as string | undefined);
    return { success: true, toolName: 'curriculum_lookup', latencyMs: Date.now() - startTime, data: curriculumData };
  },
};

const practiceGeneratorTool: ToolDefinition = {
  name: 'practice_generator',
  activationThreshold: 0.4,
  description: `Generate practice questions at appropriate difficulty.`,
  parameters: [
    { name: 'topic', type: 'string', description: 'Topic', required: true },
    { name: 'difficulty', type: 'enum', description: 'Difficulty', required: false, enum: ['easy', 'medium', 'hard', 'adaptive'] },
    { name: 'count', type: 'number', description: 'Number of questions', required: false },
  ],
  execute: async (params, context) => {
    const startTime = Date.now();
    const userProfile = context.userProfile as Record<string, unknown>;
    const proficiency = (userProfile?.proficiency as Record<string, number>)?.[String(params.topic)] || 0.5;
    let difficulty = (params.difficulty as string) || 'adaptive';
    if (difficulty === 'adaptive') {
      difficulty = proficiency < 0.4 ? 'easy' : proficiency < 0.7 ? 'medium' : 'hard';
    }

    return {
      success: true,
      toolName: 'practice_generator',
      latencyMs: Date.now() - startTime,
      data: {
        topic: params.topic,
        difficulty,
        count: (params.count as number) || 3,
        instruction: `Generate ${params.count || 3} ${difficulty} questions about ${params.topic}.`,
      },
    };
  },
};

const currentTimeTool: ToolDefinition = {
  name: 'current_time',
  activationThreshold: 0.15,
  description: `Get current date and time.`,
  parameters: [],
  execute: async (_params, _context) => {
    const now = new Date();
    const nigeriaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));

    return {
      success: true,
      toolName: 'current_time',
      latencyMs: 0,
      data: {
        timestamp: now.toISOString(),
        nigeriaTime: nigeriaTime.toISOString(),
        nigeriaFormatted: nigeriaTime.toLocaleString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }),
        isLateNight: nigeriaTime.getHours() >= 23 || nigeriaTime.getHours() < 5,
        isStudyHours: nigeriaTime.getHours() >= 17 && nigeriaTime.getHours() <= 22,
      },
    };
  },
};

const ALL_TOOLS: ToolDefinition[] = [
  webSearchTool,
  calculatorTool,
  memoryRetrieveTool,
  memoryStoreTool,
  curriculumLookupTool,
  practiceGeneratorTool,
  currentTimeTool,
];

function getCurriculumData(subject: string, topic: string, examType?: string): Record<string, unknown> {
  const nigerianSubjects: Record<string, { waecTopics: string[]; commonQuestions: string[]; markingFocus: string }> = {
    'mathematics': { waecTopics: ['Algebra', 'Geometry', 'Trigonometry', 'Calculus', 'Statistics'], commonQuestions: ['Simultaneous equations', 'Circle theorem', 'Differentiation'], markingFocus: 'Show all working' },
    'english': { waecTopics: ['Comprehension', 'Summary', 'Essay Writing'], commonQuestions: ['Letter writing', 'Comprehension passages'], markingFocus: 'Clarity and grammar' },
    'physics': { waecTopics: ['Mechanics', 'Heat', 'Waves', 'Electricity'], commonQuestions: ['Projectile motion', "Ohm's law"], markingFocus: 'Correct formulas and units' },
    'chemistry': { waecTopics: ['Organic', 'Inorganic', 'Physical Chemistry'], commonQuestions: ['Stoichiometry', 'Organic reactions'], markingFocus: 'Balanced equations' },
    'biology': { waecTopics: ['Ecology', 'Genetics', 'Anatomy'], commonQuestions: ['Genetics problems', 'Ecological terms'], markingFocus: 'Correct terminology' },
  };

  const subjectData = nigerianSubjects[subject.toLowerCase()] || { waecTopics: ['General'], commonQuestions: ['Various'], markingFocus: 'Clear responses' };

  return {
    subject,
    topic,
    examType: examType || 'WAEC/NECO',
    ...subjectData,
    nigerianContext: true,
  };
}

export class ToolSystem {
  private static instance: ToolSystem;
  private embedder: EmbeddingService;
  private tools: ToolDefinition[];
  private initialized = false;

  private constructor(embedder: EmbeddingService) {
    this.embedder = embedder;
    this.tools = [...ALL_TOOLS];
  }

  static getInstance(embedder?: EmbeddingService): ToolSystem {
    if (!ToolSystem.instance) {
      if (!embedder) throw new Error('Embedder required');
      ToolSystem.instance = new ToolSystem(embedder);
    }
    return ToolSystem.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const tool of this.tools) {
      const embedding = await this.embedder.embed(tool.description);
      tool.embedding = embedding.embedding;
    }
    this.initialized = true;
  }

  async selectTools(query: string, context: { userId: string; userProfile: Record<string, unknown>; conversationHistory: Array<{ role: string; content: string }>; intent: string }): Promise<ToolDefinition[]> {
    if (!this.initialized) await this.initialize();
    const queryEmbedding = await this.embedder.embed(query);

    const scoredTools = this.tools
      .map(tool => ({
        tool,
        similarity: tool.embedding
          ? this.cosineSimilarity(queryEmbedding.embedding, tool.embedding)
          : 0,
      }))
      .filter(({ similarity, tool }) => similarity >= tool.activationThreshold)
      .sort((a, b) => b.similarity - a.similarity);

    return scoredTools.slice(0, 3).map(({ tool }) => tool);
  }

  async executeTool(toolName: string, params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      return { success: false, toolName, data: null, latencyMs: 0, error: `Tool not found: ${toolName}` };
    }
    return tool.execute(params, context);
  }

  getToolDefinitions(): Array<{ name: string; description: string; parameters: ToolParameter[] }> {
    return this.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return normA === 0 || normB === 0 ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

export const toolSystem = ToolSystem;
