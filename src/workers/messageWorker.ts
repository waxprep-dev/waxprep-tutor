/**
 * WaxPrep Message Worker — UPDATED with CUGA AI Brain Integration
 *
 * This replaces the placeholder processWithAI() with the full CUGA multi-agent system.
 * CUGA lives BEHIND the queue — never in the webhook handler.
 */
import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { memory } from '../memory/index.js';
import { Timer } from '../utils/timing.js';
import type { WebhookEvent, MessageEvent } from '../types/webhook.js';
import type { SessionTurn } from '../memory/types/memory.js';

// Import the new modules
import { EmbeddingService } from '../utils/embedder.js';
import { IntentClassifier } from '../intent/classifier.js';
import { EmotionalIntelligence } from '../emotional/intelligence.js';
import { DynamicPromptEngine } from '../prompt-engine/engine.js';
import { ToolSystem } from '../tools/index.js';
import { MultiAgentOrchestrator } from '../orchestration/multi-agent.js';

// Import CUGA client
import { cugaClient } from '../cugaClient.js';

// ═══════════════════════════════════════════════════════════════
// QUEUE SETUP
// ═══════════════════════════════════════════════════════════════

const redisConnection = { url: config.redis.url };

const messageQueue = new Queue(`${config.queue.prefix}:messages`, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: config.queue.maxRetries,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

const statusQueue = new Queue(`${config.queue.prefix}:status`, {
  connection: redisConnection,
});

// ═══════════════════════════════════════════════════════════════
// AI PROCESSING WITH FULL INTEGRATION
// ═══════════════════════════════════════════════════════════════

interface ProcessingResult {
  text: string;
  metadata: {
    agent: string;
    subject: string;
    tools: string[];
    confidence: number;
    mode: string;
    complexity: number;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
    emotionalState: Record<string, unknown>;
    intent: Record<string, unknown>;
  };
}

// Type for the prompt engine profile (inferred from usage)
type LearningStyle = 'visual' | 'auditory' | 'kinesthetic' | 'reading' | 'adaptive';

interface PromptEngineUserProfile {
  name: string;
  subjects: string[];
  learningStyle: LearningStyle;
  proficiencyVector: Record<string, number>;
  engagementScore: number;
  preferences: {
    language: string;
    tone: string;
    complexity: number;
    examplePreference: string[];
  };
  goals: Array<{ id: string; description: string; progress: number; priority: number; status: string }>;
  weaknesses: string[];
  strengths: string[];
  recentActivity: {
    lastSessionAt: number;
    sessionCount: number;
    avgSatisfaction: number;
  };
}

/**
 * Process message with integrated AI pipeline — the heart of the tutoring system */
async function processWithAI(
  message: string,
  userId: string,
): Promise<ProcessingResult> {
  const timer = new Timer();

  // Initialize the embedding service
  const embedder = EmbeddingService.fromEnvironment();

  // Step 1: Classify intent probabilistically
  const intentResult = await IntentClassifier.getInstance(embedder).classify(
    message,
    [] // conversation history
  );

  // Step 2: Assess emotional state using VAD model
  const emotionalState = await EmotionalIntelligence.getInstance(embedder)
    .assessEmotionalState(message, userId);

  // Step 3: Load conversation history and user profile from memory
  const context = await memory.assembleContext(userId, message);
  const userProfile = await memory.getUserProfile(userId);

  // Helper to validate learning style
  const validLearningStyles: LearningStyle[] = ['visual', 'auditory', 'kinesthetic', 'reading', 'adaptive'];
  const normalizeLearningStyle = (style: unknown): LearningStyle => {
    if (typeof style === 'string' && validLearningStyles.includes(style as LearningStyle)) {
      return style as LearningStyle;
    }
    return 'adaptive';
  };

  // Convert userProfile to a plain object for compatibility
  const profileObj: PromptEngineUserProfile = userProfile && typeof userProfile === 'object' && 'id' in userProfile
    ? {
        name: (userProfile as { name?: string }).name || '',
        subjects: (userProfile as { subjects?: string[] }).subjects || [],
        learningStyle: normalizeLearningStyle((userProfile as { learningStyle?: string }).learningStyle),
        proficiencyVector: (userProfile as { proficiencyVector?: Record<string, number> }).proficiencyVector || {},
        engagementScore: (userProfile as { engagementScore?: number }).engagementScore || 0.5,
        preferences: (userProfile as { preferences?: { language: string; tone: string; complexity: number; examplePreference: string[] } }).preferences || {
          language: 'en',
          tone: 'friendly',
          complexity: 0.5,
          examplePreference: [],
        },
        goals: (userProfile as { goals?: Array<{ id: string; description: string; progress: number; priority: number; status: string }> }).goals || [],
        weaknesses: (userProfile as { weaknesses?: string[] }).weaknesses || [],
        strengths: (userProfile as { strengths?: string[] }).strengths || [],
        recentActivity: (userProfile as { recentActivity?: { lastSessionAt: number; sessionCount: number; avgSatisfaction: number } }).recentActivity || {
          lastSessionAt: Date.now(),
          sessionCount: 1,
          avgSatisfaction: 0.8,
        },
      }
    : {
        name: '',
        subjects: [],
        learningStyle: 'adaptive',
        proficiencyVector: {},
        engagementScore: 0.5,
        preferences: {
          language: 'en',
          tone: 'friendly',
          complexity: 0.5,
          examplePreference: [],
        },
        goals: [],
        weaknesses: [],
        strengths: [],
        recentActivity: {
          lastSessionAt: Date.now(),
          sessionCount: 1,
          avgSatisfaction: 0.8,
        },
      };

  // Step 4: Assemble dynamic prompt using attention mechanism
  const promptResult = await DynamicPromptEngine.getInstance(embedder).assemblePrompt({
    currentMessage: message,
    messageEmbedding: (await embedder.embed(message)).embedding,
    recentTurns: context.recentTurns || [],
    episodicMemories: [],
    longTermFacts: [],
    intentDistribution: intentResult.distribution,
    emotionalState: [emotionalState.valence, emotionalState.arousal, emotionalState.dominance],
    userProfile: profileObj,
    session: {
      messageCount: 1,
      startTime: Date.now(),
      subjectTrajectory: [],
    },
  });

  // Step 5: Select tools based on embedding similarity
  const tools = await ToolSystem.getInstance(embedder).selectTools(message, {
    userId,
    userProfile: profileObj as unknown as Record<string, unknown>,
    conversationHistory: context.recentTurns || [],
    intent: intentResult.primaryIntent,
  });

  // Step 6: Route to best agent using multi-agent orchestrator
  const agentResponse = await MultiAgentOrchestrator.getInstance(embedder).route(
    message,
    {
      userProfile: profileObj as unknown as Record<string, unknown>,
      recentTurns: context.recentTurns || [],
      intent: intentResult.primaryIntent,
      intentConfidence: intentResult.confidence,
      mode: 'balanced',
    },
    async (
      systemPrompt: string,
      userMessage: string,
      ctx: Record<string, unknown>,
    ) => {
      // This function would call your LLM to generate a response
      // For now, we'll call the CUGA client which may use this prompt internally
      const cugaResponse = await cugaClient.tutor(userMessage, userId, {
        systemPrompt,
        recentTurns: recentTurnsForCuga,
        retrievedMemories: [],
        userProfile: ctx.userProfile as Record<string, unknown>,
        activeTask: undefined,
        assemblyMetadata: {
          durationMs: timer.elapsedMs(),
          tokensUsed: 0,
          tokensBudget: 8000,
          memorySources: { session: 0, episodic: 0, longTerm: 0, procedural: 0 },
        },
      });

      return {
        text: cugaResponse.answer,
        confidence: cugaResponse.confidence,
        tokensUsed: {
          prompt: cugaResponse.tokens_used?.prompt || 0,
          completion: cugaResponse.tokens_used?.completion || 0,
        },
        latencyMs: timer.elapsedMs(),
      };
    }
  );

  const latencyMs = timer.elapsedMs();

  // Step 7: Record exchange in memory system
  await memory.recordExchange(
    userId,
    `msg_${Date.now()}`,
    message,
    agentResponse.response.text,
    {
      tokensIn: agentResponse.response.tokensUsed.prompt,
      tokensOut: agentResponse.response.tokensUsed.completion,
      latencyMs,
      agentUsed: agentResponse.response.agentName,
      intent: intentResult.primaryIntent,
      emotionalState: emotionalState as unknown as Record<string, unknown>,
    }
  );

  // Step 8: Store learning moment if confidence is high
  if (agentResponse.response.confidence > 0.85 && agentResponse.routingDecision) {
    try {
      await memory.storeFact(
        userId,
        'skill',
        `engagement_${intentResult.primaryIntent}`,
        'active',
        `Student actively engaged with ${intentResult.primaryIntent} tutoring via ${agentResponse.response.agentName}`,
        agentResponse.response.confidence,
      );
    } catch (e) {
      // Non-critical: don't fail if memory storage fails
      logger.warn({ userId, error: e }, 'Learning moment storage failed');
    }
  }

  // Step 9: Track study streak for gamification
  try {
    await memory.storeFact(
      userId,
      'behavior',
      'last_study_session',
      new Date().toISOString(),
      `Study session at ${new Date().toISOString()}`,
      1.0,
    );
  } catch {
    // Non-critical
  }

  return {
    text: agentResponse.response.text,
    metadata: {
      agent: agentResponse.response.agentName,
      subject: intentResult.primaryIntent,
      tools: agentResponse.response.toolsUsed,
      confidence: agentResponse.response.confidence,
      mode: 'balanced',
      complexity: 0.5,
      latencyMs,
      tokensIn: agentResponse.response.tokensUsed.prompt,
      tokensOut: agentResponse.response.tokensUsed.completion,
      emotionalState: {
        valence: emotionalState.valence,
        arousal: emotionalState.arousal,
        dominance: emotionalState.dominance,
        category: emotionalState.category,
      } as Record<string, unknown>,
      intent: {
        primary: intentResult.primaryIntent,
        confidence: intentResult.confidence,
      } as Record<string, unknown>,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP MESSAGE SENDING
// ═══════════════════════════════════════════════════════════════

interface WhatsAppMessage {
  to: string;
  body: string;
  metadata?: Record<string, unknown>;
}

/**
 * Send message via Meta Cloud API
 */
async function sendWhatsAppMessage(message: WhatsAppMessage): Promise<void> {
  const url = `https://graph.facebook.com/v18.0/${config.meta.phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to,
    type: 'text',
    text: {
      body: message.body,
      preview_url: false,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.meta.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp API error: ${response.status} - ${error}`);
  }
}

/**
 * Send typing indicator (shows "typing..." to user)
 */
async function sendTypingIndicator(to: string): Promise<void> {
  const url = `https://graph.facebook.com/v18.0/${config.meta.phoneNumberId}/messages`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.meta.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: '' },
    }),
  });
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════

interface MessageJobData {
  event: WebhookEvent;
  sourceIp: string;
  signature: string;
}

/**
 * Check if an event is a message event with text
 */
function isMessageEvent(event: WebhookEvent): event is MessageEvent {
  return event.type === 'message';
}

/**
 * Handle a single incoming WhatsApp message
 */
async function handleMessage(job: Job<MessageJobData>): Promise<Record<string, unknown>> {
  const { event } = job.data;

  // Cast to MessageEvent to access .from and .text
  const msgEvent = isMessageEvent(event) ? event : null;
  const userId = msgEvent?.from || event.sourcePhone || 'unknown';
  const messageText = msgEvent?.text || '';

  logger.info({
    jobId: job.id,
    userId,
    messagePreview: messageText.substring(0, 60),
    attempt: job.attemptsMade + 1,
  }, 'Processing message with integrated AI pipeline');

  // Skip non-text messages (images, audio, etc. — handle separately)
  if (!msgEvent || !messageText) {
    logger.info({ jobId: job.id, type: event.type }, 'Skipping non-text message');
    return { success: true, skipped: true, reason: 'non-text' };
  }

  try {
    // Step 1: Send typing indicator for UX
    await sendTypingIndicator(userId).catch(() => { /* ignore */ });

    // Step 2: Process with integrated AI pipeline
    const result = await processWithAI(messageText, userId);

    // Step 3: Format for WhatsApp (ensure it's under character limits)
    let whatsappMessage = result.text;
    if (whatsappMessage.length > 1024) {
      whatsappMessage = whatsappMessage.substring(0, 1020) + '...';
    }

    // Step 4: Send response
    await sendWhatsAppMessage({
      to: userId,
      body: whatsappMessage,
      metadata: result.metadata,
    });

    // Step 5: Log success
    logger.info({
      jobId: job.id,
      userId,
      agent: result.metadata.agent,
      subject: result.metadata.subject,
      mode: result.metadata.mode,
      confidence: result.metadata.confidence.toFixed(3),
      latencyMs: result.metadata.latencyMs,
      tokensIn: result.metadata.tokensIn,
      tokensOut: result.metadata.tokensOut,
    }, 'Message processed successfully');

    return {
      success: true,
      agent: result.metadata.agent,
      subject: result.metadata.subject,
      mode: result.metadata.mode,
      confidence: result.metadata.confidence,
      latencyMs: result.metadata.latencyMs,
    };

  } catch (error) {
    logger.error({ jobId: job.id, error }, 'Processing error');

    // Last resort: send generic response so user isn't left hanging
    if (job.attemptsMade >= config.queue.maxRetries - 1) {
      await sendWhatsAppMessage({
        to: userId,
        body: "I apologize, I'm having technical difficulties. Please try again!",
      }).catch(() => { /* ignore */ });
    }

    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// WORKER SETUP
// ═══════════════════════════════════════════════════════════════

export function startMessageWorker(): Worker<MessageJobData> {
  const worker = new Worker(
    `${config.queue.prefix}:messages`,
    handleMessage,
    {
      connection: redisConnection,
      concurrency: config.queue.concurrency,
      limiter: {
        max: 60,
        duration: 60000,
      },
    }
  );

  // Event handlers
  worker.on('completed', (job, result) => {
    if (!(result as Record<string, unknown>)?.skipped) {
      logger.info({ jobId: job.id, result }, 'Job completed');
    }
  });

  worker.on('failed', (job, error) => {
    logger.error({
      jobId: job?.id,
      error: error instanceof Error ? error.message : String(error),
      attempts: job?.attemptsMade,
    }, 'Job failed after all retries');
  });

  worker.on('error', (error) => {
    logger.error({ error }, 'Worker error');
  });

  logger.info('Message worker started with integrated AI pipeline');

  return worker;
}

// ═══════════════════════════════════════════════════════════════
// STATUS WORKER
// ═══════════════════════════════════════════════════════════════

export function startStatusWorker(): Worker {
  const worker = new Worker(
    `${config.queue.prefix}:status`,
    async (job) => {
      const data = job.data as { event?: Record<string, unknown> };
      logger.debug({ event: data.event }, 'Status update received');
      // Track message delivery status
      // Update analytics in Supabase
    },
    { connection: redisConnection }
  );

  logger.info('Status worker started');
  return worker;
}

// ═══════════════════════════════════════════════════════════════
// DEAD LETTER QUEUE WORKER
// ═══════════════════════════════════════════════════════════════

export function startDLQWorker(): Worker {
  const worker = new Worker(
    `${config.queue.prefix}:messages:dlq`,
    async (job) => {
      logger.warn({
        jobId: job.id,
        data: job.data,
        failedReason: job.failedReason,
      }, 'Dead letter queue job — manual review needed');

      // Store for manual review
      // Send alert to admin
      // Could trigger fallback to human tutor
    },
    { connection: redisConnection }
  );

  logger.info('DLQ worker started');
  return worker;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export { messageQueue, statusQueue };
