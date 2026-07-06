# Supabase Database Schema for Wax Tutoring System

This directory contains the database schema for the Wax tutoring system, designed as a "synaptic bus" that connects all components of the system.

## Schema Overview

### Core Tables

1. **interaction_queue** - Stores incoming student interactions from various sources (WhatsApp, web, etc.)
2. **student_hypergraphs** - Stores each student's cognitive hypergraph (knowledge state)
3. **episodic_traces** - Stores detailed interaction traces for memory consolidation
4. **semantic_memory** - Stores consolidated, long-term learning abstractions
5. **prompt_latent_cache** - Caches pre-computed prompt coordinates for efficiency
6. **responses** - Stores AI-generated responses to student queries

## Key Features

- **Time-partitioned**: Episodic traces are organized by time for efficient querying
- **Hypergraph-based**: Student knowledge represented as dynamic hypergraphs
- **Caching**: Prompt latent coordinates cached for faster response times
- **Analytics**: Materialized views for student progress tracking
- **Security**: Row-level security policies for data isolation

## Migration Strategy

Run migrations using:
```bash
supabase db push
```

## Development

To start the local Supabase development environment:
```bash
supabase start
```

To stop:
```bash
supabase stop
```

## Production Considerations

- Monitor table sizes for episodic_traces (consider archiving old data)
- Adjust cache TTL based on usage patterns
- Review and customize RLS policies for your authentication system
- Consider partitioning large tables by date in production
