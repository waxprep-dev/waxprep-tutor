# Ghost Gateway

The Ghost Gateway is the foundational service that keeps the Wax tutoring system alive on Render's free tier while receiving and forwarding WhatsApp webhooks to the main system.

## Purpose

- Maintains legal presence on Render free tier (prevents sleep)
- Receives WhatsApp webhook payloads
- Verifies webhook signatures
- Forwards messages to Supabase interaction queue
- Provides health check endpoint

## Architecture

The Ghost Gateway operates as a minimal Rust service that:
1. Stays alive via Uptime Robot pings (every 4 minutes)
2. Receives WhatsApp webhooks on `/webhook`
3. Validates signatures using HMAC-SHA256
4. Processes and enriches messages
5. Inserts them into the Supabase `interaction_queue` table
6. Responds to health checks on `/health`

## Environment Variables

Create a `.env` file with the following variables:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
WHATSAPP_VERIFY_TOKEN=your-verification-token
WHATSAPP_ACCESS_TOKEN=your-access-token
WHATSAPP_APP_SECRET=your-app-secret
WEBHOOK_VERIFY_ENABLED=true
```

## Endpoints

- `GET /health` - Health check endpoint (used by Uptime Robot)
- `GET /webhook` - WhatsApp webhook verification
- `POST /webhook` - WhatsApp message reception

## Security Features

- HMAC-SHA256 signature verification
- Replay attack prevention (5-minute window)
- Rate limiting considerations
- Input validation and sanitization

## Deployment

This service is designed to run on Render's free tier with minimal resource usage (<128MB RAM).
