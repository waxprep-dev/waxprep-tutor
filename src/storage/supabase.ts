/**
 * Supabase Storage Layer
 * PostgreSQL persistence with upsert semantics for event auditing
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';
import { WebhookEvent, MessageEvent, StatusEvent } from '../types/webhook.js';
import { logDatabaseOperation } from '../utils/logger.js';
import { Timer } from '../utils/timing.js';
import { Database } from './database.types.js'; // This will be generated based on your DB schema

let supabaseClient: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabaseClient) {
    supabaseClient = createClient<Database>(
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
  }
  return supabaseClient;
}

/**
 * Persist an incoming webhook event to the database
 * Uses upsert to handle potential duplicates
 */
export async function persistEvent(event: WebhookEvent): Promise<boolean> {
  const timer = new Timer();
  const client = getSupabaseClient();

  try {
    const { error } = await client
      .from('webhook_events')
      .upsert({
        id: event.id,
        event_type: event.type,
        event_subtype: event.subtype,
        source_phone: event.sourcePhone,
        phone_number_id: event.phoneNumberId,
        timestamp: new Date(event.timestamp * 1000).toISOString(),
        raw_payload: event.rawPayload,
        metadata: event.metadata,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'id', // Conflict on the id column
        ignoreDuplicates: false // Don't ignore, but don't fail either
      });

    if (error) {
      console.error('Error persisting event:', error);
      return false;
    }

    const durationMs = timer.elapsedMs();
    logDatabaseOperation('upsert', 'webhook_events', durationMs, true);
    return true;
  } catch (error) {
    const durationMs = timer.elapsedMs();
    logDatabaseOperation('upsert', 'webhook_events', durationMs, false);
    console.error('Unexpected error persisting event:', error);
    return false;
  }
}

/**
 * Mark an event as processed in the database
 */
export async function markEventProcessed(
  eventId: string,
  errorMessage?: string
): Promise<boolean> {
  const timer = new Timer();
  const client = getSupabaseClient();

  try {
    const { error } = await client
      .from('webhook_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error_message: errorMessage || null
      })
      .eq('id', eventId);

    if (error) {
      console.error('Error marking event as processed:', error);
      return false;
    }

    const durationMs = timer.elapsedMs();
    logDatabaseOperation('update', 'webhook_events', durationMs, true);
    return true;
  } catch (error) {
    const durationMs = timer.elapsedMs();
    logDatabaseOperation('update', 'webhook_events', durationMs, false);
    console.error('Unexpected error marking event as processed:', error);
    return false;
  }
}

/**
 * Update message status in the database
 */
export async function updateMessageStatus(statusEvent: StatusEvent): Promise<boolean> {
  const timer = new Timer();
  const client = getSupabaseClient();

  try {
    const { error } = await client
      .from('message_statuses')
      .upsert({
        message_id: statusEvent.messageId,
        current_status: statusEvent.status,
        recipient_id: statusEvent.recipientId,
        conversation_id: statusEvent.conversationId || null,
        pricing_category: statusEvent.pricingCategory || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'message_id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('Error updating message status:', error);
      return false;
    }

    const durationMs = timer.elapsedMs();
    logDatabaseOperation('upsert', 'message_statuses', durationMs, true);
    return true;
  } catch (error) {
    const durationMs = timer.elapsedMs();
    logDatabaseOperation('upsert', 'message_statuses', durationMs, false);
    console.error('Unexpected error updating message status:', error);
    return false;
  }
}

/**
 * Get the current status of a message
 */
export async function getMessageStatus(messageId: string): Promise<StatusEvent | null> {
  const timer = new Timer();
  const client = getSupabaseClient();

  try {
    const { data, error } = await client
      .from('message_statuses')
      .select('*')
      .eq('message_id', messageId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null;
      }
      console.error('Error getting message status:', error);
      return null;
    }

    const durationMs = timer.elapsedMs();
    logDatabaseOperation('select', 'message_statuses', durationMs, true);
    
    // Convert the database row to a StatusEvent
    return {
      id: `status_${messageId}`,
      type: 'status',
      subtype: 'query_result',
      source: 'database',
      sourcePhone: '',
      phoneNumberId: '',
      timestamp: Date.now(),
      rawPayload: data,
      metadata: {},
      status: data.current_status,
      messageId: data.message_id,
      recipientId: data.recipient_id,
      conversationId: data.conversation_id,
      pricingCategory: data.pricing_category
    };
  } catch (error) {
    const durationMs = timer.elapsedMs();
    logDatabaseOperation('select', 'message_statuses', durationMs, false);
    console.error('Unexpected error getting message status:', error);
    return null;
  }
}

/**
 * Get unprocessed events for monitoring/recovery
 */
export async function getUnprocessedEvents(limit: number = 100): Promise<WebhookEvent[]> {
  const timer = new Timer();
  const client = getSupabaseClient();

  try {
    const { data, error } = await client
      .from('webhook_events')
      .select('*')
      .is('processed', false)
      .limit(limit)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error getting unprocessed events:', error);
      return [];
    }

    const durationMs = timer.elapsedMs();
    logDatabaseOperation('select', 'webhook_events', durationMs, true);
    
    // Convert database rows to WebhookEvent objects
    return data.map(row => ({
      id: row.id,
      type: row.event_type,
      subtype: row.event_subtype,
      source: 'database_query',
      sourcePhone: row.source_phone,
      phoneNumberId: row.phone_number_id,
      timestamp: Math.floor(new Date(row.timestamp).getTime() / 1000),
      rawPayload: row.raw_payload,
      metadata: row.metadata || {}
    }));
  } catch (error) {
    const durationMs = timer.elapsedMs();
    logDatabaseOperation('select', 'webhook_events', durationMs, false);
    console.error('Unexpected error getting unprocessed events:', error);
    return [];
  }
}

/**
 * Count total events by type
 */
export async function countEventsByType(type: string): Promise<number> {
  const timer = new Timer();
  const client = getSupabaseClient();

  try {
    const { count, error } = await client
      .from('webhook_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', type);

    if (error) {
      console.error('Error counting events:', error);
      return 0;
    }

    const durationMs = timer.elapsedMs();
    logDatabaseOperation('count', 'webhook_events', durationMs, true);
    return count || 0;
  } catch (error) {
    const durationMs = timer.elapsedMs();
    logDatabaseOperation('count', 'webhook_events', durationMs, false);
    console.error('Unexpected error counting events:', error);
    return 0;
  }
}

/**
 * Close Supabase client connection
 */
export async function closeSupabase(): Promise<void> {
  if (supabaseClient) {
    // Supabase doesn't have a direct disconnect method
    // Connections are managed automatically
  }
}
