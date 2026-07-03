import { ChatMessage } from "../llm/types";

export function buildPrompt(context: any, message: string, history: any[]): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: "You are Wax, a WhatsApp tutor for Nigerian students." },
  ];

  for (const h of history) {
    if (h.content) {
      messages.push({ role: "user", content: h.content });
    }
  }

  messages.push({ role: "user", content: message });

  return messages;
}
