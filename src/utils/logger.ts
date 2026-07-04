// ============================================================
// PII-REDACTING STRUCTURED LOGGER
// ============================================================

import { config } from "../config";

type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = new Set([
  "phone", "from", "student_phone", "to", "sender", "recipient",
  "api_key", "apikey", "token", "secret", "password", "authorization",
  "cookie", "session", "wax_id", "message_id", "raw_text", "ai_response",
  "content", "email", "address", "location",
]);

const PHONE_REGEX = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function redactString(value: string): string {
  if (!value || typeof value !== "string") return value;
  return value
    .replace(PHONE_REGEX, "[REDACTED_PHONE]")
    .replace(EMAIL_REGEX, "[REDACTED_EMAIL]");
}

function deepRedact(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepRedact);

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    if (SENSITIVE_KEYS.has(lowerKey)) {
      if (typeof value === "string") {
        result[key] = value.length > 20 ? `[REDACTED:${value.slice(0, 4)}...${value.slice(-4)}]` : "[REDACTED]";
      } else {
        result[key] = "[REDACTED]";
      }
    } else if (typeof value === "string") {
      result[key] = redactString(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = deepRedact(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function log(level: LogLevel, message: string, meta?: Record<string, any>) {
  const currentLevel = config.logLevel || config.LOG_LEVEL || "info";
  const levelMap: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  if (levelMap[level] < levelMap[currentLevel as LogLevel]) return;

  const entry: any = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: "waxprep-tutor",
    env: config.NODE_ENV,
  };

  if (meta) {
    entry.meta = config.piiLoggingEnabled || config.PII_LOGGING_ENABLED ? meta : deepRedact(meta);
  }

  const output = JSON.stringify(entry);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, any>) => log("debug", msg, meta),
  info: (msg: string, meta?: Record<string, any>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, any>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, any>) => log("error", msg, meta),
};
