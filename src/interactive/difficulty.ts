import { sendButtonMessage } from "../whatsapp/interactive";
import { query, queryOne } from "../db/client";
import { logger } from "../utils/logger";
import * as concepts from "../memory/concepts";

export type DifficultySignal = "got_it" | "confused" | "lost";

export const DIFFICULTY_DELTAS: Record<DifficultySignal, number> = {
  got_it: 0.15,
  confused: 0.05,
  lost: -0.10,
};

export const DIFFICULTY_LABELS: Record<DifficultySignal, string> = {
  got_it: "Got it 💪",
  confused: "Bit confused",
  lost: "Lost 😅",
};

export async function sendDifficultyCheck(
  toPhone: string,
  conceptId: string,
  conceptName: string,
  followUpMessage: string = ""
): Promise<{ message_id: string }> {
  return sendButtonMessage(
    toPhone,
    followUpMessage || `How did "${conceptName}" land?`,
    [
      { id: `diff:got_it:${conceptId}`, title: DIFFICULTY_LABELS.got_it },
      { id: `diff:confused:${conceptId}`, title: DIFFICULTY_LABELS.confused },
      { id: `diff:lost:${conceptId}`, title: DIFFICULTY_LABELS.lost },
    ],
    { footer: "Tap to update your mastery" }
  );
}

export async function processDifficultySignal(
  phone: string,
  conceptId: string,
  signal: DifficultySignal
): Promise<{ newMastery: number; signal: DifficultySignal }> {
  const concept = await concepts.getConcept(conceptId);
  if (!concept) throw new Error(`Concept not found: ${conceptId}`);

  const delta = DIFFICULTY_DELTAS[signal];
  const newMastery = Math.max(0, Math.min(1, concept.mastery_score + delta));

  const evidence = `Student tapped "${DIFFICULTY_LABELS[signal]}" button after teaching ${concept.name}`;
  await concepts.updateMastery(conceptId, newMastery, evidence);

  if (newMastery >= 0.5 && newMastery < 0.85) {
    const days = newMastery >= 0.7 ? 7 : 3;
    await concepts.scheduleReview(conceptId, phone, days);
  }

  await query(
    `INSERT INTO difficulty_signals (student_phone, concept_id, signal, mastery_before, mastery_after)
     VALUES ($1, $2, $3, $4, $5)`,
    [phone, conceptId, signal, concept.mastery_score, newMastery]
  );

  logger.info("Difficulty signal processed", {
    phone,
    concept: concept.name,
    signal,
    delta,
    new_mastery: newMastery,
  });

  return { newMastery, signal };
}
