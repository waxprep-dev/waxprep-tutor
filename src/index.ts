import express from "express";
import cors from "cors";
import { config } from "./config";
import { handleWebhookGet, handleWebhookPost } from "./whatsapp/webhook";
import { logger } from "./utils/logger";

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ verify: (req: any, res, buf) => { req.rawBody = buf; } }));

// Health check (for keep-alive and monitoring)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Dream Worker trigger (for cron-job.org)
app.post("/run-dream", async (req, res) => {
  try {
    const { dreamWorker } = await import("./workers/dreamWorker");
    logger.info("🌙 Dream Worker triggered externally via /run-dream");
    
    // Run the dream worker asynchronously so we don't timeout
    dreamWorker.run()
      .then(() => {
        logger.info("🌙 Dream Worker completed successfully");
      })
      .catch((error: any) => {
        logger.error("🌙 Dream Worker failed", { error: error.message });
      });
    
    res.status(200).json({ 
      success: true, 
      message: "Dream Worker started in background",
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error("Failed to trigger Dream Worker", { error: error.message });
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Webhook routes
app.get("/webhook", handleWebhookGet);
app.post("/webhook", handleWebhookPost);

// Root route
app.get("/", (req, res) => {
  res.send("WaxPrep Tutor is running!");
});

app.listen(port, () => {
  logger.info(`Tutor server running on port ${port}`, { env: process.env.NODE_ENV });
});
