/**
 * Structured logging with Pino
 */

let loggerInstance: any = null;
let pinoModule: any = null;

export const logLevel: string = (process.env.LOG_LEVEL || 'info').toLowerCase();

async function loadPino() {
  if (!pinoModule) {
    // Dynamic import for ES module compatibility
    pinoModule = await import('pino');
    // Handle both default and named exports
    pinoModule = pinoModule.default || pinoModule;
  }
  return pinoModule;
}

export async function getLogger(): Promise<any> {
  if (!loggerInstance) {
    const pino = await loadPino();
    loggerInstance = pino({
      level: logLevel,
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
        : undefined,
    });
  }
  return loggerInstance;
}

// Initialize logger with a top-level await
export const logger = await getLogger();

export function startTimer(label: string): () => void {
  const start = performance.now();
  return () => {
    const duration = Math.round(performance.now() - start);
    logger.debug({ duration, label }, 'timer');
  };
}
