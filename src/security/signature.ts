/**
 * Webhook Signature Verification
 * HMAC-SHA256 verification for secure webhook authentication
 */

import crypto from 'crypto';
import { config } from '../config/index.js';

/**
 * Verifies the signature of an incoming webhook request
 * @param signatureHeader The signature from the request header
 * @param rawBody The raw request body (before JSON parsing)
 */
export function verifyWebhookSignature(signatureHeader: string | undefined, rawBody: Buffer): void {
  if (!signatureHeader) {
    throw new Error('Missing signature header');
  }

  // Extract the hash from the header (format: "sha256=abc123...")
  const signatureMatch = signatureHeader.match(/^sha256=(.*)$/);
  if (!signatureMatch) {
    throw new Error('Invalid signature format');
  }

  const expectedSignature = signatureMatch[1];

  // Create HMAC with app secret
  const hmac = crypto.createHmac('sha256', config.meta.appSecret);
  hmac.update(rawBody);
  const computedSignature = hmac.digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  if (!timingSafeEqual(expectedSignature, computedSignature)) {
    throw new Error('Invalid signature');
  }
}

/**
 * Timing-safe string comparison to prevent timing attacks
 * @param a First string to compare
 * @param b Second string to compare
 * @returns True if strings are equal
 */
export function timingSafeEqual(a: string, b: string): boolean {
  try {
    // Ensure both strings are the same length to prevent length-based timing attacks
    if (a.length !== b.length) {
      // Perform comparison anyway to maintain constant time
      crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(a, 'hex'));
      return false;
    }
    
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch (error) {
    // If there's an error (e.g., invalid hex), return false safely
    return false;
  }
}

/**
 * Generate a signature for testing purposes
 * @param body The request body to sign
 * @returns The signature string
 */
export function generateTestSignature(body: string): string {
  const hmac = crypto.createHmac('sha256', config.meta.appSecret);
  hmac.update(body);
  const signature = hmac.digest('hex');
  return `sha256=${signature}`;
}

/**
 * Validate the signature format
 * @param signature The signature to validate
 * @returns True if valid format
 */
export function isValidSignatureFormat(signature: string): boolean {
  return /^sha256=[a-fA-F0-9]{64}$/.test(signature);
}
