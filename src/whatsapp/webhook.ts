import { Request, Response } from "express";
import { verifyWebhookSignature, verifyChallenge } from "./verify";
import { query, withTransaction } from "../db/client";
import { createIfMissing, touchStudent, incrementOutboundCount } from "../memory/profile";
import { getOrCreateCurrentEpisode, incrementEpisodeMessageCount, getRecentHistory } from "../memory/episodes";
import { assembleContext } from "../memory/retrieval";
import { buildPrompt } from "../brain/promptBuilder";
import { runAgentLoop } from "../brain/agentLoop";
import { sendTextMessage } from "./sender";
import { logger } from "../utils/logger";
import TheVoid from "../consciousness/TheVoid";
import { config } from "../config";
import { 
  validateTimestamp, 
  sanitizeMessageId, 
  sanitizeMessageText, 
  sanitizeInteractivePayload
} from "../utils/validation";
import { generateSecureId } from "../utils/security";

const theVoid = new TheVoid();

const FALLBACK_MESSAGE = process.env.FALLBACK_MESSAGE || 
  "Gimme one sec, gathering my thoughts on that 🧠 — try sending it again in a moment.";

export async function handleWebhookGet(req: Request, res: Response): Promise<void> {
  const mode = req.query["hub.mode"] as string | undefined;
  const token = req.query["hub.verify_token"] as string | undefined;
  const challenge = req.query["hub.challenge"] as string | undefined;

  const result = verifyChallenge(mode, token, challenge);
  if (result) {
    logger.info("Webhook verified");
    res.status(200).send(result);
    return;
  }
  res.status(403).send("Forbidden");
}

export async function handleWebhookPost(req: Request, res: Response): Promise<void> {
  const rawBody = (req as any).rawBody as string;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn("Invalid webhook signature");
    res.status(401).send("Invalid signature");
    return;
  }

  res.status(200).send("OK");

  try {
    await processWebhookAsync(req.body);
  } catch (err: any) {
    logger.error("Webhook processing failed, sending to dead letter queue", { 
      error: err.message,
      stack: err.stack 
    });
    
    try {
      await query(
        `INSERT INTO webhook_dead_letter (payload, error_message)
         VALUES ($1, $2)`,
        [JSON.stringify(req.body), err.message.slice(0, 1000)]
      );
    } catch (dlqError: any) {
      logger.error("Failed to write to dead letter queue", { error: dlqError.message });
    }
  }
}

async function runAgentLoopSafely(
  messages: any[],
  ctx: { phone: string; episodeId: string }
): Promise<{ finalResponse: string; totalTokens?: number; allToolCalls: any[]; modelUsed?: string } | null> {
  try {
    return await runAgentLoop(messages, ctx);
  } catch (err: any) {
    logger.error("Agent loop failed — sending fallback", {
      phone: ctx.phone,
      error: err.message,
    });
    
    await sendTextMessage(ctx.phone, FALLBACK_MESSAGE);
    
    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, ai_response, timestamp, episode_id)
       VALUES ($1, $2, 'outbound', $3, $3, NOW(), $4)`,
      [generateSecureId("fallback"), ctx.phone, FALLBACK_MESSAGE, ctx.episodeId]
    );
    
    return null;
  }
}

async function processWebhookAsync(body: any): Promise<void> {
  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  if (!message) return;

  const fromPhone = message.from;
  if (!fromPhone || typeof fromPhone !== "string") {
    logger.warn("Missing or invalid from phone");
    return;
  }

  const rawMessageId = message.id;
  if (!rawMessageId || typeof rawMessageId !== "string") {
    logger.warn("Missing message ID");
    return;
  }
  const messageId = sanitizeMessageId(rawMessageId);

  let timestamp: Date;
  try {
    timestamp = validateTimestamp(message.timestamp);
  } catch (err: any) {
    logger.error("Invalid timestamp in webhook", { timestamp: message.timestamp, error: err.message });
    timestamp = new Date();
  }

  const duplicateCheck = await query(
    `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
     VALUES ($1, $2, 'inbound', $3, $4, '00000000-0000-0000-0000-000000000000')
     ON CONFLICT (message_id) DO NOTHING
     RETURNING message_id`,
    [messageId, fromPhone, "[placeholder]", timestamp]
  );

  if (duplicateCheck.length === 0) {
    logger.info("Duplicate message, skipping", { message_id: messageId });
    return;
  }

  let messageText = "";
  
  if (message.type === "text") {
    messageText = sanitizeMessageText(message.text?.body || "");
  } else if (message.type === "interactive") {
    messageText = sanitizeInteractivePayload(message.interactive);
  } else if (message.type === "audio") {
    messageText = "[Voice message received — transcription not yet available]";
    await sendTextMessage(fromPhone, 
      "I can't listen to voice notes yet 😅. Send me a text message and I'll help you right away!"
    );
    return;
  } else {
    await sendTextMessage(fromPhone, "I can read text best right now. Send me a message!");
    return;
  }

  if (!messageText || messageText.length === 0) {
    logger.info("Empty message after sanitization, skipping");
    return;
  }

  logger.info("Inbound message", {
    from: fromPhone,
    type: message.type,
    message_id: messageId,
    length: messageText.length,
  });

  await createIfMissing(fromPhone);
  await touchStudent(fromPhone);

  const episode = await getOrCreateCurrentEpisode(fromPhone);
  await incrementEpisodeMessageCount(episode.episode_id);

  await query(
    `UPDATE message_log 
     SET raw_text = $1, episode_id = $2
     WHERE message_id = $3`,
    [messageText, episode.episode_id, messageId]
  );

  const history = await getRecentHistory(fromPhone, episode.episode_id, messageId, 20);
  const context = await assembleContext(fromPhone, messageText);

  const startTime = Date.now();
  let finalResponse = "";
  let allToolCalls: any[] = [];
  let totalTokens = 0;
  let modelUsed = "cerebras";
  let perceptionResult: any = null;
  let contextBundleResult: any = null;

  try {
    const voidResult = await theVoid.processMessage(
      fromPhone,
      messageText,
      history.map((m: any) => m.content || ""),
      context.profile,
      { ...context, currentEpisodeId: episode.episode_id }
    );
    
    finalResponse = voidResult.response || "";
    allToolCalls = voidResult.toolsCalled || [];
    perceptionResult = voidResult.perception;
    contextBundleResult = voidResult.contextBundle;
    
    if (voidResult.guardianDecision?.decision !== "approve") {
      logger.warn("Guardian intervened", { 
        decision: voidResult.guardianDecision?.decision,
        reason: voidResult.guardianDecision?.reason 
      });
    }
    
  } catch (voidError: any) {
    const isSafetyError = voidError.message?.toLowerCase().includes("safety") ||
                          voidError.message?.toLowerCase().includes("crisis") ||
                          voidError.message?.toLowerCase().includes("risk");
    
    if (isSafetyError) {
      logger.error("TheVoid safety failure, NOT falling back to agentLoop", { error: voidError.message });
      finalResponse = FALLBACK_MESSAGE;
    } else {
      logger.warn("TheVoid failed, falling back to agentLoop", { error: voidError.message });
      const messages = buildPrompt(context, messageText, history);
      const fallbackResult = await runAgentLoopSafely(messages, {
        phone: fromPhone,
        episodeId: episode.episode_id,
      });
      
      if (fallbackResult) {
        finalResponse = fallbackResult.finalResponse || "";
        allToolCalls = fallbackResult.allToolCalls || [];
        totalTokens = fallbackResult.totalTokens || 0;
        modelUsed = fallbackResult.modelUsed || "cerebras";
      }
    }
  }

  const latency = Date.now() - startTime;

  if (!finalResponse) {
    logger.warn("No final response generated", { phone: fromPhone });
    return;
  }

  const outboundMessageId = generateSecureId("out");

  await query(
    `INSERT INTO message_log (message_id, student_phone, direction, raw_text, ai_tool_calls, ai_response, timestamp, episode_id, latency_ms, model_used)
     VALUES ($1, $2, 'outbound', $3, $4, $5, NOW(), $6, $7, $8)`,
    [
      outboundMessageId,
      fromPhone,
      finalResponse,
      JSON.stringify(allToolCalls),
      finalResponse,
      episode.episode_id,
      latency,
      modelUsed
    ]
  );

  await incrementOutboundCount(fromPhone);
  await sendTextMessage(fromPhone, finalResponse);

  logger.info("Message processed", {
    phone: fromPhone,
    type: message.type,
    latency_ms: latency,
    tokens: totalTokens,
    tool_calls: allToolCalls.length,
  });

  if (perceptionResult && contextBundleResult) {
    setImmediate(async () => {
      try {
        await theVoid.evolve(
          fromPhone,
          messageText,
          perceptionResult,
          contextBundleResult,
          finalResponse,
          null,
          context.profile?.teaching_signature,
          context
        );
      } catch (evolveError: any) {
        logger.error("Background evolution failed", { error: evolveError.message });
      }
    });
  }
}
