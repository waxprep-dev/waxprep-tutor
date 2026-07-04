// ============================================================
// CENTRALIZED CONFIGURATION
// ============================================================

export const config = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "3000"),
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL || "",
  DB_POOL_SIZE: parseInt(process.env.DB_POOL_SIZE || "20"),
  DB_STATEMENT_TIMEOUT: parseInt(process.env.DB_STATEMENT_TIMEOUT || "30000"),
  
  // WhatsApp
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || "",
  WHATSAPP_API_TOKEN: process.env.WHATSAPP_API_TOKEN || "",
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  META_APP_SECRET: process.env.META_APP_SECRET || "",
  
  // LLM
  CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY || "",
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  KIMI_API_KEY: process.env.KIMI_API_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  
  // Safety & Crisis
  EMERGENCY_PHONE_NUMBER: process.env.EMERGENCY_PHONE_NUMBER || "0800-123-4567",
  EMERGENCY_WEBHOOK_URL: process.env.EMERGENCY_WEBHOOK_URL || "",
  CRISIS_ALERT_EMAIL: process.env.CRISIS_ALERT_EMAIL || "",
  
  // System Limits
  MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH || "4096"),
  MAX_EPISODE_MESSAGES: parseInt(process.env.MAX_EPISODE_MESSAGES || "50"),
  EPISODE_TIMEOUT_HOURS: parseInt(process.env.EPISODE_TIMEOUT_HOURS || "6"),
  WEBHOOK_TIMEOUT_MS: parseInt(process.env.WEBHOOK_TIMEOUT_MS || "15000"),
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  PII_LOGGING_ENABLED: process.env.PII_LOGGING_ENABLED === "true",
};

export const IS_PRODUCTION = config.NODE_ENV === "production";
export const IS_DEVELOPMENT = config.NODE_ENV === "development";
