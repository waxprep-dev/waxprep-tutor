// FILE: src/utils/ghostLock.ts
// =====================================================
// Ghost Lock — Prevents the panic double-message
// "If you chase, they run. If you wait, they return."
// =====================================================

interface LockEntry {
  phone: string;
  lastOutboundAt: number;
  lastInboundAt: number;
  consecutiveOutbound: number;
}

const locks = new Map<string, LockEntry>();

// Increased cooldown to prevent blocking legitimate responses
const COOLDOWN_MS = 15_000; // 15 seconds (was 45s)
const MAX_CONSECUTIVE = 2; // Allow 2 consecutive before blocking

export function canSend(phone: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const entry = locks.get(phone);

  if (!entry) {
    locks.set(phone, { phone, lastOutboundAt: 0, lastInboundAt: 0, consecutiveOutbound: 0 });
    return { allowed: true };
  }

  // Always allow if student replied (inbound after outbound)
  if (entry.lastInboundAt > entry.lastOutboundAt) {
    entry.consecutiveOutbound = 0;
    return { allowed: true };
  }

  if (entry.consecutiveOutbound >= MAX_CONSECUTIVE) {
    return {
      allowed: false,
      reason: `GhostLock: ${phone} already sent ${entry.consecutiveOutbound}x without reply.`
    };
  }

  if (now - entry.lastOutboundAt < COOLDOWN_MS) {
    return {
      allowed: false,
      reason: `GhostLock: ${phone} on cooldown (${Math.round((COOLDOWN_MS - (now - entry.lastOutboundAt)) / 1000)}s remaining).`
    };
  }

  return { allowed: true };
}

export function recordOutbound(phone: string): void {
  const entry = locks.get(phone);
  if (entry) {
    entry.lastOutboundAt = Date.now();
    entry.consecutiveOutbound += 1;
  } else {
    locks.set(phone, { phone, lastOutboundAt: Date.now(), lastInboundAt: 0, consecutiveOutbound: 1 });
  }
}

export function recordInbound(phone: string): void {
  const entry = locks.get(phone);
  if (entry) {
    entry.lastInboundAt = Date.now();
    entry.consecutiveOutbound = 0;
  } else {
    locks.set(phone, { phone, lastOutboundAt: 0, lastInboundAt: Date.now(), consecutiveOutbound: 0 });
  }
}
