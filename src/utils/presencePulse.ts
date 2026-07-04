// FILE: src/utils/presencePulse.ts
// =====================================================
// The Presence Pulse — Shadow that feels the student
// "You cannot see the wind, but you can see the leaves move."
// =====================================================

import { query } from "../db/client";

interface PresenceReading {
  isPresent: boolean;
  isHesitating: boolean;
  isWithdrawing: boolean;
  lastReadAt?: Date;
  avgReplySeconds: number;
  silenceSeconds: number;
  disengagementScore: number; // 0-1
  messageCount: number;
  isRepeating: boolean;
}

// Configurable via environment variables
const DEATH_WORDS = new Set(
  (process.env.DEATH_WORDS || "nothing,ok,k,kk,okay,hmm,wow,nice,cool,alright,true,yes,no")
    .split(",")
    .map(w => w.trim().toLowerCase())
);

const WITHDRAWAL_PATTERNS = (process.env.WITHDRAWAL_PATTERNS || "i don't know,forget it,never mind,leave me,i'm tired,i give up")
  .split(",")
  .map(w => w.trim().toLowerCase());

const MAX_HISTORY = parseInt(process.env.PRESENCE_MAX_HISTORY || "10");
const SILENCE_THRESHOLD_MULTIPLIER = parseFloat(process.env.SILENCE_THRESHOLD_MULTIPLIER || "2");
const MAX_SILENCE_SECONDS = parseInt(process.env.MAX_SILENCE_SECONDS || "300");

export async function pulse(
  phone: string,
  episodeId: string,
  currentMessageText: string,
  currentMessageTimestamp: Date
): Promise<PresenceReading> {
  const recent = await query(
    `SELECT direction, raw_text, timestamp, 
            EXTRACT(EPOCH FROM ($1::timestamptz - timestamp)) as seconds_ago
     FROM message_log
     WHERE student_phone = $2 AND episode_id = $3
     ORDER BY timestamp DESC LIMIT $4`,
    [currentMessageTimestamp, phone, episodeId, MAX_HISTORY]
  );

  const inboundMessages = recent.filter((r: any) => r.direction === 'inbound');
  const outboundMessages = recent.filter((r: any) => r.direction === 'outbound');

  // Calculate average reply time
  let avgReplySeconds = 45;
  const replyGaps: number[] = [];
  
  for (let i = 0; i < Math.min(inboundMessages.length - 1, 5); i++) {
    const current = new Date(inboundMessages[i].timestamp).getTime();
    const previous = new Date(inboundMessages[i + 1].timestamp).getTime();
    const gap = (current - previous) / 1000;
    if (gap > 3 && gap < 600) replyGaps.push(gap);
  }
  
  if (replyGaps.length > 0) {
    avgReplySeconds = replyGaps.reduce((a, b) => a + b, 0) / replyGaps.length;
  }

  // Silence since last outbound
  let silenceSeconds = 0;
  const lastOutbound = outboundMessages[0];
  if (lastOutbound) {
    silenceSeconds = (currentMessageTimestamp.getTime() - new Date(lastOutbound.timestamp).getTime()) / 1000;
  }

  // Disengagement detection
  const textLower = currentMessageText.toLowerCase().trim();
  let disengagementScore = 0;
  
  if (DEATH_WORDS.has(textLower)) disengagementScore += 0.4;
  if (textLower.length < 10) disengagementScore += 0.2;
  if (WITHDRAWAL_PATTERNS.some(p => textLower.includes(p))) disengagementScore += 0.6;
  
  // Check for repetition (student saying the same thing)
  let isRepeating = false;
  const previousInbound = inboundMessages.slice(1);
  if (previousInbound.length > 0) {
    const recentMessages = previousInbound.map((m: any) => m.raw_text || "").join(" ");
    const currentPreview = textLower.slice(0, 30);
    if (currentPreview.length > 5) {
      isRepeating = recentMessages.includes(currentPreview);
    }
    // If they used death words before, repetition is more severe
    if (isRepeating && DEATH_WORDS.has(textLower)) {
      disengagementScore += 0.6;
    } else if (isRepeating) {
      disengagementScore += 0.4;
    }
  }

  // Normalize
  disengagementScore = Math.min(disengagementScore, 1.0);

  const isWithdrawing = disengagementScore > 0.5;
  const isHesitating = silenceSeconds > avgReplySeconds * SILENCE_THRESHOLD_MULTIPLIER && !isWithdrawing;
  const isPresent = !isWithdrawing && silenceSeconds < MAX_SILENCE_SECONDS;

  return {
    isPresent,
    isHesitating,
    isWithdrawing,
    avgReplySeconds,
    silenceSeconds,
    disengagementScore,
    messageCount: inboundMessages.length,
    isRepeating,
  };
}

export function shouldShowTyping(
  messageText: string,
  presence: PresenceReading,
  predictedLatencyMs: number
): boolean {
  // Never for disengagement — it feels like chasing
  if (presence.disengagementScore > 0.5) return false;
  
  // Always for high emotional weight or long processing
  if (predictedLatencyMs > 2000) return true;
  
  // For substantive messages (> 15 chars) that aren't one-word replies
  if (messageText.length > 15 && presence.isPresent) return true;
  
  return false;
}
