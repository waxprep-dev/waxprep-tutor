/**
 * Configuration Type Definitions
 * Strict TypeScript interfaces for all configuration values
 */

export interface Config {
  meta: {
    appSecret: string;
    verifyToken: string;
    phoneNumberId: string;
    accessToken: string;
  };
  redis: {
    url: string;
    password?: string;
    db: number;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  server: {
    port: number;
  };
  queue: {
    prefix: string;
    concurrency: number;
    maxRetries: number;
  };
  webhook: {
    timeoutMs: number;
    maxBodySize: number;
  };
  security: {
    signatureHeader: string;
  };
  logging: {
    level: string;
  };
}
