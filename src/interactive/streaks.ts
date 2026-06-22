import { query, queryOne } from "../db/client";
import { sendButtonMessage } from "../whatsapp/interactive";
import { logger } from "../utils/logger";
import { getProfile } from "../memory/profile";

const STREAK_MESSAGES_THRESHOLD = 1;

export interface StreakStatus {
  current_streak: number;
  longest_streak: number;
  last_study_date: string | null;
  total_days_studied: number;
}

export async function getStreakStatus(phone: string): Promise<StreakStatus> {
  const row = await queryOne<any>(
    `SELECT * FROM study_streaks WHERE student_phone = $1`,
    [phone]
  );

  if (!row) {
    return {
      current_streak: 0,
      longest_streak: 0,
      last_study_date: null,
      total_days_studied: 0,
    };
  }

  return {
    current_streak: row.current_streak,
    longest_streak: row.longest_streak,
    last_study_date: row.last_study_date,
    total_days_studied: row.total_days_studied,
  };
}

export async function recordStudyToday(phone: string): Promise<{
  current_streak: number;
  is_new_streak: boolean;
  streak_extended: boolean;
}> {
  const today = new Date().toISOString().split("T")[0];
  const existing = await queryOne<any>(
    `SELECT * FROM study_streaks WHERE student_phone = $1`,
    [phone]
  );

  if (!existing) {
    await query(
      `INSERT INTO study_streaks (student_phone, current_streak, longest_streak, last_study_date, total_days_studied)
       VALUES ($1, 1, 1, $2, 1)`,
      [phone, today]
    );
    return { current_streak: 1, is_new_streak: true, streak_extended: false };
  }

  if (existing.last_study_date === today) {
    return { current_streak: existing.current_streak, is_new_streak: false, streak_extended: false };
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  let newStreak: number;
  let streakExtended = false;
  let isNewStreak = false;

  if (existing.last_study_date === yesterday) {
    newStreak = existing.current_streak + 1;
    streakExtended = true;
  } else {
    newStreak = 1;
    isNewStreak = existing.current_streak > 0;
  }

  const longest = Math.max(existing.longest_streak, newStreak);

  await query(
    `UPDATE study_streaks
     SET current_streak = $1,
         longest_streak = $2,
         last_study_date = $3,
         total_days_studied = total_days_studied + 1
     WHERE student_phone = $4`,
    [newStreak, longest, today, phone]
  );

  return { current_streak: newStreak, is_new_streak: isNewStreak, streak_extended: streakExtended };
}

export async function sendDailyCheckIn(phone: string): Promise<void> {
  const streak = await getStreakStatus(phone);
  const profile = await getProfile(phone);
  const studentName = profile.preferred_name || "hey";

  let message: string;

  if (streak.current_streak === 0) {
    message = `Hey ${studentName}! Ready to start a new streak today? Even 10 minutes counts. What do you want to look at?`;
  } else if (streak.current_streak === 1) {
    message = `Day 1, ${studentName}. Let's keep the ball rolling. Pick up where you left off or try something new?`;
  } else if (streak.current_streak < 7) {
    message = `Day ${streak.current_streak}! You're building something real. Want to keep the streak alive?`;
  } else if (streak.current_streak < 30) {
    message = `${streak.current_streak} days in a row — that's not luck, that's discipline. What's the plan today?`;
  } else {
    message = `${streak.current_streak} days. ${studentName}, you're not the same person who started this. Let's go again today.`;
  }

  await sendButtonMessage(
    phone,
    message,
    [
      { id: "checkin:continue", title: "Continue last topic" },
      { id: "checkin:new", title: "Something new" },
      { id: "checkin:review", title: "Quick review" },
    ],
    { footer: `🔥 ${streak.current_streak} day streak` }
  );

  logger.info("Daily check-in sent", { phone, streak: streak.current_streak });
}

export async function maybeSendStreakMilestone(phone: string, newStreak: number): Promise<void> {
  const milestones = [3, 7, 14, 30, 50, 100, 365];
  if (!milestones.includes(newStreak)) return;

  const profile = await getProfile(phone);
  const studentName = profile.preferred_name || "you";

  const messages: Record<number, string> = {
    3: `3 days straight. ${studentName}, you're forming a habit now. Don't break it.`,
    7: `A full week, ${studentName}. Most people don't make it past day 2. You did.`,
    14: `Two weeks. You're not dabbling anymore — you're serious.`,
    30: `30 days, ${studentName}. I don't need to motivate you anymore. You ARE the motivation.`,
    50: `50. Stop and look back at what you've covered. You're a different student.`,
    100: `100 days. At this point you're not using a tutor. You're a learner with a tool. Respect.`,
    365: `A year, ${studentName}. Whatever exam you started this for — you're ready. And beyond.`,
  };

  await sendButtonMessage(
    phone,
    messages[newStreak],
    [
      { id: "milestone:continue", title: "Keep going" },
      { id: "milestone:share", title: "Tell me my progress" },
    ]
  );

  logger.info("Streak milestone sent", { phone, streak: newStreak });
}
