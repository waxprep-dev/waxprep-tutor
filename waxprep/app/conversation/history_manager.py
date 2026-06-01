from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from loguru import logger
from waxprep.app.core.config import settings
from waxprep.app.core.constants import MessageDirection
from waxprep.app.database.client import get_db_client

class ConversationHistoryManager:
    def __init__(self):
        self.db = get_db_client()

    async def get_or_create_active_conversation(
        self,
        student_id: str,
        platform: str,
    ) -> Dict[str, Any]:
        try:
            timeout = (
                datetime.utcnow() - timedelta(minutes=settings.session_timeout_minutes)
            ).isoformat()

            r = (
                self.db.table("conversations")
                .select("*")
                .eq("student_id", student_id)
                .eq("is_active", True)
                .eq("platform", platform)
                .gte("last_message_at", timeout)
                .order("started_at", desc=True)
                .limit(1)
                .execute()
            )
            if r.data:
                return r.data[0]

            result = self.db.table("conversations").insert({
                "student_id": student_id,
                "platform": platform,
                "session_state": "onboarding",
                "is_active": True,
            }).execute()
            return result.data[0]
        except Exception as e:
            logger.error(f"Conversation get/create error: {e}")
            raise

    async def save_message(
        self,
        conversation_id: str,
        student_id: str,
        direction: str,
        content: str,
        message_type: str = "text",
        intent: str = None,
        platform_message_id: str = None,
        metadata: Dict = None,
    ) -> Dict:
        try:
            result = self.db.table("messages").insert({
                "conversation_id": conversation_id,
                "student_id": student_id,
                "direction": direction,
                "content": content,
                "message_type": message_type,
                "intent_classified": intent,
                "platform_message_id": platform_message_id,
                "metadata": metadata or {},
            }).execute()

            self.db.table("conversations").update({
                "last_message_at": datetime.utcnow().isoformat()
            }).eq("id", conversation_id).execute()

            return result.data[0] if result.data else {}
        except Exception as e:
            logger.error(f"Save message error: {e}")
            return {}

    async def get_history_for_ai(
        self,
        conversation_id: str,
        limit: int = 15,
    ) -> List[Dict[str, str]]:
        try:
            r = (
                self.db.table("messages")
                .select("direction, content, timestamp")
                .eq("conversation_id", conversation_id)
                .order("timestamp", desc=True)
                .limit(limit)
                .execute()
            )
            messages = list(reversed(r.data or []))
            return [
                {
                    "role": "user" if m["direction"] == MessageDirection.INBOUND.value else "assistant",
                    "content": m["content"],
                }
                for m in messages
            ]
        except Exception as e:
            logger.error(f"History fetch error: {e}")
            return []

    async def get_previous_session_summary(self, student_id: str) -> Optional[str]:
        try:
            r = (
                self.db.table("conversations")
                .select("summary, ended_at")
                .eq("student_id", student_id)
                .eq("is_active", False)
                .not_.is_("summary", "null")
                .order("ended_at", desc=True)
                .limit(1)
                .execute()
            )
            return r.data[0]["summary"] if r.data else None
        except Exception as e:
            logger.error(f"Session summary fetch error: {e}")
            return None

    async def update_conversation_state(self, conversation_id: str, state: str) -> None:
        try:
            self.db.table("conversations").update({
                "session_state": state
            }).eq("id", conversation_id).execute()
        except Exception as e:
            logger.warning(f"State update error: {e}")
