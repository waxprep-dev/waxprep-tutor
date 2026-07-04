// FILE: src/consciousness/types.ts
// =====================================================

export interface Perception {
  intent: {
    primary: string;
    confidence: number;
    sub_intents: string[];
  };
  emotional_state: {
    primary_emotion: string;
    intensity: number;
    emotional_triggers: string[];
    vulnerability_detected: boolean;
    shame_detected: boolean;
    pride_detected: boolean;
  };
  cognitive_state: {
    understanding_level: string;
    confusion_detected: boolean;
    pretending_to_understand: boolean;
    engagement_level: string;
    attention_span_estimate: string;
  };
  social_context: {
    formality_level: string;
    relationship_stage: string;
    trust_level: string;
    power_dynamic: string;
  };
  dimensions_detected: {
    intellectual: boolean;
    emotional: boolean;
    social: boolean;
    economic: boolean;
    physical: boolean;
    spiritual: boolean;
    cultural: boolean;
  };
  urgency: {
    level: string;
    reason: string;
  };
  student_needs: {
    immediate: string;
    underlying: string;
    unstated: string;
  };
  cultural_signals: {
    language_used: string;
    references: string[];
    world_indicators: string[];
  };
  risk_flags: {
    suicidal_ideation: boolean;
    self_harm: boolean;
    abuse_indicators: boolean;
    extreme_distress: boolean;
    academic_crisis: boolean;
  };
}

export interface ContextBundle {
  student_profile: {
    name: string;
    origin: string;
    teaching_signature: string;
    current_mood: string;
    last_topic: string;
    last_mood: string;
  };
  relevant_memories: {
    past_conversations: string[];
    concepts_known: string[];
    concepts_struggling: string[];
    misconceptions: string[];
    procedural_rules: string[];
    relational_notes: string[];
  };
  contextual_examples: {
    recommended_analogy: string;
    alternative_analogies: string[];
    cultural_bridge: string;
    previous_successful_approach: string;
  };
  teaching_recommendations: {
    suggested_topic: string;
    suggested_depth: string;
    suggested_pace: string;
    suggested_tone: string;
    avoid: string[];
    emphasize: string[];
  };
  conversation_state: {
    current_flow_state: string;
    recommended_next_state: string;
    message_count_this_episode: number;
    time_since_last_message: string;
  };
  retrieval_actions: {
    tools_to_call: { tool: string; reason: string }[];
    data_to_save: { what: string; where: string; why: string }[];
  };
}

export interface Reflection {
  interaction_quality: {
    score: number;
    assessment: string;
    reason: string;
  };
  what_worked: string[];
  what_failed: string[];
  missed_opportunities: string[];
  emotional_missed: string[];
  cognitive_missed: string[];
  pattern_detected: {
    pattern_type: string;
    description: string;
    confidence: number;
    recommended_action: string;
  };
  teaching_effectiveness: {
    concept_understood: boolean;
    student_engaged: boolean;
    would_student_return: boolean;
    risk_of_churn: number;
  };
  system_improvements: string[];
}

export interface GuardianDecision {
  decision: "approve" | "modify" | "compress" | "block" | "escalate";
  reason: string;
  modified_response: string | null;
  quality_checks: Record<string, boolean>;
  safety_checks: Record<string, boolean>;
  escalation: {
    needed: boolean;
    reason: string;
    human_alert: string;
  };
}

export interface ArchivistOutput {
  memory_updates: any[];
  signature_evolution: any;
  new_patterns: any[];
  procedural_rules: any[];
  alerts: any[];
}

export interface AgentConfig {
  modelTier: "fast" | "capable" | "best";
  maxTokens: number;
  temperature: number;
  retryAttempts: number;
}

// =====================================================

// ============================================================
// BREATH BUDGET — Pacing Protocol
// ============================================================
export interface BreathBudget {
  targetChars: number;
  maxChars: number;
  strategy: "hook" | "bite" | "meal" | "feast";
  why: string;
}

// ============================================================
// UPDATED VOID RESULT
// ============================================================
export interface VoidResult {
  response: string;
  perception: Perception;
  contextBundle: ContextBundle;
  guardianDecision: GuardianDecision;
  toolsCalled: string[];
  latencyMs: number;
  breathBudget?: BreathBudget;
}
