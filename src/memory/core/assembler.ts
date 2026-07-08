/**
 * Context Assembler
 * Assembles personalized context for AI generation
 * Balances token budget, relevance, and personalization
 */

import {
  AssembledContext,
  UserProfile,
  SessionMemory,
  SessionTurn,
  EpisodicMemory,
  LongTermMemory,
  ProceduralMemory,
  RetrievedMemory,
  TaskState
} from '../types/memory.js';
import { SessionStorage } from '../interfaces/storage.js';
import { EpisodicStorage } from '../interfaces/storage.js';
import { LongTermStorage } from '../interfaces/storage.js';
import { ProceduralStorage } from '../interfaces/storage.js';
import { MemoryStorage } from '../interfaces/storage.js';
import { embedder } from './embedder.js';
import { decayEngine } from './decay.js';
import { getSessionStorage } from '../layers/session.js';
import { getEpisodicStorage } from '../layers/episodic.js';
import { getLongTermStorage } from '../layers/longterm.js';
import { getProceduralStorage } from '../layers/procedural.js';
import { Timer } from '../../utils/timing.js';
import { logger } from '../../utils/logger.js';

export interface ContextAssemblyConfig {
  // Token budget allocation
  totalTokens: number;           // Total context window (e.g., 8000)
  systemPromptTokens: number;    // For system prompt (e.g., 2000)
  recentTurnsTokens: number;     // For recent conversation (e.g., 3000)
  retrievedMemoryTokens: number; // For retrieved memories (e.g., 2000)
  userProfileTokens: number;     // For user profile (e.g., 1000)

  // Retrieval parameters
  maxRecentTurns: number;        // Max turns from current session (e.g., 7)
  maxEpisodicMatches: number;    // Max episodic memories to retrieve (e.g., 3)
  maxLongTermMatches: number;    // Max long-term facts to retrieve (e.g., 5)
  similarityThreshold: number;   // Minimum similarity for retrieval (e.g., 0.7)

  // Filtering criteria
  minConfidence: number;         // Minimum confidence for long-term facts (e.g., 0.6)
  includeInactiveRules: boolean; // Whether to include deactivated rules (false)

  // Prioritization weights
  recencyWeight: number;         // Weight for temporal proximity (e.g., 0.3)
  relevanceWeight: number;       // Weight for semantic similarity (e.g., 0.5)
  importanceWeight: number;      // Weight for salience/confidence (e.g., 0.2)
}

export class ContextAssembler {
  private static instance: ContextAssembler | null = null;
  private config: ContextAssemblyConfig;
  private sessionStorage: SessionStorage;
  private episodicStorage: EpisodicStorage;
  private longTermStorage: LongTermStorage;
  private proceduralStorage: ProceduralStorage;

  private constructor(
    config?: Partial<ContextAssemblyConfig>,
    storage?: MemoryStorage
  ) {
    this.config = {
      totalTokens: config?.totalTokens ?? 8000,
      systemPromptTokens: config?.systemPromptTokens ?? 2000,
      recentTurnsTokens: config?.recentTurnsTokens ?? 3000,
      retrievedMemoryTokens: config?.retrievedMemoryTokens ?? 2000,
      userProfileTokens: config?.userProfileTokens ?? 1000,
      maxRecentTurns: config?.maxRecentTurns ?? 7,
      maxEpisodicMatches: config?.maxEpisodicMatches ?? 3,
      maxLongTermMatches: config?.maxLongTermMatches ?? 5,
      similarityThreshold: config?.similarityThreshold ?? 0.7,
      minConfidence: config?.minConfidence ?? 0.6,
      includeInactiveRules: config?.includeInactiveRules ?? false,
      recencyWeight: config?.recencyWeight ?? 0.3,
      relevanceWeight: config?.relevanceWeight ?? 0.5,
      importanceWeight: config?.importanceWeight ?? 0.2,
    };

    // Use provided storage or get from layers
    this.sessionStorage = storage?.session ?? getSessionStorage();
    this.episodicStorage = storage?.episodic ?? getEpisodicStorage();
    this.longTermStorage = storage?.longTerm ?? getLongTermStorage();
    this.proceduralStorage = storage?.procedural ?? getProceduralStorage();
  }

  static initialize(
    config?: Partial<ContextAssemblyConfig>,
    storage?: MemoryStorage
  ): ContextAssembler {
    if (!ContextAssembler.instance) {
      ContextAssembler.instance = new ContextAssembler(config, storage);
    }
    return ContextAssembler.instance;
  }

  /**
   * Assemble complete context for AI generation
   */
  async assembleContext(
    userId: string,
    currentMessage: string,
    tenantId?: string
  ): Promise<AssembledContext> {
    const timer = new Timer();

    // Step 1: Get recent session context
    const recentTurns = await this.getRecentTurns(userId);

    // Step 2: Create embedding for current message
    const queryEmbedding = await embedder.embed(currentMessage);

    // Step 3: Retrieve relevant episodic memories
    const episodicMemories = await this.retrieveEpisodicMemories(userId, queryEmbedding);

    // Step 4: Retrieve relevant long-term memories
    const longTermMemories = await this.retrieveLongTermMemories(userId, queryEmbedding);

    // Step 5: Get active procedural rules
    const activeRules = await this.getActiveRules(userId, tenantId);

    // Step 6: Build user profile
    const userProfile = await this.buildUserProfile(userId, longTermMemories);

    // Step 7: Generate system prompt
    const systemPrompt = await this.generateSystemPrompt(
      userProfile,
      activeRules,
      episodicMemories,
      longTermMemories
    );

    // Step 8: Create active task context (if applicable)
    const activeTask = await this.getActiveTask(recentTurns);

    // Step 9: Package everything
    const assembledContext: AssembledContext = {
      systemPrompt,
      recentTurns,
      retrievedMemories: [
        ...episodicMemories.map(m => ({
          id: m.id,
          type: 'episodic' as const,
          content: m.summary,
          similarity: m.vector ? embedder.cosineSimilarity(queryEmbedding.embedding, m.vector.embedding) : 0,
          metadata: m.metadata
        })),
        ...longTermMemories.map(m => ({
          id: m.id,
          type: 'longterm' as const,
          content: m.content,
          similarity: m.vector ? embedder.cosineSimilarity(queryEmbedding.embedding, m.vector.embedding) : 0,
          metadata: m.metadata
        }))
      ].sort((a, b) => b.similarity - a.similarity),
      userProfile,
      activeTask,
      assemblyMetadata: {
        durationMs: timer.elapsedMs(),
        tokensUsed: this.estimateTokenUsage(systemPrompt, recentTurns, episodicMemories, longTermMemories),
        tokensBudget: this.config.totalTokens,
        memorySources: {
          session: recentTurns.length,
          episodic: episodicMemories.length,
          longTerm: longTermMemories.length,
          procedural: activeRules.length,
        }
      }
    };

    logger.info({
      userId,
      tokensUsed: assembledContext.assemblyMetadata.tokensUsed,
      durationMs: assembledContext.assemblyMetadata.durationMs,
      sources: assembledContext.assemblyMetadata.memorySources
    }, 'Context assembled successfully');

    return assembledContext;
  }

  /**
   * Get recent turns from current session
   */
  private async getRecentTurns(userId: string): Promise<SessionTurn[]> {
    const session = await this.sessionStorage.getActiveSession(userId);
    if (!session) return [];

    // Get recent turns, limited by config
    const allTurns = session.turns;
    const recentTurns = allTurns.slice(-this.config.maxRecentTurns);

    // Estimate token usage and truncate if necessary
    let tokenCount = 0;
    const truncatedTurns: SessionTurn[] = [];

    for (const turn of recentTurns.reverse()) { // Start from most recent
      const turnTokens = this.estimateStringTokens(turn.content);
      if (tokenCount + turnTokens > this.config.recentTurnsTokens) {
        break;
      }
      truncatedTurns.unshift(turn); // Add to beginning to maintain order
      tokenCount += turnTokens;
    }

    return truncatedTurns;
  }

  /**
   * Retrieve relevant episodic memories using vector search
   */
  private async retrieveEpisodicMemories(
    userId: string,
    queryEmbedding: import('../types/memory.js').VectorEmbedding
  ): Promise<EpisodicMemory[]> {
    try {
      // Search for similar episodic memories
      const searchResults = await this.episodicStorage.search({
        userId,
        query: 'dummy', // Will use vector search internally
        limit: this.config.maxEpisodicMatches * 2, // Get extra for filtering
        threshold: this.config.similarityThreshold,
      });

      // Calculate actual similarities and filter
      const similarities = searchResults.map(memory => ({
        memory,
        similarity: memory.vector
          ? embedder.cosineSimilarity(queryEmbedding.embedding, memory.vector.embedding)
          : 0
      }));

      // Sort by similarity and take top matches
      const sorted = similarities
        .filter(item => item.similarity >= this.config.similarityThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, this.config.maxEpisodicMatches);

      return sorted.map(item => item.memory);
    } catch (error) {
      logger.error({ userId, error }, 'Failed to retrieve episodic memories');
      return []; // Return empty array on error, don't crash
    }
  }

  /**
   * Retrieve relevant long-term memories
   */
  private async retrieveLongTermMemories(
    userId: string,
    queryEmbedding: import('../types/memory.js').VectorEmbedding
  ): Promise<LongTermMemory[]> {
    try {
      // Search for similar long-term memories
      const searchResults = await this.longTermStorage.search({
        userId,
        query: 'dummy', // Will use vector search internally
        limit: this.config.maxLongTermMatches * 2, // Get extra for filtering
        threshold: this.config.similarityThreshold,
      });

      // Filter by confidence and calculate similarities
      const filtered = searchResults
        .filter(memory => memory.metadata.confidence >= this.config.minConfidence)
        .map(memory => ({
          memory,
          similarity: memory.vector
            ? embedder.cosineSimilarity(queryEmbedding.embedding, memory.vector.embedding)
            : 0
        }))
        .filter(item => item.similarity >= this.config.similarityThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, this.config.maxLongTermMatches);

      return filtered.map(item => item.memory);
    } catch (error) {
      logger.error({ userId, error }, 'Failed to retrieve long-term memories');
      return []; // Return empty array on error
    }
  }

  /**
   * Get active procedural rules
   */
  private async getActiveRules(userId: string, tenantId?: string): Promise<ProceduralMemory[]> {
    try {
      // Get rules in priority order
      const allRules = await this.proceduralStorage.getByUserId(userId);

      // Filter active rules and sort by priority
      return allRules
        .filter(rule => {
          const now = Date.now();
          return (
            rule.effectiveFrom <= now &&
            (!rule.effectiveTo || rule.effectiveTo >= now)
          );
        })
        .sort((a, b) => b.priority - a.priority); // Higher priority first
    } catch (error) {
      logger.error({ userId, error }, 'Failed to retrieve active rules');
      return []; // Return empty array on error
    }
  }

  /**
   * Build user profile from long-term memories
   */
  private async buildUserProfile(
    userId: string,
    longTermMemories: LongTermMemory[]
  ): Promise<UserProfile> {
    // Start with basic structure
    const profile: UserProfile = {
      id: userId,
      name: undefined,
      grade: undefined,
      subjects: [],
      learningStyle: 'visual', // Default, will be overridden if found
      preferences: {
        language: 'en',
        tone: 'friendly',
        complexity: 0.7,
        examplePreference: []
      },
      goals: [],
      weaknesses: [],
      strengths: [],
      recentActivity: {
        lastSessionAt: Date.now(),
        sessionCount: 1, // Default assumption
        avgSatisfaction: 0.7
      }
    };

    // Extract information from long-term memories
    for (const memory of longTermMemories) {
      if (memory.category === 'profile') {
        if (memory.key === 'name') profile.name = memory.value;
        if (memory.key === 'grade') profile.grade = memory.value;
      }
      else if (memory.category === 'preference') {
        if (memory.key === 'learning_style') {
          const validStyles = ['visual', 'auditory', 'kinesthetic', 'reading'] as const;
          const style = memory.value as string;
          profile.learningStyle = validStyles.includes(style as typeof validStyles[number]) ? style as typeof validStyles[number] : 'visual';
        }
        if (memory.key === 'language') {
          profile.preferences.language = memory.value;
        }
        if (memory.key === 'tone') {
          profile.preferences.tone = memory.value;
        }
      }
      else if (memory.category === 'skill' || memory.category === 'knowledge') {
        if (profile.subjects if (!profile.subjects.includes(memory.value)) {if (!profile.subjects.includes(memory.value)) { !profile.subjects.includes(memory.value)) {
          profile.subjects profile.subjects.push(memory.value)profile.subjects.push(memory.value) profile.subjects.push(memory.value);
        }
      }
      else if (memory.category === 'profile') {
        if (!profile.weaknesses.includes(memory.value)) {
          profile.weaknesses.push(memory.value);
        }
      }
      else if (memory.category === 'profile') {
        if (!profile.strengths.includes(memory.value)) {
          profile.strengths.push(memory.value);
        }
      }
      else if (memory.category === 'goal') {
        profile.goals.push({
          id: memory.id,
          description: memory.content,
          progress: memory.metadata.confidence * 100, // Convert confidence to progress estimate
          priority: memory.metadata.salience * 100, // Use salience as priority
          status: 'in-progress'
        });
      }
    }

    return profile;
  }

  /**
   * Generate system prompt incorporating all context
   */
  private async generateSystemPrompt(
    userProfile: UserProfile,
    activeRules: ProceduralMemory[],
    episodicMemories: EpisodicMemory[],
    longTermMemories: LongTermMemory[]
  ): Promise<string> {
    let promptParts: string[] = [];

    // Start with base identity
    promptParts.push("You are Amina, a compassionate and knowledgeable AI tutor from Nigeria.");

    // Add user-specific context
    if (userProfile.name) {
      promptParts.push(`The student you're helping is named ${userProfile.name}.`);
    }

    if (userProfile.grade) {
      promptParts.push(`They are in ${userProfile.grade} grade.`);
    }

    if (userProfile.subjects.length > 0) {
      promptParts.push(`They are studying: ${userProfile.subjects.join(', ')}.`);
    }

    // Add learning preferences
    promptParts.push(`Their preferred learning style is ${userProfile.learningStyle}.`);
    promptParts.push(`Use ${userProfile.preferences.language} as the primary language.`);
    promptParts.push(`Maintain a ${userProfile.preferences.tone} tone in your responses.`);

    // Add academic context
    if (userProfile.weaknesses.length > 0) {
      promptParts.push(`They struggle with: ${userProfile.weaknesses.join(', ')}. Be patient and provide extra explanation for these topics.`);
    }

    if (userProfile.strengths.length > 0) {
      promptParts.push(`Their strengths include: ${userProfile.strengths.join(', ')}. Build on these when possible.`);
    }

    // Add current goals
    if (userProfile.goals.length > 0) {
      const activeGoals = userProfile.goals.filter(g => g.status === 'in-progress');
      if (activeGoals.length > 0) {
        promptParts.push(`Current goals: ${activeGoals.map(g => g.description).join('; ')}. Help them work toward these objectives.`);
      }
    }

    // Add relevant episodic context
    if (episodicMemories.length > 0) {
      promptParts.push("\nPrevious session context:");
      for (const episode of episodicMemories.slice(0, 2)) { // Limit to 2 most recent
        promptParts.push(`- ${episode.summary}`);
      }
    }

    // Add important long-term facts
    const importantFacts = longTermMemories
      .filter(m => m.metadata.salience > 0.7) // Only highly salient facts
      .slice(0, 5); // Limit to 5 facts

    if (importantFacts.length > 0) {
      promptParts.push("\nImportant facts about this student:");
      for (const fact of importantFacts) {
        promptParts.push(`- ${fact.category}: ${fact.content}`);
      }
    }

    // Add procedural rules (safety, compliance, etc.)
    if (activeRules.length > 0) {
      promptParts.push("\nRules for this conversation:");
      for (const rule of activeRules) {
        promptParts.push(`- ${rule.condition} → ${rule.action} (Priority: ${rule.priority})`);
      }
    }

    // Add general guidelines
    promptParts.push("\nGeneral guidelines:");
    promptParts.push("- Be culturally aware of Nigerian educational context");
    promptParts.push("- Use relatable examples and analogies");
    promptParts.push("- Encourage and motivate the student");
    promptParts.push("- Provide step-by-step explanations for complex topics");
    promptParts.push("- Ask clarifying questions to gauge understanding");

    // Join all parts and ensure it fits within token budget
    let fullPrompt = promptParts.join('\n\n');

    // Truncate if necessary
    const maxPromptLength = this.config.systemPromptTokens * 4; // Rough estimate: 4 chars per token
    if (fullPrompt.length > maxPromptLength) {
      fullPrompt = fullPrompt.substring(0, maxPromptLength) + "\n\n[TRUNCATED - See full context in memory system]";
    }

    return fullPrompt;
  }

  /**
   * Get active task from recent turns
   */
  private async getActiveTask(recentTurns: SessionTurn[]): Promise<TaskState | undefined> {
    // Look for ongoing tasks in recent conversation
    // This is a simplified implementation - could be enhanced with NLP
    const taskKeywords = ['help me with', 'I need to learn', 'teach me', 'how do I', 'can you explain'];

    for (const turn of recentTurns.reverse()) {
      const content = turn.content.toLowerCase();
      if (taskKeywords.some(keyword => content.includes(keyword))) {
        return {
          id: `task_${Date.now()}`,
          name: turn.content.substring(0, 50),
          progress: 0.1, // Just started
          steps: [{
            id: 'step_1',
            description: 'Understand the student\'s specific needs',
            completed: false
          }]
        };
      }
    }

    return undefined;
  }

  /**
   * Estimate token usage of assembled context
   */
  private estimateTokenUsage(
    systemPrompt: string,
    recentTurns: SessionTurn[],
    episodicMemories: EpisodicMemory[],
    longTermMemories: LongTermMemory[]
  ): number {
    let total = 0;

    // System prompt
    total += this.estimateStringTokens(systemPrompt);

    // Recent turns
    for (const turn of recentTurns) {
      total += this.estimateStringTokens(turn.content);
    }

    // Episodic memories
    for (const memory of episodicMemories) {
      total += this.estimateStringTokens(memory.summary);
    }

    // Long-term memories
    for (const memory of longTermMemories) {
      total += this.estimateStringTokens(memory.content);
    }

    return total;
  }

  /**
   * Estimate tokens in a string (rough approximation: 4 characters per token)
   */
  private estimateStringTokens(str: string): number {
    return Math.ceil(str.length / 4);
  }
}

// Export singleton instance
export const contextAssembler = ContextAssembler.initialize();

/**
 * Convenience function to assemble context
 */
export async function assembleContext(
  userId: string,
  currentMessage: string,
  tenantId?: string
): Promise<AssembledContext> {
  return contextAssembler.assembleContext(userId, currentMessage, tenantId);
}

/**
 * Function to record user turn in memory system
 */
export async function recordUserTurn(
  userId: string,
  messageId: string,
  content: string,
  messageType: string = 'text'
): Promise<void> {
  const sessionStorage = getSessionStorage();
  let session = await sessionStorage.getActiveSession(userId);

  if (!session) {
    // Create new session if none exists
    session = await sessionStorage.createSession(userId);
  }

  const turn: SessionTurn = {
    id: messageId,
    role: 'user',
    content,
    timestamp: Date.now(),
    metadata: {
      tokensIn: Math.ceil(content.length / 4),
      sentiment: 'neutral' // Could be enhanced with sentiment analysis
    }
  };

  await sessionStorage.addTurnToSession(session.sessionId, turn);
}

/**
 * Function to record assistant turn in memory system
 */
export async function recordAssistantTurn(
  userId: string,
  content: string,
  metadata: {
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
  } = {}
): Promise<void> {
  const sessionStorage = getSessionStorage();
  const session = await sessionStorage.getActiveSession(userId);

  if (!session) {
    // Create new session if none exists
    const newSession = await sessionStorage.createSession(userId);
    // Add the assistant turn to the new session
  } else {
    const turn: SessionTurn = {
      id: `ai_${Date.now()}`,
      role: 'assistant',
      content,
      timestamp: Date.now(),
      metadata: {
        tokensOut: metadata.tokensOut || Math.ceil(content.length / 4),
        latencyMs: metadata.latencyMs,
        sentiment: 'neutral'
      }
    };

    await sessionStorage.addTurnToSession(session.sessionId, turn);
  }
}
