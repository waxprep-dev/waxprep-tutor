import { config } from "../config";
import { logger } from "../utils/logger";

interface WhatsAppMessage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: { body: string };
}

interface TypingIndicatorRequest {
  messaging_product: "whatsapp";
  status: "read";
  message_id: string;
  typing_indicator: { type: "text" };
}

export async function sendTextMessage(to: string, text: string): Promise<void> {
  const apiToken = config.whatsapp?.apiToken || config.whatsapp?.accessToken;
  const phoneNumberId = config.whatsapp?.phoneNumberId;

  if (!apiToken || !phoneNumberId) {
    logger.error("WhatsApp credentials not configured");
    return;
  }

  const cleanPhone = to.replace(/\D/g, "");
  if (cleanPhone.length < 10) {
    logger.error("Invalid phone number for WhatsApp", { to });
    return;
  }

  const safeText = text.slice(0, 4096);

  const payload: WhatsAppMessage = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: cleanPhone,
    type: "text",
    text: { body: safeText },
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`WhatsApp API error: ${response.status} - ${error}`);
    }

    logger.info("Message sent via WhatsApp", { to: cleanPhone, length: safeText.length });
  } catch (error: any) {
    logger.error("Failed to send WhatsApp message", { error: error.message, to: cleanPhone });
    throw error;
  }
}

// ============================================================
// TYPING INDICATOR — Shows "Wax is typing..." to the student
// ============================================================
export async function sendTypingIndicator(
  phone: string,
  incomingMessageId: string
): Promise<void> {
  const apiToken = config.whatsapp?.apiToken || config.whatsapp?.accessToken;
  const phoneNumberId = config.whatsapp?.phoneNumberId;

  if (!apiToken || !phoneNumberId) {
    logger.debug("Typing indicator skipped: missing credentials");
    return;
  }

  const cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length < 10) {
    logger.debug("Typing indicator skipped: invalid phone", { phone });
    return;
  }

  try {
    const payload: TypingIndicatorRequest = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: incomingMessageId,
      typing_indicator: { type: "text" },
    };

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logger.warn("Typing indicator failed", { 
        phone: cleanPhone, 
        status: response.status,
        error: error.slice(0, 200)
      });
      return;
    }

    logger.debug("Typing indicator sent", { phone: cleanPhone });

  } catch (error: any) {
    // Non-critical — don't throw, just log
    logger.warn("Typing indicator failed", { 
      phone: cleanPhone, 
      error: error.message 
    });
  }
}
