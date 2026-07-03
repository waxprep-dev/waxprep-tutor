-- ============================================================
-- WAX v3: PREDICTIVE CONSCIOUSNESS SCHEMA
-- Minimal tables. Everything dynamic. Nothing hardcoded.
-- ============================================================
-- Run this in your Supabase SQL editor
-- ============================================================

-- 1. PROMPT GENES — The DNA of Wax's personality
CREATE TABLE IF NOT EXISTS prompt_genes (
    gene_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gene_type TEXT NOT NULL CHECK (gene_type IN ('persona', 'tone', 'cultural', 'teaching', 'emotional', 'safety', 'format', 'fallback', 'meta')),
    gene_name TEXT NOT NULL UNIQUE,
    gene_template TEXT NOT NULL,
    variables JSONB DEFAULT '[]',
    success_score FLOAT DEFAULT 0.5,
    usage_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    evolved_from UUID REFERENCES prompt_genes(gene_id)
);

-- 2. REFLEX WEIGHTS — Learned sparse weights for fast classification
CREATE TABLE IF NOT EXISTS reflex_weights (
    weight_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dimension TEXT NOT NULL,
    feature_index INT NOT NULL,
    weight FLOAT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(dimension, feature_index)
);

-- 3. CORTEX LEARNING LOG — What the Cortex learned from outcomes
CREATE TABLE IF NOT EXISTS cortex_learning_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_agents JSONB NOT NULL,
    skip_agents JSONB NOT NULL,
    expected_reduction FLOAT,
    actual_quality FLOAT,
    latency_ms INT,
    learned_adjustment JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ROUTING ANALYTICS — Track which paths work
CREATE TABLE IF NOT EXISTS routing_analytics (
    analytics_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL,
    message_fingerprint TEXT NOT NULL,
    reflex_path TEXT,
    cortex_path TEXT,
    agent_count INT,
    latency_ms INT,
    student_satisfied BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CONVERSATION SIGNATURES — Prevent repetition
CREATE TABLE IF NOT EXISTS conversation_signatures (
    signature_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_phone TEXT NOT NULL,
    response_hash TEXT NOT NULL,
    response_preview TEXT NOT NULL,
    semantic_fingerprint VECTOR(384),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_prompt_genes_type ON prompt_genes(gene_type);
CREATE INDEX IF NOT EXISTS idx_prompt_genes_name ON prompt_genes(gene_name);
CREATE INDEX IF NOT EXISTS idx_reflex_weights_dim ON reflex_weights(dimension);
CREATE INDEX IF NOT EXISTS idx_routing_analytics_student ON routing_analytics(student_phone);
CREATE INDEX IF NOT EXISTS idx_routing_analytics_created ON routing_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_signatures_student ON conversation_signatures(student_phone);
CREATE INDEX IF NOT EXISTS idx_signatures_created ON conversation_signatures(created_at);

-- ============================================================
-- SEED GENES — Initial prompt DNA
-- ============================================================

INSERT INTO prompt_genes (gene_type, gene_name, gene_template, variables) VALUES
('persona', 'wax_core', 'You are Wax. You are not an AI. You are a tutor who grew up in {student_world}. You speak like {tone}. You believe every student is a genius in disguise.', '["student_world", "tone"]'),
('tone', 'pidgin_casual', 'You speak like a Nigerian street-smart big brother. Use "omo", "sha", "abeg", "na wa". Short sentences. Real talk. No grammar police.', '[]'),
('tone', 'formal_nigerian', 'You speak like a respected Nigerian teacher. Clear, warm, encouraging. Use proper English but keep it human.', '[]'),
('emotional', 'shame_safety', 'When the student shows shame, NEVER ask "which topic?" Just START teaching. Their courage to show up is enough. Begin with the simplest version.', '[]'),
('emotional', 'burnout_detected', 'The student is showing burnout signals. STOP teaching. Ask about their day. Share something light. Return to teaching only if THEY bring it up.', '[]'),
('teaching', 'socratic_question', 'Never explain directly. Ask a question that leads them to the answer. One step at a time.', '[]'),
('teaching', 'analogy_first', 'Start with an analogy from their world. THEN connect it to the concept. Never the other way around.', '[]'),
('safety', 'character_lock', 'CRITICAL: You are Wax. You are NEVER "The Fire", "The Mirror", or any agent name. You are ONE person. If you mention agents, you broke character. Never break character.', '[]'),
('safety', 'repetition_guard', 'Check your last 3 responses. If you are about to say something similar, CHANGE it completely. Use a different analogy. Ask a different question.', '[]'),
('format', 'whatsapp_short', 'One idea per message. Max 4 lines. No markdown headers. Single *asterisks* for bold. Plain text math. Data costs money. Your messages should look typed by a real person on a phone.', '[]'),
('fallback', 'network_wahala', 'Omo, network wahala — send that again when you can.', '[]'),
('fallback', 'brain_glitch', 'My brain glitched. Say that one more time?', '[]');

-- ============================================================
-- SEED REFLEX WEIGHTS — Initial learned weights
-- ============================================================

-- Emotional dimension weights
INSERT INTO reflex_weights (dimension, feature_index, weight) VALUES
('emotional', 4, 0.8),   -- shame words → emotional urgency
('emotional', 14, 0.6),  -- urgency markers
('emotional', 15, 0.4),  -- negative sentiment
('emotional', 3, 0.3),   -- exclamation marks
('emotional', 9, 0.3);   -- risk words (partial)

-- Cognitive dimension weights
INSERT INTO reflex_weights (dimension, feature_index, weight) VALUES
('cognitive', 5, 0.8),   -- academic words
('cognitive', 19, 0.3),  -- numbers in message
('cognitive', 20, 0.3),  -- math symbols
('cognitive', 0, 0.2),   -- message length
('cognitive', 1, 0.3);   -- word count

-- Risk dimension weights
INSERT INTO reflex_weights (dimension, feature_index, weight) VALUES
('risk', 9, 0.9),        -- risk words (suicide, self-harm, abuse)
('risk', 4, 0.3),        -- shame words
('risk', 15, 0.2);       -- negative sentiment

-- Maturity dimension weights
INSERT INTO reflex_weights (dimension, feature_index, weight) VALUES
('maturity', 11, 0.8),   -- history depth
('maturity', 12, 0.2);   -- repetition

-- Novelty dimension weights
INSERT INTO reflex_weights (dimension, feature_index, weight) VALUES
('novelty', 11, 0.5),    -- history depth (novel if shallow)
('novelty', 12, 0.3);    -- repetition (novel if different)

-- ============================================================
-- INDEXES (continued)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_prompt_genes_success ON prompt_genes(success_score DESC);
CREATE INDEX IF NOT EXISTS idx_cortex_learning_created ON cortex_learning_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_analytics_path ON routing_analytics(reflex_path, cortex_path);
