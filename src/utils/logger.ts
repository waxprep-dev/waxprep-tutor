/**
 * Structured logging with Pino
 */
import pino from 'pino';

let loggerInstance: pino.Logger;

// Keep this var for legacy code that reads logLevel
export const logLevel: string = process.env.LOG_LEVEL || 'info';

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    loggerInstance = pino({
      level: logLevel,
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
        : undefined,
    });
  }
  return loggerInstance;
}

export const logger = getLogger();

export function startTimer(label: string): () => void {
  const start = performance.now();
  return () => {
    const duration = Math.round(performance.now() - start);
    logger.debug({ duration, label }, 'timer');
  };
}
