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
  lastMessageLength: number;
}

const locks = new Map<string, LockEntry>();

// All values are configurable via environment variables
const COOLDOWN_MS = parseInt(process.env.GHOST_LOCK_COOLDOWN_MS || "45000");
const MAX_CONSECUTIVE = parseInt(process.env.GHOST_LOCK_MAX_CONSECUTIVE || "1");

export function canSend(phone: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const entry = locks.get(phone);

  if (!entry) {
    locks.set(phone, { 
      phone, 
      lastOutboundAt: 0, 
      lastInboundAt: 0, 
      consecutiveOutbound: 0, 
      lastMessageLength: 0 
    });
    return { allowed: true };
  }

  // If we already sent without receiving a reply, block
  if (entry.consecutiveOutbound >= MAX_CONSECUTIVE && entry.lastOutboundAt > entry.lastInboundAt) {
    return {
      allowed: false,
      reason: `GhostLock: ${phone} already sent ${entry.consecutiveOutbound}x without reply.`,
    };
  }

  // Cooldown between messages
  if (now - entry.lastOutboundAt < COOLDOWN_MS && entry.lastOutboundAt > entry.lastInboundAt) {
    return {
      allowed: false,
      reason: `GhostLock: ${phone} on cooldown.`,
    };
  }

  return { allowed: true };
}

export function recordOutbound(phone: string, messageLength: number = 0): void {
  const entry = locks.get(phone);
  if (entry) {
    entry.lastOutboundAt = Date.now();
    entry.consecutiveOutbound += 1;
    entry.lastMessageLength = messageLength;
  } else {
    locks.set(phone, {
      phone,
      lastOutboundAt: Date.now(),
      lastInboundAt: 0,
      consecutiveOutbound: 1,
      lastMessageLength: messageLength,
    });
  }
}

export function recordInbound(phone: string): void {
  const entry = locks.get(phone);
  if (entry) {
    entry.lastInboundAt = Date.now();
    entry.consecutiveOutbound = 0;
  } else {
    locks.set(phone, {
      phone,
      lastOutboundAt: 0,
      lastInboundAt: Date.now(),
      consecutiveOutbound: 0,
      lastMessageLength: 0,
    });
  }
}

export function resetLock(phone: string): void {
  locks.delete(phone);
}
