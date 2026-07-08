/**
 * Structured logging with Pino
 */
import pkg from 'pino';
const pino = pkg.default || pkg;

let loggerInstance: any;

export const logLevel: string = process.env.LOG_LEVEL || 'info';

export function getLogger(): any {
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
