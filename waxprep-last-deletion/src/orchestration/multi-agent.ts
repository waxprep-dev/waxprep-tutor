/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAXPREP MULTI-AGENT ORCHESTRATION v3.0 — "The Parliament"
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Competitive Multi-Agent System with Confidence-Based Routing
 *
 * ARCHITECTURE:
 *   Student Message
 *        ↓
 *   [Router Agent] — Classifies intent, selects candidate agents
 *        ↓
 *   [Candidate Agents] — Each generates a response + confidence score
 *        ↓
 *   [Arbiter] — Selects best response using weighted voting
 *        ↓
 *   [Quality Gate] — Self-evaluation + optional regeneration
 *        ↓
 *   Student Response
 *
 * MATHEMATICAL MODEL:
 *   score(agentᵢ) = α·confidenceᵢ + β·relevanceᵢ + γ·diversityᵢ + δ·speedᵢ
 *
 *   WHERE:
 *     confidenceᵢ = agent's self-assessed confidence [0,1]
 *     relevanceᵢ  = embedding similarity to query [0,1]
 *     diversityᵢ  = dissimilarity to other agents' responses [0,1]
 *     speedᵢ      = response time normalization [0,1]
 *     α, β, γ, δ  = learned weights
 *
 * NO HARDCODED AGENT SELECTION. Agents COMPETE mathematically.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { EmbeddingService } from '../utils/embedder';

// ───────────────────────────────────────────────────────────────────────────────
// AGENT INTERFACES
// ───────────────────────────────────────────────────────────────────────────────

interface AgentResponse {
  /** The generated response text */
  text: string;
  /** Agent's self-assessed confidence [0, 1] */
  confidence: number;
  /** Which agent generated this */
  agentName: string;
  /** Reasoning mode used */
  reasoningMode: string;
  /** Tools used */
  toolsUsed: string[];
  /** Tokens consumed */
  tokensUsed: { prompt: number; completion: number };
  /** Latency in ms */
  latencyMs: number;
  /** Vector embedding of the response */
  responseEmbedding?: number[];
  /** Specialty areas this agent activated */
  activatedSpecialties: string[];
}

interface AgentScore {
  agentName: string;
  response: AgentResponse;
  /** Final composite score */
  compositeScore: number;
  /** Individual score components */
  components: {
    confidence: number;
    relevance: number;
    diversity: number;
    speed: number;
    quality: number;
  };
  /** Weights used */
  weights: {
    alpha: number;  // confidence weight
    beta: number;   // relevance weight
    gamma: number;  // diversity weight
    delta: number;  // speed weight
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// SPECIALIST AGENTS — Each is an EXPERT in specific domains
// ═══════════════════════════════════════════════════════════════════════════════
// These are NOT hardcoded. They are DYNAMICALLY ACTIVATED based on
// embedding similarity between the query and their specialty vectors.
// ───────────────────────────────────────────────────────────────────────────────

interface SpecialistAgent {
  name: string;
  description: string;
  /** Specialty vectors — embeddings of what this agent is good at */
  specialtyTexts: string[];
  /** Cached specialty embeddings */
  specialtyEmbeddings?: number[][];
  /** System prompt template */
  systemPromptTemplate: string;
  /** Base capability score */
  baseCapability: number;
}

const SPECIALIST_AGENTS: SpecialistAgent[] = [
  {
    name: 'MathMaster',
    description: 'Expert in all areas of mathematics: algebra, calculus, geometry, trigonometry, statistics, further mathematics',
    specialtyTexts: [
      'solving mathematical equations algebra calculus geometry',
      'mathematical proofs theorems derivations',
      'WAEC NECO JAMB mathematics past questions',
      'simultaneous equations quadratic differentiation integration',
      'statistics probability permutations combinations',
    ],
    baseCapability: 0.95,
    systemPromptTemplate: `You are MathMaster, an elite mathematics tutor specializing in Nigerian curriculum.

APPROACH:
- Show every step clearly. Never skip steps.
- Use the → symbol to show progression
- After 2-3 steps, ask "What do you think the next step is?"
- For proofs: state the theorem, show given/prove, then work forward
- Use Nigerian examples when possible (market calculations, sports stats)

CHECKS:
- Always verify your algebra by substituting back
- Check if answers are reasonable (e.g., probability must be 0-1)
- Point out common mistakes students make on this topic

FORMAT:
- Use WhatsApp-friendly formatting: *bold* for key results
- Keep each message focused on one step or concept
- If the solution is long, ask "Ready for the next step?"`,
  },
  {
    name: 'ScienceSage',
    description: 'Expert in Physics, Chemistry, and Biology with laboratory and real-world focus',
    specialtyTexts: [
      'physics mechanics electricity thermodynamics waves',
      'chemistry organic inorganic reactions stoichiometry',
      'biology genetics ecology human anatomy physiology',
      'WAEC NECO JAMB science practical questions',
      'scientific method experiments laboratory procedures',
    ],
    baseCapability: 0.95,
    systemPromptTemplate: `You are ScienceSage, an expert science tutor for Physics, Chemistry, and Biology.

APPROACH:
- Connect theory to real life: "This is why your phone heats up when charging"
- Use Nigerian contexts: crude oil chemistry, tropical diseases, local ecology
- For Physics: draw mental pictures — "Imagine a ball rolling down a hill..."
- For Chemistry: use analogy — "Electrons are like dancers swapping partners"
- For Biology: connect to body experience — "You can feel your pulse, right?"

PRACTICAL FOCUS:
- Explain WAEC practical questions
- Describe experiments step by step
- Emphasize safety and proper procedure
- Link to everyday observations`,
  },
  {
    name: 'WordWeaver',
    description: 'Expert in English Language, Literature, and Essay Writing',
    specialtyTexts: [
      'english language grammar comprehension essay writing',
      'literature prose poetry drama analysis',
      ' WAEC NECO JAMB english summary letter writing',
      'figurative language literary devices themes',
      'essay structure argumentative descriptive narrative',
    ],
    baseCapability: 0.93,
    systemPromptTemplate: `You are WordWeaver, a master of English Language and Literature.

APPROACH:
- For grammar: explain the rule, show the mistake, give the correction
- For literature: analyze themes, characters, and literary devices
- For essays: provide structure templates (intro, body, conclusion)
- For comprehension: teach active reading strategies

NIGERIAN LITERATURE:
- Chinua Achebe, Wole Soyinka, Chimamanda Adichie
- Know prescribed texts for WAEC/NECO
- Connect themes to Nigerian society and culture

WRITING TIPS:
- Show don't tell
- Vary sentence structure
- Use transitional phrases
- Practice with past essay questions`,
  },
  {
    name: 'ExamStrategist',
    description: 'WAEC, NECO, and JAMB exam preparation specialist',
    specialtyTexts: [
      'WAEC West African Examination Council preparation',
      'NECO National Examination Council past questions',
      'JAMB Joint Admissions Matriculation Board UTME',
      'exam time management strategies tips',
      'past question analysis marking scheme',
    ],
    baseCapability: 0.97,
    systemPromptTemplate: `You are ExamStrategist, the ultimate exam preparation coach.

YOUR GOAL: Maximize the student's exam score.

STRATEGIES:
- Teach time management: "You have 2 hours for 50 questions = 2.4 minutes each"
- Spot frequently repeated question patterns
- Teach elimination techniques for multiple choice
- Explain marking schemes — what examiners look for
- Share memory techniques for formulas and facts

PAST QUESTIONS:
- Reference specific years: "In WAEC 2023, this topic appeared 3 times"
- Show how questions are rephrased but test the same concept
- Highlight topics with highest probability of appearing

MINDSET:
- Build confidence: "You've prepared. You've got this."
- Manage anxiety: deep breathing, positive self-talk
- Night before exam: what to review, what to skip`,
  },
  {
    name: 'ConceptBuilder',
    description: 'Foundational concept teacher — builds understanding from basics',
    specialtyTexts: [
      'basic concepts fundamentals building blocks',
      'simple explanations beginners introduction',
      'foundational knowledge prerequisite understanding',
      'analogies visual explanations step by step',
      'starting from zero no prior knowledge',
    ],
    baseCapability: 0.90,
    systemPromptTemplate: `You are ConceptBuilder, a patient tutor who excels at making complex topics simple.

APPROACH:
- Start from what the student ALREADY knows
- Build one concept at a time — never rush
- Use analogies from daily Nigerian life
- Check understanding after every new concept: "Does that make sense?"
- If confused, try a different angle — never repeat the same explanation

TECHNIQUES:
- "Think of it like..." (analogy)
- "Before we do X, let's make sure Y is clear"
- Use simple language — avoid jargon until necessary
- Celebrate small wins: "See? You just understood something new!"

PATIENCE:
- Never make the student feel dumb for not knowing
- "There's no such thing as a dumb question"
- Go as slow as needed — understanding > speed`,
  },
  {
    name: 'CodeCraft',
    description: 'Computer Science, programming, and ICT tutor',
    specialtyTexts: [
      'computer science programming coding algorithms',
      'python javascript html css web development',
      'ICT information communication technology',
      'data structures algorithms flowcharts pseudocode',
      'NECO computer science practical WAEC ICT',
    ],
    baseCapability: 0.92,
    systemPromptTemplate: `You are CodeCraft, a programming and computer science tutor.

APPROACH:
- Code is like cooking: follow the recipe, get the result
- Explain logic first, syntax second
- Use visual diagrams for algorithms
- Start with simple programs, build complexity gradually

PROGRAMMING:
- Python for beginners (readable, friendly)
- Explain error messages clearly — they're clues, not failures
- Debug together: "Let's trace through this line by line"
- Emphasize problem-solving over memorizing syntax

COMPUTER SCIENCE THEORY:
- Algorithms: use everyday examples (recipes, directions)
- Data structures: organize like a filing cabinet
- Boolean logic: light switches (on/off, AND/OR)
- Networking: explain like postal system`,
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// THE ORCHESTRATOR — Routes queries to competing agents
// ───────────────────────────────────────────────────────────────────────────────

export class MultiAgentOrchestrator {
  private static instance: MultiAgentOrchestrator;
  private embedder: EmbeddingService;
  private agents: SpecialistAgent[];
  private initialized = false;

  // Scoring weights (learned from feedback)
  private weights = {
    alpha: 0.35,  // confidence weight
    beta: 0.30,   // relevance weight
    gamma: 0.15,  // diversity weight
    delta: 0.10,  // speed weight
    epsilon: 0.10, // quality estimation weight
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

    // Pre-compute specialty embeddings for all agents
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

  /**
   * Route a student query to the best agent(s)
   *
   * ALGORITHM:
   * 1. Embed the student query
   * 2. Compute relevance score for each agent (cosine sim to specialties)
   * 3. Select top-K agents (dynamic threshold, not fixed number)
   * 4. Have each selected agent generate a response
   * 5. Score all responses using multi-factor formula
   * 6. Return the best response + metadata
   */
  async route(
    studentMessage: string,
    context: {
      userProfile: any;
      recentTurns: Array<{ role: string; content: string }>;
      intent: string;
      intentConfidence: number;
      mode: string;
    },
    generateFn: (systemPrompt: string, message: string, context: any) => Promise<{
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

    // Step 1: Embed the query
    const queryEmbedding = await this.embedder.embed(studentMessage);

    // Step 2: Score each agent's relevance to the query
    const agentScores = await this.scoreAgentRelevances(queryEmbedding.embedding);

    // Step 3: Dynamic K selection — include agents above threshold
    const relevanceThreshold = 0.45; // Minimum relevance to participate
    const dynamicK = Math.max(2, agentScores.filter(s => s.relevance > relevanceThreshold).length);
    const topAgents = agentScores.slice(0, Math.min(dynamicK, 4)); // Cap at 4 agents

    // Step 4: Generate responses from each selected agent in parallel
    const generationResults = await Promise.all(
      topAgents.map(async ({ agent, relevance }) => {
        const startTime = Date.now();

        // Build agent-specific system prompt
        const systemPrompt = this.buildAgentPrompt(agent, context);

        // Generate response
        const result = await generateFn(systemPrompt, studentMessage, context);

        // Embed the response for diversity scoring
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

    // Step 5: Score all responses using multi-factor formula
    const scoredResponses = this.scoreResponses(
      generationResults.map(r => r.agentResponse),
      generationResults.map(r => r.relevance)
    );

    // Step 6: Select best response
    const winner = scoredResponses.reduce((best, current) =>
      current.compositeScore > best.compositeScore ? current : best
    );

    // Build routing decision explanation
    const routingDecision = this.explainRouting(topAgents, scoredResponses, winner);

    return {
      response: winner.response,
      allCandidates: scoredResponses,
      routingDecision,
    };
  }

  /**
   * Score each agent's relevance to the query using embedding similarity
   */
  private async scoreAgentRelevances(queryEmbedding: number[]): Promise<
    Array<{ agent: SpecialistAgent; relevance: number }>
  > {
    const scored = this.agents.map(agent => {
      // Average similarity across all specialty embeddings
      const similarities = (agent.specialtyEmbeddings || []).map(emb =>
        this.cosineSimilarity(queryEmbedding, emb)
      );

      const avgSimilarity = similarities.length > 0
        ? similarities.reduce((sum, s) => sum + s, 0) / similarities.length
        : 0;

      // Combine with base capability
      const relevance = avgSimilarity * 0.7 + agent.baseCapability * 0.3;

      return { agent, relevance };
    });

    return scored.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Build agent-specific system prompt with dynamic context
   */
  private buildAgentPrompt(agent: SpecialistAgent, context: any): string {
    const name = context.userProfile?.name || 'student';
    const grade = context.userProfile?.grade || 'unknown';
    const learningStyle = context.userProfile?.learningStyle || 'adaptive';

    return `${agent.systemPromptTemplate}

STUDENT CONTEXT:
- Name: ${name}
- Grade: ${grade}
- Learning style: ${learningStyle}
- Detected intent: ${context.intent} (confidence: ${(context.intentConfidence * 100).toFixed(0)}%)

CONVERSATION HISTORY:
${context.recentTurns.slice(-3).map((t: any) => `${t.role}: ${t.content}`).join('\n')}

INSTRUCTION: Respond as ${agent.name}. Be helpful, accurate, and engaging. Follow your specialty approach.`;
  }

  /**
   * Score all responses using the multi-factor formula
   */
  private scoreResponses(
    responses: AgentResponse[],
    relevances: number[]
  ): AgentScore[] {
    // Compute diversity scores (how different is each response from others)
    const diversityScores = this.computeDiversityScores(responses);

    // Compute speed scores (normalize latencies)
    const maxLatency = Math.max(...responses.map(r => r.latencyMs), 1);
    const speedScores = responses.map(r => 1 - (r.latencyMs / maxLatency));

    // Compute quality estimates (based on response characteristics)
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

  /**
   * Compute diversity scores — how different is each response from the average
   */
  private computeDiversityScores(responses: AgentResponse[]): number[] {
    if (responses.length <= 1) return [1];

    // Compute centroid of all response embeddings
    const embeddings = responses.map(r => r.responseEmbedding).filter(Boolean) as number[][];
    if (embeddings.length === 0) return responses.map(() => 1);

    const dim = embeddings[0].length;
    const centroid: number[] = [];
    for (let d = 0; d < dim; d++) {
      centroid.push(embeddings.reduce((sum, emb) => sum + emb[d], 0) / embeddings.length);
    }

    // Diversity = distance from centroid (higher = more diverse = bonus)
    return responses.map(r => {
      if (!r.responseEmbedding) return 0.5;
      const dist = this.euclideanDistance(r.responseEmbedding, centroid);
      // Normalize to [0, 1] using sigmoid
      return 2 / (1 + Math.exp(-dist)) - 1;
    });
  }

  /**
   * Estimate quality of response without human feedback
   */
  private estimateQuality(response: AgentResponse): number {
    const text = response.text;
    let score = 0.5; // Base score

    // Length appropriateness (not too short, not too long)
    const wordCount = text.split(/\s+/).length;
    if (wordCount >= 20 && wordCount <= 300) score += 0.15;
    else if (wordCount > 300) score -= 0.1;
    else if (wordCount < 10) score -= 0.2;

    // Structure indicators
    if (text.includes('→')) score += 0.05; // Step indicators
    if (text.includes('?')) score += 0.05; // Engagement questions
    if (/\*[^*]+\*/.test(text)) score += 0.05; // WhatsApp formatting

    // Content quality signals
    if (text.toLowerCase().includes('example')) score += 0.05;
    if (text.toLowerCase().includes('because') || text.toLowerCase().includes('because')) score += 0.05;
    if (text.toLowerCase().includes('step')) score += 0.03;

    // Penalize repetitive text
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
    if (uniqueSentences.size / sentences.length < 0.7) score -= 0.1;

    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * Generate human-readable explanation of routing decision
   */
  private explainRouting(
    topAgents: Array<{ agent: SpecialistAgent; relevance: number }>,
    scores: AgentScore[],
    winner: AgentScore
  ): string {
    const agentList = topAgents.map(a =>
      `${a.agent.name} (${(a.relevance * 100).toFixed(0)}% relevance)`
    ).join(', ');

    const scoreBreakdown = scores.map(s =>
      `${s.agentName}: score=${s.compositeScore.toFixed(3)} ` +
      `[confidence=${s.components.confidence.toFixed(2)}, ` +
      `relevance=${s.components.relevance.toFixed(2)}, ` +
      `diversity=${s.components.diversity.toFixed(2)}, ` +
      `speed=${s.components.speed.toFixed(2)}]`
    ).join('\n');

    return `ROUTING DECISION:
Selected agents: ${agentList}

SCORE BREAKDOWN:
${scoreBreakdown}

WINNER: ${winner.agentName} (score: ${winner.compositeScore.toFixed(3)})
REASON: ${this.explainWinnerReason(winner)}`;
  }

  private explainWinnerReason(winner: AgentScore): string {
    const c = winner.components;
    if (c.confidence > 0.9 && c.relevance > 0.8) {
      return 'High confidence and relevance — clear best match.';
    } else if (c.relevance > c.confidence) {
      return 'Best domain match even with moderate confidence.';
    } else if (c.diversity > 0.7) {
      return 'Unique perspective added diversity to response pool.';
    } else if (c.speed > 0.9) {
      return 'Fastest response with acceptable quality.';
    } else {
      return 'Balanced performance across all factors.';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MATHEMATICAL UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

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

// Export
export const multiAgentOrchestrator = MultiAgentOrchestrator;
