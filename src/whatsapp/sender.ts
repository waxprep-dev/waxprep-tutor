import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

export async function sendTextMessage(
  toPhone: string,
  text: string
): Promise<{ message_id: string }> {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${config.whatsapp.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const messageId = response.data.messages?.[0]?.id;
    logger.info("Message sent", { to: toPhone, message_id: messageId });
    return { message_id: messageId };
  } catch (err: any) {
    logger.error("Failed to send WhatsApp message", {
      to: toPhone,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}

export async function sendTypingIndicator(messageId: string): Promise<void> {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${config.whatsapp.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
        },
        timeout: 5000,
      }
    );
  } catch (err: any) {
    logger.warn("Typing indicator failed (non-critical)", { error: err.response?.data || err.message });
  }
}
