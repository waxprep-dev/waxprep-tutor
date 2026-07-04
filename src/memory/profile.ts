import { query, queryOne, withTransaction } from "../db/client";
import { createWaxIdentity } from "../identity/waxId";
import { safeMerge, sanitizeKeys } from "../utils/security";
import { logger } from "../utils/logger";

export interface StudentProfile {
  phone: string;
  wax_id?: string;
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

export async function getProfile(phone: string): Promise<StudentProfile> {
  const row = await queryOne<{ phone: string; profile: any; last_active_at: string }>(
    `SELECT phone, profile, last_active_at FROM students WHERE phone = $1 AND deleted_at IS NULL`,
    [phone]
  );

  if (!row) {
    return { phone, ...DEFAULT_PROFILE } as StudentProfile;
  }

  const safeProfile = sanitizeKeys(row.profile || {});

  return {
    phone: row.phone,
    ...DEFAULT_PROFILE,
    ...safeProfile,
    last_active_at: row.last_active_at,
  } as StudentProfile;
}

export async function createIfMissing(phone: string): Promise<{ wax_id: string; is_new: boolean }> {
  const existing = await queryOne<{ phone: string; wax_id: string }>(
    `SELECT phone, wax_id FROM students WHERE phone = $1`,
    [phone]
  );
  
  if (existing) {
    return { wax_id: existing.wax_id, is_new: false };
  }

  const identity = await createWaxIdentity(phone);
  
  await query(
    `INSERT INTO students (phone, profile, wax_id, consent_status, first_seen_at, last_active_at)
     VALUES ($1, $2, $3, 'pending', NOW(), NOW())
     ON CONFLICT (phone) DO NOTHING`,
    [phone, JSON.stringify(DEFAULT_PROFILE), identity.wax_id]
  );

  return { wax_id: identity.wax_id, is_new: true };
}

export async function updateProfile(
  phone: string,
  updates: Partial<StudentProfile>
): Promise<void> {
  const current = await getProfile(phone);
  const merged = safeMerge(current, updates);
  
  delete (merged as any).phone;
  delete (merged as any).last_active_at;
  delete (merged as any).first_seen_at;
  delete (merged as any).wax_id;
  delete (merged as any).message_count_in;
  delete (merged as any).message_count_out;

  await query(
    `UPDATE students SET profile = $1, last_active_at = NOW() WHERE phone = $2 AND deleted_at IS NULL`,
    [JSON.stringify(merged), phone]
  );
}

export async function touchStudent(phone: string): Promise<void> {
  await query(
    `UPDATE students
     SET last_active_at = NOW(),
         message_count_in = message_count_in + 1
     WHERE phone = $1 AND deleted_at IS NULL`,
    [phone]
  );
}

export async function recordInteractiveSent(phone: string, messageId: string): Promise<void> {
  await query(
    `UPDATE students SET last_interactive_message_id = $1, last_interactive_sent_at = NOW() WHERE phone = $2`,
    [messageId.slice(0, 256), phone]
  );
}

export async function getLastInteractiveMessageId(phone: string): Promise<string | null> {
  const row = await queryOne<{ last_interactive_message_id: string | null }>(
    `SELECT last_interactive_message_id FROM students WHERE phone = $1`,
    [phone]
  );
  return row?.last_interactive_message_id || null;
}

export async function incrementOutboundCount(phone: string): Promise<void> {
  await query(
    `UPDATE students SET message_count_out = message_count_out + 1 WHERE phone = $1`,
    [phone]
  );
}

export async function recordCrisisEscalation(phone: string, riskFlags: any): Promise<void> {
  await query(
    `UPDATE students 
     SET emergency_escalation_count = emergency_escalation_count + 1,
         last_risk_assessment = NOW()
     WHERE phone = $1`,
    [phone]
  );
}
