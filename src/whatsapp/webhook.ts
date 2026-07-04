import { Request, Response } from "express";
import { verifyWebhookSignature, verifyChallenge } from "./verify";
import { query, queryOne } from "../db/client";
import { createIfMissing, touchStudent } from "../memory/profile";
import { getOrCreateCurrentEpisode, incrementEpisodeMessageCount, getRecentHistory } from "../memory/episodes";
import { assembleContext } from "../memory/retrieval";
import { runAgentLoop } from "../brain/agentLoop";
import { sendTextMessage } from "./sender";
import { logger } from "../utils/logger";
import TheVoid from "../consciousness/TheVoid";
import { hippocampus } from "../memory/hippocampus";

const theVoid = new TheVoid();
const FALLBACK_MESSAGE = "Gimme one sec, gathering my thoughts on that 🧠 — try sending it again in a moment.";

export async function handleWebhookGet(req: Request, res: Response): Promise<void> {
  const mode = req.query["hub.mode"] as string | undefined;
  const token = req.query["hub.verify_token"] as string | undefined;
  const challenge = req.query["hub.challenge"] as string | undefined;

  const result = verifyChallenge(mode, token, challenge);
  if (result) {
    res.status(200).send(result);
    return;
  }
  res.status(403).send("Forbidden");
}

export async function handleWebhookPost(req: Request, res: Response): Promise<void> {
  const rawBody = (req as any).rawBody as string;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  if (!verifyWebhookSignature(rawBody, signature)) {
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

    if (!message) return;

    const fromPhone = message.from;
    const messageId = message.id;
    const timestamp = new Date(parseInt(message.timestamp) * 1000);

    const existing = await query(`SELECT message_id FROM message_log WHERE message_id = $1`, [messageId]);
    if (existing.length > 0) return;

    let messageText = "";
    if (message.type === "text") {
      messageText = message.text.body;
    } else if (message.type === "interactive") {
      const interactive = message.interactive;
      if (interactive.type === "button_reply") messageText = interactive.button_reply.title;
      else if (interactive.type === "list_reply") messageText = interactive.list_reply.title;
      else messageText = JSON.stringify(interactive);
    } else if (message.type === "audio") {
      messageText = "[Voice message received]";
    } else {
      await sendTextMessage(fromPhone, "I can read text best right now. Send me a message!");
      return;
    }

    await createIfMissing(fromPhone);
    await touchStudent(fromPhone);

    const episode = await getOrCreateCurrentEpisode(fromPhone);
    await incrementEpisodeMessageCount(episode.episode_id);

    const timeOfDay = timestamp.getHours() < 12 ? 'morning' : 
                      timestamp.getHours() < 17 ? 'afternoon' : 
                      timestamp.getHours() < 21 ? 'evening' : 'night';

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id, time_of_day, day_of_week)
       VALUES ($1, $2, 'inbound', $3, $4, $5, $6, $7)`,
      [messageId, fromPhone, messageText, timestamp, episode.episode_id, timeOfDay, timestamp.getDay()]
    );

    const history = await getRecentHistory(fromPhone, episode.episode_id, messageId);
    const context = await assembleContext(fromPhone, messageText);

    // Get current season
    const currentSeason = await queryOne(
      `SELECT season_id, season_number FROM conversation_seasons 
       WHERE student_phone = $1 AND is_active = true ORDER BY season_number DESC LIMIT 1`,
      [fromPhone]
    );

    const startTime = Date.now();
    let finalResponse = "";
    let allToolCalls: any[] = [];
    let modelUsed = "cerebras";
    let voidResult: any = null;

    try {
      voidResult = await theVoid.processMessage(
        fromPhone, messageText,
        history.map((m: any) => m.content || ""),
        context.profile,
        { 
          ...context, 
          currentEpisodeId: episode.episode_id, 
          currentSeasonId: currentSeason?.season_id, 
          seasonNumber: currentSeason?.season_number || 1 
        }
      );
      
      finalResponse = voidResult.response || "";
      allToolCalls = voidResult.toolsCalled || [];

      logger.info("Chronos processed", {
        routing: voidResult.routingPath,
        agents: voidResult.agentCount,
        latency: voidResult.latencyMs,
        healing: voidResult.healingEvents?.length || 0,
        season: voidResult.seasonInfo?.seasonNumber
      });

    } catch (voidError: any) {
      logger.warn("Chronos failed, falling back", { error: voidError.message });
      const messages = buildPrompt(context, messageText, history);
      const fallbackResult = await runAgentLoop(messages, { phone: fromPhone, episodeId: episode.episode_id });
      if (fallbackResult) {
        finalResponse = fallbackResult.finalResponse || FALLBACK_MESSAGE;
        modelUsed = fallbackResult.modelUsed || "cerebras";
      } else {
        finalResponse = FALLBACK_MESSAGE;
      }
    }

    const latency = Date.now() - startTime;
    if (!finalResponse) return;

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, ai_response, ai_tool_calls, timestamp, episode_id, latency_ms, model_used, routing_path, agent_count)
       VALUES ($1, $2, 'outbound', $3, $4, $5, NOW(), $6, $7, $8, $9, $10)`,
      [`ai_${messageId}`, fromPhone, finalResponse, finalResponse, JSON.stringify(allToolCalls), 
       episode.episode_id, latency, modelUsed, voidResult?.routingPath || "fallback", allToolCalls.length]
    );

    await sendTextMessage(fromPhone, finalResponse);

    // Background evolution
    setTimeout(async () => {
      try {
        if (voidResult && voidResult.perception) {
          await theVoid.evolve(
            fromPhone, messageText,
            voidResult.perception,
            voidResult.contextBundle || {},
            finalResponse, null,
            context.profile,
            { ...context, metacognitiveScaffold: voidResult.metacognitiveScaffold }
          );
        }
      } catch (e: any) {
        logger.error("Background evolution failed", { error: e.message });
      }
    }, 100);

  } catch (err: any) {
    logger.error("Webhook error", { error: err.message });
  }
}

function buildPrompt(context: any, messageText: string, history: any[]): any[] {
  return [
    { role: "system", content: "You are Wax, a Nigerian tutor. Be helpful and warm." },
    { role: "user", content: messageText }
  ];
}
