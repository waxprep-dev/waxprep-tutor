import { Request, Response } from "express";
import { verifyWebhookSignature, verifyChallenge } from "./verify";
import { query } from "../db/client";
import { createIfMissing, touchStudent, incrementOutboundCount } from "../memory/profile";
import { getOrCreateCurrentEpisode, incrementEpisodeMessageCount, getRecentHistory } from "../memory/episodes";
import { assembleContext } from "../memory/retrieval";
import { buildPrompt } from "../brain/promptBuilder";
import { runAgentLoop } from "../brain/agentLoop";
import { TheVoid } from "../consciousness/TheVoid";
import { sendTextMessage } from "./sender";
import { logger } from "../utils/logger";

const FALLBACK_MESSAGE = "Gimme one sec, gathering my thoughts on that 🧠 — try sending it again in a moment.";

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

  processWebhookAsync(req.body).catch((err) => {
    logger.error("Async webhook processing failed", { error: err.message });
  });
}

async function runAgentLoopSafely(
  messages: any[],
  ctx: { phone: string; episodeId: string }
): Promise<{ finalResponse: string; totalTokens?: number; allToolCalls: any[]; modelUsed?: string } | null> {
  try {
    return await runAgentLoop(messages, ctx);
  } catch (err: any) {
    logger.error("Agent loop failed — sending fallback instead of silence", {
      phone: ctx.phone,
      error: err.response?.data || err.message,
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

async function processWebhookAsync(body: any): Promise<void> {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const fromPhone = message.from;
    const messageId = message.id;
    const timestamp = new Date(parseInt(message.timestamp) * 1000);

    const existing = await query(`SELECT message_id FROM message_log WHERE message_id = $1`, [messageId]);
    if (existing.length > 0) {
      logger.info("Duplicate message, skipping", { message_id: messageId });
      return;
    }

    let messageText = "";

    if (message.type === "text") {
      messageText = message.text.body;
    } else if (message.type === "interactive") {
      const interactive = message.interactive;
      if (interactive.type === "button_reply") {
        messageText = interactive.button_reply.title;
      } else if (interactive.type === "list_reply") {
        messageText = interactive.list_reply.title;
      } else {
        messageText = JSON.stringify(interactive);
      }
    } else if (message.type === "audio") {
      messageText = "[Voice message received]";
    } else {
      await sendTextMessage(fromPhone, "I can read text best right now. Send me a message!");
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
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
       VALUES ($1, $2, 'inbound', $3, $4, $5)
       ON CONFLICT (message_id) DO NOTHING`,
      [messageId, fromPhone, messageText, timestamp, episode.episode_id]
    );

    const history = await getRecentHistory(fromPhone, episode.episode_id, messageId);
    const context = await assembleContext(fromPhone, messageText);

    const startTime = Date.now();
    let result: any;

    try {
      const voidResult = await TheVoid.processMessage(
        fromPhone,
        messageText,
        history.map(m => m.content || ""),
        context.profile,
        context
      );
      result = { finalResponse: voidResult.finalResponse, allToolCalls: voidResult.toolCalls || [], totalTokens: voidResult.totalTokens || 0, modelUsed: voidResult.modelUsed || "cerebras", loopCount: voidResult.loopCount || 1 };
    } catch (voidError: any) {
      logger.warn("TheVoid failed, falling back to agentLoop", { error: voidError.message });
      const messages = buildPrompt(context, messageText, history);
      result = await runAgentLoopSafely(messages, {
        phone: fromPhone,
        episodeId: episode.episode_id,
      });
    }

    const latency = Date.now() - startTime;

    if (!result) return;

    const outboundText = result.finalResponse || "[response sent]";

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, ai_tool_calls, ai_response, timestamp, episode_id, latency_ms, model_used)
       VALUES ($1, $2, 'outbound', $3, $4, $5, NOW(), $6, $7, $8)`,
      [`ai_${messageId}`, fromPhone, outboundText, JSON.stringify(result.allToolCalls), outboundText, episode.episode_id, latency, result.modelUsed]
    );
      [`ai_${messageId}`, fromPhone, outboundText, JSON.stringify(result.allToolCalls), outboundText, episode.episode_id, latency, result.modelUsed]
    );

    await incrementOutboundCount(fromPhone);
    if (result.finalResponse) {
      await sendTextMessage(fromPhone, result.finalResponse);
    }

    logger.info("Message processed", {
      phone: fromPhone,
      type: message.type,
      latency_ms: latency,
      tokens: result.totalTokens,
      tool_calls: result.allToolCalls.length,
    });
  } catch (err: any) {
    logger.error("Webhook processing error", { error: err.message, stack: err.stack });
  }
}
