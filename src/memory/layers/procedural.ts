/**
 * Procedural Memory Layer
 * PostgreSQL-backed storage for rules, procedures, and behavioral patterns
 * Versioned, auditable, and prioritized rule engine
 */

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import {
  ProceduralMemory,
  RuleType,
  RuleScope,
  RuleAuditEntry
} from '../types/memory.js';
import { ProceduralStorage } from '../interfaces/storage.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

export class ProceduralMemoryLayer implements ProceduralStorage {
  private supabase;
  private readonly tableName: string;

  constructor() {
    this.supabase = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
        },
        db: {
          schema: 'public'
        }
      }
    );
    this.tableName = 'procedural_memories';
  }

  /**
   * Create a new procedural rule
   */
  async create(
    rule: Omit<ProceduralMemory, 'id' | 'createdAt' | 'updatedAt' | 'auditLog'>
  ): Promise<ProceduralMemory> {
    const id = `rule_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const newRule: ProceduralMemory = {
      ...rule,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      auditLog: [{
        timestamp: Date.now(),
        action: 'created',
        actor: 'system',
        details: { rule: { ...rule } }
      }],
      metadata: {
        ...rule.metadata,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessCount: 0,
        lastAccessedAt: Date.now(),
        confidence: rule.metadata?.confidence ?? 1.0,
        salience: rule.metadata?.salience ?? 1.0,
        source: rule.metadata?.source ?? 'system_derived',
        tags: rule.metadata?.tags ?? [rule.ruleType, rule.scope],
        activationCount: rule.metadata?.activationCount ?? 0,
        lastActivation: rule.metadata?.lastActivation ?? Date.now(),
      }
    };

    const { error } = await this.supabase
      .from(this.tableName)
      .insert({
        id: newRule.id,
        user_id: newRule.userId,
        tenant_id: newRule.tenantId,
        rule_type: newRule.ruleType,
        condition: newRule.condition,
        action: newRule.action,
        priority: newRule.priority,
        scope: newRule.scope,
        version: newRule.version,
        effective_from: new Date(newRule.effectiveFrom).toISOString(),
        effective_to: newRule.effectiveTo ? new Date(newRule.effectiveTo).toISOString() : null,
        metadata: newRule.metadata,
        audit_log: newRule.auditLog,
        created_at: new Date(newRule.createdAt).toISOString(),
        updated_at: new Date(newRule.updatedAt).toISOString(),
      });

    if (error) {
      logger.error({ error, ruleId: id }, 'Failed to create procedural rule');
      throw new Error(`Failed to create procedural rule: ${error.message}`);
    }

    logger.info({
      ruleId: id,
      ruleType: newRule.ruleType,
      scope: newRule.scope,
      priority: newRule.priority
    }, 'Created procedural rule');

    return newRule;
  }

  /**
   * Get procedural rule by ID
   */
  async getById(id: string): Promise<ProceduralMemory | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Row not found
        return null;
      }
      logger.error({ error, id }, 'Failed to get procedural rule by ID');
      throw new Error(`Failed to get procedural rule: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return this.mapRowToMemory(data);
  }

  /**
   * Get all rules for a specific user
   */
  async getByUserId(userId: string): Promise<ProceduralMemory[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      logger.error({ error, userId }, 'Failed to get procedural rules by user');
      throw new Error(`Failed to get procedural rules: ${error.message}`);
    }

    return data.map(row => this.mapRowToMemory(row));
  }

  /**
   * Get rules by scope (global, tenant, user, session)
   */
  async getByScope(
    scope: 'global' | 'tenant' | 'user',
    userId?: string,
    tenantId?: string
  ): Promise<ProceduralMemory[]> {
    let query = this.supabase
      .from(this.tableName)
      .select('*')
      .eq('scope', scope)
      .order('priority', { ascending: false });

    if (scope === 'user' && userId) {
      query = query.eq('user_id', userId);
    } else if (scope === 'tenant' && tenantId) {
      query = query.eq('tenant_id', tenantId);
    } else if (scope === 'global') {
      query = query.is('user_id', null).is('tenant_id', null);
    }

    const now = new Date().toISOString();
    query = query.lte('effective_from', now);
    query = query.or(`effective_to.is.null, effective_to.gt.${now}`);

    const { data, error } = await query;

    if (error) {
      logger.error({ error, scope, userId, tenantId }, 'Failed to get procedural rules by scope');
      throw new Error(`Failed to get procedural rules: ${error.message}`);
    }

    return data.map(row => this.mapRowToMemory(row));
  }

  /**
   * Get rules by type
   */
  async getByType(ruleType: string): Promise<ProceduralMemory[]> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('rule_type', ruleType)
      .lte('effective_from', now)
      .or(`effective_to.is.null, effective_to.gt.${now}`)
      .order('priority', { ascending: false });

    if (error) {
      logger.error({ error, ruleType }, 'Failed to get procedural rules by type');
      throw new Error(`Failed to get procedural rules: ${error.message}`);
    }

    return data.map(row => this.mapRowToMemory(row));
  }

  /**
   * Update a procedural rule
   */
  async update(id: string, updates: Partial<ProceduralMemory>): Promise<ProceduralMemory> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Procedural rule not found: ${id}`);
    }

    const updatedRule: ProceduralMemory = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
      version: updates.version ?? existing.version + 1,
      metadata: {
        ...existing.metadata,
        ...updates.metadata,
        updatedAt: Date.now()
      }
    };

    const newAuditEntry: RuleAuditEntry = {
      timestamp: Date.now(),
      action: 'updated',
      actor: 'system',
      details: { updates, previous: existing }
    };

    updatedRule.auditLog = [...existing.auditLog, newAuditEntry];

    const { error } = await this.supabase
      .from(this.tableName)
      .update({
        condition: updatedRule.condition,
        action: updatedRule.action,
        priority: updatedRule.priority,
        version: updatedRule.version,
        effective_from: new Date(updatedRule.effectiveFrom).toISOString(),
        effective_to: updatedRule.effectiveTo ? new Date(updatedRule.effectiveTo).toISOString() : null,
        metadata: updatedRule.metadata,
        audit_log: updatedRule.auditLog,
        updated_at: new Date(updatedRule.updatedAt).toISOString(),
      })
      .eq('id', id);

    if (error) {
      logger.error({ error, id }, 'Failed to update procedural rule');
      throw new Error(`Failed to update procedural rule: ${error.message}`);
    }

    logger.info({ id, version: updatedRule.version }, 'Updated procedural rule');

    return updatedRule;
  }

  /**
   * Deactivate a rule (set effective_to to now)
   */
  async deactivate(id: string): Promise<ProceduralMemory> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Procedural rule not found: ${id}`);
    }

    return this.update(id, {
      effectiveTo: Date.now(),
      metadata: {
        ...existing.metadata,
        updatedAt: Date.now()
      }
    });
  }

  /**
   * Delete a rule permanently
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      logger.error({ error, id }, 'Failed to delete procedural rule');
      throw new Error(`Failed to delete procedural rule: ${error.message}`);
    }

    logger.info({ id }, 'Deleted procedural rule');
  }

  /**
   * Get active rules for a user based on context
   */
  async getActiveRules(userId: string, context?: Record<string, unknown>): Promise<ProceduralMemory[]> {
    const now = new Date().toISOString();

    const [globalRules, tenantRules, userRules] = await Promise.all([
      this.supabase
        .from(this.tableName)
        .select('*')
        .eq('scope', 'global')
        .lte('effective_from', now)
        .or(`effective_to.is.null, effective_to.gt.${now}`)
        .order('priority', { ascending: false }),
      Promise.resolve({ data: [], error: null }),
      this.supabase
        .from(this.tableName)
        .select('*')
        .eq('user_id', userId)
        .lte('effective_from', now)
        .or(`effective_to.is.null, effective_to.gt.${now}`)
        .order('priority', { ascending: false })
    ]);

    const allRules = [
      ...(globalRules.data || []),
      ...(tenantRules.data || []),
      ...(userRules.data || [])
    ];

    let filteredRules = allRules;
    if (context) {
      filteredRules = allRules.filter(rule => this.evaluateCondition(rule.condition, context));
    }

    return filteredRules.map(row => this.mapRowToMemory(row));
  }

  /**
   * Activate a rule (set effective_to to null if previously deactivated)
   */
  async activateRule(id: string): Promise<ProceduralMemory> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Procedural rule not found: ${id}`);
    }

    return this.update(id, {
      effectiveTo: undefined,
      metadata: {
        ...existing.metadata,
        updatedAt: Date.now()
      }
    });
  }

  /**
   * Increment activation counter for a rule
   */
  async incrementActivation(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Procedural rule not found: ${id}`);
    }

    const updatedMetadata = {
      ...existing.metadata,
      activationCount: (existing.metadata.activationCount || 0) + 1,
      lastActivation: Date.now(),
      updatedAt: Date.now()
    };

    const { error } = await this.supabase
      .from(this.tableName)
      .update({
        metadata: updatedMetadata,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      logger.error({ error, id }, 'Failed to increment rule activation');
      throw new Error(`Failed to increment rule activation: ${error.message}`);
    }
  }

  /**
   * Get audit trail for a rule
   */
  async getAuditTrail(id: string): Promise<RuleAuditEntry[]> {
    const rule = await this.getById(id);
    return rule ? rule.auditLog : [];
  }

  /**
   * Log rule activation
   */
  async logActivation(ruleId: string, context?: Record<string, unknown>): Promise<void> {
    const existing = await this.getById(ruleId);
    if (!existing) {
      throw new Error(`Procedural rule not found: ${ruleId}`);
    }

    const newAuditEntry: RuleAuditEntry = {
      timestamp: Date.now(),
      action: 'triggered',
      actor: 'ai_engine',
      details: { context }
    };

    const updatedAuditLog = [...existing.auditLog, newAuditEntry];

    const { error } = await this.supabase
      .from(this.tableName)
      .update({
        audit_log: updatedAuditLog,
        updated_at: new Date().toISOString()
      })
      .eq('id', ruleId);

    if (error) {
      logger.error({ error, ruleId }, 'Failed to log rule activation');
      throw new Error(`Failed to log rule activation: ${error.message}`);
    }

    await this.incrementActivation(ruleId);
  }

  /**
   * Evaluate a condition against context
   */
  private evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
    try {
      if (condition.includes('user_is_frustrated')) {
        return (context?.user as { sentiment?: string })?.sentiment === 'negative';
      }
      if (condition.includes('session_duration > 30')) {
        return ((context?.session as { duration?: number })?.duration || 0) > 30;
      }
      if (condition.includes('student_grade === "SS3"')) {
        return (context?.user as { grade?: string })?.grade === 'SS3';
      }

      return Object.values(context || {}).some(value =>
        condition.toLowerCase().includes(String(value).toLowerCase())
      );
    } catch (error) {
      logger.warn({ error, condition, context }, 'Failed to evaluate condition');
      return false;
    }
  }

  /**
   * Map database row to ProceduralMemory object
   */
  private mapRowToMemory(row: Record<string, unknown>): ProceduralMemory {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      tenantId: row.tenant_id as string | undefined,
      layer: 'procedural',
      ruleType: row.rule_type as RuleType,
      condition: row.condition as string,
      action: row.action as string,
      priority: row.priority as number,
      scope: row.scope as RuleScope,
      version: row.version as number,
      effectiveFrom: new Date(row.effective_from as string).getTime(),
      effectiveTo: row.effective_to ? new Date(row.effective_to as string).getTime() : undefined,
      auditLog: (row.audit_log as RuleAuditEntry[]) || [],
      createdAt: new Date(row.created_at as string).getTime(),
      updatedAt: new Date(row.updated_at as string).getTime(),
      metadata: (row.metadata as {
        createdAt: number;
        updatedAt: number;
        accessCount: number;
        lastAccessedAt: number;
        confidence: number;
        salience: number;
        source: string;
        tags: string[];
        activationCount: number;
        lastActivation: number;
      }) || {
        createdAt: new Date(row.created_at as string).getTime(),
        updatedAt: new Date(row.updated_at as string).getTime(),
        accessCount: 0,
        lastAccessedAt: new Date(row.created_at as string).getTime(),
        confidence: 1.0,
        salience: 1.0,
        source: 'database',
        tags: [row.rule_type as string, row.scope as string],
        activationCount: 0,
        lastActivation: Date.now(),
      }
    };
  }
}

// Singleton instance
let proceduralStorageInstance: ProceduralMemoryLayer | null = null;

export function getProceduralStorage(): ProceduralMemoryLayer {
  if (!proceduralStorageInstance) {
    proceduralStorageInstance = new ProceduralMemoryLayer();
  }
  return proceduralStorageInstance;
}

// Export for direct use if needed
export const proceduralMemory = getProceduralStorage();
