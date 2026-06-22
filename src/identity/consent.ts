import { query, queryOne } from "../db/client";

/**
 * NDPR (Nigeria Data Protection Regulation) compliance + cross-platform consent.
 *
 * This is what separates a toy from a production system. The big AI companies
 * (Google, OpenAI, etc.) all have granular consent tracking. We need it too
 * because we're storing personal data about minors (most secondary school
 * students are under 18).
 */

export interface ConsentRecord {
  wax_id: string;
  data_retention_consent: boolean;
  cross_platform_sync_consent: boolean;
  parental_consent_for_minor: boolean;
  consent_date: string;
  consent_version: string;
  consent_method: string | null;
}

/**
 * Record consent for a student. This should be called after the student
 * has been informed about data collection and has agreed.
 *
 * In the WhatsApp onboarding flow, this happens via a clear message
 * the student agrees to (no dark patterns).
 */
export async function recordConsent(
  waxId: string,
  consent: {
    data_retention_consent: boolean;
    cross_platform_sync_consent: boolean;
    parental_consent_for_minor: boolean;
    consent_method: string;
  }
): Promise<void> {
  await query(
    `INSERT INTO wax_id_consent (
       wax_id, data_retention_consent, cross_platform_sync_consent,
       parental_consent_for_minor, consent_method, consent_date, consent_version
     )
     VALUES ($1, $2, $3, $4, $5, NOW(), 'v1')
     ON CONFLICT (wax_id) DO UPDATE SET
       data_retention_consent = EXCLUDED.data_retention_consent,
       cross_platform_sync_consent = EXCLUDED.cross_platform_sync_consent,
       parental_consent_for_minor = EXCLUDED.parental_consent_for_minor,
       consent_method = EXCLUDED.consent_method,
       consent_date = NOW(),
       consent_version = 'v1'`,
    [
      waxId,
      consent.data_retention_consent,
      consent.cross_platform_sync_consent,
      consent.parental_consent_for_minor,
      consent.consent_method,
    ]
  );
}

export async function getConsent(waxId: string): Promise<ConsentRecord | null> {
  return queryOne<ConsentRecord>(
    `SELECT * FROM wax_id_consent WHERE wax_id = $1`,
    [waxId]
  );
}

/**
 * Withdraw consent + delete all data. NDPR right-to-be-forgotten compliance.
 */
export async function withdrawConsentAndDelete(waxId: string): Promise<void> {
  // Mark WAX ID as deleted (don't hard-delete for audit trail)
  await query(`UPDATE wax_ids SET status = 'deleted' WHERE wax_id = $1`, [waxId]);

  // Delete personal data across all memory tables
  await query(`DELETE FROM platform_handles WHERE wax_id = $1`, [waxId]);
  await query(`DELETE FROM procedural_rules WHERE student_phone IN (SELECT student_phone FROM wax_ids WHERE wax_id = $1)`, [waxId]);
  await query(`DELETE FROM relational_notes WHERE student_phone IN (SELECT student_phone FROM wax_ids WHERE wax_id = $1)`, [waxId]);
  await query(`DELETE FROM message_log WHERE student_phone IN (SELECT student_phone FROM wax_ids WHERE wax_id = $1)`, [waxId]);

  // Soft-delete episodes (keep aggregated, anonymized stats)
  await query(
    `UPDATE episodes SET summary = '[REDACTED]', key_moments = '[]'::jsonb
     WHERE student_phone IN (SELECT student_phone FROM wax_ids WHERE wax_id = $1)`,
    [waxId]
  );

  // Delete consent record
  await query(`DELETE FROM wax_id_consent WHERE wax_id = $1`, [waxId]);

  // Log the deletion
  await query(
    `INSERT INTO wax_id_events (wax_id, event_type, actor) VALUES ($1, 'deleted', 'student')`,
    [waxId]
  );
}
