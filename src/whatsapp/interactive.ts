import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

/**
 * Interactive messages are WhatsApp's killer feature for non-text interactions.
 * Reply buttons: up to 3 tappable buttons per message.
 * List messages: a button that opens a multi-section picker (great for menus).
 * CTA buttons: link out to URLs.
 * 
 * Button IDs encode meaning: we use them to route actions in the webhook.
 * Convention: "category:action:context" — e.g., "diff:got_it:concept_uuid"
 */

const WA_API_URL = `https://graph.facebook.com/v18.0/${config.whatsapp.phoneNumberId}/messages`;

interface ButtonAction {
  id: string;
  title: string;
}

interface ListSection {
  title: string;
  rows: Array<{ id: string; title: string; description?: string }>;
}

/**
 * Send a message with up to 3 reply buttons.
 * Best for: yes/no/maybe, got it/confused/lost, easy/medium/hard
 */
export async function sendButtonMessage(
  toPhone: string,
  body: string,
  buttons: ButtonAction[],
  options?: { header?: string; footer?: string }
): Promise<{ message_id: string }> {
  if (buttons.length === 0 || buttons.length > 3) {
    throw new Error(`Reply buttons must be 1-3 buttons, got ${buttons.length}`);
  }

  const interactive: any = {
    type: "button",
    body: { text: body },
    action: {
      buttons: buttons.map((b) => ({
        type: "reply",
        reply: { id: b.id, title: b.title.substring(0, 20) },
      })),
    },
  };

  if (options?.header) interactive.header = { type: "text", text: options.header.substring(0, 60) };
  if (options?.footer) interactive.footer = { text: options.footer.substring(0, 60) };

  try {
    const response = await axios.post(
      WA_API_URL,
      {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "interactive",
        interactive,
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
    logger.info("Button message sent", { to: toPhone, buttons: buttons.length });
    return { message_id: messageId };
  } catch (err: any) {
    logger.error("Button message failed", { error: err.response?.data || err.message });
    throw err;
  }
}

/**
 * Send a list picker message.
 * Best for: subject selection, topic menus, multi-option choices (4+ items).
 */
export async function sendListMessage(
  toPhone: string,
  body: string,
  buttonLabel: string,
  sections: ListSection[],
  options?: { header?: string; footer?: string }
): Promise<{ message_id: string }> {
  if (sections.length === 0 || sections.length > 10) {
    throw new Error(`List sections must be 1-10, got ${sections.length}`);
  }

  const interactive: any = {
    type: "list",
    body: { text: body },
    action: {
      button: buttonLabel.substring(0, 20),
      sections: sections.map((s) => ({
        title: s.title.substring(0, 24),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title.substring(0, 24),
          description: r.description?.substring(0, 72),
        })),
      })),
    },
  };

  if (options?.header) interactive.header = { type: "text", text: options.header.substring(0, 60) };
  if (options?.footer) interactive.footer = { text: "Footer text" };

  try {
    const response = await axios.post(
      WA_API_URL,
      {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "interactive",
        interactive,
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
    logger.info("List message sent", { to: toPhone, sections: sections.length });
    return { message_id: messageId };
  } catch (err: any) {
    logger.error("List message failed", { error: err.response?.data || err.message });
    throw err;
  }
}

/**
 * Send a CTA URL button (links out to a URL).
 * Best for: "View your progress dashboard", "Join community"
 */
export async function sendCtaButton(
  toPhone: string,
  body: string,
  buttonText: string,
  url: string,
  options?: { header?: string; footer?: string }
): Promise<{ message_id: string }> {
  const interactive: any = {
    type: "cta_url",
    body: { text: body },
    action: {
      name: "cta_url",
      parameters: {
        display_text: buttonText.substring(0, 20),
        url: url,
      },
    },
  };

  if (options?.header) interactive.header = { type: "text", text: options.header };
  if (options?.footer) interactive.footer = { text: options.footer };

  try {
    const response = await axios.post(
      WA_API_URL,
      {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "interactive",
        interactive,
      },
      {
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    return { message_id: response.data.messages?.[0]?.id };
  } catch (err: any) {
    logger.error("CTA button failed", { error: err.response?.data || err.message });
    throw err;
  }
}

/**
 * Send a reaction (emoji) to a message. NEW WhatsApp feature.
 * Best for: celebrating wins ("🎉" when they master something)
 */
export async function sendReaction(
  toPhone: string,
  messageId: string,
  emoji: string
): Promise<void> {
  try {
    await axios.post(
      WA_API_URL,
      {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "reaction",
        reaction: {
          message_id: messageId,
          emoji: emoji,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${config.whatsapp.accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
  } catch (err: any) {
    logger.warn("Reaction send failed (non-critical)", { error: err.response?.data || err.message });
  }
}
