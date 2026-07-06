# Nigeria AI Tutor WhatsApp Webhook

Production-grade WhatsApp webhook infrastructure for the Nigeria AI Tutor system - a tutor that actually knows you.

## Architecture Overview

This system implements a robust, scalable WhatsApp webhook infrastructure with the following components:

- **Fastify Webhook Server**: High-performance HTTP server that handles incoming WhatsApp webhooks
- **BullMQ Queue System**: Reliable message queuing with retry and dead-letter capabilities
- **Redis Storage**: Fast idempotency checks and temporary data storage
- **Supabase PostgreSQL**: Persistent storage for audit trails and message status tracking
- **Security Layer**: HMAC signature verification for authentic webhook requests
- **Monitoring**: Comprehensive logging and metrics

## Features

- ✅ **Idempotency**: Prevents duplicate message processing
- ✅ **Reliability**: Automatic retries and dead-letter queue for failed events
- ✅ **Performance**: Sub-100ms response times to WhatsApp
- ✅ **Security**: HMAC signature verification
- ✅ **Scalability**: Queue-based architecture handles traffic spikes
- ✅ **Monitoring**: Comprehensive logging and metrics
- ✅ **Persistence**: Audit trails in PostgreSQL

## Getting Started

### Prerequisites

- Node.js 18+
- Redis server
- Supabase account

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

## Contributing

This system is designed to be modular and extensible. New features can be added by implementing additional workers or extending the existing components.

## License

MIT
