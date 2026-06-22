import { query } from "../db/client";
import { logger } from "../utils/logger";
import { sendDailyCheckIn } from "../interactive/streaks";

/**
 * Daily check-in worker. Runs once per day at a chosen time (e.g., 4pm WAT).
 * Sends a personalized message to every active student with their streak.
 * 
 * Run via cron: 0 16 * * * npm run worker:checkin
 */

async function sendAllCheckIns(): Promise<void> {
  const activeStudents = await query<{ phone: string }>(
    `SELECT phone FROM students
     WHERE last_active_at > NOW() - INTERVAL '3 days'
       AND phone IS NOT NULL`
  );

  logger.info(`Sending daily check-ins to ${activeStudents.length} students`);

  for (const student of activeStudents) {
    try {
      await sendDailyCheckIn(student.phone);
      await new Promise((r) => setTimeout(r, 200));
    } catch (err: any) {
      logger.error("Daily check-in failed", { phone: student.phone, error: err.message });
    }
  }
}

async function main() {
  logger.info("Daily check-in worker started");
  await sendAllCheckIns();
  logger.info("Daily check-in worker done");
  process.exit(0);
}

main().catch((err) => {
  logger.error("Check-in worker crashed", { error: err.message });
  process.exit(1);
});
