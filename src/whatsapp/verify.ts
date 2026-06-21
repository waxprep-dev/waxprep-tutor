import crypto from "crypto";
import { config } from "../config";

/**
 * Verify that incoming webhook requests are actually from Meta.
 * Every request has a signature header. We recompute it with our app secret
 * and compare. If they don't match, reject.
 */

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined
): boolean {
  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const providedSignature = signatureHeader.split("=")[1];

  const expectedSignature = crypto
    .createHmac("sha256", config.whatsapp.appSecret)
    .update(rawBody)
    .digest("hex");

  // timingSafeEqual to prevent timing attacks
  const provided = Buffer.from(providedSignature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");

  if (provided.length !== expected.length) return false;

  return crypto.timingSafeEqual(provided, expected);
}

/**
 * Verify webhook challenge (Meta sends this when you first register the webhook).
 */
export function verifyChallenge(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined
): string | null {
  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    return challenge || null;
  }
  return null;
}
