/**
 * Configuration Loader
 * Validates and loads all environment variables with strict typing
 */

import { Config } from '../types/config.js';

function getEnvVar(name: string, required = true): string | undefined {
  const value = process.env[name];

  if (required && (value === undefined || value.trim() === '')) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getEnvVarNumber(name: string, defaultValue: number): number {
  const value = getEnvVar(name, false);
  if (value === undefined) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid numeric value for environment variable: ${name} = ${value}`);
  }

  return parsed;
}

export const config: Config = {
  meta: {
    appSecret: getEnvVar('WHATSAPP_APP_SECRET') || getEnvVar('META_APP_SECRET')!,
    verifyToken: getEnvVar('WHATSAPP_VERIFY_TOKEN') || getEnvVar('META_VERIFY_TOKEN')!,
    phoneNumberId: getEnvVar('WHATSAPP_PHONE_NUMBER_ID') || getEnvVar('META_PHONE_NUMBER_ID')!,
    accessToken: getEnvVar('WHATSAPP_ACCESS_TOKEN') || getEnvVar('META_ACCESS_TOKEN')!,
  },
  redis: {
    url: getEnvVar('REDIS_URL')!,
    password: getEnvVar('REDIS_PASSWORD', false),
    db: getEnvVarNumber('REDIS_DB', 0),
  },
  supabase: {
    url: getEnvVar('SUPABASE_URL')!,
    serviceRoleKey: getEnvVar('SUPABASE_SERVICE_KEY') || getEnvVar('SUPABASE_SERVICE_ROLE_KEY')!,
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

// Validate configuration on startup
export function validateConfig(): void {
  if (!config.meta.appSecret) {
    throw new Error('WHATSAPP_APP_SECRET or META_APP_SECRET is required');
  }

  if (!config.meta.verifyToken) {
    throw new Error('WHATSAPP_VERIFY_TOKEN or META_VERIFY_TOKEN is required');
  }

  if (!config.meta.phoneNumberId) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID or META_PHONE_NUMBER_ID is required');
  }

  if (!config.meta.accessToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN or META_ACCESS_TOKEN is required');
  }

  if (!config.supabase.url) {
    throw new Error('SUPABASE_URL is required');
  }

  if (!config.supabase.serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY is required');
  }

  console.log('Configuration validated successfully');
}

validateConfig();
