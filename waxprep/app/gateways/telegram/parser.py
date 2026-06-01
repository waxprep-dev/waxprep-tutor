from typing import Optional, Dict, Any
from datetime import datetime
from loguru import logger
from waxprep.app.gateways.normalizer import NormalizedMessage
from waxprep.app.core.constants import Platform

class TelegramParser:
    def parse_update(self, update: Dict[str, Any]) -> Optional[NormalizedMessage]:
        try:
            message = update.get("message") or update.get("edited_message")
            if not message:
                return None

            from_user = message.get("from", {})
            user_id = str(from_user.get("id", ""))
            msg_id = f"tg_{message.get('message_id', '')}"
            try:
                ts = datetime.fromtimestamp(int(message.get("date", 0)))
            except Exception:
                ts = datetime.now()

            content = ""
            msg_type = "text"
            is_voice = False
            media_url = None
            media_type = None

            if "text" in message:
                content = message["text"]
            elif "voice" in message:
                is_voice = True
                content = "[VOICE_NOTE]"
                media_url = message["voice"].get("file_id")
                media_type = "audio"
            elif "photo" in message:
                photos = message["photo"]
                best = max(photos, key=lambda p: p.get("file_size", 0))
                media_url = best.get("file_id")
                content = message.get("caption", "[IMAGE]")
                media_type = "image"
            else:
                return None

            if not content and not is_voice:
                return None

            return NormalizedMessage(
                platform=Platform.TELEGRAM,
                platform_user_id=user_id,
                platform_message_id=msg_id,
                content=content,
                message_type=msg_type,
                timestamp=ts,
                raw_payload=update,
                media_url=media_url,
                media_type=media_type,
                is_voice=is_voice,
                metadata={"from_user": from_user},
            )
        except Exception as e:
            logger.error(f"Telegram parse error: {e}")
            return None
