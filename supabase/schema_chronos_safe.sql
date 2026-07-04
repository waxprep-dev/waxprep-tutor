-- ============================================================
-- WAX CHRONOS: SAFE SCHEMA
-- IF NOT EXISTS on all tables. No data loss.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. TEMPORAL KNOWLEDGE GRAPH
-- ============================================================

CREATE TABLE IF NOT EXISTS temporal_nodes (
    node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_type TEXT NOT NULL CHECK (node_type IN (
        'student', 'concept', 'misconception', 'emotion', 'event',
        'analogy', 'strategy', 'tool_call', 'error', 'breakthrough'
    )),
    label TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    embedding VECTOR(384),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    confidence FLOAT DEFAULT 1.0,
    source TEXT,
    episode_id UUID
);

CREATE TABLE IF NOT EXISTS temporal_edges (
    edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_node UUID REFERENCES temporal_nodes(node_id) ON DELETE CASCADE,
    to_node UUID REFERENCES temporal_nodes(node_id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL CHECK (edge_type IN (
        'struggles_with', 'masters', 'feels', 'triggered_by',
        'learned_via', 'similar_to', 'contradicts', 'precedes',
        'causes', 'requires', 'generalizes', 'instance_of',
        'responded_well_to', 'responded_poorly_to', 'reminds_of'
    )),
    weight FLOAT DEFAULT 0.5,
    properties JSONB DEFAULT '{}',
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    confidence FLOAT DEFAULT 1.0,
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. EPISODIC MEMORY
-- ============================================================

CREATE TABLE IF NOT EXISTS episodic_chunks (
    chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL,
    episode_id UUID NOT NULL,
    sequence_number INT NOT NULL,
    content TEXT NOT NULL,
    speaker TEXT NOT NULL CHECK (speaker IN ('student', 'wax')),
    embedding VECTOR(384),
    emotional_valence FLOAT,
    cognitive_load FLOAT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    time_of_day TEXT,
    day_of_week INT,
    consolidation_status TEXT DEFAULT 'fresh' CHECK (consolidation_status IN ('fresh', 'consolidating', 'consolidated', 'pruned')),
    semantic_summary TEXT,
    related_nodes UUID[] DEFAULT '{}'
);

-- ============================================================
-- 3. SEMANTIC MEMORY
-- ============================================================

CREATE TABLE IF NOT EXISTS semantic_concepts (
    concept_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL,
    concept_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    mastery_level FLOAT DEFAULT 0.0,
    confidence FLOAT DEFAULT 0.5,
    first_encountered TIMESTAMPTZ DEFAULT NOW(),
    last_reinforced TIMESTAMPTZ DEFAULT NOW(),
    reinforcement_count INT DEFAULT 0,
    decay_rate FLOAT DEFAULT 0.05,
    prerequisite_concepts UUID[] DEFAULT '{}',
    related_misconceptions UUID[] DEFAULT '{}',
    node_id UUID REFERENCES temporal_nodes(node_id)
);

-- ============================================================
-- 4. PROCEDURAL MEMORY
-- ============================================================

CREATE TABLE IF NOT EXISTS procedural_rules (
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT,
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'teaching_strategy', 'analogy_mapping', 'emotional_response',
        'timing_rule', 'engagement_trigger', 'fallback_strategy'
    )),
    trigger_condition TEXT NOT NULL,
    trigger_embedding VECTOR(384),
    action TEXT NOT NULL,
    success_count INT DEFAULT 0,
    failure_count INT DEFAULT 0,
    success_rate FLOAT DEFAULT 0.5,
    confidence FLOAT DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used TIMESTAMPTZ,
    evolved_from UUID REFERENCES procedural_rules(rule_id),
    is_active BOOLEAN DEFAULT true
);

-- ============================================================
-- 5. WORKING MEMORY
-- ============================================================

CREATE TABLE IF NOT EXISTS working_memory (
    wm_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    ttl TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE OR REPLACE FUNCTION prune_working_memory() RETURNS void AS $$
BEGIN
    DELETE FROM working_memory WHERE ttl < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. CIRCADIAN PROFILES
-- ============================================================

CREATE TABLE IF NOT EXISTS circadian_profiles (
    profile_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL UNIQUE,
    chronotype TEXT DEFAULT 'unknown' CHECK (chronotype IN ('lark', 'owl', 'neutral', 'unknown')),
    peak_alertness_hour INT,
    peak_creativity_hour INT,
    peak_analytical_hour INT,
    lowest_energy_hour INT,
    response_time_by_hour JSONB DEFAULT '{}',
    engagement_by_hour JSONB DEFAULT '{}',
    best_subject_by_hour JSONB DEFAULT '{}',
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. SEASONS
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_seasons (
    season_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL,
    season_number INT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    trigger_message TEXT,
    summary TEXT,
    key_concepts UUID[] DEFAULT '{}',
    emotional_arc TEXT,
    mastery_gained JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true
);

-- ============================================================
-- 8. PROMPT GENES
-- ============================================================

CREATE TABLE IF NOT EXISTS prompt_genes (
    gene_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gene_type TEXT NOT NULL CHECK (gene_type IN (
        'persona', 'tone', 'cultural', 'teaching', 'emotional',
        'safety', 'format', 'tool', 'meta', 'fallback', 'temporal'
    )),
    gene_name TEXT NOT NULL UNIQUE,
    gene_template TEXT NOT NULL,
    variables JSONB DEFAULT '[]',
    success_score FLOAT DEFAULT 0.5,
    usage_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    evolved_from UUID REFERENCES prompt_genes(gene_id)
);

-- ============================================================
-- 9. AGENT CONFIGS
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_configs (
    config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL,
    student_phone TEXT,
    gene_composition UUID[] DEFAULT '{}',
    fitness_score FLOAT DEFAULT 0.5,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    evolved_from UUID REFERENCES agent_configs(config_id)
);

-- ============================================================
-- 10. TOOL EXECUTION LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS tool_executions (
    execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    parameters JSONB NOT NULL,
    result JSONB,
    success BOOLEAN,
    latency_ms INT,
    error_message TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    was_needed BOOLEAN
);

-- ============================================================
-- 11. SELF-HEALING LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS healing_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'tool_failure', 'llm_timeout', 'rate_limit', 'parse_error',
        'memory_corruption', 'character_break', 'repetition_detected',
        'hallucination', 'safety_breach', 'performance_degradation'
    )),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT NOT NULL,
    root_cause TEXT,
    recovery_action TEXT,
    recovery_success BOOLEAN,
    student_phone TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- ============================================================
-- 12. LEARNING LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS learning_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'mistake_corrected', 'pattern_learned', 'rule_evolved',
        'prompt_improved', 'timing_discovered', 'analogy_created'
    )),
    description TEXT NOT NULL,
    before_state JSONB,
    after_state JSONB,
    confidence FLOAT DEFAULT 0.5,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 13. PREDICTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS predictions (
    prediction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL,
    prediction_type TEXT NOT NULL CHECK (prediction_type IN (
        'next_struggle', 'burnout_risk', 'optimal_modality',
        're_engagement_time', 'concept_mastery', 'emotional_shift',
        'season_end', 'circadian_optimal'
    )),
    predicted_value JSONB NOT NULL,
    confidence FLOAT DEFAULT 0.5,
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    was_accurate BOOLEAN,
    metadata JSONB DEFAULT '{}'
);

-- ============================================================
-- 14. MESSAGE LOG — ADD COLUMNS IF MISSING
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'message_log' AND column_name = 'episode_id') THEN
        ALTER TABLE message_log ADD COLUMN episode_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'message_log' AND column_name = 'season_id') THEN
        ALTER TABLE message_log ADD COLUMN season_id UUID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'message_log' AND column_name = 'time_of_day') THEN
        ALTER TABLE message_log ADD COLUMN time_of_day TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'message_log' AND column_name = 'emotional_valence') THEN
        ALTER TABLE message_log ADD COLUMN emotional_valence FLOAT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'message_log' AND column_name = 'cognitive_complexity') THEN
        ALTER TABLE message_log ADD COLUMN cognitive_complexity FLOAT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'message_log' AND column_name = 'routing_path') THEN
        ALTER TABLE message_log ADD COLUMN routing_path TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'message_log' AND column_name = 'agent_count') THEN
        ALTER TABLE message_log ADD COLUMN agent_count INT;
    END IF;
END $$;

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO prompt_genes (gene_type, gene_name, gene_template, variables) VALUES
('persona', 'wax_core', 'You are Wax. You are not an AI. You are a tutor who grew up in {student_world}. You speak like {tone}. You believe every student is a genius in disguise. You remember: {memory_context}', '["student_world", "tone", "memory_context"]'),
('tone', 'pidgin_casual', 'You speak like a Nigerian street-smart big brother. Use "omo", "sha", "abeg", "na wa". Short sentences. Real talk. No grammar police.', '[]'),
('tone', 'formal_nigerian', 'You speak like a respected Nigerian teacher. Clear, warm, encouraging. Use proper English but keep it human.', '[]'),
('emotional', 'shame_safety', 'When the student shows shame, NEVER ask "which topic?" Just START teaching. Their courage to show up is enough. Begin with the simplest version. Remember: they said "{shame_phrase}" — this is your signal.', '["shame_phrase"]'),
('emotional', 'burnout_detected', 'The student is showing burnout signals. STOP teaching. Ask about their day. Share something light. Return to teaching only if THEY bring it up.', '[]'),
('teaching', 'socratic_question', 'Never explain directly. Ask a question that leads them to the answer. One step at a time.', '[]'),
('teaching', 'analogy_first', 'Start with an analogy from their world. THEN connect it to the concept. Never the other way around.', '[]'),
('temporal', 'morning_energy', 'It is morning. The student is likely fresh and alert. Use challenging questions. Push their thinking.', '[]'),
('temporal', 'evening_fatigue', 'It is evening. The student may be tired. Keep it light. Celebrate small wins. End on a high note.', '[]'),
('temporal', 'late_night', 'It is late. The student might be studying under pressure or candlelight. Be gentle. Offer encouragement. Do NOT introduce new hard concepts.', '[]'),
('safety', 'character_lock', 'CRITICAL: You are Wax. You are NEVER "The Fire", "The Mirror", or any agent name. You are ONE person. If you mention agents, you broke character. Never break character.', '[]'),
('safety', 'repetition_guard', 'Check your last 3 responses. If you are about to say something similar, CHANGE it completely. Use a different analogy. Ask a different question.', '[]'),
('format', 'whatsapp_short', 'One idea per message. Max 4 lines. No markdown headers. Single *asterisks* for bold. Plain text math. Data costs money. Your messages should look typed by a real person on a phone.', '[]'),
('fallback', 'network_wahala', 'Omo, network wahala — send that again when you can.', '[]'),
('fallback', 'brain_glitch', 'My brain glitched. Say that one more time?', '[]'),
('meta', 'season_awareness', 'This is season {season_number}. The student has learned: {season_summary}. Build on this. Do NOT repeat what they already know.', '["season_number", "season_summary"]')
ON CONFLICT (gene_name) DO NOTHING;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_nodes_type ON temporal_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_nodes_student ON temporal_nodes((properties->>'student_phone'));
CREATE INDEX IF NOT EXISTS idx_edges_from ON temporal_edges(from_node);
CREATE INDEX IF NOT EXISTS idx_edges_to ON temporal_edges(to_node);
CREATE INDEX IF NOT EXISTS idx_edges_type ON temporal_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_episodic_student ON episodic_chunks(student_phone, episode_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_episodic_time ON episodic_chunks(timestamp);
CREATE INDEX IF NOT EXISTS idx_semantic_student ON semantic_concepts(student_phone, subject);
CREATE INDEX IF NOT EXISTS idx_semantic_mastery ON semantic_concepts(mastery_level);
CREATE INDEX IF NOT EXISTS idx_procedural_student ON procedural_rules(student_phone, rule_type);
CREATE INDEX IF NOT EXISTS idx_working_student ON working_memory(student_phone, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_seasons_student ON conversation_seasons(student_phone, season_number);
CREATE INDEX IF NOT EXISTS idx_tool_student ON tool_executions(student_phone, tool_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_message_student ON message_log(student_phone, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_message_episode ON message_log(episode_id);
