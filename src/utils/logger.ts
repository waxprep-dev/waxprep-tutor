/**
 * Structured logging with Pino — ESM-safe using createRequire
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Simple fallback logger
const fallbackLogger = {
  trace: () => {},
  debug: (...args: unknown[]) => { if (process.env.LOG_LEVEL === 'debug') console.debug('[DEBUG]', ...args); },
  info: (obj: unknown, msg?: string) => { console.log(`[INFO] ${msg || ''}`, typeof obj === 'object' ? JSON.stringify(obj) : obj); },
  warn: (obj: unknown, msg?: string) => { console.warn(`[WARN] ${msg || ''}`, typeof obj === 'object' ? JSON.stringify(obj) : obj); },
  error: (obj: unknown, msg?: string) => { console.error(`[ERROR] ${msg || ''}`, typeof obj === 'object' ? JSON.stringify(obj) : obj); },
  fatal: (obj: unknown, msg?: string) => { console.error(`[FATAL] ${msg || ''}`, typeof obj === 'object' ? JSON.stringify(obj) : obj); },
  child: () => fallbackLogger,
};

let pinoLogger: any = null;

function getPinoLogger(): any {
  if (pinoLogger) return pinoLogger;
  try {
    const pino = require('pino');
    const targetPino = pino.default || pino;
    pinoLogger = targetPino({
      level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
        : undefined,
    });
    return pinoLogger;
  } catch (err) {
    console.error('[LOGGER] Failed to load pino, using fallback:', (err as Error).message);
    return fallbackLogger;
  }
}

// Proxy that lazily loads pino on first access
export const logger = new Proxy({} as any, {
  get(_target, prop: string) {
    const instance = getPinoLogger();
    const fn = instance[prop];
    if (typeof fn === 'function') {
      return fn.bind(instance);
    }
    return fn;
  },
});

export const logLevel: string = (process.env.LOG_LEVEL || 'info').toLowerCase();

export function startTimer(label: string): () => void {
  const start = performance.now();
  return () => {
    const duration = Math.round(performance.now() - start);
    logger.debug({ duration, label }, 'timer');
  };
}
