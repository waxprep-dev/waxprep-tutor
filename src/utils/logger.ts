/**
 * Structured logging with Pino
 */
import pino from 'pino';

let loggerInstance: ReturnType<typeof pino>;

// Normalize log level to lowercase (Pino expects lowercase)
const rawLevel = process.env.LOG_LEVEL || 'info';
export const logLevel: string = rawLevel.toLowerCase();

export function getLogger(): ReturnType<typeof pino> {
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
