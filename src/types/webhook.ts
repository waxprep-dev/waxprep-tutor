/**
 * Webhook Event Type Definitions
 * Strict TypeScript interfaces for all Meta/WhatsApp webhook payloads
 */

export interface WebhookEvent {
  id: string;
  type: string;
  subtype: string;
  source: string;
  sourcePhone: string;
  phoneNumberId: string;
  timestamp: number;
  rawPayload: any;
  metadata: Record<string, any>;
}

export interface MessageEvent extends WebhookEvent {
  type: 'message';
  from: string;
  to: string;
  text?: string;
  mediaUrl?: string;
  messageType?: string;
  conversationId?: string;
  pricingCategory?: string;
  waId?: string;
  displayName?: string;
}

export interface StatusEvent extends WebhookEvent {
  type: 'status';
  status: 'sent' | 'delivered' | 'read' | 'failed';
  messageId: string;
  recipientId: string;
  conversationId?: string;
  pricingCategory?: string;
  error?: {
    code: number;
    title: string;
    message: string;
    error_data?: any;
  };
}

export interface WebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          wa_id: string;
          profile: {
            name: string;
          };
        }>;
        messages?: Array<{
          id: string;
          from: string;
          timestamp: string;
          text?: {
            body: string;
          };
          image?: {
            id: string;
            mime_type: string;
            sha256: string;
            caption?: string;
          };
          video?: {
            id: string;
            mime_type: string;
            sha256: string;
            caption?: string;
          };
          document?: {
            id: string;
            filename: string;
            mime_type: string;
            sha256: string;
          };
          audio?: {
            id: string;
            mime_type: string;
            sha256: string;
          };
          location?: {
            latitude: string;
            longitude: string;
            name?: string;
            address?: string;
          };
          contacts?: Array<any>;
          interactive?: any;
          button?: any;
          type: string;
          context?: {
            message_id: string;
            forwarded?: boolean;
            frequently_forwarded?: boolean;
            from?: string;
          };
        }>;
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
          conversation?: {
            id: string;
            expiration_timestamp: string;
            origin: {
              type: string;
            };
          };
          pricing?: {
            category: string;
            pricing_model: string;
          };
          errors?: Array<{
            code: number;
            title: string;
            message: string;
            error_data?: any;
          }>;
        }>;
      };
    }>;
  }>;
}
