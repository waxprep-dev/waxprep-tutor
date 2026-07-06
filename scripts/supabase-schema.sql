-- Webhook Events Table
-- Stores all incoming webhook events for audit, replay, and analytics

CREATE TABLE webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    event_subtype TEXT NOT NULL,
    source_phone TEXT NOT NULL,
    phone_number_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    raw_payload JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_webhook_events_type ON webhook_events(event_type, event_subtype);
CREATE INDEX idx_webhook_events_source ON webhook_events(source_phone);
CREATE INDEX idx_webhook_events_processed ON webhook_events(processed) WHERE processed = FALSE;
CREATE INDEX idx_webhook_events_created ON webhook_events(created_at DESC);
CREATE INDEX idx_webhook_events_timestamp ON webhook_events(timestamp DESC);

-- For fast duplicate checks
CREATE UNIQUE INDEX idx_webhook_events_id ON webhook_events(id);

-- Message Status Tracking (for out-of-order handling)
CREATE TABLE message_statuses (
    message_id TEXT PRIMARY KEY,
    current_status TEXT NOT NULL,
    status_history JSONB[] DEFAULT '{}',
    recipient_id TEXT NOT NULL,
    conversation_id TEXT,
    pricing_category TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for status lookups
CREATE INDEX idx_message_statuses_recipient ON message_statuses(recipient_id);

-- ============================================================================
-- MEMORY SYSTEM TABLES
-- ============================================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- EPISODIC MEMORIES (Session Summaries)
-- ---------------------------------------------------------------------------
CREATE TABLE episodic_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT NOT NULL,
    key_outcomes TEXT[] DEFAULT '{}',
    open_items TEXT[] DEFAULT '{}',
    user_goals TEXT[] DEFAULT '{}',
    ai_actions TEXT[] DEFAULT '{}',
    duration_ms INTEGER,
    turn_count INTEGER,
    satisfaction_score NUMERIC(3,2),
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),  -- Match your embedding model dimensions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_episodic_user ON episodic_memories(user_id);
CREATE INDEX idx_episodic_session ON episodic_memories(session_id);
CREATE INDEX idx_episodic_created ON episodic_memories(created_at DESC);

-- Vector similarity search function
CREATE OR REPLACE FUNCTION match_episodic_memories(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    filter_user_id text DEFAULT NULL
)
RETURNS TABLE(
    id text,
    user_id text,
    content text,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        episodic_memories.id,
        episodic_memories.user_id,
        episodic_memories.content,
        episodic_memories.metadata,
        1 - (episodic_memories.embedding <=> query_embedding) AS similarity
    FROM episodic_memories
    WHERE episodic_memories.embedding IS NOT NULL
        AND 1 - (episodic_memories.embedding <=> query_embedding) > match_threshold
        AND (filter_user_id IS NULL OR episodic_memories.user_id = filter_user_id)
    ORDER BY episodic_memories.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- LONG-TERM MEMORIES (Semantic Facts)
-- ---------------------------------------------------------------------------
CREATE TABLE long_term_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT,
    category TEXT NOT NULL CHECK (category IN (
        'preference', 'profile', 'knowledge', 'goal', 'behavior',
        'relationship', 'constraint', 'history', 'skill', 'context'
    )),
    fact_type TEXT NOT NULL CHECK (fact_type IN (
        'static', 'dynamic', 'probabilistic', 'temporal', 'conditional'
    )),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    content TEXT NOT NULL,
    context TEXT,
    contradictions TEXT[] DEFAULT '{}',
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN (
        'unverified', 'verified', 'disputed', 'deprecated'
    )),
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ,
    UNIQUE(user_id, key)
);

-- Indexes
CREATE INDEX idx_ltm_user ON long_term_memories(user_id);
CREATE INDEX idx_ltm_category ON long_term_memories(user_id, category);
CREATE INDEX idx_ltm_key ON long_term_memories(user_id, key);
CREATE INDEX idx_ltm_verification ON long_term_memories(verification_status);
CREATE INDEX idx_ltm_created ON long_term_memories(created_at DESC);

-- Vector similarity search function
CREATE OR REPLACE FUNCTION match_long_term_memories(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    filter_user_id text DEFAULT NULL,
    filter_categories text[] DEFAULT NULL
)
RETURNS TABLE(
    id text,
    user_id text,
    category text,
    key text,
    value text,
    content text,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        long_term_memories.id,
        long_term_memories.user_id,
        long_term_memories.category,
        long_term_memories.key,
        long_term_memories.value,
        long_term_memories.content,
        long_term_memories.metadata,
        1 - (long_term_memories.embedding <=> query_embedding) AS similarity
    FROM long_term_memories
    WHERE long_term_memories.embedding IS NOT NULL
        AND 1 - (long_term_memories.embedding <=> query_embedding) > match_threshold
        AND (filter_user_id IS NULL OR long_term_memories.user_id = filter_user_id)
        AND (filter_categories IS NULL OR long_term_memories.category = ANY(filter_categories))
        AND long_term_memories.verification_status != 'deprecated'
    ORDER BY long_term_memories.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- PROCEDURAL MEMORIES (Rules & Guardrails)
-- ---------------------------------------------------------------------------
CREATE TABLE procedural_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    tenant_id TEXT,
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'safety', 'business', 'tone', 'escalation', 'compliance', 'routing', 'format'
    )),
    condition TEXT NOT NULL,
    action TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
    scope TEXT NOT NULL CHECK (scope IN ('global', 'tenant', 'user', 'session')),
    version INTEGER NOT NULL DEFAULT 1,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    audit_log JSONB[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_procedural_scope ON procedural_memories(scope, priority DESC);
CREATE INDEX idx_procedural_type ON procedural_memories(rule_type);
CREATE INDEX idx_procedural_effective ON procedural_memories(effective_from, effective_to);

-- ---------------------------------------------------------------------------
-- MEMORY CLEANUP TRIGGER
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_episodic_updated_at BEFORE UPDATE ON episodic_memories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ltm_updated_at BEFORE UPDATE ON long_term_memories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_procedural_updated_at BEFORE UPDATE ON procedural_memories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (configure policies as needed)
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE long_term_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedural_memories ENABLE ROW LEVEL SECURITY;

-- Real-time notifications for new events (optional)
ALTER PUBLICATION supabase_realtime ADD TABLE webhook_events;
ALTER PUBLICATION supabase_realtime ADD TABLE episodic_memories;
ALTER PUBLICATION supabase_realtime ADD TABLE long_term_memories;
ALTER PUBLICATION supabase_realtime ADD TABLE procedural_memories;
