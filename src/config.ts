// ============================================================
// CONFIGURATION — MATCHES ALL EXISTING FILES
// ============================================================

export const config = {
  // Environment
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "3000"),
  
  // Database
  databaseUrl: process.env.DATABASE_URL || "",
  dbPoolSize: parseInt(process.env.DB_POOL_SIZE || "20"),
  dbStatementTimeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || "30000"),
  
  // WhatsApp
  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
    apiToken: process.env.WHATSAPP_ACCESS_TOKEN || "",  // Changed from WHATSAPP_API_TOKEN
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",  // Alias
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",  // Changed from META_APP_SECRET
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
    embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  },
  
  // Embedding
  embeddingProvider: process.env.EMBEDDING_PROVIDER || "local",
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  
  // Safety & Crisis
  emergency: {
    phoneNumber: process.env.DISTRESS_HELPLINE_NIGERIA || "0800-123-4567",
    webhookUrl: process.env.EMERGENCY_WEBHOOK_URL || "",
    alertEmail: process.env.CRISIS_ALERT_EMAIL || "",
  },
  
  // System Limits
  MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH || "4096"),
  MAX_EPISODE_MESSAGES: parseInt(process.env.MAX_EPISODE_MESSAGES || "50"),
  EPISODE_TIMEOUT_HOURS: parseInt(process.env.EPISODE_TIMEOUT_HOURS || "6"),
  WEBHOOK_TIMEOUT_MS: parseInt(process.env.WEBHOOK_TIMEOUT_MS || "15000"),
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  logLevel: process.env.LOG_LEVEL || "info",
  PII_LOGGING_ENABLED: process.env.PII_LOGGING_ENABLED === "true",
  piiLoggingEnabled: process.env.PII_LOGGING_ENABLED === "true",
};

export const IS_PRODUCTION = config.NODE_ENV === "production";
export const IS_DEVELOPMENT = config.NODE_ENV === "development";
