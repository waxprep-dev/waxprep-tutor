/**
 * Supabase Database Types
 * Generated based on the schema for type-safe database operations
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      message_statuses: {
        Row: {
          conversation_id: string | null
          created_at: string
          current_status: string
          pricing_category: string | null
          recipient_id: string
          updated_at: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          current_status: string
          pricing_category?: string | null
          recipient_id: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          current_status?: string
          pricing_category?: string | null
          recipient_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_subtype: string
          event_type: string
          id: string
          metadata: Json
          phone_number_id: string
          processed: boolean
          processed_at: string | null
          raw_payload: Json
          source_phone: string
          timestamp: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_subtype: string
          event_type: string
          id: string
          metadata?: Json
          phone_number_id: string
          processed?: boolean
          processed_at?: string | null
          raw_payload: Json
          source_phone: string
          timestamp: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_subtype?: string
          event_type?: string
          id?: string
          metadata?: Json
          phone_number_id?: string
          processed?: boolean
          processed_at?: string | null
          raw_payload?: Json
          source_phone?: string
          timestamp?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
