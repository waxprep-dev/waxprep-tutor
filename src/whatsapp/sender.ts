import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * Send a text message to a WhatsApp user via Meta's Cloud API.
 */

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

/**
 * Send a "typing" indicator (the three dots). Optional but feels more human.
 */
export async function sendTypingIndicator(toPhone: string): Promise<void> {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${config.whatsapp.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "text",
        text: { body: "\u200B" }, // zero-width space as a no-op marker
      },
      {
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
  } catch (err) {
    // Typing indicator failures are non-critical
    logger.warn("Typing indicator failed (non-critical)", { to: toPhone });
  }
}
