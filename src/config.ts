import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  port: parseInt(optional("PORT", "3000"), 10),
  nodeEnv: optional("NODE_ENV", "development"),

  databaseUrl: required("DATABASE_URL"),

  whatsapp: {
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
    appSecret: required("WHATSAPP_APP_SECRET"),
  },

  groq: {
    apiKey: required("GROQ_API_KEY"),
    baseUrl: optional("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
    model: optional("GROQ_MODEL", "openai/gpt-oss-120b"),
  },

  kimi: {
    apiKey: optional("KIMI_API_KEY", ""),
    baseUrl: optional("KIMI_BASE_URL", "https://api.moonshot.cn/v1"),
    model: optional("KIMI_MODEL", "moonshot-v1-8k"),
  },

  anthropic: {
    apiKey: optional("ANTHROPIC_API_KEY", ""),
    model: optional("CLAUDE_MODEL", "claude-3-5-sonnet-20241022"),
  },

  openai: {
    apiKey: optional("OPENAI_API_KEY", ""),
    model: optional("OPENAI_MODEL", "gpt-4o"),
    embeddingModel: optional("EMBEDDING_MODEL", "text-embedding-3-small"),
  },

  embeddingProvider: optional("EMBEDDING_PROVIDER", "local") as "local" | "openai",

  tutor: {
    defaultName: optional("DEFAULT_TUTOR_NAME", "Wax"),
    defaultFormality: optional("DEFAULT_TUTOR_FORMALITY", "casual"),
  },

  safety: {
    distressHelpline: required("DISTRESS_HELPLINE_NIGERIA"),
  },
};
