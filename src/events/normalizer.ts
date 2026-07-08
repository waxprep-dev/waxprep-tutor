/**
 * Event Normalizer
 * Converts raw Meta/WhatsApp webhook payloads into standardized internal events
 */

import { WebhookPayload, WebhookEvent, MessageEvent, StatusEvent } from '../types/webhook.js';
import { config } from '../config/index.js';
import { v4 as uuidv4 } from 'uuid';

export function validatePayloadStructure(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    console.error('Invalid payload: not an object');
    return false;
  }

  const obj = payload as Record<string, unknown>;
  if (!obj.object) {
    console.error('Invalid payload: missing object field');
    return false;
  }

  if (!Array.isArray(obj.entry)) {
    console.error('Invalid payload: entry is not an array');
    return false;
  }

  return true;
}

export function normalizePayload(payload: WebhookPayload): WebhookEvent[] {
  const events: WebhookEvent[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') {
        continue;
      }

      const value = change.value;

      if (value.messages) {
        for (const message of value.messages) {
          const normalizedEvent = normalizeMessage(message as any, value as any, entry.id);
          if (normalizedEvent) {
            events.push(normalizedEvent);
          }
        }
      }

      if (value.statuses) {
        for (const status of value.statuses) {
          const normalizedEvent = normalizeStatus(status as any, value as any, entry.id);
          if (normalizedEvent) {
            events.push(normalizedEvent);
          }
        }
      }
    }
  }

  return events;
}

function normalizeMessage(message: any, value: any, entryId: string): MessageEvent | null {
  try {
    let textContent: string | undefined;
    let mediaUrl: string | undefined;

    switch (message.type) {
      case 'text':
        textContent = message.text?.body;
        break;
      case 'image':
        mediaUrl = message.image?.id;
        textContent = message.image?.caption;
        break;
      case 'video':
        mediaUrl = message.video?.id;
        textContent = message.video?.caption;
        break;
      case 'document':
        mediaUrl = message.document?.id;
        textContent = message.document?.filename;
        break;
      case 'audio':
        mediaUrl = message.audio?.id;
        break;
      case 'location':
        textContent = `Location: ${message.location?.name || 'Unknown'}, ${message.location?.address || 'Unknown'}`;
        break;
      case 'contacts':
        textContent = 'Contact card shared';
        break;
      case 'interactive':
        textContent = message.interactive?.button_reply?.title ||
                     message.interactive?.list_reply?.title ||
                     'Interactive message';
        break;
      case 'button':
        textContent = message.button?.text;
        break;
      default:
        console.warn(`Unknown message type: ${message.type}`);
        textContent = JSON.stringify(message);
    }

    const eventId = `msg_${message.id}_${Date.now()}`;

    const normalizedEvent: MessageEvent = {
      id: eventId,
      type: 'message',
      subtype: message.type,
      source: 'whatsapp',
      sourcePhone: value.metadata?.display_phone_number || '',
      phoneNumberId: value.metadata?.phone_number_id || config.meta.phoneNumberId,
      timestamp: parseInt(message.timestamp, 10),
      rawPayload: message as Record<string, unknown>,
      metadata: {
        contactName: value.contacts?.[0]?.profile?.name || '',
        waId: message.from,
        hasMedia: !!mediaUrl,
        originalMessageId: message.id,
        entryId,
        context: message.context || null,
      },
      from: message.from,
      to: value.metadata?.phone_number_id || config.meta.phoneNumberId,
      text: textContent,
      mediaUrl,
      messageType: message.type,
      conversationId: message.context?.message_id || undefined,
      pricingCategory: undefined,
      waId: message.from,
      displayName: value.contacts?.[0]?.profile?.name || message.from,
    };

    return normalizedEvent;
  } catch (error) {
    console.error('Error normalizing message:', error, message);
    return null;
  }
}

function normalizeStatus(status: any, value: any, entryId: string): StatusEvent | null {
  try {
    const validStatuses = ['sent', 'delivered', 'read', 'failed'];
    if (!validStatuses.includes(status.status)) {
      console.warn(`Invalid status value: ${status.status}`);
      return null;
    }

    const eventId = `status_${status.id}_${Date.now()}`;

    const normalizedEvent: StatusEvent = {
      id: eventId,
      type: 'status',
      subtype: status.status,
      source: 'whatsapp',
      sourcePhone: value.metadata?.display_phone_number || '',
      phoneNumberId: value.metadata?.phone_number_id || config.meta.phoneNumberId,
      timestamp: parseInt(status.timestamp, 10),
      rawPayload: status as Record<string, unknown>,
      metadata: {
        originalMessageId: status.id,
        entryId,
        recipientWaId: status.recipient_id,
      },
      status: status.status as 'sent' | 'delivered' | 'read' | 'failed',
      messageId: status.id,
      recipientId: status.recipient_id,
      conversationId: status.conversation?.id,
      pricingCategory: status.pricing?.category,
      error: status.errors?.[0] ? {
        code: status.errors[0].code,
        title: status.errors[0].title,
        message: status.errors[0].message,
        error_data: status.errors[0].error_data,
      } : undefined,
    };

    return normalizedEvent;
  } catch (error) {
    console.error('Error normalizing status:', error, status);
    return null;
  }
}

export function extractContactInfo(payload: WebhookPayload): Map<string, { name: string }> {
  const contacts = new Map<string, { name: string }>();

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.value.contacts) {
        for (const contact of change.value.contacts) {
          contacts.set(contact.wa_id, {
            name: contact.profile.name
          });
        }
      }
    }
  }

  return contacts;
}

export function determinePricingCategory(
  timestamp: number,
  conversation: Record<string, unknown> | null,
  isBusinessInitiated: boolean
): string {
  if (conversation) {
    const origin = conversation.origin as { type?: string } | undefined;
    if (origin?.type === 'customer_initiated') {
      return 'AUTHENTICATION';
    } else if (origin?.type === 'business_initiated') {
      return 'MARKETING';
    } else {
      return 'UTILITY';
    }
  }

  const now = Date.now() / 1000;
  const timeDiffHours = (now - timestamp) / 3600;

  if (timeDiffHours <= 24) {
    return 'UTILITY';
  }

  return isBusinessInitiated ? 'MARKETING' : 'UTILITY';
}

export function createTestMessageEvent(text: string, from: string = 'test_user'): MessageEvent {
  return {
    id: `test_msg_${uuidv4()}`,
    type: 'message',
    subtype: 'text',
    source: 'test',
    sourcePhone: config.meta.phoneNumberId,
    phoneNumberId: config.meta.phoneNumberId,
    timestamp: Math.floor(Date.now() / 1000),
    rawPayload: { text: { body: text }, from, type: 'text' },
    metadata: { test: true },
    from,
    to: config.meta.phoneNumberId,
    text,
    messageType: 'text',
    waId: from,
    displayName: `Test User ${from.slice(-4)}`,
  };
}

export function createTestStatusEvent(
  messageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  recipientId: string
): StatusEvent {
  return {
    id: `test_status_${uuidv4()}`,
    type: 'status',
    subtype: status,
    source: 'test',
    sourcePhone: config.meta.phoneNumberId,
    phoneNumberId: config.meta.phoneNumberId,
    timestamp: Math.floor(Date.now() / 1000),
    rawPayload: { id: messageId, status, recipient_id: recipientId },
    metadata: { test: true },
    status,
    messageId,
    recipientId,
  };
}
