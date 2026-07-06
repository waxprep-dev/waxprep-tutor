-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Create interaction_queue table
create table interaction_queue (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    source text not null check (source in ('whatsapp', 'web', 'api', 'mobile')),
    source_id text not null,
    student_external_id text not null,
    student_display_name text,
    message_type text not null,
    raw_content text not null,
    timestamp_utc timestamp with time zone not null,
    enrichment jsonb default '{}',
    processing_status text default 'pending' check (processing_status in ('pending', 'processing', 'completed', 'failed')),
    cortex_result jsonb,
    cerebras_response_id text,
    error_log text,
    constraint interaction_queue_source_source_id_unique unique (source, source_id)
);

-- Create indexes for interaction_queue
create index idx_interaction_queue_created_at on interaction_queue(created_at);
create index idx_interaction_queue_student_external_id on interaction_queue(student_external_id);
create index idx_interaction_queue_processing_status on interaction_queue(processing_status);
create index idx_interaction_queue_source on interaction_queue(source);

-- Create student_hypergraphs table
create table student_hypergraphs (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc' :: text, now()) not null,
    updated_at timestamp with time zone default timezone('utc' :: text, now()) not null,
    student_external_id text not null,
    hypergraph_json jsonb not null,
    hypergraph_version integer default 1,
    last_interaction_at timestamp with time zone,
    constraint student_hypergraphs_student_external_id_unique unique (student_external_id)
);

-- Create indexes for student_hypergraphs
create index idx_student_hypergraphs_student_external_id on student_hypergraphs(student_external_id);
create index idx_student_hypergraphs_updated_at on student_hypergraphs(updated_at);

-- Create episodic_traces table (append-only, time-partitioned)
create table episodic_traces (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc' :: text, now()) not null,
    student_external_id text not null,
    trace_type text not null,
    trace_data jsonb not null,
    session_id text,
    interaction_id uuid references interaction_queue(id),
    constraint episodic_traces_student_external_id_created_at_idx unique (student_external_id, created_at)
);

-- Create indexes for episodic_traces
create index idx_episodic_traces_student_external_id on episodic_traces(student_external_id);
create index idx_episodic_traces_created_at on episodic_traces(created_at);
create index idx_episodic_traces_trace_type on episodic_traces(trace_type);

-- Create semantic_memory table (consolidated abstractions)
create table semantic_memory (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc' :: text, now()) not null,
    updated_at timestamp with time zone default timezone('utc' :: text, now()) not null,
    student_external_id text not null,
    memory_type text not null,
    memory_content jsonb not null,
    consolidation_timestamp timestamp with time zone,
    decay_half_life_days numeric default 90.0,
    activation_level numeric default 1.0,
    constraint semantic_memory_student_external_id_memory_type_unique unique (student_external_id, memory_type)
);

-- Create indexes for semantic_memory
create index idx_semantic_memory_student_external_id on semantic_memory(student_external_id);
create index idx_semantic_memory_memory_type on semantic_memory(memory_type);
create index idx_semantic_memory_consolidation_timestamp on semantic_memory(consolidation_timestamp);

-- Create prompt_latent_cache table
create table prompt_latent_cache (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc' :: text, now()) not null,
    updated_at timestamp with time zone default timezone('utc' :: text, now()) not null,
    student_external_id text not null,
    topic text not null,
    difficulty_level numeric,
    prompt_latent_coordinates jsonb not null,
    cache_ttl_minutes integer default 1440, -- 24 hours
    expires_at timestamp with time zone default (timezone('utc' :: text, now()) + interval '24 hours')
);

-- Create indexes for prompt_latent_cache
create index idx_prompt_latent_cache_student_external_id on prompt_latent_cache(student_external_id);
create index idx_prompt_latent_cache_topic on prompt_latent_cache(topic);
create index idx_prompt_latent_cache_expires_at on prompt_latent_cache(expires_at);

-- Create responses table
create table responses (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default timezone('utc' :: text, now()) not null,
    interaction_id uuid not null references interaction_queue(id),
    student_external_id text not null,
    response_text text not null,
    response_metadata jsonb,
    response_latency_ms integer,
    was_cached boolean default false,
    feedback_rating integer check (feedback_rating between 1 and 5),
    feedback_comment text
);

-- Create indexes for responses
create index idx_responses_interaction_id on responses(interaction_id);
create index idx_responses_student_external_id on responses(student_external_id);
create index idx_responses_created_at on responses(created_at);

-- Create a function to update the updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = timezone('utc' :: text, now());
    return new;
end;
$$ language 'plpgsql';

-- Create triggers to update updated_at
create trigger update_student_hypergraphs_updated_at before update on student_hypergraphs
    for each row execute procedure update_updated_at_column();

create trigger update_semantic_memory_updated_at before update on semantic_memory
    for each row execute procedure update_updated_at_column();

create trigger update_prompt_latent_cache_updated_at before update on prompt_latent_cache
    for each row execute procedure update_updated_at_column();

-- Enable Row Level Security (RLS) policies
alter table interaction_queue enable row level security;
alter table student_hypergraphs enable row level security;
alter table episodic_traces enable row level security;
alter table semantic_memory enable row level security;
alter table prompt_latent_cache enable row level security;
alter table responses enable row level security;

-- Create RLS policies
create policy "Individuals can view their own interactions" on interaction_queue
    for select using (auth.uid() = (select auth_uid from profiles where student_external_id = student_external_id));

create policy "Individuals can view their own hypergraphs" on student_hypergraphs
    for select using (auth.uid() = (select auth_uid from profiles where student_external_id = student_external_id));

create policy "Individuals can view their own traces" on episodic_traces
    for select using (auth.uid() = (select auth_uid from profiles where student_external_id = student_external_id));

create policy "Individuals can view their own semantic memory" on semantic_memory
    for select using (auth.uid() = (select auth_uid from profiles where student_external_id = student_external_id));

-- Note: We'll need to set up the profiles table and authentication separately
-- For now, we'll focus on the core tutoring functionality

-- Create a materialized view for student analytics
create materialized view student_analytics as
select 
    ih.student_external_id,
    count(ih.id) as total_interactions,
    max(ih.created_at) as last_interaction,
    avg(case when ir.feedback_rating is not null then ir.feedback_rating end) as avg_feedback,
    count(ir.id) as total_responses_with_feedback
from interaction_queue ih
left join responses ir on ih.id = ir.interaction_id
group by ih.student_external_id;

-- Create index on materialized view
create index idx_student_analytics_last_interaction on student_analytics(last_interaction);

-- Grant permissions to anon and authenticated roles
grant all privileges on interaction_queue to anon, authenticated;
grant all privileges on student_hypergraphs to anon, authenticated;
grant all privileges on episodic_traces to anon, authenticated;
grant all privileges on semantic_memory to anon, authenticated;
grant all privileges on prompt_latent_cache to anon, authenticated;
grant all privileges on responses to anon, authenticated;
