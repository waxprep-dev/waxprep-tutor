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
import { processVoiceMessage } from "./voice";
import { recordStudyToday, maybeSendStreakMilestone } from "../interactive/streaks";
import { processDifficultySignal } from "../interactive/difficulty";
import { gradeQuiz, buildQuizFeedbackContext } from "../interactive/quiz";

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

    if (message.type === "text") {
      messageText = message.text.body;
      messageType = "text";
    } else if (message.type === "interactive") {
      messageType = "interactive";
      const interactive = message.interactive;
      if (interactive.type === "button_reply") {
        messageText = `[BUTTON_TAP] id="${interactive.button_reply.id}" title="${interactive.button_reply.title}"`;
      } else if (interactive.type === "list_reply") {
        messageText = `[LIST_SELECT] id="${interactive.list_reply.id}" title="${interactive.list_reply.title}" description="${interactive.list_reply.description || ""}"`;
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
      await sendTextMessage(
        fromPhone,
        "I can read text and voice notes best for now. Send me one of those!"
      );
      return;
    }

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

    const directHandled = await maybeHandleInteractiveResponse(fromPhone, messageText, messageId);
    if (directHandled) return;

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp, episode_id)
       VALUES ($1, $2, 'inbound', $3, $4, $5)
       ON CONFLICT (message_id) DO NOTHING`,
      [messageId, fromPhone, messageText, timestamp, episode.episode_id]
    );

    const context = await assembleContext(fromPhone, messageText);
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
      [`ai_${messageId}`, fromPhone, result.finalResponse, JSON.stringify(result.allToolCalls), result.finalResponse, episode.episode_id, latency, result.modelUsed]
    );

    await incrementOutboundCount(fromPhone);
    await sendTextMessage(fromPhone, result.finalResponse);

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
  messageText: string,
  messageId: string
): Promise<boolean> {
  const buttonMatch = messageText.match(/id="([^"]+)"/);
  const buttonId = buttonMatch?.[1];
  if (!buttonId) return false;

  const diffMatch = buttonId.match(/^diff:(got_it|confused|lost):(.+)$/);
  if (diffMatch) {
    const [, signal, conceptId] = diffMatch;
    const result = await processDifficultySignal(phone, conceptId, signal as any);

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp)
       VALUES ($1, $2, 'inbound', $3, NOW())`,
      [messageId, phone, messageText]
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
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp)
       VALUES ($1, $2, 'inbound', $3, NOW())`,
      [messageId, phone, messageText]
    );

    const feedbackContext = buildQuizFeedbackContext(result);

    const episode = await getOrCreateCurrentEpisode(phone);
    const context = await assembleContext(phone, feedbackContext);
    const messages = buildPrompt(context, feedbackContext);
    const aiResult = await runAgentLoop(messages, { phone, episodeId: episode.episode_id });

    await sendTextMessage(phone, aiResult.finalResponse);
    return true;
  }

  const topicMatch = buttonId.match(/^topic:(.+)$/);
  if (topicMatch) {
    const topicId = topicMatch[1];

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp)
       VALUES ($1, $2, 'inbound', $3, NOW())`,
      [messageId, phone, messageText]
    );

    const syntheticMessage = `I want to study ${topicId}`;
    const episode = await getOrCreateCurrentEpisode(phone);
    const context = await assembleContext(phone, syntheticMessage);
    const messages = buildPrompt(context, syntheticMessage);
    const result = await runAgentLoop(messages, { phone, episodeId: episode.episode_id });

    await sendTextMessage(phone, result.finalResponse);
    return true;
  }

  if (buttonId.startsWith("checkin:") || buttonId.startsWith("milestone:")) {
    const action = buttonId.split(":")[1];

    await query(
      `INSERT INTO message_log (message_id, student_phone, direction, raw_text, timestamp)
       VALUES ($1, $2, 'inbound', $3, NOW())`,
      [messageId, phone, messageText]
    );

    let syntheticMessage: string;
    if (action === "continue") syntheticMessage = "Let's continue where I left off";
    else if (action === "new") syntheticMessage = "I want to start something new";
    else if (action === "review") syntheticMessage = "Quick review please";
    else if (action === "share") syntheticMessage = "Tell me my progress";
    else syntheticMessage = "Continue";

    const episode = await getOrCreateCurrentEpisode(phone);
    const context = await assembleContext(phone, syntheticMessage);
    const messages = buildPrompt(context, syntheticMessage);
    const result = await runAgentLoop(messages, { phone, episodeId: episode.episode_id });

    await sendTextMessage(phone, result.finalResponse);
    return true;
  }

  return false;
}
