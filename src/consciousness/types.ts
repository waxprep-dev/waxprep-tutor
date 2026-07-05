// ============================================================
// CONSCIOUSNESS TYPES
// ============================================================

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
    past_conversations: any[];
    concepts_known: string[];
    concepts_struggling: string[];
    misconceptions: any[];
    procedural_rules: any[];
    relational_notes: any[];
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
    tools_to_call: Array<{ tool: string; reason: string }>;
    data_to_save: Array<{ what: string; where: string; why: string }>;
  };
  // ADDED: Scaffold property for metacognitive scaffolding
  scaffold?: {
    mode: string;
    prompts: string[];
    expectedOutcome: string;
  };
}

export interface GuardianDecision {
  decision: "approve" | "modify" | "compress" | "block" | "escalate";
  reason: string;
  modified_response: string | null;
  quality_checks: any;
  safety_checks: any;
  escalation: {
    needed: boolean;
    reason: string;
    human_alert: string;
  };
}

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
// VOID RESULT
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
