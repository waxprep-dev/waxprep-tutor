import { query, queryOne } from "../db/client";

export interface StudentProfile {
  phone: string;
  full_name?: string;
  preferred_name?: string;
  age?: number;
  city?: string;
  state?: string;
  country?: string;
  preferred_language?: string;
  formality?: "casual" | "neutral" | "formal";
  uses_code_switching?: boolean;
  current_level?: string;
  school_type?: string;
  goals?: Array<{
    subject: string;
    target: string;
    exam_date?: string;
    importance?: number;
  }>;
  learning_style?: {
    primary?: string;
    secondary?: string;
    dislikes?: string[];
  };
  pace?: "slow" | "medium" | "fast";
  confidence_baseline?: "low" | "medium" | "high";
  timezone?: string;
  tutor_persona?: {
    tutor_name?: string;
    tutor_formality?: string;
  };
  first_seen_at?: string;
  last_active_at?: string;
  message_count_in?: number;
  message_count_out?: number;
}

const DEFAULT_PROFILE: Partial<StudentProfile> = {
  country: "Nigeria",
  preferred_language: "english",
  formality: "casual",
  timezone: "Africa/Lagos",
};

/**
 * Get a student's profile. Returns a default profile if student doesn't exist.
 * Note: students are auto-created on first message — see createIfMissing.
 */
export async function getProfile(phone: string): Promise<StudentProfile> {
  const row = await queryOne<{ phone: string; profile: any; last_active_at: string }>(
    `SELECT phone, profile, last_active_at FROM students WHERE phone = $1`,
    [phone]
  );

  if (!row) {
    return { phone, ...DEFAULT_PROFILE } as StudentProfile;
  }

  return {
    phone: row.phone,
    ...DEFAULT_PROFILE,
    ...row.profile,
    last_active_at: row.last_active_at,
  };
}

/**
 * Create student record if it doesn't exist. Idempotent.
 */
export async function createIfMissing(phone: string): Promise<void> {
  await query(
    `INSERT INTO students (phone, profile) VALUES ($1, $2)
     ON CONFLICT (phone) DO NOTHING`,
    [phone, JSON.stringify(DEFAULT_PROFILE)]
  );
}

/**
 * Update one or more fields in the student's profile.
 * The AI calls this via the update_profile tool.
 */
export async function updateProfile(
  phone: string,
  updates: Partial<StudentProfile>
): Promise<void> {
  // Build a JSON merge: get current, merge, save
  const current = await getProfile(phone);
  const merged = { ...current, ...updates };
  // Remove fields that don't belong in profile jsonb
  delete (merged as any).phone;
  delete (merged as any).last_active_at;

  await query(
    `UPDATE students SET profile = $1, last_active_at = NOW() WHERE phone = $2`,
    [JSON.stringify(merged), phone]
  );
}

/**
 * Touch the student — increment message count, update last_active.
 * Called on every inbound message.
 */
export async function touchStudent(phone: string): Promise<void> {
  await query(
    `UPDATE students
     SET last_active_at = NOW(),
         message_count_in = message_count_in + 1
     WHERE phone = $1`,
    [phone]
  );
}

export async function incrementOutboundCount(phone: string): Promise<void> {
  await query(
    `UPDATE students SET message_count_out = message_count_out + 1 WHERE phone = $1`,
    [phone]
  );
}
