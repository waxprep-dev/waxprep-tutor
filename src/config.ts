// ============================================================
// CONFIGURATION — ORIGINAL STRUCTURE
// Matches existing codebase expectations
// ============================================================

export const config = {
  // Environment
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "3000"),
  
  // Database
  databaseUrl: process.env.DATABASE_URL || "",
  
  // WhatsApp
  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
    apiToken: process.env.WHATSAPP_API_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    appSecret: process.env.META_APP_SECRET || "",
  },
  
  // LLM Providers
  cerebras: {
    apiKey: process.env.CEREBRAS_API_KEY || "",
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || "",
  },
  kimi: {
    apiKey: process.env.KIMI_API_KEY || "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
  },
  
  // Safety & Crisis
  emergency: {
    phoneNumber: process.env.EMERGENCY_PHONE_NUMBER || "0800-123-4567",
    webhookUrl: process.env.EMERGENCY_WEBHOOK_URL || "",
    alertEmail: process.env.CRISIS_ALERT_EMAIL || "",
  },
  
  // System Limits
  limits: {
    maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || "4096"),
    maxEpisodeMessages: parseInt(process.env.MAX_EPISODE_MESSAGES || "50"),
    episodeTimeoutHours: parseInt(process.env.EPISODE_TIMEOUT_HOURS || "6"),
    webhookTimeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS || "15000"),
  },
  
  // Logging
  logLevel: process.env.LOG_LEVEL || "info",
  piiLoggingEnabled: process.env.PII_LOGGING_ENABLED === "true",
};

export const IS_PRODUCTION = config.NODE_ENV === "production";
export const IS_DEVELOPMENT = config.NODE_ENV === "development";
