/**
 * WaxPrep Multi-Agent Orchestration v3.0
 * Competitive Multi-Agent System with Confidence-Based Routing
 */

import { EmbeddingService } from '../utils/embedder.js';

interface AgentResponse {
  text: string;
  confidence: number;
  agentName: string;
  reasoningMode: string;
  toolsUsed: string[];
  tokensUsed: { prompt: number; completion: number };
  latencyMs: number;
  responseEmbedding?: number[];
  activatedSpecialties: string[];
}

interface AgentScore {
  agentName: string;
  response: AgentResponse;
  compositeScore: number;
  components: {
    confidence: number;
    relevance: number;
    diversity: number;
    speed: number;
    quality: number;
  };
  weights: {
    alpha: number;
    beta: number;
    gamma: number;
    delta: number;
  };
}

interface SpecialistAgent {
  name: string;
  description: string;
  specialtyTexts: string[];
  specialtyEmbeddings?: number[][];
  systemPromptTemplate: string;
  baseCapability: number;
}

const SPECIALIST_AGENTS: SpecialistAgent[] = [
  {
    name: 'MathMaster',
    description: 'Expert in mathematics: algebra, calculus, geometry, trigonometry, statistics',
    specialtyTexts: ['solving mathematical equations algebra calculus geometry', 'mathematical proofs theorems derivations', 'WAEC NECO JAMB mathematics', 'simultaneous equations quadratic differentiation integration', 'statistics probability'],
    baseCapability: 0.95,
    systemPromptTemplate: `You are MathMaster, an elite mathematics tutor. Show every step clearly. Use -> for progression. After 2-3 steps, ask "What do you think the next step is?" Verify algebra by substituting back.`,
  },
  {
    name: 'ScienceSage',
    description: 'Expert in Physics, Chemistry, and Biology',
    specialtyTexts: ['physics mechanics electricity thermodynamics', 'chemistry organic inorganic reactions', 'biology genetics ecology anatomy', 'WAEC NECO JAMB science practical', 'scientific method experiments'],
    baseCapability: 0.95,
    systemPromptTemplate: `You are ScienceSage. Connect theory to real life. Use Nigerian contexts. For Physics: draw mental pictures. For Chemistry: use analogy. For Biology: connect to body experience.`,
  },
  {
    name: 'WordWeaver',
    description: 'Expert in English Language and Literature',
    specialtyTexts: ['english language grammar comprehension essay', 'literature prose poetry drama analysis', 'WAEC NECO JAMB english summary', 'figurative language literary devices', 'essay structure argumentative descriptive'],
    baseCapability: 0.93,
    systemPromptTemplate: `You are WordWeaver. For grammar: explain rule, show mistake, give correction. For literature: analyze themes, characters, devices. Know Chinua Achebe, Wole Soyinka, Chimamanda Adichie.`,
  },
  {
    name: 'ExamStrategist',
    description: 'WAEC, NECO, JAMB exam preparation specialist',
    specialtyTexts: ['WAEC preparation', 'NECO past questions', 'JAMB UTME', 'exam time management', 'past question analysis marking scheme'],
    baseCapability: 0.97,
    systemPromptTemplate: `You are ExamStrategist. Teach time management. Spot repeated question patterns. Teach elimination techniques. Explain marking schemes. Build confidence.`,
  },
  {
    name: 'ConceptBuilder',
    description: 'Foundational concept teacher',
    specialtyTexts: ['basic concepts fundamentals', 'simple explanations beginners', 'foundational knowledge prerequisites', 'analogies visual explanations', 'starting from zero'],
    baseCapability: 0.90,
    systemPromptTemplate: `You are ConceptBuilder. Start from what student knows. Build one concept at a time. Use analogies from daily Nigerian life. Check understanding after every concept.`,
  },
  {
    name: 'CodeCraft',
    description: 'Computer Science and programming tutor',
    specialtyTexts: ['computer science programming coding', 'python javascript html css', 'ICT information communication technology', 'data structures algorithms', 'NECO computer science practical'],
    baseCapability: 0.92,
    systemPromptTemplate: `You are CodeCraft. Explain logic first, syntax second. Use visual diagrams. Start simple, build complexity. Python for beginners. Explain errors as clues.`,
  },
];

export class MultiAgentOrchestrator {
  private static instance: MultiAgentOrchestrator;
  private embedder: EmbeddingService;
  private agents: SpecialistAgent[];
  private initialized = false;

  private weights = {
    alpha: 0.35,
    beta: 0.30,
    gamma: 0.15,
    delta: 0.10,
    epsilon: 0.10,
  };

  private constructor(embedder: EmbeddingService) {
    this.embedder = embedder;
    this.agents = JSON.parse(JSON.stringify(SPECIALIST_AGENTS));
  }

  static getInstance(embedder?: EmbeddingService): MultiAgentOrchestrator {
    if (!MultiAgentOrchestrator.instance) {
      if (!embedder) throw new Error('Embedder required');
      MultiAgentOrchestrator.instance = new MultiAgentOrchestrator(embedder);
    }
    return MultiAgentOrchestrator.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const agent of this.agents) {
      const embeddings: number[][] = [];
      for (const text of agent.specialtyTexts) {
        const emb = await this.embedder.embed(text);
        embeddings.push(emb.embedding);
      }
      agent.specialtyEmbeddings = embeddings;
    }
    this.initialized = true;
  }

  async route(
    studentMessage: string,
    context: {
      userProfile: Record<string, unknown>;
      recentTurns: Array<{ role: string; content: string }>;
      intent: string;
      intentConfidence: number;
      mode: string;
    },
    generateFn: (systemPrompt: string, message: string, ctx: Record<string, unknown>) => Promise<{
      text: string;
      confidence: number;
      tokensUsed: { prompt: number; completion: number };
      latencyMs: number;
    }>
  ): Promise<{
    response: AgentResponse;
    allCandidates: AgentScore[];
    routingDecision: string;
  }> {
    if (!this.initialized) await this.initialize();

    const queryEmbedding = await this.embedder.embed(studentMessage);
    const agentScores = await this.scoreAgentRelevances(queryEmbedding.embedding);

    const relevanceThreshold = 0.45;
    const dynamicK = Math.max(2, agentScores.filter(s => s.relevance > relevanceThreshold).length);
    const topAgents = agentScores.slice(0, Math.min(dynamicK, 4));

    const generationResults = await Promise.all(
      topAgents.map(async ({ agent, relevance }) => {
        const startTime = Date.now();
        const systemPrompt = this.buildAgentPrompt(agent, context);
        const result = await generateFn(systemPrompt, studentMessage, context);
        const responseEmbedding = await this.embedder.embed(result.text);

        const agentResponse: AgentResponse = {
          text: result.text,
          confidence: result.confidence,
          agentName: agent.name,
          reasoningMode: context.mode,
          toolsUsed: [],
          tokensUsed: result.tokensUsed,
          latencyMs: Date.now() - startTime,
          responseEmbedding: responseEmbedding.embedding,
          activatedSpecialties: agent.specialtyTexts.slice(0, 2),
        };

        return { agentResponse, relevance };
      })
    );

    const scoredResponses = this.scoreResponses(
      generationResults.map(r => r.agentResponse),
      generationResults.map(r => r.relevance)
    );

    const winner = scoredResponses.reduce((best, current) =>
      current.compositeScore > best.compositeScore ? current : best
    );

    const routingDecision = this.explainRouting(topAgents, scoredResponses, winner);

    return {
      response: winner.response,
      allCandidates: scoredResponses,
      routingDecision,
    };
  }

  private async scoreAgentRelevances(queryEmbedding: number[]): Promise<Array<{ agent: SpecialistAgent; relevance: number }>> {
    const scored = this.agents.map(agent => {
      const similarities = (agent.specialtyEmbeddings || []).map(emb =>
        this.cosineSimilarity(queryEmbedding, emb)
      );
      const avgSimilarity = similarities.length > 0
        ? similarities.reduce((sum, s) => sum + s, 0) / similarities.length
        : 0;
      const relevance = avgSimilarity * 0.7 + agent.baseCapability * 0.3;
      return { agent, relevance };
    });

    return scored.sort((a, b) => b.relevance - a.relevance);
  }

  private buildAgentPrompt(agent: SpecialistAgent, context: Record<string, unknown>): string {
    const userProfile = context.userProfile as Record<string, unknown>;
    const name = (userProfile?.name as string) || 'student';
    const grade = (userProfile?.grade as string) || 'unknown';
    const learningStyle = (userProfile?.learningStyle as string) || 'adaptive';
    const recentTurns = (context.recentTurns as Array<{ role: string; content: string }>) || [];

    return `${agent.systemPromptTemplate}\n\nSTUDENT:\n- Name: ${name}\n- Grade: ${grade}\n- Learning style: ${learningStyle}\n- Intent: ${context.intent} (${((context.intentConfidence as number) * 100).toFixed(0)}%)\n\nHISTORY:\n${recentTurns.slice(-3).map(t => `${t.role}: ${t.content}`).join('\n')}`;
  }

  private scoreResponses(
    responses: AgentResponse[],
    relevances: number[]
  ): AgentScore[] {
    const diversityScores = this.computeDiversityScores(responses);
    const maxLatency = Math.max(...responses.map(r => r.latencyMs), 1);
    const speedScores = responses.map(r => 1 - (r.latencyMs / maxLatency));
    const qualityScores = responses.map(r => this.estimateQuality(r));

    return responses.map((response, i) => {
      const { alpha, beta, gamma, delta, epsilon } = this.weights;
      const components = {
        confidence: response.confidence,
        relevance: relevances[i] || 0,
        diversity: diversityScores[i] || 0,
        speed: speedScores[i] || 0,
        quality: qualityScores[i] || 0,
      };

      const compositeScore =
        alpha * components.confidence +
        beta * components.relevance +
        gamma * components.diversity +
        delta * components.speed +
        epsilon * components.quality;

      return {
        agentName: response.agentName,
        response,
        compositeScore,
        components,
        weights: { alpha, beta, gamma, delta },
      };
    });
  }

  private computeDiversityScores(responses: AgentResponse[]): number[] {
    if (responses.length <= 1) return [1];
    const embeddings = responses.map(r => r.responseEmbedding).filter(Boolean) as number[][];
    if (embeddings.length === 0) return responses.map(() => 1);

    const dim = embeddings[0].length;
    const centroid: number[] = [];
    for (let d = 0; d < dim; d++) {
      centroid.push(embeddings.reduce((sum, emb) => sum + emb[d], 0) / embeddings.length);
    }

    return responses.map(r => {
      if (!r.responseEmbedding) return 0.5;
      const dist = this.euclideanDistance(r.responseEmbedding, centroid);
      return 2 / (1 + Math.exp(-dist)) - 1;
    });
  }

  private estimateQuality(response: AgentResponse): number {
    const text = response.text;
    let score = 0.5;

    const wordCount = text.split(/\s+/).length;
    if (wordCount >= 20 && wordCount <= 300) score += 0.15;
    else if (wordCount > 300) score -= 0.1;
    else if (wordCount < 10) score -= 0.2;

    if (text.includes('->')) score += 0.05;
    if (text.includes('?')) score += 0.05;
    if (/\*[^*]+\*/.test(text)) score += 0.05;
    if (text.toLowerCase().includes('example')) score += 0.05;
    if (text.toLowerCase().includes('because')) score += 0.05;
    if (text.toLowerCase().includes('step')) score += 0.03;

    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
    if (uniqueSentences.size / sentences.length < 0.7) score -= 0.1;

    return Math.min(Math.max(score, 0), 1);
  }

  private explainRouting(
    topAgents: Array<{ agent: SpecialistAgent; relevance: number }>,
    scores: AgentScore[],
    winner: AgentScore
  ): string {
    const agentList = topAgents.map(a => `${a.agent.name} (${(a.relevance * 100).toFixed(0)}%)`).join(', ');
    return `Selected: ${agentList}\nWinner: ${winner.agentName} (score: ${winner.compositeScore.toFixed(3)})`;
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

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
  }
}

export const multiAgentOrchestrator = MultiAgentOrchestrator;
