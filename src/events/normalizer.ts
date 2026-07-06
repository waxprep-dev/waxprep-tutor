/**
 * Event Normalizer
 * Converts raw Meta/WhatsApp webhook payloads into standardized internal events
 */

import { WebhookPayload, WebhookEvent, MessageEvent, StatusEvent } from '../types/webhook.js';
import { config } from '../config/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Validates the basic structure of an incoming webhook payload
 */
export function validatePayloadStructure(payload: any): boolean {
  if (!payload || typeof payload !== 'object') {
    console.error('Invalid payload: not an object');
    return false;
  }

  if (!payload.object) {
    console.error('Invalid payload: missing object field');
    return false;
  }

  if (!Array.isArray(payload.entry)) {
    console.error('Invalid payload: entry is not an array');
    return false;
  }

  return true;
}

/**
 * Normalizes a raw webhook payload into internal event objects
 */
export function normalizePayload(payload: WebhookPayload): WebhookEvent[] {
  const events: WebhookEvent[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') {
        continue; // Currently only handle messages field
      }

      const value = change.value;

      // Handle messages
      if (value.messages) {
        for (const message of value.messages) {
          const normalizedEvent = normalizeMessage(message, value, entry.id);
          if (normalizedEvent) {
            events.push(normalizedEvent);
          }
        }
      }

      // Handle statuses
      if (value.statuses) {
        for (const status of value.statuses) {
          const normalizedEvent = normalizeStatus(status, value, entry.id);
          if (normalizedEvent) {
            events.push(normalizedEvent);
          }
        }
      }
    }
  }

  return events;
}

/**
 * Normalizes a message object into a standardized MessageEvent
 */
function normalizeMessage(
  message: any,
  value: any,
  entryId: string
): MessageEvent | null {
  try {
    // Determine message type
    let messageType = message.type;
    let textContent: string | undefined;
    let mediaUrl: string | undefined;

    switch (message.type) {
      case 'text':
        textContent = message.text?.body;
        break;
      case 'image':
        mediaUrl = message.image?.id; // Will be resolved later
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
        // Handle buttons, lists, etc.
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

    // Create a unique internal ID for this event
    const eventId = `msg_${message.id}_${Date.now()}`;

    const normalizedEvent: MessageEvent = {
      id: eventId,
      type: 'message',
      subtype: message.type,
      source: 'whatsapp',
      sourcePhone: value.metadata?.display_phone_number || '',
      phoneNumberId: value.metadata?.phone_number_id || config.meta.phoneNumberId,
      timestamp: parseInt(message.timestamp, 10),
      rawPayload: message,
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
      pricingCategory: undefined, // Will be determined later
      waId: message.from,
      displayName: value.contacts?.[0]?.profile?.name || message.from,
    };

    return normalizedEvent;
  } catch (error) {
    console.error('Error normalizing message:', error, message);
    return null;
  }
}

/**
 * Normalizes a status object into a standardized StatusEvent
 */
function normalizeStatus(
  status: any,
  value: any,
  entryId: string
): StatusEvent | null {
  try {
    // Validate status value
    const validStatuses = ['sent', 'delivered', 'read', 'failed'];
    if (!validStatuses.includes(status.status)) {
      console.warn(`Invalid status value: ${status.status}`);
      return null;
    }

    // Create a unique internal ID for this event
    const eventId = `status_${status.id}_${Date.now()}`;

    const normalizedEvent: StatusEvent = {
      id: eventId,
      type: 'status',
      subtype: status.status,
      source: 'whatsapp',
      sourcePhone: value.metadata?.display_phone_number || '',
      phoneNumberId: value.metadata?.phone_number_id || config.meta.phoneNumberId,
      timestamp: parseInt(status.timestamp, 10),
      rawPayload: status,
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

/**
 * Extracts contact information from webhook payload
 */
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

/**
 * Determines pricing category based on message context
 */
export function determinePricingCategory(
  timestamp: number,
  conversation: any,
  isBusinessInitiated: boolean
): string {
  // If we have conversation data, determine pricing based on that
  if (conversation) {
    // If it's within 24hr window of a customer-initiated conversation
    if (conversation.origin?.type === 'customer_initiated') {
      return 'AUTHENTICATION';
    } else if (conversation.origin?.type === 'business_initiated') {
      return 'MARKETING';
    } else {
      // Context exists but type is unknown, assume utility
      return 'UTILITY';
    }
  }

  // If no conversation context, determine based on time
  // If it's within 24 hours of a customer message, it's utility
  // Otherwise, it might be marketing (though this is harder to determine without context)
  const now = Date.now() / 1000;
  const timeDiffHours = (now - timestamp) / 3600;

  if (timeDiffHours <= 24) {
    return 'UTILITY';
  }

  // Default fallback
  return isBusinessInitiated ? 'MARKETING' : 'UTILITY';
}

/**
 * Creates a synthetic message event for testing
 */
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

/**
 * Creates a synthetic status event for testing
 */
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
