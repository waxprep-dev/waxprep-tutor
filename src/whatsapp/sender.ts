import { config } from "../config";
import { logger } from "../utils/logger";

interface WhatsAppMessage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: { body: string };
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
