import express from "express";
import { config } from "./config";
import { logger } from "./utils/logger";
import { handleWebhookGet, handleWebhookPost } from "./whatsapp/webhook";
import { pool } from "./db/client";

const app = express();

// IMPORTANT: webhook signature verification needs the raw body.
// We use express.raw() and then manually parse JSON inside the handler.
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    // Save raw body for signature verification
    (req as any).rawBody = req.body.toString("utf8");
    try {
      req.body = JSON.parse((req as any).rawBody);
    } catch (e) {
      req.body = {};
    }
    next();
  }
);

// All other routes get normal JSON parsing
app.use(express.json());

// Health check
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

// Webhook routes
app.get("/webhook", handleWebhookGet);
app.post("/webhook", handleWebhookPost);

// Start server
app.listen(config.port, () => {
  logger.info(`Tutor server running on port ${config.port}`, {
    env: config.nodeEnv,
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down");
  await pool.end();
  process.exit(0);
});
