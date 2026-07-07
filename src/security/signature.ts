/**
 * WhatsApp signature verification
 */
import { createHmac, timingSafeEqual } from 'crypto';

const APP_SECRET = process.env.APP_SECRET;

export function verifySignature(payload: string, signature: string): boolean {
  if (!APP_SECRET) {
    throw new Error('APP_SECRET not configured');
  }

  const expectedSignature = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
  const sig = signature.replace('sha256=', '');

  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');

    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function generateSignature(payload: string): string {
  if (!APP_SECRET) throw new Error('APP_SECRET not configured');
  return createHmac('sha256', APP_SECRET).update(payload).digest('hex');
}
