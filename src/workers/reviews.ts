/**
 * Background worker: sends review reminders to students.
 * Run hourly via cron. Finds due reviews and sends a WhatsApp message
 * prompting the student to revisit the concept.
 * 
 * This is the spaced-repetition engine in action.
 * 
 * Run with: npm run worker:reviews
 */

import { query } from "../db/client";
import { logger } from "../utils/logger";
import { sendTextMessage } from "../whatsapp/sender";
import { getProfile } from "../memory/profile";
import { callLLM } from "../llm/client";

async function sendDueReviews(): Promise<void> {
  const dueReviews = await query<any>(
    `SELECT rq.*, c.name as concept_name, c.subject, c.mastery_score
     FROM review_queue rq
     JOIN concepts c ON c.concept_id = rq.concept_id
     WHERE rq.completed = FALSE
       AND rq.scheduled_for <= NOW()
     ORDER BY rq.scheduled_for ASC
     LIMIT 20`
  );

  logger.info(`Found ${dueReviews.length} due reviews`);

  for (const review of dueReviews) {
    try {
      const profile = await getProfile(review.student_phone);
      const studentName = profile.preferred_name || "hey";

      // Generate a personalized review prompt via LLM
      const response = await callLLM({
        messages: [
          {
            role: "user",
            content: `Send a brief, natural WhatsApp message to ${studentName} reminding them to review "${review.concept_name}" in ${review.subject}. Keep it short and warm — like a friend nudging them to revisit something. Don't be preachy. One or two sentences max. Don't say "As an AI" or use bullet points.`,
          },
        ],
        temperature: 0.8,
        max_tokens: 150,
      });

      const message = response.content || `Hey ${studentName}! Ready to revisit ${review.concept_name}?`;

      await sendTextMessage(review.student_phone, message);

      // Mark as completed
      await query(
        `UPDATE review_queue SET completed = TRUE, completed_at = NOW() WHERE review_id = $1`,
        [review.review_id]
      );

      logger.info("Review sent", {
        student: review.student_phone,
        concept: review.concept_name,
      });
    } catch (err: any) {
      logger.error("Failed to send review", {
        review_id: review.review_id,
        error: err.message,
      });
    }
  }
}

async function main() {
  logger.info("Reviews worker started");
  await sendDueReviews();
  logger.info("Reviews worker done");
  process.exit(0);
}

main().catch((err) => {
  logger.error("Reviews worker crashed", { error: err.message });
  process.exit(1);
});
