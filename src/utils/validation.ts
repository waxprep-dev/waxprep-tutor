// ============================================================
// INPUT VALIDATION
// ============================================================

import { config } from "../config";

const MAX_MESSAGE_LENGTH = config.MAX_MESSAGE_LENGTH || 4096;

export function validateTimestamp(timestamp: string): Date {
  if (!timestamp || typeof timestamp !== "string") {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }
  
  if (!/^\d{10,13}$/.test(timestamp)) {
    throw new Error(`Timestamp must be 10-13 digits: ${timestamp}`);
  }
  
  const parsed = parseInt(timestamp, 10);
  if (isNaN(parsed) || parsed < 1000000000 || parsed > 9999999999999) {
    throw new Error(`Timestamp out of range: ${timestamp}`);
  }
  
  const date = new Date(parsed * 1000);
  const now = new Date();
  const diffHours = Math.abs(now.getTime() - date.getTime()) / (1000 * 60 * 60);
  
  if (diffHours > 24) {
    throw new Error("Timestamp too old, possible replay attack");
  }
  
  return date;
}

export function sanitizeMessageId(messageId: string): string {
  if (!messageId || typeof messageId !== "string") return "";
  return messageId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 256);
}

export function sanitizeMessageText(text: string): string {
  if (!text || typeof text !== "string") return "";
  
  let cleaned = text.trim().replace(/\s+/g, " ");
  
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    cleaned = cleaned.slice(0, MAX_MESSAGE_LENGTH);
  }
  
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return cleaned;
}

export function sanitizeInteractivePayload(interactive: any): string {
  if (!interactive || typeof interactive !== "object") {
    return "[Invalid interactive message]";
  }
  
  const type = interactive.type;
  
  if (type === "button_reply" && interactive.button_reply?.title) {
    return sanitizeMessageText(String(interactive.button_reply.title));
  }
  
  if (type === "list_reply" && interactive.list_reply?.title) {
    return sanitizeMessageText(String(interactive.list_reply.title));
  }
  
  if (type && typeof type === "string") {
    return `[Unsupported interactive type: ${type.slice(0, 32)}]`;
  }
  
  return "[Unknown interactive message]";
}

export function validatePhone(phone: string): boolean {
  if (!phone || typeof phone !== "string") return false;
  return /^\+?\d{10,15}$/.test(phone);
}

export function sanitizePhone(phone: string): string {
  if (!phone || typeof phone !== "string") return "";
  return phone.replace(/\D/g, "").slice(0, 15);
}
