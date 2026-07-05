import { logger } from "../utils/logger";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
  halfOpenAllowedCalls: number;
  successThreshold: number;
  monitoringWindowMs: number;
  failureRateThreshold: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalCalls: number;
  rejectionCount: number;
  stateChangedAt: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 30000,
  halfOpenMaxCalls: 2,
  halfOpenAllowedCalls: 1,
  successThreshold: 2,
  monitoringWindowMs: 60000,
  failureRateThreshold: 50,
};

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures: number = 0;
  private successes: number = 0;
  private consecutiveSuccesses: number = 0;
  private consecutiveFailures: number = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalCalls: number = 0;
  private rejectionCount: number = 0;
  private stateChangedAt: number = Date.now();
  private halfOpenCalls: number = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;
  private callHistory: Array<{ timestamp: number; success: boolean }> = [];

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      this.rejectionCount++;
      logger.warn(`Circuit breaker OPEN — request rejected`, {
        circuit: this.name,
        state: this.state,
        rejections: this.rejectionCount,
      });
      if (fallback) return fallback();
      throw new Error(`Circuit "${this.name}" is OPEN`);
    }
    return this.doExecute(fn);
  }

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      consecutiveSuccesses: this.consecutiveSuccesses,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      rejectionCount: this.rejectionCount,
      stateChangedAt: this.stateChangedAt,
    };
  }

  forceClose(): void {
    logger.info(`Circuit breaker force-closed`, { circuit: this.name });
    this.reset();
  }

  private async doExecute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "HALF_OPEN") this.halfOpenCalls++;
    this.totalCalls++;
    const callTime = Date.now();

    try {
      const result = await fn();
      this.recordSuccess(callTime);
      return result;
    } catch (error: any) {
      this.recordFailure(callTime);
      throw error;
    }
  }

  private canExecute(): boolean {
    this.maybeTransitionToHalfOpen();
    switch (this.state) {
      case "CLOSED": return true;
      case "OPEN": return false;
      case "HALF_OPEN": return this.halfOpenCalls < this.config.halfOpenAllowedCalls;
    }
  }

  private recordSuccess(callTime: number): void {
    this.successes++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();
    this.callHistory.push({ timestamp: callTime, success: true });
    this.pruneHistory();

    if (this.state === "HALF_OPEN" && this.consecutiveSuccesses >= this.config.halfOpenMaxCalls) {
      logger.info(`Circuit breaker CLOSED after ${this.consecutiveSuccesses} successes in half-open`, {
        circuit: this.name
      });
      this.transitionTo("CLOSED");
    }
  }

  private recordFailure(callTime: number): void {
    this.failures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();
    this.callHistory.push({ timestamp: callTime, success: false });
    this.pruneHistory();

    const failureRate = this.calculateFailureRate();
    const thresholdCrossed = this.consecutiveFailures >= this.config.failureThreshold;
    const rateCrossed = failureRate >= this.config.failureRateThreshold;

    if (this.state === "HALF_OPEN") {
      logger.warn(`Circuit breaker returned to OPEN after failure in half-open`, {
        circuit: this.name,
        consecutiveFailures: this.consecutiveFailures
      });
      this.transitionTo("OPEN");
    } else if (thresholdCrossed || rateCrossed) {
      logger.warn(`Circuit breaker OPENED`, {
        circuit: this.name,
        consecutiveFailures: this.consecutiveFailures,
        failureRate: `${failureRate.toFixed(1)}%`,
        reason: thresholdCrossed ? "consecutive_threshold" : "rate_threshold"
      });
      this.transitionTo("OPEN");
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state !== "OPEN" || !this.lastFailureTime) return;
    const elapsed = Date.now() - this.lastFailureTime;
    if (elapsed >= this.config.resetTimeoutMs) {
      logger.info(`Circuit breaker entering HALF_OPEN after ${elapsed}ms cooldown`, {
        circuit: this.name,
        resetTimeoutMs: this.config.resetTimeoutMs
      });
      this.halfOpenCalls = 0;
      this.transitionTo("HALF_OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.stateChangedAt = Date.now();
    if (newState === "CLOSED") this.resetCounters();
    logger.info(`Circuit breaker state transition`, {
      circuit: this.name,
      from: oldState,
      to: newState,
      failures: this.failures,
      successes: this.successes
    });
  }

  private reset(): void {
    this.state = "CLOSED";
    this.resetCounters();
    this.callHistory = [];
    this.halfOpenCalls = 0;
    this.rejectionCount = 0;
    this.stateChangedAt = Date.now();
  }

  private resetCounters(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - this.config.monitoringWindowMs;
    this.callHistory = this.callHistory.filter(c => c.timestamp >= cutoff);
  }

  private calculateFailureRate(): number {
    if (this.callHistory.length === 0) return 0;
    const failures = this.callHistory.filter(c => !c.success).length;
    return (failures / this.callHistory.length) * 100;
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(provider: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  if (!breakers.has(provider)) {
    breakers.set(provider, new CircuitBreaker(provider, config));
  }
  return breakers.get(provider)!;
}

export function getAllBreakerStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  for (const [name, breaker] of breakers) {
    stats[name] = breaker.getStats();
  }
  return stats;
}

export function resetAllBreakers(): void {
  for (const [, breaker] of breakers) {
    breaker.forceClose();
  }
}

export const cerebrasBreaker = getCircuitBreaker("cerebras", {
  failureThreshold: 3,
  resetTimeoutMs: 30000,
  halfOpenMaxCalls: 2,
  halfOpenAllowedCalls: 1,
  successThreshold: 2,
  monitoringWindowMs: 60000,
  failureRateThreshold: 60,
});
