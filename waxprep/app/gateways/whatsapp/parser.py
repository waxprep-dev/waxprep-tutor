from typing import Optional, Dict, Any, List
from datetime import datetime
from loguru import logger
from waxprep.app.gateways.normalizer import NormalizedMessage
from waxprep.app.core.constants import Platform

class WhatsAppParser:
    def parse_payload(self, payload: Dict[str, Any]) -> List[NormalizedMessage]:
        messages = []
        try:
            for entry in payload.get("entry", []):
                for change in entry.get("changes", []):
                    value = change.get("value", {})
                    for msg in value.get("messages", []):
                        n = self._normalize(msg, value)
                        if n:
                            messages.append(n)
        except Exception as e:
            logger.error(f"WhatsApp parse error: {e}")
        return messages

    def _normalize(self, msg: Dict, value: Dict) -> Optional[NormalizedMessage]:
        try:
            msg_type = msg.get("type", "")
            user_id = msg.get("from", "")
            msg_id = msg.get("id", "")
            try:
                ts = datetime.fromtimestamp(int(msg.get("timestamp", 0)))
            except Exception:
                ts = datetime.now()

            content = ""
            media_url = None
            media_type = None
            is_voice = False
            metadata = {}

            if msg_type == "text":
                content = msg.get("text", {}).get("body", "")

            elif msg_type == "audio":
                is_voice = True
                media_url = msg.get("audio", {}).get("id", "")
                media_type = "audio"
                content = "[VOICE_NOTE]"

            elif msg_type == "image":
                media_url = msg.get("image", {}).get("id", "")
                media_type = "image"
                content = msg.get("image", {}).get("caption", "[IMAGE]")
                metadata["is_image"] = True

            elif msg_type == "interactive":
                interactive = msg.get("interactive", {})
                itype = interactive.get("type", "")
                if itype == "button_reply":
                    reply = interactive.get("button_reply", {})
                    btn_id = reply.get("id", "")
                    content = self._resolve_id(btn_id, reply.get("title", ""))
                    metadata["button_id"] = btn_id
                    metadata["is_button_reply"] = True
                elif itype == "list_reply":
                    reply = interactive.get("list_reply", {})
                    list_id = reply.get("id", "")
                    content = self._resolve_id(list_id, reply.get("title", ""))
                    metadata["list_id"] = list_id
                    metadata["is_list_reply"] = True

            elif msg_type == "button":
                content = msg.get("button", {}).get("text", "")

            else:
                return None

            if not content and not is_voice:
                return None

            return NormalizedMessage(
                platform=Platform.WHATSAPP,
                platform_user_id=user_id,
                platform_message_id=msg_id,
                content=content,
                message_type=msg_type,
                timestamp=ts,
                raw_payload=msg,
                media_url=media_url,
                media_type=media_type,
                is_voice=is_voice,
                metadata=metadata,
            )
        except Exception as e:
            logger.error(f"Message normalize error: {e}")
            return None

    def _resolve_id(self, btn_id: str, title: str) -> str:
        prefixes = ["mcq_", "subject_", "level_", "exam_target_", "action_", "frustration_"]
        for prefix in prefixes:
            if btn_id.startswith(prefix):
                clean = btn_id.replace(prefix, "").replace("_", " ")
                return clean
        return title
