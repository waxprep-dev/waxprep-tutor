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

const COOLDOWN_MS = 45_000;
const MAX_CONSECUTIVE = 1;

export function canSend(phone: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const entry = locks.get(phone);

  if (!entry) {
    locks.set(phone, { phone, lastOutboundAt: 0, lastInboundAt: 0, consecutiveOutbound: 0 });
    return { allowed: true };
  }

  if (entry.consecutiveOutbound >= MAX_CONSECUTIVE && entry.lastOutboundAt > entry.lastInboundAt) {
    return {
      allowed: false,
      reason: `GhostLock: ${phone} already sent ${entry.consecutiveOutbound}x without reply.`,
    };
  }

  if (now - entry.lastOutboundAt < COOLDOWN_MS) {
    return {
      allowed: false,
      reason: `GhostLock: ${phone} on cooldown.`,
    };
  }

  return { allowed: true };
}

export function recordOutbound(phone: string): void {
  const entry = locks.get(phone);
  if (entry) {
    entry.lastOutboundAt = Date.now();
    entry.consecutiveOutbound += 1;
  }
}

export function recordInbound(phone: string): void {
  const entry = locks.get(phone);
  if (entry) {
    entry.lastInboundAt = Date.now();
    entry.consecutiveOutbound = 0;
  }
}
