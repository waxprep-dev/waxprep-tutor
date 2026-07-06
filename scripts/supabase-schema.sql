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

-- Enable Row Level Security (configure policies as needed)
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_statuses ENABLE ROW LEVEL SECURITY;

-- Real-time notifications for new events (optional)
ALTER PUBLICATION supabase_realtime ADD TABLE webhook_events;
