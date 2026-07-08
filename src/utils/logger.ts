/**
 * Structured logging with Pino
 */
import pino from 'pino';

export let logger: pino.Logger;

// Keep this var for legacy code that reads logLevel
export const logLevel: string = process.env.LOG_LEVEL || 'info';

export function initializeLogger(): void {
  logger = pino({
    level: logLevel,
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
      : undefined,
  });
}

// Auto-init if module-level `logger` is accessed before explicit init
initializeLogger();

export function startTimer(label: string): () => void {
  const start = performance.now();
  return () => {
    const duration = Math.round(performance.now() - start);
    logger.debug({ duration, label }, 'timer');
  };
}
