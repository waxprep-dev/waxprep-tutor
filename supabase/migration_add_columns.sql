-- Migration: Add missing columns to episodes table
-- Run this in your Supabase SQL editor

-- Add summary column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'episodes' AND column_name = 'summary') THEN
        ALTER TABLE episodes ADD COLUMN summary TEXT;
    END IF;
END $$;

-- Add summary_embedding column (vector type)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'episodes' AND column_name = 'summary_embedding') THEN
        -- Check if pgvector extension is installed
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
            ALTER TABLE episodes ADD COLUMN summary_embedding vector(384);
        ELSE
            -- If pgvector not installed, create as jsonb as fallback
            ALTER TABLE episodes ADD COLUMN summary_embedding JSONB;
        END IF;
    END IF;
END $$;

-- Ensure message_log has raw_text column (it should already)
-- But if not, add it
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'message_log' AND column_name = 'raw_text') THEN
        ALTER TABLE message_log ADD COLUMN raw_text TEXT;
    END IF;
END $$;
