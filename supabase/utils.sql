-- Utility queries for the Wax tutoring system

-- Get student's current hypergraph
SELECT hypergraph_json FROM student_hypergraphs WHERE student_external_id = $1;

-- Get recent interactions for a student
SELECT * FROM interaction_queue 
WHERE student_external_id = $1 
AND processing_status = 'completed' 
ORDER BY created_at DESC LIMIT 10;

-- Get student's semantic memory for a specific topic
SELECT memory_content FROM semantic_memory 
WHERE student_external_id = $1 
AND memory_type = $2;

-- Get cached prompt coordinates
SELECT prompt_latent_coordinates FROM prompt_latent_cache 
WHERE student_external_id = $1 
AND topic = $2 
AND difficulty_level = $3 
AND expires_at > NOW();

-- Update student hypergraph
UPDATE student_hypergraphs 
SET hypergraph_json = $1, updated_at = NOW() 
WHERE student_external_id = $2;

-- Insert new interaction
INSERT INTO interaction_queue (source, source_id, student_external_id, message_type, raw_content, timestamp_utc, enrichment)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id;

-- Insert episodic trace
INSERT INTO episodic_traces (student_external_id, trace_type, trace_data, session_id, interaction_id)
VALUES ($1, $2, $3, $4, $5);

-- Consolidate episodic traces into semantic memory (called during nocturnal processing)
INSERT INTO semantic_memory (student_external_id, memory_type, memory_content, consolidation_timestamp)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (student_external_id, memory_type) 
DO UPDATE SET 
    memory_content = $3,
    consolidation_timestamp = NOW(),
    activation_level = semantic_memory.activation_level * 0.8 + 0.2;  -- Boost activation

-- Get student analytics summary
SELECT * FROM student_analytics WHERE student_external_id = $1;

-- Clean up expired prompt caches
DELETE FROM prompt_latent_cache WHERE expires_at < NOW();

-- Archive old episodic traces (run periodically)
-- This would typically be done in a background job
-- DELETE FROM episodic_traces WHERE created_at < NOW() - INTERVAL '90 days';
