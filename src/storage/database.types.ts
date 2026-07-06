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
      episodic_memories: {
        Row: {
          id: string
          user_id: string
          tenant_id: string | null
          session_id: string
          content: string
          summary: string
          key_outcomes: string[]
          open_items: string[]
          user_goals: string[]
          ai_actions: string[]
          duration_ms: number | null
          turn_count: number | null
          satisfaction_score: number | null
          metadata: Json
          embedding: Json
          created_at: string
          updated_at: string
          last_accessed_at: string
        }
        Insert: {
          id: string
          user_id: string
          tenant_id?: string | null
          session_id: string
          content: string
          summary: string
          key_outcomes?: string[]
          open_items?: string[]
          user_goals?: string[]
          ai_actions?: string[]
          duration_ms?: number | null
          turn_count?: number | null
          satisfaction_score?: number | null
          metadata?: Json
          embedding: Json
          created_at?: string
          updated_at?: string
          last_accessed_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          tenant_id?: string | null
          session_id?: string
          content?: string
          summary?: string
          key_outcomes?: string[]
          open_items?: string[]
          user_goals?: string[]
          ai_actions?: string[]
          duration_ms?: number | null
          turn_count?: number | null
          satisfaction_score?: number | null
          metadata?: Json
          embedding?: Json
          created_at?: string
          updated_at?: string
          last_accessed_at?: string
        }
        Relationships: []
      }
      long_term_memories: {
        Row: {
          id: string
          user_id: string
          tenant_id: string | null
          category: string
          fact_type: string
          key: string
          value: string
          content: string
          context: string | null
          contradictions: string[]
          verification_status: string
          metadata: Json
          embedding: Json
          created_at: string
          updated_at: string
          last_accessed_at: string
        }
        Insert: {
          id: string
          user_id: string
          tenant_id?: string | null
          category: string
          fact_type: string
          key: string
          value: string
          content: string
          context?: string | null
          contradictions?: string[]
          verification_status?: string
          metadata?: Json
          embedding: Json
          created_at?: string
          updated_at?: string
          last_accessed_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          tenant_id?: string | null
          category?: string
          fact_type?: string
          key?: string
          value?: string
          content?: string
          context?: string | null
          contradictions?: string[]
          verification_status?: string
          metadata?: Json
          embedding?: Json
          created_at?: string
          updated_at?: string
          last_accessed_at?: string
        }
        Relationships: []
      }
      procedural_memories: {
        Row: {
          id: string
          user_id: string | null
          tenant_id: string | null
          rule_type: string
          condition: string
          action: string
          priority: number
          scope: string
          version: number
          effective_from: string
          effective_to: string | null
          metadata: Json
          audit_log: Json[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          user_id?: string | null
          tenant_id?: string | null
          rule_type: string
          condition: string
          action: string
          priority: number
          scope: string
          version: number
          effective_from: string
          effective_to?: string | null
          metadata?: Json
          audit_log?: Json[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          tenant_id?: string | null
          rule_type?: string
          condition?: string
          action?: string
          priority?: number
          scope?: string
          version?: number
          effective_from?: string
          effective_to?: string | null
          metadata?: Json
          audit_log?: Json[]
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_episodic_memories: {
        Args: {
          query_embedding: Json
          match_threshold: number
          match_count: number
          filter_user_id?: string
        }
        Returns: {
          id: string
          user_id: string
          content: string
          metadata: Json
          similarity: number
        }
      }
      match_long_term_memories: {
        Args: {
          query_embedding: Json
          match_threshold: number
          match_count: number
          filter_user_id?: string
          filter_categories?: string[]
        }
        Returns: {
          id: string
          user_id: string
          category: string
          key: string
          value: string
          content: string
          metadata: Json
          similarity: number
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
