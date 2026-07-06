/**
 * Timing Utilities
 * Performance timers and timeout helpers for webhook performance guarantees
 */

export class Timer {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  public elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  public elapsedSeconds(): number {
    return this.elapsedMs() / 1000;
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function measureAsync<T>(
  fn: () => Promise<T>,
  label: string
): Promise<{ result: T; durationMs: number }> {
  const timer = new Timer();
  
  return fn().then(result => {
    const duration = timer.elapsedMs();
    console.log(`[${label}] Completed in ${duration}ms`);
    return { result, durationMs: duration };
  });
}

export function ensureMinExecutionTime<T>(
  promise: Promise<T>,
  minMs: number
): Promise<T> {
  return Promise.all([promise, sleep(minMs)]).then(([result]) => result);
}
