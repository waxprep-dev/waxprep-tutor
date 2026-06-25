import { Request, Response } from "express";
import { verifyWebhookSignature, verifyChallenge } from "./verify";
import { query } from "../db/client";
import { createIfMissing, touchStudent, incrementOutboundCount, getLastInteractiveMessageId } from "../memory/profile";
import { getOrCreateCurrentEpisode, incrementEpisodeMessageCount, getRecentHistory } from "../memory/episodes";
import { assembleContext } from "../memory/retrieval";
import { buildPrompt } from "../brain/promptBuilder";
import { runAgentLoop } from "../brain/agentLoop";
import { sendTextMessage } from "./sender";
import { processVoiceMessage } from "./voice";
import { recordStudyToday, maybeSendStreakMilestone } from "../interactive/streaks";
import { processDifficultySignal } from "../interactive/difficulty";
import { gradeQuiz, buildQuizFeedbackContext } from "../interactive/quiz";
import { logger } from "../utils/logger";

const FALLBACK_MESSAGE =
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

    let messageText: string;
    let messageType: "text" | "interactive" | "audio" | "unsupported" = "unsupported";
    let interactiveId: string | undefined;

    if (message.type === "text") {
      messageText = message.text.body;
      messageType = "text";
    } else if (message.type === "interactive") {
      messageType = "interactive";
      const interactive = message.interactive;
      if (interactive.type === "button_reply") {
        interactiveId = interactive.button_reply.id;
        messageText = interactive.button_reply.title;
      } else if (interactive.type === "list_reply") {
        interactiveId = interactive.list_reply.id;
        messageText = interactive.list_reply.title;
      } else {
        messageText = `[INTERACTIVE] ${JSON.stringify(interactive)}`;
      }
    } else if (message.type === "audio") {
      messageType = "audio";
      try {
        const transcript = await processVoiceMessage(message.audio.id, fromPhone);
        messageText = `[VOICE_TRANSCRIPT] ${transcript}`;
      } catch (err: any) {
        logger.error("Voice transcription failed", { error: err.message });
        await sendTextMessage(fromPhone, "I couldn't catch what you said there. Can you type it out?");
        return;
      }
    } else {
      await sendTextMessage(fromPhone, "I can read text and voice notes best for now. Send me one of those!");
      return;
    }

    sendTypingIndicator(messageId); // fire-and-forget
    logger.info("Inbound message", {
      from: fromPhone,
      type: messageType,
      message_id: messageId,
      length: messageText.length,
    });

    await createIfMissing(fromPhone);
    await touchStudent(fromPhone);

    const streakResult = await recordStudyToday(fromPhone);
    if (streakResult.streak_extended) {
      await maybeSendStreakMilestone(fromPhone, streakResult.current_streak);
    }

    const episode = await getOrCreateCurrentEpisode(fromPhone);
    await incrementEpisodeMessageCount(episode.episode_id);

    if (messageType === "interactive") {
      const repliedToId = message.context?.id;
      const lastSentId = await getLastInteractiveMessageId(fromPhone);

      if (repliedToId && lastSentId && repliedToId !== lastSentId) {
        logger.info("Stale button tap ignored", { phone: fromPhone, tapped: repliedToId, current: lastSentId });
        await sendTextMessage(
          fromPhone,
          "That option's expired — what would you like to do now?"
        );
        return;
      }
    }

    const directHandled = await maybeHandleInteractiveResponse(
      fromPhone,
      interactiveId,
      messageText,
      messageId,
      episode.episode_id
    );
    if (directHandled) return;

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
       VALUES ($1, $2, 'inbound', $3, $4, $5)
       ON CONFLICT (message_id) DO NOTHING`,
      [messageId, fromPhone, messageText, timestamp, episode.episode_id]
    );

    const history = await getRecentHistory(fromPhone, episode.episode_id, messageId);
    const context = await assembleContext(fromPhone, messageText);
    const messages = buildPrompt(context, messageText, history);

    const startTime = Date.now();
    const result = await runAgentLoopSafely(messages, {
      phone: fromPhone,
      episodeId: episode.episode_id,
    });
    const latency = Date.now() - startTime;

    if (!result) return;

    const outboundText = result.finalResponse || "[interactive prompt sent]";

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, ai_tool_calls, ai_response, timestamp, episode_id, latency_ms, model_used)
       VALUES ($1, $2, 'outbound', $3, $4, $5, NOW(), $6, $7, $8)`,
      [`ai_${messageId}`, fromPhone, outboundText, JSON.stringify(result.allToolCalls), outboundText, episode.episode_id, latency, result.modelUsed]
    );

    await incrementOutboundCount(fromPhone);
    if (result.finalResponse) {
      await sendTextMessage(fromPhone, result.finalResponse);
    }

    logger.info("Message processed", {
      phone: fromPhone,
      type: messageType,
      latency_ms: latency,
      tokens: result.totalTokens,
      tool_calls: result.allToolCalls.length,
    });
  } catch (err: any) {
    logger.error("Webhook processing error", { error: err.message, stack: err.stack });
  }
}

async function maybeHandleInteractiveResponse(
  phone: string,
  buttonId: string | undefined,
  messageText: string,
  messageId: string,
  episodeId: string
): Promise<boolean> {
  if (!buttonId) return false;

  const diffMatch = buttonId.match(/^diff:(got_it|confused|lost):(.+)$/);
  if (diffMatch) {
    const [, signal, conceptId] = diffMatch;
    const result = await processDifficultySignal(phone, conceptId, signal as any);

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
       VALUES ($1, $2, 'inbound', $3, NOW(), $4)`,
      [messageId, phone, messageText, episodeId]
    );

    let responseText: string;
    if (signal === "got_it") {
      responseText = result.newMastery >= 0.9
        ? `Locked in. Mastery at ${(result.newMastery * 100).toFixed(0)}%. You've got this one solid.`
        : `Nice. ${(result.newMastery * 100).toFixed(0)}% on this. Want to keep going or take a break?`;
    } else if (signal === "confused") {
      responseText = `Aight, let me try a different angle. Imagine this instead: [I'll switch up the explanation].`;
    } else {
      responseText = `No worries, this one trips up a lot of people. Let's slow down and start from what you DO know.`;
    }

    await sendTextMessage(phone, responseText);
    return true;
  }

  const quizMatch = buttonId.match(/^quiz:([^:]+):(\d+)$/);
  if (quizMatch) {
    const [, quizId, indexStr] = quizMatch;
    const selectedIndex = parseInt(indexStr, 10);
    const result = await gradeQuiz(quizId, selectedIndex);

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
       VALUES ($1, $2, 'inbound', $3, NOW(), $4)`,
      [messageId, phone, messageText, episodeId]
    );

    const feedbackContext = buildQuizFeedbackContext(result);
    const history = await getRecentHistory(phone, episodeId, messageId);
    const context = await assembleContext(phone, feedbackContext);
    const messages = buildPrompt(context, feedbackContext, history);
    const aiResult = await runAgentLoopSafely(messages, { phone, episodeId });
    if (aiResult) await sendTextMessage(phone, aiResult.finalResponse);
    return true;
  }

  const topicMatch = buttonId.match(/^topic:(.+)$/);
  if (topicMatch) {
    const topicId = topicMatch[1];

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
       VALUES ($1, $2, 'inbound', $3, NOW(), $4)`,
      [messageId, phone, messageText, episodeId]
    );

    const syntheticMessage = `I want to study ${topicId}`;
    const history = await getRecentHistory(phone, episodeId, messageId);
    const context = await assembleContext(phone, syntheticMessage);
    const messages = buildPrompt(context, syntheticMessage, history);
    const result = await runAgentLoopSafely(messages, { phone, episodeId });
    if (result) await sendTextMessage(phone, result.finalResponse);
    return true;
  }

  if (buttonId.startsWith("checkin:") || buttonId.startsWith("milestone:")) {
    const action = buttonId.split(":")[1];

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
       VALUES ($1, $2, 'inbound', $3, NOW(), $4)`,
      [messageId, phone, messageText, episodeId]
    );

    let syntheticMessage: string;
    if (action === "continue") syntheticMessage = "Let's continue where I left off";
    else if (action === "new") syntheticMessage = "I want to start something new";
    else if (action === "review") syntheticMessage = "Quick review please";
    else if (action === "share") syntheticMessage = "Tell me my progress";
    else syntheticMessage = "Continue";

    const history = await getRecentHistory(phone, episodeId, messageId);
    const context = await assembleContext(phone, syntheticMessage);
    const messages = buildPrompt(context, syntheticMessage, history);
    const result = await runAgentLoopSafely(messages, { phone, episodeId });
    if (result) await sendTextMessage(phone, result.finalResponse);
    return true;
  }

  return false;
}
