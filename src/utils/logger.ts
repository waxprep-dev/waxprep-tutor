/**
 * Structured logging with Pino — SYNCHRONOUS, crash-safe
 */

// Simple fallback logger that never crashes
const fallbackLogger = {
  trace: () => {},
  debug: () => {},
  info: (obj: unknown, msg?: string) => { console.log(`[INFO] ${msg || ''}`, typeof obj === 'object' ? JSON.stringify(obj) : obj); },
  warn: (obj: unknown, msg?: string) => { console.warn(`[WARN] ${msg || ''}`, typeof obj === 'object' ? JSON.stringify(obj) : obj); },
  error: (obj: unknown, msg?: string) => { console.error(`[ERROR] ${msg || ''}`, typeof obj === 'object' ? JSON.stringify(obj) : obj); },
  fatal: (obj: unknown, msg?: string) => { console.error(`[FATAL] ${msg || ''}`, typeof obj === 'object' ? JSON.stringify(obj) : obj); },
  child: () => fallbackLogger,
};

let pinoLogger: any = null;

function createPinoLogger(): any {
  try {
    const pino = require('pino');
    const targetPino = pino.default || pino;
    return targetPino({
      level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
        : undefined,
    });
  } catch (err) {
    console.error('[LOGGER] Failed to load pino, using fallback logger:', (err as Error).message);
    return fallbackLogger;
  }
}

function getLoggerInstance(): any {
  if (!pinoLogger) {
    pinoLogger = createPinoLogger();
  }
  return pinoLogger;
}

export const logger = new Proxy({} as any, {
  get(_target, prop: string) {
    const instance = getLoggerInstance();
    return instance[prop] || fallbackLogger[prop as keyof typeof fallbackLogger];
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
