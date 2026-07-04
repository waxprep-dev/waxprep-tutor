import { Request, Response } from "express";
import { verifyWebhookSignature, verifyChallenge } from "./verify";
import { query, queryOne } from "../db/client";
import { createIfMissing, touchStudent, incrementOutboundCount } from "../memory/profile";
import { getOrCreateCurrentEpisode, incrementEpisodeMessageCount, getRecentHistory } from "../memory/episodes";
import { assembleContext } from "../memory/retrieval";
import { buildPrompt } from "../brain/promptBuilder";
import { runAgentLoop } from "../brain/agentLoop";
import { sendTextMessage, sendTypingIndicator } from "./sender";
import { logger } from "../utils/logger";
import TheVoid from "../consciousness/TheVoid";
import { pulse, shouldShowTyping } from "../utils/presencePulse";
import { canSend, recordOutbound, recordInbound } from "../utils/ghostLock";

const theVoid = new TheVoid();

// Hard cap — one law to rule them all
const HARD_CAP = 900;
const MIN_LENGTH = 60;

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
      [`fallback_${Date.now()}`, ctx.phone, FALLBACK_MESSAGE, ctx.episodeId]
    );
    
    return null;
  }
}

// ============================================================
// MAIN PROCESSING PIPELINE
// ============================================================
async function processWebhookAsync(body: any): Promise<void> {
  try {
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
    const messageId = rawMessageId;

    const timestamp = new Date(parseInt(message.timestamp) * 1000);

    // Duplicate check
    const existing = await query(`SELECT message_id FROM message_log WHERE message_id = $1`, [messageId]);
    if (existing.length > 0) {
      logger.info("Duplicate message, skipping", { message_id: messageId });
      return;
    }

    // Extract message text
    let messageText = "";
    if (message.type === "text") {
      messageText = message.text.body || "";
    } else if (message.type === "interactive") {
      const interactive = message.interactive;
      if (interactive.type === "button_reply") {
        messageText = interactive.button_reply.title || "";
      } else if (interactive.type === "list_reply") {
        messageText = interactive.list_reply.title || "";
      } else {
        messageText = JSON.stringify(interactive);
      }
    } else if (message.type === "audio") {
      messageText = "[Voice message received]";
      await sendTextMessage(fromPhone, 
        "I can't listen to voice notes yet 😅. Send me a text message and I'll help you right away!"
      );
      return;
    } else {
      await sendTextMessage(fromPhone, "I can read text best right now. Send me a message!");
      return;
    }

    if (!messageText || messageText.trim().length === 0) {
      logger.info("Empty message after sanitization, skipping");
      return;
    }

    logger.info("Inbound message", {
      from: fromPhone,
      type: message.type,
      message_id: messageId,
      length: messageText.length,
    });

    // Create/update student
    await createIfMissing(fromPhone);
    await touchStudent(fromPhone);
    recordInbound(fromPhone);

    // Get/create episode
    const episode = await getOrCreateCurrentEpisode(fromPhone);
    await incrementEpisodeMessageCount(episode.episode_id);

    // Log inbound message
    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
       VALUES ($1, $2, 'inbound', $3, $4, $5)
       ON CONFLICT (message_id) DO NOTHING`,
      [messageId, fromPhone, messageText, timestamp, episode.episode_id]
    );

    // Get history with chronological order and speaker labels
    const history = await getRecentHistory(fromPhone, episode.episode_id, messageId);
    
    // Calculate minutes since last student message
    let minutesSinceLast = 10;
    const studentMessages = history.filter((h: any) => h.direction === 'inbound');
    if (studentMessages.length > 1) {
      const lastStudentMsg = studentMessages[studentMessages.length - 2]; // Before current
      if (lastStudentMsg?.timestamp) {
        minutesSinceLast = (timestamp.getTime() - new Date(lastStudentMsg.timestamp).getTime()) / 60000;
      }
    }

    // Get actual message count from database
    const episodeData = await queryOne(
      `SELECT message_count FROM episodes WHERE episode_id = $1`,
      [episode.episode_id]
    );
    const msgCountThisEpisode = episodeData?.message_count || 0;

    // Presence Pulse — detect engagement/withdrawal
    const presence = await pulse(fromPhone, episode.episode_id, messageText, timestamp);
    logger.info("Presence Pulse", {
      phone: fromPhone,
      disengagement: presence.disengagementScore,
      withdrawing: presence.isWithdrawing,
      hesitating: presence.isHesitating,
      repeating: presence.isRepeating,
    });

    // Send typing indicator if appropriate
    if (shouldShowTyping(messageText, presence, 3000)) {
      sendTypingIndicator(fromPhone, messageId).catch(() => {});
    }

    // Assemble context
    const context = await assembleContext(fromPhone, messageText);

    // Process message
    const startTime = Date.now();
    let finalResponse = "";
    let allToolCalls: any[] = [];
    let totalTokens = 0;
    let modelUsed = "cerebras";

    try {
      const voidResult = await theVoid.processMessage(
        fromPhone,
        messageText,
        history.map((m: any) => m.formatted || m.content || ""),
        context.profile,
        context,
        {
          minutesSinceLast,
          messageCountThisEpisode,
          presence,
          incomingMessageId: messageId,
        }
      );
      finalResponse = voidResult.response || "";
      allToolCalls = voidResult.toolsCalled || [];
    } catch (voidError: any) {
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

    if (!finalResponse) {
      logger.warn("No final response generated", { phone: fromPhone });
      return;
    }

    // EMERGENCY HARD CAP — never exceed 900 characters
    if (finalResponse.length > HARD_CAP) {
      logger.warn("Emergency trim in webhook", { 
        length: finalResponse.length, 
        phone: fromPhone 
      });
      const trimmed = finalResponse.slice(0, HARD_CAP);
      const lastBreak = Math.max(
        trimmed.lastIndexOf(". "),
        trimmed.lastIndexOf("! "),
        trimmed.lastIndexOf("? ")
      );
      finalResponse = lastBreak > 300 
        ? trimmed.slice(0, lastBreak + 1) + " Want me to continue?" 
        : trimmed.slice(0, 400) + " …";
    }

    // Minimum length guard — never send empty soul
    if (finalResponse.length < MIN_LENGTH && finalResponse.length > 0) {
      const warmFallbacks = [
        "I'm listening. Tell me more.",
        "I hear you. What's on your mind?",
        "That's interesting. Tell me more.",
      ];
      finalResponse = warmFallbacks[Math.floor(Math.random() * warmFallbacks.length)];
    }

    // Ghost Lock check — prevent panic double messages
    const lockCheck = canSend(fromPhone);
    if (!lockCheck.allowed) {
      logger.warn("GhostLock prevented send", { 
        phone: fromPhone, 
        reason: lockCheck.reason 
      });
      return;
    }

    // Log outbound message
    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, ai_tool_calls, ai_response, timestamp, episode_id, latency_ms, model_used)
       VALUES ($1, $2, 'outbound', $3, $4, $5, NOW(), $6, $7, $8)`,
      [`ai_${messageId}`, fromPhone, finalResponse, JSON.stringify(allToolCalls), finalResponse, 
       episode.episode_id, Date.now() - startTime, modelUsed]
    );

    await incrementOutboundCount(fromPhone);
    await sendTextMessage(fromPhone, finalResponse);
    recordOutbound(fromPhone, finalResponse.length);

    logger.info("Message processed", {
      phone: fromPhone,
      type: message.type,
      latency_ms: Date.now() - startTime,
      tokens: totalTokens,
      tool_calls: allToolCalls.length,
      response_length: finalResponse.length,
    });

  } catch (err: any) {
    logger.error("Webhook processing error", { error: err.message, stack: err.stack });
  }
}
