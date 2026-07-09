/**
 * Memory Consolidation Worker
 * Background job that transforms session memories into episodic and long-term memories
 * Uses AI to summarize sessions and extract important facts
 */

import { Worker, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../../config/index.js';
import { SessionMemory, EpisodicMemory, LongTermMemory } from '../types/memory.js';
import { getSessionStorage } from '../layers/session.js';
import { getEpisodicStorage } from '../layers/episodic.js';
import { getLongTermStorage } from '../layers/longterm.js';
import { getProceduralStorage } from '../layers/procedural.js';
import { embedder } from '../core/embedder.js';
import { decayEngine } from '../core/decay.js';
import { logger } from '../../utils/logger.js';
import { Timer } from '../../utils/timing.js';

// Define the job data structure
interface ConsolidationJobData {
  sessionId: string;
  userId: string;
  trigger: 'session_end' | 'scheduled' | 'manual';
  metadata?: {
    initiatedBy?: string;
    reason?: string;
    scheduledTime?: number;
  };
}

// Define the AI service interface
interface AIService {
  summarizeSession(session: SessionMemory): Promise<SessionSummaryResult>;
  extractFacts(session: SessionMemory, summary: SessionSummaryResult): Promise<LongTermMemory[]>;
}

// Result interfaces
interface SessionSummaryResult {
  summary: string;
  keyOutcomes: string[];
  openItems: string[];
  userGoals: string[];
  aiActions: string[];
  satisfactionScore?: number;
  topicCoverage: string[];
  difficultyLevel: number;
}

class PlaceholderAIService implements AIService {
  async summarizeSession(session: SessionMemory): Promise<SessionSummaryResult> {
    // This is a placeholder - replace with actual AI integration
    logger.warn('Using placeholder AI service - replace with actual Gamma-4/Kimi integration');

    // Analyze the session turns to create a summary
    const allContent = session.turns.map(t => t.content).join(' ');

    // Extract some basic information
    const keyOutcomes: string[] = [];
    const openItems: string[] = [];
    const userGoals: string[] = [];
    const aiActions: string[] = [];

    // Simple keyword-based extraction (replace with real NLP)
    if (allContent.toLowerCase().includes('thank')) {
      keyOutcomes.push('Student expressed gratitude');
    }

    if (allContent.toLowerCase().includes('confused')) {
      openItems.push('Student showed confusion about a topic');
    }

    if (allContent.toLowerCase().includes('goal')) {
      userGoals.push('Student mentioned a learning goal');
    }

    if (allContent.toLowerCase().includes('example')) {
      aiActions.push('AI provided an example');
    }

    return {
      summary: `Session with ${session.userId} covering various topics. Student participated actively.`,
      keyOutcomes: keyOutcomes.length > 0 ? keyOutcomes : ['General participation'],
      openItems: openItems.length > 0 ? openItems : ['No specific items identified'],
      userGoals: userGoals.length > 0 ? userGoals : ['No specific goals mentioned'],
      aiActions: aiActions.length > 0 ? aiActions : ['General tutoring'],
      satisfactionScore: 0.7, // Default score
      topicCoverage: ['general'],
      difficultyLevel: 0.5
    };
  }

  async extractFacts(session: SessionMemory, summary: SessionSummaryResult): Promise<LongTermMemory[]> {
    // This is a placeholder - replace with actual AI fact extraction
    logger.warn('Using placeholder fact extraction - replace with actual AI integration');

    // In a real implementation, this would use your AI model to extract
    // specific facts about the user from the session
    const facts: LongTermMemory[] = [];

    // Example: Extract learning preferences
    if (summary.topicCoverage.includes('math') || session.turns.some(t => t.content.toLowerCase().includes('math'))) {
      facts.push({
        id: `ltm_${session.userId}_subject_math_${Date.now()}`,
        userId: session.userId,
        tenantId: session.tenantId,
        layer: 'longterm',
        category: 'knowledge',
        factType: 'dynamic',
        key: 'preferred_subject',
        value: 'math',
        content: 'Student showed interest in mathematics during this session',
        context: 'Identified from session participation',
        contradictions: [],
        verificationStatus: 'unverified',
        vector: await embedder.embed('Student showed interest in mathematics during this session'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          accessCount: 0,
          lastAccessedAt: Date.now(),
          confidence: 0.7,
          salience: 0.6,
          source: 'session_analysis',
          tags: ['subject', 'interest', 'mathematics'],
          sourceMessages: [],
          evidenceStrength: 0.7,
          temporalRelevance: 0.8
        }
      });
    }

    return facts;
  }
}

export class ConsolidationWorker {
  private worker: Worker<ConsolidationJobData>;
  private queue: Queue<ConsolidationJobData>;
  private readonly redisConnection: { host: string; port: number; password?: string; db: number };
  private readonly aiService: AIService;

  constructor(aiService?: AIService) {
    this.redisConnection = getRedisConnectionConfig();

    this.queue = new Queue<ConsolidationJobData>(`${config.queue.prefix}_memory_consolidation`, {
      connection: this.redisConnection,
    });

    this.aiService = aiService || new PlaceholderAIService();

    this.worker = new Worker<ConsolidationJobData>(
      `${config.queue.prefix}_memory_consolidation`,
      async (job) => {
        const timer = new Timer();
        logger.info({ jobId: job.id, sessionId: job.data.sessionId }, 'Starting memory consolidation job');

        try {
          await this.consolidateSession(job.data.sessionId, job.data.userId);

          const durationMs = timer.elapsedMs();
          logger.info({
            jobId: job.id,
            sessionId: job.data.sessionId,
            durationMs
          }, 'Memory consolidation completed');

          return { success: true, durationMs };
        } catch (error) {
          const durationMs = timer.elapsedMs();
          logger.error({
            jobId: job.id,
            sessionId: job.data.sessionId,
            error: error instanceof Error ? error.message : String(error),
            durationMs
          }, 'Memory consolidation failed');

          throw error;
        }
      },
      {
        connection: this.redisConnection,
        concurrency: 2, // Conservative concurrency for memory-intensive operations
      }
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Consolidation job completed');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({
        jobId: job?.id,
        sessionId: job?.data.sessionId,
        error: err.message
      }, 'Consolidation job failed');
    });
  }

  /**
   * Consolidate a session into episodic and long-term memories
   */
  private async consolidateSession(sessionId: string, userId: string): Promise<void> {
    const sessionStorage = getSessionStorage();
    const episodicStorage = getEpisodicStorage();
    const longTermStorage = getLongTermStorage();

    // Get the session to consolidate
    const session = await sessionStorage.getActiveSession(userId);
    if (!session || session.sessionId !== sessionId) {
      // If session is not active, try to get it directly (if consolidation is happening post-closure)
      throw new Error(`Session not found or not active: ${sessionId}`);
    }

    // Use AI to summarize the session
    const summaryResult = await this.aiService.summarizeSession(session);

    // Create episodic memory from the summary
    const episodicMemory: Omit<EpisodicMemory, 'id' | 'createdAt' | 'updatedAt'> = {
      userId: session.userId,
      tenantId: session.tenantId,
      layer: 'episodic',
      sessionId: session.sessionId,
      content: session.turns.map(t => `${t.role}: ${t.content}`).join('\n'),
      summary: summaryResult.summary,
      keyOutcomes: summaryResult.keyOutcomes,
      openItems: summaryResult.openItems,
      userGoals: summaryResult.userGoals,
      aiActions: summaryResult.aiActions,
      durationMs: session.metadata.lastActivityAt - session.metadata.startTime,
      turnCount: session.turns.length,
      satisfactionScore: summaryResult.satisfactionScore,
      vector: await embedder.embed(summaryResult.summary),
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now(),
        confidence: 0.8,
        salience: 0.7,
        source: 'session_consolidation',
        tags: ['session_summary', 'episodic_memory', ...summaryResult.topicCoverage],
        sessionDuration: session.metadata.lastActivityAt - session.metadata.startTime,
        turnCount: session.turns.length,
        topicCoverage: summaryResult.topicCoverage,
        difficultyLevel: summaryResult.difficultyLevel,
      }
    };

    // Save episodic memory
    const createdEpisodic = await episodicStorage.create(episodicMemory);

    // Extract facts using AI
    const facts = await this.aiService.extractFacts(session, summaryResult);

    // Save facts to long-term memory
    if (facts.length > 0) {
      await longTermStorage.bulkUpsert(facts);
    }

    // Update session to mark as consolidated
    // In a real implementation, you might want to archive the session
    // rather than keep it in active memory

    logger.info({
      userId,
      sessionId,
      episodicMemoryId: createdEpisodic.id || 'unknown',
      factsExtracted: facts.length
    }, 'Session consolidated successfully');
  }

  /**
   * Queue a consolidation job
   */
  async queueConsolidation(
    sessionId: string,
    userId: string,
    trigger: 'session_end' | 'scheduled' | 'manual' = 'session_end',
    delay?: number
  ): Promise<string> {
    const jobData: ConsolidationJobData = {
      sessionId,
      userId,
      trigger,
      metadata: {
        initiatedBy: 'system',
        reason: `Session ended - triggering consolidation`,
        scheduledTime: delay ? Date.now() + delay : undefined
      }
    };

    const job = await this.queue.add('consolidate-session', jobData, {
      delay, // Delay in ms if specified
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    logger.info({
      jobId: job.id,
      sessionId: sessionId || 'unknown',
      userId,
      delay
    }, 'Consolidation job queued');

    return job.id ?? "unknown";
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    logger.info('Starting memory consolidation worker');
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    logger.info('Stopped memory consolidation worker');
  }

  /**
   * Get queue metrics
   */
  async getMetrics(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
    };
  }
}

// Singleton instance
let consolidationWorkerInstance: ConsolidationWorker | null = null;

export function startConsolidationWorker(aiService?: AIService): ConsolidationWorker {
  if (!consolidationWorkerInstance) {
    consolidationWorkerInstance = new ConsolidationWorker(aiService);
    consolidationWorkerInstance.start();
  }
  return consolidationWorkerInstance;
}

export function getConsolidationWorker(): ConsolidationWorker | null {
  return consolidationWorkerInstance;
}

// For direct usage without BullMQ
export async function consolidateSessionDirect(
  sessionId: string,
  userId: string,
  aiService?: AIService
): Promise<void> {
  const worker = new ConsolidationWorker(aiService);
  await worker['consolidateSession'](sessionId, userId);
}
