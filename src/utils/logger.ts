/**
 * Structured logging with Pino — ESM-safe, no top-level await
 */

// Simple fallback logger that works in any environment
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
let pinoLoadAttempted = false;

async function loadPinoLogger(): Promise<any> {
  if (pinoLoadAttempted) return pinoLogger || fallbackLogger;
  pinoLoadAttempted = true;

  try {
    const pinoModule = await import('pino');
    const pino = pinoModule.default || pinoModule;
    pinoLogger = pino({
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

// Synchronous proxy — async init happens lazily
let asyncLogger: any = null;

function ensureLogger(): any {
  if (!asyncLogger) {
    // Kick off async load but return fallback immediately
    loadPinoLogger().then(logger => { asyncLogger = logger; });
  }
  return asyncLogger || fallbackLogger;
}

export const logger = new Proxy({} as any, {
  get(_target, prop: string) {
    const instance = ensureLogger();
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
