/**
 * Configuration Loader
 * SAFE: Does NOT throw on module load — defers validation to runtime
 */

function getEnvVar(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (required && (value === undefined || value.trim() === '')) {
    return undefined;
  }
  return value;
}

function getEnvVarNumber(name: string, defaultValue: number): number {
  const value = getEnvVar(name, false);
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`[CONFIG] Invalid numeric value for ${name}, using default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

export const config = {
  meta: {
    appSecret: getEnvVar('WHATSAPP_APP_SECRET') || getEnvVar('META_APP_SECRET') || '',
    verifyToken: getEnvVar('WHATSAPP_VERIFY_TOKEN') || getEnvVar('META_VERIFY_TOKEN') || '',
    phoneNumberId: getEnvVar('WHATSAPP_PHONE_NUMBER_ID') || getEnvVar('META_PHONE_NUMBER_ID') || '',
    accessToken: getEnvVar('WHATSAPP_ACCESS_TOKEN') || getEnvVar('META_ACCESS_TOKEN') || '',
  },
  redis: {
    url: getEnvVar('REDIS_URL') || 'redis://localhost:6379',
    password: getEnvVar('REDIS_PASSWORD', false),
    db: getEnvVarNumber('REDIS_DB', 0),
  },
  supabase: {
    url: getEnvVar('SUPABASE_URL') || '',
    serviceRoleKey: getEnvVar('SUPABASE_SERVICE_KEY') || getEnvVar('SUPABASE_SERVICE_ROLE_KEY') || '',
  },
  server: {
    port: getEnvVarNumber('PORT', 3000),
  },
  queue: {
    prefix: getEnvVar('QUEUE_PREFIX', false) || 'waxprep',
    concurrency: getEnvVarNumber('QUEUE_CONCURRENCY', 10),
    maxRetries: getEnvVarNumber('QUEUE_MAX_RETRIES', 3),
  },
  webhook: {
    timeoutMs: getEnvVarNumber('WEBHOOK_TIMEOUT_MS', 80),
    maxBodySize: getEnvVarNumber('WEBHOOK_MAX_BODY_SIZE', 1048576),
  },
  security: {
    signatureHeader: getEnvVar('SECURITY_SIGNATURE_HEADER', false) || 'x-hub-signature-256',
  },
  logging: {
    level: getEnvVar('LOG_LEVEL', false) || 'info',
  },
};

export function validateConfig(): void {
  const missing: string[] = [];

  if (!config.meta.appSecret) missing.push('WHATSAPP_APP_SECRET or META_APP_SECRET');
  if (!config.meta.verifyToken) missing.push('WHATSAPP_VERIFY_TOKEN or META_VERIFY_TOKEN');
  if (!config.meta.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID or META_PHONE_NUMBER_ID');
  if (!config.meta.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN or META_ACCESS_TOKEN');
  if (!config.supabase.url) missing.push('SUPABASE_URL');
  if (!config.supabase.serviceRoleKey) missing.push('SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables:\n  - ${missing.join('\n  - ')}`);
  }

  console.log('[CONFIG] Configuration validated successfully');
}
