/**
 * Message Worker — INTEGRATED WITH MEMORY SYSTEM
 * 
 * YOUR TEAM: Replace processWithAI() with your Gamma 4 / Kimi 4.3 API call
 */

import { Worker } from 'bullmq';
import { config } from '../config/index.js';
import { getRedisClient, markEventCompleted, markEventFailed, releaseEventClaim } from '../storage/idempotency.js';
import { markEventProcessed } from '../storage/supabase.js';
import { logWorkerStart, logWorkerComplete, logWorkerError } from '../utils/logger.js';
import { Timer } from '../utils/timing.js';
import { moveToDeadLetter } from '../queue/index.js';
import { memory } from '../memory/index.js';  // <-- MEMORY SYSTEM IMPORT
import type { WebhookJobData } from '../types/queue.js';
import type { MessageEvent } from '../types/webhook.js';

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379'),
  password: config.redis.password || undefined,
  db: config.redis.db,
};

/**
 * YOUR TEAM: Replace with actual Gamma 4 / Kimi 4.3 API integration
 */
async function processWithAI(
  userId: string,
  message: string,
  context: Awaited<ReturnType<typeof memory.assembleContext>>
): Promise<{
  success: boolean;
  responseText?: string;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}> {
  // ============================================================
  // YOUR TEAM: REPLACE WITH ACTUAL AI API CALL
  // ============================================================
  
  // The context object contains everything your AI needs:
  // - context.systemPrompt: Dynamic system prompt with user profile, rules, facts
  // - context.recentTurns: Last N conversation turns
  // - context.retrievedMemories: Relevant episodic and long-term memories
  // - context.activeTask: Current task state
  // - context.userProfile: Structured user data
  
  console.log(`[AI PLACEHOLDER] Processing for ${userId}`);
  console.log(`System prompt length: ${context.systemPrompt.length} chars`);
  console.log(`Recent turns: ${context.recentTurns.length}`);
  console.log(`Retrieved memories: ${context.retrievedMemories.length}`);
  
  // Example Gamma 4 integration:
  // const response = await fetch('https://api.gamma4.ai/v1/chat', {
  //   method: 'POST',
  //   headers: { 'Authorization': `Bearer ${config.ai.gamma4ApiKey}` },
  //   body: JSON.stringify({
  //     model: 'gamma-4',
  //     system: context.systemPrompt,
  //     messages: [
  //       ...context.recentTurns.map(t => ({ role: t.role, content: t.content })),
  //       { role: 'user', content: message }
  //     ],
  //     context_documents: context.retrievedMemories.map(m => m.memory.content),
  //   }),
  // });
  
  return {
    success: true,
    responseText: `[Placeholder response for: ${message.substring(0, 50)}...]`,
    tokensIn: context.systemPrompt.length / 4,
    tokensOut: 50,
    latencyMs: 500,
  };
}

export function startMessageWorker(): Worker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(
    `${config.queue.prefix}:messages`,
    async (job) => {
      const timer = new Timer();
      const event = job.data.event as MessageEvent;
      
      logWorkerStart(event.id, 'messageWorker', job.attemptsMade + 1);
      
      try {
        await markEventCompleted(event.id);
        
        // =====================================================================
        // STEP 1: Record user message in memory system
        // =====================================================================
        await memory.recordUserMessage(
          event.from,
          event.messageId,
          event.text || '[media message]',
          event.subtype
        );
        
        // =====================================================================
        // STEP 2: Assemble context (the magic happens here)
        // =====================================================================
        const context = await memory.assembleContext(
          event.from,
          event.text || '',
          undefined // tenantId if multi-tenant
        );
        
        // =====================================================================
        // STEP 3: Call your AI with assembled context
        // =====================================================================
        const aiResult = await processWithAI(event.from, event.text || '', context);
        
        if (!aiResult.success || !aiResult.responseText) {
          throw new Error(aiResult.error || 'AI processing failed');
        }
        
        // =====================================================================
        // STEP 4: Record AI response in memory system
        // =====================================================================
        await memory.recordAIResponse(event.from, aiResult.responseText, {
          tokensIn: aiResult.tokensIn,
          tokensOut: aiResult.tokensOut,
          latencyMs: aiResult.latencyMs,
        });
        
        // =====================================================================
        // STEP 5: Send response back to user (YOUR TEAM: implement WhatsApp send)
        // =====================================================================
        // await sendWhatsAppMessage(event.from, aiResult.responseText);
        
        await markEventProcessed(event.id);
        
        const durationMs = timer.elapsedMs();
        logWorkerComplete(event.id, 'messageWorker', durationMs);
        
        return {
          success: true,
          processedAt: Date.now(),
          durationMs,
          aiLatencyMs: aiResult.latencyMs,
          contextAssemblyMs: context.assemblyMetadata.durationMs,
        };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logWorkerError(event.id, 'messageWorker', error, job.attemptsMade + 1);
        
        if (job.attemptsMade >= (job.opts.attempts || config.queue.maxRetries) - 1) {
          await moveToDeadLetter(job, errorMessage);
          await markEventProcessed(event.id, errorMessage);
        } else {
          await releaseEventClaim(event.id);
        }
        
        throw error;
      }
    },
    {
      connection,
      concurrency: config.queue.concurrency,
      limiter: { max: 80, duration: 1000 },
    }
  );

  console.log('Message worker started (with memory system)');
  return worker;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMessageWorker();
}
