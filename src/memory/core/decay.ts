/**
 * Memory Decay Engine
 * Implements mathematical models of forgetting based on cognitive science
 * Combines Ebbinghaus curve, dual-trace theory, and salience weighting
 */

import { LongTermMemory, EpisodicMemory, MemoryBase } from '../types/memory.js';

export interface DecayParameters {
  // Base decay rate (higher = faster forgetting)
  baseDecayRate: number; // Default: 0.1
  
  // Salience influence (how much importance affects retention)
  salienceWeight: number; // Default: 0.3
  
  // Access reinforcement (how much each access strengthens memory)
  accessReinforcement: number; // Default: 0.05
  
  // Emotional weighting (how emotions affect retention)
  emotionalWeight: number; // Default: 0.2
  
  // Minimum confidence floor (never forget completely)
  minConfidence: number; // Default: 0.1
  
  // Time unit in milliseconds (default: 1 day)
  timeUnitMs: number; // Default: 86400000 (24h)
}

export class MemoryDecayEngine {
  private static instance: MemoryDecayEngine | null = null;
  private params: DecayParameters;

  private constructor(params?: Partial<DecayParameters>) {
    this.params = {
      baseDecayRate: params?.baseDecayRate ?? 0.1,
      salienceWeight: params?.salienceWeight ?? 0.3,
      accessReinforcement: params?.accessReinforcement ?? 0.05,
      emotionalWeight: params?.emotionalWeight ?? 0.2,
      minConfidence: params?.minConfidence ?? 0.1,
      timeUnitMs: params?.timeUnitMs ?? 24 * 60 * 60 * 1000, // 24 hours
    };
  }

  static initialize(params?: Partial<DecayParameters>): MemoryDecayEngine {
    if (!MemoryDecayEngine.instance) {
      MemoryDecayEngine.instance = new MemoryDecayEngine(params);
    }
    return MemoryDecayEngine.instance;
  }

  /**
   * Calculate decayed confidence for a memory
   */
  calculateDecayedConfidence<T extends MemoryBase>(
    memory: T,
    currentTime: number = Date.now()
  ): number {
    const timeSinceLastAccess = currentTime - memory.metadata.lastAccessedAt;
    const timeSinceCreation = currentTime - memory.metadata.createdAt;
    
    // Calculate base decay using Ebbinghaus forgetting curve
    const timeFactor = this.calculateTimeDecay(timeSinceLastAccess);
    
    // Apply salience weighting
    const salienceFactor = this.calculateSalienceFactor(memory.metadata.salience);
    
    // Apply emotional weighting if available
    const emotionalFactor = this.calculateEmotionalFactor(memory);
    
    // Combine factors
    const decayMultiplier = 
      timeFactor * 
      (1 - (this.params.salienceWeight * (salienceFactor - 1))) *
      (1 - (this.params.emotionalWeight * (emotionalFactor - 1)));
    
    // Apply minimum floor
    const decayedConfidence = Math.max(
      this.params.minConfidence,
      memory.metadata.confidence * decayMultiplier
    );
    
    return Math.min(decayedConfidence, 1.0); // Cap at 1.0
  }

  /**
   * Calculate decay for multiple memories
   */
  calculateMultipleDecays<T extends MemoryBase>(
    memories: T[],
    currentTime: number = Date.now()
  ): Array<{ id: string; originalConfidence: number; decayedConfidence: number; shouldKeep: boolean }> {
    return memories.map(memory => {
      const decayedConfidence = this.calculateDecayedConfidence(memory, currentTime);
      const shouldKeep = decayedConfidence > this.params.minConfidence * 0.8; // Small buffer
      
      return {
        id: memory.id,
        originalConfidence: memory.metadata.confidence,
        decayedConfidence,
        shouldKeep
      };
    });
  }

  /**
   * Update memory metadata with decay calculations
   */
  updateMemoryWithDecay<T extends MemoryBase>(memory: T, currentTime: number = Date.now()): T {
    const decayedConfidence = this.calculateDecayedConfidence(memory, currentTime);
    
    return {
      ...memory,
      metadata: {
        ...memory.metadata,
        confidence: decayedConfidence,
        updatedAt: currentTime,
        lastAccessedAt: currentTime
      }
    };
  }

  /**
   * Reinforce memory strength when accessed
   */
  reinforceMemory<T extends MemoryBase>(memory: T, strengthBoost: number = 0.05): T {
    const newConfidence = Math.min(
      1.0,
      memory.metadata.confidence + (strengthBoost * this.params.accessReinforcement)
    );
    
    return {
      ...memory,
      metadata: {
        ...memory.metadata,
        confidence: newConfidence,
        accessCount: memory.metadata.accessCount + 1,
        lastAccessedAt: Date.now(),
        updatedAt: Date.now()
      }
    };
  }

  /**
   * Calculate time-based decay using Ebbinghaus curve
   * Formula: R = e^(-t/S) where S = stability parameter
   */
  private calculateTimeDecay(timeSinceAccess: number): number {
    // Convert time to time units
    const timeUnits = timeSinceAccess / this.params.timeUnitMs;
    
    // Apply Ebbinghaus forgetting curve with base decay rate
    // Higher baseDecayRate means faster forgetting
    const stability = 1 / this.params.baseDecayRate;
    
    // R = e^(-timeUnits/stability)
    const retention = Math.exp(-timeUnits / stability);
    
    // Ensure result is between 0 and 1
    return Math.max(0, Math.min(1, retention));
  }

  /**
   * Calculate salience factor (how important the memory is)
   */
  private calculateSalienceFactor(salience: number): number {
    // Salience is typically between 0 and 1
    // Higher salience means slower decay
    return 1 + (salience * this.params.salienceWeight);
  }

  /**
   * Calculate emotional weighting based on memory properties
   */
  private calculateEmotionalFactor<T extends MemoryBase>(memory: T): number {
    // For now, use a simple approach based on tags
    // In the future, this could use sentiment analysis of content
    const emotionalTags = ['important', 'urgent', 'critical', 'personal', 'emotional'];
    const hasEmotionalTag = memory.metadata.tags.some(tag => 
      emotionalTags.includes(tag.toLowerCase())
    );
    
    return hasEmotionalTag ? (1 + this.params.emotionalWeight) : 1;
  }

  /**
   * Get time until confidence drops below threshold
   */
  getTimeToThreshold<T extends MemoryBase>(
    memory: T,
    threshold: number = 0.5,
    currentTime: number = Date.now()
  ): number {
    if (memory.metadata.confidence <= threshold) {
      return 0; // Already below threshold
    }

    // Binary search to find when confidence will reach threshold
    let low = 0;
    let high = 365 * 24 * 60 * 60 * 1000; // 1 year max
    let timeEstimate = high;

    while (high - low > 1000) { // 1 second precision
      const mid = Math.floor((low + high) / 2);
      const testTime = currentTime + mid;
      
      const testMemory = { ...memory, metadata: { ...memory.metadata } };
      testMemory.metadata.lastAccessedAt = currentTime;
      
      const decayedConfidence = this.calculateDecayedConfidence(testMemory, testTime);
      
      if (decayedConfidence <= threshold) {
        timeEstimate = mid;
        high = mid;
      } else {
        low = mid;
      }
    }

    return timeEstimate;
  }

  /**
   * Get memories that should be pruned based on decay
   */
  getPrunableMemories<T extends MemoryBase>(
    memories: T[],
    currentTime: number = Date.now(),
    threshold: number = this.params.minConfidence * 0.8
  ): T[] {
    return memories.filter(memory => {
      const decayedConfidence = this.calculateDecayedConfidence(memory, currentTime);
      return decayedConfidence <= threshold;
    });
  }

  /**
   * Update decay parameters
   */
  updateParameters(newParams: Partial<DecayParameters>): void {
    this.params = { ...this.params, ...newParams };
  }

  /**
   * Get current parameters
   */
  getParameters(): DecayParameters {
    return { ...this.params };
  }
}

// Default instance with conservative parameters
export const decayEngine = MemoryDecayEngine.initialize();

/**
 * Utility function to apply decay to memory arrays
 */
export function applyDecayFilter<T extends MemoryBase>(
  memories: T[],
  threshold: number = 0.3,
  currentTime: number = Date.now()
): { kept: T[]; pruned: T[] } {
  const results = decayEngine.calculateMultipleDecays(memories, currentTime);
  
  const kept: T[] = [];
  const pruned: T[] = [];
  
  memories.forEach((memory, index) => {
    if (results[index].shouldKeep) {
      kept.push(decayEngine.updateMemoryWithDecay(memory, currentTime));
    } else {
      pruned.push(memory);
    }
  });
  
  return { kept, pruned };
}
