import hashlib
import hmac
from typing import Optional, List
from datetime import datetime
from loguru import logger
import httpx
import os

WHATSAPP_API = "https://graph.facebook.com/v21.0"

class WhatsAppMessage:
    def __init__(self, user_id: str, message_id: str, content: str,
                 is_voice: bool = False, media_id: Optional[str] = None,
                 timestamp: Optional[datetime] = None):
        self.user_id = user_id
        self.message_id = message_id
        self.content = content
        self.is_voice = is_voice
        self.media_id = media_id
        self.timestamp = timestamp or datetime.now()

def verify_signature(payload: bytes, signature: str) -> bool:
    app_secret = os.environ.get("WHATSAPP_APP_SECRET", "")
    if not app_secret:
        return True
    if not signature or not signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(app_secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

def parse_payload(payload: dict) -> List[WhatsAppMessage]:
    messages = []
    try:
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                for msg in value.get("messages", []):
                    parsed = _parse_message(msg)
                    if parsed:
                        messages.append(parsed)
    except Exception as e:
        logger.error(f"WhatsApp parse error: {e}")
    return messages

def _parse_message(msg: dict) -> Optional[WhatsAppMessage]:
    msg_type = msg.get("type", "")
    user_id = msg.get("from", "")
    msg_id = msg.get("id", "")
    try:
        ts = datetime.fromtimestamp(int(msg.get("timestamp", 0)))
    except Exception:
        ts = datetime.now()

    if msg_type == "text":
        content = msg.get("text", {}).get("body", "")
        if content:
            return WhatsAppMessage(user_id, msg_id, content, timestamp=ts)

    elif msg_type == "audio":
        media_id = msg.get("audio", {}).get("id", "")
        return WhatsAppMessage(user_id, msg_id, "[VOICE_NOTE]", is_voice=True, media_id=media_id, timestamp=ts)

    elif msg_type == "image":
        caption = msg.get("image", {}).get("caption", "") or ""
        content = caption if caption else "I sent an image."
        return WhatsAppMessage(user_id, msg_id, content, timestamp=ts)

    elif msg_type == "interactive":
        interactive = msg.get("interactive", {})
        itype = interactive.get("type", "")
        if itype == "button_reply":
            reply = interactive.get("button_reply", {})
            btn_id = reply.get("id", "")
            title = reply.get("title", "")
            content = _decode_button_id(btn_id) or title
            if content:
                return WhatsAppMessage(user_id, msg_id, content, timestamp=ts)
        elif itype == "list_reply":
            reply = interactive.get("list_reply", {})
            list_id = reply.get("id", "")
            title = reply.get("title", "")
            content = _decode_button_id(list_id) or title
            if content:
                return WhatsAppMessage(user_id, msg_id, content, timestamp=ts)

    elif msg_type == "button":
        content = msg.get("button", {}).get("text", "")
        if content:
            return WhatsAppMessage(user_id, msg_id, content, timestamp=ts)

    return None

def _decode_button_id(btn_id: str) -> Optional[str]:
    for prefix in ["subject_", "level_", "exam_", "action_", "mcq_"]:
        if btn_id.startswith(prefix):
            return btn_id[len(prefix):].replace("_", " ")
    return None

async def send_text(to: str, text: str) -> bool:
    phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
    token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
    url = f"{WHATSAPP_API}/{phone_id}/messages"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    if len(text) > 4096:
        parts = _split_text(text)
        for part in parts:
            success = await _post(url, {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to,
                "type": "text",
                "text": {"body": part, "preview_url": False},
            }, headers)
            if not success:
                return False
        return True

    return await _post(url, {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "text",
        "text": {"body": text, "preview_url": False},
    }, headers)

async def mark_read(message_id: str) -> None:
    phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
    token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
    url = f"{WHATSAPP_API}/{phone_id}/messages"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    await _post(url, {"messaging_product": "whatsapp", "status": "read", "message_id": message_id}, headers)

async def download_media(media_id: str) -> Optional[bytes]:
    token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(f"{WHATSAPP_API}/{media_id}", headers=headers)
            r.raise_for_status()
            url = r.json().get("url")
            if not url:
                return None
            audio_r = await client.get(url, headers=headers)
            audio_r.raise_for_status()
            return audio_r.content
    except Exception as e:
        logger.error(f"Media download failed: {e}")
        return None

async def _post(url: str, payload: dict, headers: dict) -> bool:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            return True
    except Exception as e:
        logger.error(f"WhatsApp send failed: {e}")
        return False

def _split_text(text: str, max_len: int = 4000) -> List[str]:
    if len(text) <= max_len:
        return [text]
    parts = []
    while len(text) > max_len:
        split_at = text[:max_len].rfind("\n\n")
        if split_at == -1:
            split_at = text[:max_len].rfind(". ")
        if split_at == -1:
            split_at = max_len
        parts.append(text[:split_at].strip())
        text = text[split_at:].strip()
    if text:
        parts.append(text)
    return parts
