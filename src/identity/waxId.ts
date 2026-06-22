import crypto from "crypto";
import { query, queryOne } from "../db/client";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * WAX ID: the universal, persistent, cross-platform identity for each student.
 *
 * Format: wax_<22 character base62 string>
 * Example: wax_a3f8b2c1d4e5f6a7b8c9d0
 *
 * 22 chars of base62 (a-z, A-Z, 0-9) gives ~130 bits of entropy.
 * That's 2^130 possible IDs — collision probability is essentially zero
 * even at 10 billion students.
 */

const WAX_ID_PREFIX = "wax_";
const WAX_ID_RANDOM_BYTES = 16;
const WAX_ID_VERSION = "wax_v1";

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function toBase62(buffer: Buffer): string {
  let num = 0n;
  for (const byte of buffer) {
    num = num * 256n + BigInt(byte);
  }
  let result = "";
  while (num > 0n) {
    result = BASE62_ALPHABET[Number(num % 62n)] + result;
    num = num / 62n;
  }
  while (result.length < 22) result = "0" + result;
  return result;
}

export function generateWaxId(): string {
  const randomBytes = crypto.randomBytes(WAX_ID_RANDOM_BYTES);
  return WAX_ID_PREFIX + toBase62(randomBytes);
}

export function generateWaxSignature(waxId: string, phone: string): string {
  const hmac = crypto.createHmac("sha256", config.whatsapp.appSecret);
  hmac.update(waxId);
  hmac.update(":");
  hmac.update(phone);
  return hmac.digest("hex");
}

export function verifyWaxSignature(waxId: string, phone: string, signature: string): boolean {
  const expected = generateWaxSignature(waxId, phone);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface WaxIdentity {
  wax_id: string;
  student_phone: string;
  status: "active" | "suspended" | "deleted";
  created_at: string;
  signature: string;
  version: string;
}

export interface PlatformHandle {
  handle_id: string;
  wax_id: string;
  platform: "whatsapp" | "web" | "mobile" | "sms" | "telegram" | "voice" | "other";
  handle_value: string;
  verified: boolean;
  is_primary: boolean;
}

export async function getWaxIdByPhone(phone: string): Promise<string | null> {
  const row = await queryOne<{ wax_id: string }>(
    `SELECT wax_id FROM wax_ids WHERE student_phone = $1 AND status = 'active' LIMIT 1`,
    [phone]
  );
  return row?.wax_id || null;
}

export async function getPhoneByWaxId(waxId: string): Promise<string | null> {
  const row = await queryOne<{ student_phone: string }>(
    `SELECT student_phone FROM wax_ids WHERE wax_id = $1 AND status = 'active' LIMIT 1`,
    [waxId]
  );
  return row?.student_phone || null;
}

export async function getWaxIdentity(waxId: string): Promise<WaxIdentity | null> {
  return queryOne<WaxIdentity>(
    `SELECT * FROM wax_ids WHERE wax_id = $1`,
    [waxId]
  );
}

export async function createWaxIdentity(phone: string): Promise<{
  wax_id: string;
  signature: string;
  already_existed: boolean;
}> {
  const existing = await getWaxIdByPhone(phone);
  if (existing) {
    const identity = await getWaxIdentity(existing);
    return {
      wax_id: existing,
      signature: identity?.signature || "",
      already_existed: true,
    };
  }

  let attempts = 0;
  let waxId: string = "";
  let signature: string = "";

  while (attempts < 3) {
    waxId = generateWaxId();
    signature = generateWaxSignature(waxId, phone);

    try {
      await query(
        `INSERT INTO wax_ids (wax_id, student_phone, signature, version)
         VALUES ($1, $2, $3, $4)`,
        [waxId, phone, signature, WAX_ID_VERSION]
      );
      break;
    } catch (err: any) {
      if (err.code === "23505") {
        attempts++;
        logger.warn("WAX ID collision, retrying", { attempt: attempts });
        continue;
      }
      throw err;
    }
  }

  if (attempts >= 3) {
    throw new Error("Failed to generate unique WAX ID after 3 attempts");
  }

  await query(
    `UPDATE students SET wax_id = $1 WHERE phone = $2`,
    [waxId, phone]
  );

  await query(
    `INSERT INTO platform_handles (wax_id, platform, handle_value, verified, verification_method, verified_at, is_primary)
     VALUES ($1, 'whatsapp', $2, TRUE, 'initial_phone', NOW(), TRUE)`,
    [waxId, phone]
  );

  await query(
    `INSERT INTO wax_id_events (wax_id, event_type, details, actor)
     VALUES ($1, 'created', $2::jsonb, 'system')`,
    [waxId, JSON.stringify({ phone, platform: "whatsapp" })]
  );

  logger.info("WAX ID created", { wax_id: waxId, phone });

  return {
    wax_id: waxId,
    signature,
    already_existed: false,
  };
}

export async function addPlatformHandle(
  waxId: string,
  platform: PlatformHandle["platform"],
  handleValue: string,
  verified: boolean = false,
  verificationMethod?: string
): Promise<void> {
  await query(
    `INSERT INTO platform_handles (wax_id, platform, handle_value, verified, verification_method, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (platform, handle_value) DO NOTHING`,
    [waxId, platform, handleValue, verified, verificationMethod || null, verified ? new Date() : null]
  );

  await query(
    `INSERT INTO wax_id_events (wax_id, event_type, details, actor)
     VALUES ($1, 'handle_added', $2::jsonb, 'system')`,
    [waxId, JSON.stringify({ platform, handle_value: handleValue, verified })]
  );
}

export async function verifyPlatformHandle(
  platform: PlatformHandle["platform"],
  handleValue: string
): Promise<void> {
  await query(
    `UPDATE platform_handles
     SET verified = TRUE,
         verification_method = COALESCE(verification_method, 'verified_post_creation'),
         verified_at = NOW()
     WHERE platform = $1 AND handle_value = $2`,
    [platform, handleValue]
  );

  const handle = await queryOne<{ wax_id: string }>(
    `SELECT wax_id FROM platform_handles WHERE platform = $1 AND handle_value = $2`,
    [platform, handleValue]
  );

  if (handle) {
    await query(
      `INSERT INTO wax_id_events (wax_id, event_type, details, actor)
       VALUES ($1, 'handle_verified', $2::jsonb, 'system')`,
      [handle.wax_id, JSON.stringify({ platform, handle_value: handleValue })]
    );
  }
}

export async function changePhoneNumber(
  waxId: string,
  oldPhone: string,
  newPhone: string
): Promise<void> {
  await query(
    `UPDATE platform_handles SET is_primary = FALSE WHERE wax_id = $1 AND handle_value = $2`,
    [waxId, oldPhone]
  );

  await query(
    `UPDATE wax_ids SET student_phone = $1 WHERE wax_id = $2`,
    [newPhone, waxId]
  );

  await query(
    `UPDATE students SET phone = $1 WHERE wax_id = $2`,
    [newPhone, waxId]
  );

  await query(
    `INSERT INTO platform_handles (wax_id, platform, handle_value, verified, verification_method, verified_at, is_primary)
     VALUES ($1, 'whatsapp', $2, TRUE, 'phone_change', NOW(), TRUE)
     ON CONFLICT (platform, handle_value) DO UPDATE SET is_primary = TRUE, wax_id = EXCLUDED.wax_id`,
    [waxId, newPhone]
  );

  await query(
    `INSERT INTO wax_id_events (wax_id, event_type, details, actor)
     VALUES ($1, 'phone_changed', $2::jsonb, 'student')`,
    [waxId, JSON.stringify({ old_phone: oldPhone, new_phone: newPhone })]
  );

  logger.info("Phone changed", { wax_id: waxId, old: oldPhone, new: newPhone });
}

export async function getWaxIdByHandle(
  platform: PlatformHandle["platform"],
  handleValue: string
): Promise<string | null> {
  const row = await queryOne<{ wax_id: string }>(
    `SELECT wax_id FROM platform_handles WHERE platform = $1 AND handle_value = $2 LIMIT 1`,
    [platform, handleValue]
  );
  return row?.wax_id || null;
}

export async function getPlatformHandles(waxId: string): Promise<PlatformHandle[]> {
  return query<PlatformHandle>(
    `SELECT * FROM platform_handles WHERE wax_id = $1 ORDER BY is_primary DESC, created_at ASC`,
    [waxId]
  );
}

export async function getPreferredHandle(
  waxId: string,
  preferredPlatform: PlatformHandle["platform"] = "whatsapp"
): Promise<PlatformHandle | null> {
  const preferred = await queryOne<PlatformHandle>(
    `SELECT * FROM platform_handles
     WHERE wax_id = $1 AND platform = $2 AND verified = TRUE
     ORDER BY is_primary DESC, last_used_at DESC NULLS LAST
     LIMIT 1`,
    [waxId, preferredPlatform]
  );
  if (preferred) return preferred;

  return queryOne<PlatformHandle>(
    `SELECT * FROM platform_handles
     WHERE wax_id = $1 AND verified = TRUE
     ORDER BY is_primary DESC, last_used_at DESC NULLS LAST
     LIMIT 1`,
    [waxId]
  );
}
