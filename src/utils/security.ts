// ============================================================
// SECURITY UTILITIES
// Prototype pollution protection, safe JSON, crypto randomness
// ============================================================

import { randomBytes } from "crypto";
import { logger } from "./logger";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// ============================================================
// SAFE OBJECT MERGE (Anti-Prototype-Pollution)
// ============================================================
export function safeMerge<T extends Record<string, any>>(
  target: T,
  source: Partial<T>
): T {
  const result: any = {};
  
  for (const key of Object.keys(target)) {
    if (!FORBIDDEN_KEYS.has(key)) {
      result[key] = (target as any)[key];
    }
  }
  
  for (const key of Object.keys(source)) {
    if (!FORBIDDEN_KEYS.has(key)) {
      result[key] = (source as any)[key];
    }
  }
  
  return result as T;
}

export function sanitizeKeys(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeKeys);
  
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    result[key] = typeof value === "object" && value !== null 
      ? sanitizeKeys(value) 
      : value;
  }
  return result;
}

// ============================================================
// SAFE JSON PARSE (Anti-Prototype-Pollution)
// ============================================================
const MAX_JSON_LENGTH = 1024 * 1024; // 1MB

export function safeJsonParse(text: string, maxLength = MAX_JSON_LENGTH): any {
  if (!text || typeof text !== "string") {
    throw new Error("Invalid JSON input: not a string");
  }
  
  if (text.length > maxLength) {
    throw new Error(`JSON input exceeds maximum length of ${maxLength}`);
  }
  
  const result = JSON.parse(text, (key, value) => {
    if (FORBIDDEN_KEYS.has(key)) {
      logger.warn("Blocked prototype pollution key in JSON", { key });
      return undefined;
    }
    return value;
  });
  
  return result;
}

// ============================================================
// SAFE JSON STRINGIFY (Circular Reference Safe)
// ============================================================
export function safeJsonStringify(obj: any, space?: number): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (FORBIDDEN_KEYS.has(key)) return undefined;
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular Reference]";
      }
      seen.add(value);
    }
    return value;
  }, space);
}

// ============================================================
// CRYPTO-SAFE RANDOMNESS
// ============================================================
export function secureRandomInt(max: number): number {
  if (max <= 0) return 0;
  return randomBytes(4).readUInt32LE(0) % max;
}

export function generateSecureId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

// ============================================================
// SAFE REDACTION (for error messages)
// ============================================================
export function redactSecrets(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/(password|secret|token|key|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]");
}
