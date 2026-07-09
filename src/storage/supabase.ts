/**
 * Supabase storage implementation for messages and webhook events
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';
import type { WebhookEvent } from '../types/webhook.js';
import type { Database } from './database.types.js';

type MessageStatusRow = Database['public']['Tables']['message_statuses']['Row'];

let supabase: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be configured');
  }

  supabase = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return supabase;
}

export type MessageDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export async function updateMessageStatus(
  conversationId: string,
  status: MessageDeliveryStatus,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const client = getSupabase();

  const updateData: any = {
    conversation_id: conversationId,
    current_status: status,
    recipient_id: conversationId,
    ...(metadata ? { pricing_category: metadata.pricingCategory as string | undefined } : {}),
  };

  const { error } = await client
    .from('message_statuses')
    .upsert(updateData, { onConflict: 'conversation_id' });

  if (error) {
    logger.error({ err: error, conversationId, status }, 'Error updating message status');
    throw error;
  }
}

export async function getMessageStatus(conversationId: string): Promise<MessageStatusRow | null> {
  const client = getSupabase();

  const { data, error } = await client
    .from('message_statuses')
    .select('*')
    .eq('conversation_id', conversationId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error({ err: error, conversationId }, 'Error getting message status');
    throw error;
  }

  return data;
}

export async function storeWebhookEvents(events: WebhookEvent[]): Promise<void> {
  const client = getSupabase();

  if (events.length === 0) return;

  const rows = events.map(event => ({
    id: event.id,
    event_type: event.type,
    event_subtype: event.subtype,
    source_phone: event.sourcePhone,
    phone_number_id: event.phoneNumberId,
    timestamp: new Date(event.timestamp * 1000).toISOString(),
    raw_payload: event.rawPayload as Database['public']['Tables']['webhook_events']['Insert']['raw_payload'],
    metadata: (event.metadata ?? {}) as Database['public']['Tables']['webhook_events']['Insert']['metadata'],
  }));

  const { error } = await client
    .from('webhook_events')
    .insert(rows);

  if (error) {
    logger.error({ err: error, count: events.length }, 'Error storing webhook events');
    throw error;
  }
}

export async function getRecentEvents(hours: number = 24): Promise<WebhookEvent[]> {
  const client = getSupabase();
  const since = new Date(Date.now() - hours * 3600000).toISOString();

  const { data, error } = await client
    .from('webhook_events')
    .select('*')
    .gte('timestamp', since)
    .order('timestamp', { ascending: false })
    .limit(1000);

  if (error) {
    logger.error({ err: error }, 'Error getting recent events');
    throw error;
  }

  return (data ?? []).map(row => ({
    id: row.id,
    type: row.event_type,
    subtype: row.event_subtype,
    source: 'whatsapp',
    sourcePhone: row.source_phone,
    phoneNumberId: row.phone_number_id,
    timestamp: new Date(row.timestamp).getTime() / 1000,
    rawPayload: row.raw_payload as Record<string, unknown>,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  }));
}
