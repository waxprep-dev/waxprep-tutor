/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAXPREP TOOL SYSTEM v3.0 — "The Swiss Army Knife"
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Mathematical Tool Selection & Execution Framework
 *
 * PRINCIPLE: Tools are selected by EMBEDDING SIMILARITY, not hardcoded rules.
 * When the student asks something, Wax computes the similarity between the
 * query embedding and each tool's capability embedding. Tools above threshold
 * are made available.
 *
 * AVAILABLE TOOLS:
 * 1. web_search — Real-time internet search for current information
 * 2. calculator — Mathematical computation and symbolic math
 * 3. memory_retrieve — Search student's personal learning memory
 * 4. memory_store — Save learning moments to long-term memory
 * 5. curriculum_lookup — Nigerian curriculum standards & past questions
 * 6. practice_generator — Create practice problems at right difficulty
 * 7. concept_explainer — Generate explanations adapted to learning style
 * 8. current_time — Get current time and date
 * 9. topic_mapper — Map topics to curriculum and prerequisites
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { EmbeddingService } from '../utils/embedder';

// ───────────────────────────────────────────────────────────────────────────────
// TOOL INTERFACES
// ───────────────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string; // This text, when embedded, defines the tool's capabilities
  parameters: ToolParameter[];
  execute: (params: Record<string, any>, context: ToolContext) => Promise<ToolResult>;
  /** Embedding of description — computed at init */
  embedding?: number[];
  /** Minimum query similarity required to activate this tool */
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
  userProfile: any;
  conversationHistory: Array<{ role: string; content: string }>;
  intent: string;
  subject?: string;
}

export interface ToolResult {
  success: boolean;
  data: any;
  toolName: string;
  latencyMs: number;
  error?: string;
}

// ───────────────────────────────────────────────────────────────────────────────
// TOOL CONTEXT — Passed to all tool executions
// ───────────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────────
// TOOL IMPLEMENTATIONS
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Tool 1: Web Search
 * Searches the internet for current, real-time information
 */
const webSearchTool: ToolDefinition = {
  name: 'web_search',
  activationThreshold: 0.4,
  description: `Search the internet for current information, recent events, facts, definitions, and up-to-date knowledge. Use when the student asks about:
- Current events or news
- Recent discoveries or developments
- Facts that might have changed
- Definitions of terms
- Topics that need real-time information
- Anything where your training data might be outdated`,
  parameters: [
    { name: 'query', type: 'string', description: 'The search query', required: true },
    { name: 'num_results', type: 'number', description: 'Number of results to return (1-5)', required: false },
  ],
  execute: async (params, context) => {
    const startTime = Date.now();
    try {
      // Use a search API (e.g., Serper, Bing, or Brave Search)
      const apiKey = process.env.SERPER_API_KEY || process.env.BING_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          toolName: 'web_search',
          data: null,
          latencyMs: Date.now() - startTime,
          error: 'Search API key not configured',
        };
      }

      // Serper.dev implementation (free tier available)
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: params.query,
          num: params.num_results || 3,
        }),
      });

      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        success: true,
        toolName: 'web_search',
        latencyMs: Date.now() - startTime,
        data: {
          query: params.query,
          results: (data.organic || []).map((r: any) => ({
            title: r.title,
            snippet: r.snippet,
            url: r.link,
          })),
          answerBox: data.answerBox || null,
        },
      };
    } catch (error) {
      return {
        success: false,
        toolName: 'web_search',
        data: null,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  },
};

/**
 * Tool 2: Calculator
 * Mathematical computation
 */
const calculatorTool: ToolDefinition = {
  name: 'calculator',
  activationThreshold: 0.35,
  description: `Perform mathematical calculations, solve equations, and compute numerical answers. Use when the student needs:
- Numerical calculations
- Solving equations
- Checking answers
- Mathematical transformations
- Statistical calculations
- Unit conversions`,
  parameters: [
    { name: 'expression', type: 'string', description: 'Mathematical expression to evaluate', required: true },
    { name: 'show_steps', type: 'boolean', description: 'Whether to show step-by-step solution', required: false },
  ],
  execute: async (params, context) => {
    const startTime = Date.now();
    try {
      // Use a math evaluation API or library
      // For now, return the expression for the LLM to solve
      // In production, integrate with WolframAlpha API or mathjs

      const expression = params.expression;

      // Basic safe evaluation (can be enhanced with mathjs)
      // This is a simplified version — use mathjs in production
      const sanitized = expression
        .replace(/[^0-9+\-*/().\s^√∫πe]/g, '')
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
        data: {
          expression: params.expression,
          result: isNaN(result) ? 'Could not evaluate — please check the expression' : result,
          showSteps: params.show_steps || false,
        },
      };
    } catch (error) {
      return {
        success: false,
        toolName: 'calculator',
        data: null,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Calculation failed',
      };
    }
  },
};

/**
 * Tool 3: Memory Retrieve
 * Search student's personal memory
 */
const memoryRetrieveTool: ToolDefinition = {
  name: 'memory_retrieve',
  activationThreshold: 0.3,
  description: `Search the student's personal learning memory for past conversations, learned concepts, known weaknesses, and previous interactions. Use when:
- You need to personalize the response based on past learning
- The student references something you discussed before
- You want to check if they've learned a prerequisite concept
- You want to reference their strengths or weaknesses
- You want to build on previous knowledge`,
  parameters: [
    { name: 'query', type: 'string', description: 'What to search for in memory', required: true },
    { name: 'limit', type: 'number', description: 'Maximum number of memories to retrieve', required: false },
  ],
  execute: async (params, context) => {
    const startTime = Date.now();
    try {
      // Call the memory bridge API
      const memoryApiUrl = process.env.MEMORY_API_URL || 'http://localhost:3000';
      const response = await fetch(`${memoryApiUrl}/memory/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: context.userId,
          query: params.query,
          limit: params.limit || 5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Memory API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        success: true,
        toolName: 'memory_retrieve',
        latencyMs: Date.now() - startTime,
        data: {
          memories: data.memories || [],
          userProfile: data.userProfile || {},
          count: data.count || 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        toolName: 'memory_retrieve',
        data: null,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Memory retrieval failed',
      };
    }
  },
};

/**
 * Tool 4: Memory Store
 * Save learning moments
 */
const memoryStoreTool: ToolDefinition = {
  name: 'memory_store',
  activationThreshold: 0.25,
  description: `Save important learning moments, student preferences, or new information about the student to their long-term memory. Use when:
- The student demonstrates understanding of a concept
- The student expresses a preference
- You learn something new about their learning style
- They achieve a milestone
- They mention goals or upcoming exams`,
  parameters: [
    { name: 'category', type: 'enum', description: 'Type of memory', required: true, enum: ['skill', 'preference', 'goal', 'knowledge', 'behavior', 'weakness', 'strength'] },
    { name: 'content', type: 'string', description: 'What to remember', required: true },
    { name: 'confidence', type: 'number', description: 'Confidence level (0-1)', required: false },
  ],
  execute: async (params, context) => {
    const startTime = Date.now();
    try {
      const memoryApiUrl = process.env.MEMORY_API_URL || 'http://localhost:3000';
      const response = await fetch(`${memoryApiUrl}/memory/fact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: context.userId,
          category: params.category,
          key: `auto_${Date.now()}`,
          value: params.content,
          content: params.content,
          confidence: params.confidence || 0.8,
        }),
      });

      if (!response.ok) {
        throw new Error(`Memory store API error: ${response.status}`);
      }

      return {
        success: true,
        toolName: 'memory_store',
        latencyMs: Date.now() - startTime,
        data: { stored: true, category: params.category },
      };
    } catch (error) {
      return {
        success: false,
        toolName: 'memory_store',
        data: null,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Memory storage failed',
      };
    }
  },
};

/**
 * Tool 5: Curriculum Lookup
 * Nigerian curriculum standards
 */
const curriculumLookupTool: ToolDefinition = {
  name: 'curriculum_lookup',
  activationThreshold: 0.35,
  description: `Look up Nigerian curriculum standards, exam requirements, and topic alignments for WAEC, NECO, and JAMB. Use when:
- The student is preparing for an exam
- You need to align content to Nigerian curriculum
- You want to reference specific syllabus topics
- You need past question patterns for a topic
- The student asks about exam requirements`,
  parameters: [
    { name: 'subject', type: 'string', description: 'Subject name', required: true },
    { name: 'topic', type: 'string', description: 'Topic to look up', required: true },
    { name: 'exam_type', type: 'enum', description: 'Target exam', required: false, enum: ['WAEC', 'NECO', 'JAMB', 'Junior WAEC'] },
  ],
  execute: async (params, context) => {
    const startTime = Date.now();
    try {
      // This would connect to a curriculum database
      // For now, return a structured prompt for the LLM to use
      const curriculumData = getCurriculumData(params.subject, params.topic, params.exam_type);

      return {
        success: true,
        toolName: 'curriculum_lookup',
        latencyMs: Date.now() - startTime,
        data: curriculumData,
      };
    } catch (error) {
      return {
        success: false,
        toolName: 'curriculum_lookup',
        data: null,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Curriculum lookup failed',
      };
    }
  },
};

/**
 * Tool 6: Practice Generator
 * Generate practice problems
 */
const practiceGeneratorTool: ToolDefinition = {
  name: 'practice_generator',
  activationThreshold: 0.4,
  description: `Generate practice questions and exercises at the appropriate difficulty level for the student. Use when:
- The student asks for practice
- You want to test understanding after explaining
- The student says they want to "try" or "practice"
- You want to reinforce a concept with exercises`,
  parameters: [
    { name: 'topic', type: 'string', description: 'Topic to generate practice for', required: true },
    { name: 'difficulty', type: 'enum', description: 'Difficulty level', required: false, enum: ['easy', 'medium', 'hard', 'adaptive'] },
    { name: 'count', type: 'number', description: 'Number of questions', required: false },
    { name: 'question_type', type: 'enum', description: 'Type of questions', required: false, enum: ['multiple_choice', 'short_answer', 'problem_solving', 'essay'] },
  ],
  execute: async (params, context) => {
    const startTime = Date.now();

    // Determine difficulty if adaptive
    let difficulty = params.difficulty || 'adaptive';
    if (difficulty === 'adaptive') {
      const proficiency = context.userProfile?.proficiency?.[params.topic] || 0.5;
      difficulty = proficiency < 0.4 ? 'easy' : proficiency < 0.7 ? 'medium' : 'hard';
    }

    return {
      success: true,
      toolName: 'practice_generator',
      latencyMs: Date.now() - startTime,
      data: {
        topic: params.topic,
        difficulty,
        count: params.count || 3,
        questionType: params.question_type || 'adaptive',
        instruction: `Generate ${params.count || 3} ${difficulty} ${params.question_type || 'mixed'} questions about ${params.topic}. Make them appropriate for a Nigerian ${context.userProfile?.grade || 'secondary school'} student preparing for ${context.userProfile?.targetExam || 'WAEC/NECO'}.`,
      },
    };
  },
};

/**
 * Tool 7: Current Time
 * Get current time (important for exam schedules, study planning)
 */
const currentTimeTool: ToolDefinition = {
  name: 'current_time',
  activationThreshold: 0.15,
  description: `Get the current date and time. Use when:
- The student asks about exam dates or schedules
- You want to check if it's late (student should sleep)
- Study planning and timetables
- Any time-sensitive query`,
  parameters: [],
  execute: async (params, context) => {
    const now = new Date();
    // Convert to Nigerian time (WAT, UTC+1)
    const nigeriaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));

    return {
      success: true,
      toolName: 'current_time',
      latencyMs: 0,
      data: {
        timestamp: now.toISOString(),
        nigeriaTime: nigeriaTime.toISOString(),
        nigeriaFormatted: nigeriaTime.toLocaleString('en-NG', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Lagos',
        }),
        isLateNight: nigeriaTime.getHours() >= 23 || nigeriaTime.getHours() < 5,
        isStudyHours: nigeriaTime.getHours() >= 17 && nigeriaTime.getHours() <= 22,
      },
    };
  },
};

// ───────────────────────────────────────────────────────────────────────────────
// CURRICULUM DATA — Nigerian Education System
// ───────────────────────────────────────────────────────────────────────────────

function getCurriculumData(subject: string, topic: string, examType?: string): any {
  // This would be a full database lookup in production
  // For now, provide structured guidance

  const nigerianSubjects: Record<string, any> = {
    'mathematics': {
      waecTopics: ['Algebra', 'Geometry', 'Trigonometry', 'Calculus', 'Statistics', 'Probability'],
      commonQuestions: ['Simultaneous equations', 'Circle theorem', 'Differentiation', 'Integration'],
      markingFocus: 'Show all working — marks awarded for method',
    },
    'english': {
      waecTopics: ['Comprehension', 'Summary', 'Lexis', 'Structure', 'Essay Writing', 'Oral English'],
      commonQuestions: ['Letter writing', 'Comprehension passages', 'Summary techniques'],
      markingFocus: 'Clarity, organization, and correct grammar',
    },
    'physics': {
      waecTopics: ['Mechanics', 'Heat', 'Waves', 'Electricity', 'Modern Physics'],
      commonQuestions: ['Projectile motion', 'Ohm\'s law', 'Lens formula'],
      markingFocus: 'Correct formulas, substitutions, and units',
    },
    'chemistry': {
      waecTopics: ['Organic', 'Inorganic', 'Physical Chemistry', 'Practical'],
      commonQuestions: ['Stoichiometry', 'Organic reactions', 'Titration'],
      markingFocus: 'Balanced equations and correct calculations',
    },
    'biology': {
      waecTopics: ['Ecology', 'Genetics', 'Anatomy', 'Physiology', 'Evolution'],
      commonQuestions: ['Genetics problems', 'Ecological terms', 'Diagram labeling'],
      markingFocus: 'Correct terminology and complete explanations',
    },
  };

  const subjectData = nigerianSubjects[subject.toLowerCase()] || {
    waecTopics: ['General'],
    commonQuestions: ['Various'],
    markingFocus: 'Clear and accurate responses',
  };

  return {
    subject,
    topic,
    examType: examType || 'WAEC/NECO',
    ...subjectData,
    nigerianContext: true,
    advice: `Align explanation to ${examType || 'WAEC/NECO'} syllabus. Use Nigerian examples where possible.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// TOOL REGISTRY & SELECTION
// ───────────────────────────────────────────────────────────────────────────────

const ALL_TOOLS: ToolDefinition[] = [
  webSearchTool,
  calculatorTool,
  memoryRetrieveTool,
  memoryStoreTool,
  curriculumLookupTool,
  practiceGeneratorTool,
  currentTimeTool,
];

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

    // Pre-compute embeddings for all tool descriptions
    for (const tool of this.tools) {
      const embedding = await this.embedder.embed(tool.description);
      tool.embedding = embedding.embedding;
    }

    this.initialized = true;
  }

  /**
   * Select tools relevant to a query using embedding similarity
   */
  async selectTools(query: string, context: ToolContext): Promise<ToolDefinition[]> {
    if (!this.initialized) await this.initialize();

    const queryEmbedding = await this.embedder.embed(query);

    // Compute similarity to each tool
    const scoredTools = this.tools
      .map(tool => ({
        tool,
        similarity: tool.embedding
          ? this.cosineSimilarity(queryEmbedding.embedding, tool.embedding)
          : 0,
      }))
      .filter(({ similarity, tool }) => similarity >= tool.activationThreshold)
      .sort((a, b) => b.similarity - a.similarity);

    // Return top tools (max 3 to avoid overloading)
    return scoredTools.slice(0, 3).map(({ tool }) => tool);
  }

  /**
   * Execute a tool by name
   */
  async executeTool(
    toolName: string,
    params: Record<string, any>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      return {
        success: false,
        toolName,
        data: null,
        latencyMs: 0,
        error: `Tool not found: ${toolName}`,
      };
    }

    return tool.execute(params, context);
  }

  /**
   * Get all available tool definitions (for LLM tool calling)
   */
  getToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: ToolParameter[];
  }> {
    return this.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
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
