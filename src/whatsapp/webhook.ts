import { Request, Response } from "express";
import { config } from "../config";
import { logger } from "../utils/logger";
import { verifyWebhookSignature, verifyChallenge } from "./verify";
import { query } from "../db/client";
import { createIfMissing, touchStudent, incrementOutboundCount, getProfile } from "../memory/profile";
import { getOrCreateCurrentEpisode, incrementEpisodeMessageCount } from "../memory/episodes";
import { assembleContext } from "../memory/retrieval";
import { buildPrompt } from "../brain/promptBuilder";
import { runAgentLoop } from "../brain/agentLoop";
import { sendTextMessage } from "./sender";

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

async function processWebhookAsync(body: any): Promise<void> {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== "text") {
      return;
    }

    const fromPhone = message.from;
    const messageId = message.id;
    const messageText = message.text.body;
    const timestamp = new Date(parseInt(message.timestamp) * 1000);

    logger.info("Inbound message", { from: fromPhone, message_id: messageId, length: messageText.length });

    const existing = await query(
      `SELECT message_id FROM message_log WHERE message_id = $1`,
      [messageId]
    );
    if (existing.length > 0) {
      logger.info("Duplicate message, skipping", { message_id: messageId });
      return;
    }

    const waxId = await createIfMissing(fromPhone);
    await touchStudent(fromPhone);

    const episode = await getOrCreateCurrentEpisode(fromPhone);
    await incrementEpisodeMessageCount(episode.episode_id);

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
       VALUES ($1, $2, 'inbound', $3, $4, $5)
       ON CONFLICT (message_id) DO NOTHING`,
      [messageId, fromPhone, messageText, timestamp, episode.episode_id]
    );

    const context = await assembleContext(fromPhone, messageText, waxId);

    const messages = buildPrompt(context, messageText);

    const startTime = Date.now();
    const result = await runAgentLoop(messages, {
      phone: fromPhone,
      episodeId: episode.episode_id,
    });
    const latency = Date.now() - startTime;

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, ai_tool_calls, ai_response, timestamp, episode_id, latency_ms, model_used)
       VALUES ($1, $2, 'outbound', $3, $4, $5, NOW(), $6, $7, $8)`,
      [
        `ai_${messageId}`,
        fromPhone,
        result.finalResponse,
        JSON.stringify(result.allToolCalls),
        result.finalResponse,
        episode.episode_id,
        latency,
        result.modelUsed,
      ]
    );

    await incrementOutboundCount(fromPhone);

    await sendTextMessage(fromPhone, result.finalResponse);

    logger.info("Message processed", {
      phone: fromPhone,
      latency_ms: latency,
      tokens: result.totalTokens,
      tool_calls: result.allToolCalls.length,
      loop_count: result.loopCount,
    });
  } catch (err: any) {
    logger.error("Webhook processing error", { error: err.message, stack: err.stack });
    try {
      const fromPhone = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (fromPhone) {
        await sendTextMessage(
          fromPhone,
          "Hmm, my brain froze for a sec there. Can you send that again? 😅"
        );
      }
    } catch (sendErr: any) {
      logger.error("Fallback message also failed", { error: sendErr.message });
    }
  }
}
