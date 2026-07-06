# Nigeria AI Tutor WhatsApp Webhook with Memory System

Production-grade WhatsApp webhook infrastructure for the Nigeria AI Tutor system - a tutor that actually knows you.

## Architecture Overview

This system implements a robust, scalable WhatsApp webhook infrastructure with an advanced 4-layer cognitive memory system:

- **Fastify Webhook Server**: High-performance HTTP server that handles incoming WhatsApp webhooks
- **BullMQ Queue System**: Reliable message queuing with retry and dead-letter capabilities
- **Redis Storage**: Fast session memory and idempotency checks
- **Supabase PostgreSQL**: Persistent storage for audit trails, message status tracking, and memory system
- **Security Layer**: HMAC signature verification for authentic webhook requests
- **4-Layer Memory System**: Cognitive architecture with Session, Episodic, Long-term, and Procedural memory
- **Monitoring**: Comprehensive logging and metrics

## Memory System Architecture

The memory system consists of four specialized layers:

### 1. Session Memory
- **Purpose**: Working memory for active conversations
- **Storage**: Redis (sub-millisecond access)
- **Lifespan**: Minutes to hours
- **Function**: Tracks current session state, conversation turns, active tasks

### 2. Episodic Memory
- **Purpose**: Session summaries and experiences
- **Storage**: PostgreSQL + pgvector
- **Lifespan**: Days to months
- **Function**: Stores session summaries with semantic search capability

### 3. Long-Term Memory
- **Purpose**: Persistent facts and knowledge about users
- **Storage**: PostgreSQL + pgvector
- **Lifespan**: Months to years
- **Function**: Stores user preferences, goals, weaknesses, strengths with contradiction detection

### 4. Procedural Memory
- **Purpose**: Rules, procedures, and behavioral patterns
- **Storage**: PostgreSQL (JSONB)
- **Lifespan**: Permanent (until updated)
- **Function**: Stores safety rules, business logic, and personalized behavior patterns

## Features

- ✅ **Idempotency**: Prevents duplicate message processing
- ✅ **Reliability**: Automatic retries and dead-letter queue for failed events
- ✅ **Performance**: Sub-100ms response times to WhatsApp
- ✅ **Security**: HMAC signature verification
- ✅ **Scalability**: Queue-based architecture handles traffic spikes
- ✅ **Monitoring**: Comprehensive logging and metrics
- ✅ **Persistence**: Audit trails in PostgreSQL
- ✅ **Cognitive Memory**: 4-layer memory system with semantic search
- ✅ **Memory Decay**: Mathematical forgetting based on cognitive science
- ✅ **Contradiction Detection**: Resolves conflicting information
- ✅ **Context Assembly**: Intelligent context building for AI
- ✅ **Session Consolidation**: Background transformation of sessions to memories

## Getting Started

### Prerequisites

- Node.js 18+
- Redis server
- Supabase account with pgvector extension enabled

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd waxprep-tutor
```

2. Install dependencies:
```bash
npm install
```

3. Copy the environment file:
```bash
cp .env.example .env
```

4. Fill in the environment variables in `.env`:
   - Meta WhatsApp Business API credentials
   - Redis connection details
   - Supabase connection details

5. Set up the database schema by running the SQL in `scripts/supabase-schema.sql` in your Supabase SQL editor.

### Running the Application

For development:
```bash
npm run dev
```

For production:
```bash
npm run build
npm start
```

## Configuration

The system is configured via environment variables in the `.env` file. Key configuration options include:

- `META_*`: Meta/WhatsApp API credentials
- `REDIS_*`: Redis connection settings
- `SUPABASE_*`: Supabase connection settings
- `QUEUE_*`: Queue configuration parameters
- `WEBHOOK_*`: Webhook behavior settings

## Integration with AI System

The message worker in `src/workers/messageWorker.ts` contains a placeholder function `processWithAI()` that needs to be replaced with your actual AI integration. This is where your "Gamma-4" or other AI system will be connected.

The memory system provides the following integration points:

- `memory.assembleContext(userId, currentMessage)` - Gets contextual information before AI call
- `memory.recordUserMessage(userId, messageId, content)` - Records user input
- `memory.recordAIResponse(userId, content)` - Records AI output
- `memory.recordExchange(userId, messageId, userContent, aiContent)` - Records full exchange

## Memory System API

### Context Assembly
```typescript
const context = await memory.assembleContext(userId, currentMessage);
// Returns structured context with system prompt, recent turns, memories, and user profile
```

### Fact Storage
```typescript
await memory.storeFact(userId, 'preference', 'learning_style', 'visual', 'Prefers diagrams and visual aids');
```

### Rule Creation
```typescript
await memory.addRule('safety', 'user_is_frustrated', 'switch_to_empathetic_mode()', 95, 'user', userId);
```

## Deployment

The `render.yaml` file provides infrastructure-as-code configuration for deploying to Render. Simply connect your repository to Render and it will automatically deploy the complete infrastructure.

## Monitoring

- Health check: `/health`
- Queue metrics: `/metrics/queues` (requires API key)
- Logs: Structured logging via Pino

## Security

- All webhook requests are verified using HMAC signatures
- Environment variables store sensitive credentials
- Rate limiting prevents abuse
- Input validation prevents injection attacks
- Procedural memory provides safety rules and guardrails

## Contributing

This system is designed to be modular and extensible. New features can be added by implementing additional workers or extending the existing components.

## License

MIT

## Memory System Design Philosophy

The memory system is built on cognitive science principles:

- **Dual-trace theory**: Fast-decaying STM component + slow-decaying LTM component
- **Ebbinghaus forgetting curve**: Mathematical decay based on time and importance
- **Semantic similarity**: Vector embeddings for meaningful search
- **Contradiction resolution**: Detects and resolves conflicting information
- **Contextual relevance**: Combines semantic, temporal, and frequency factors

This creates a truly "knowing" AI tutor that builds understanding over time while maintaining safety and accuracy.
