from datetime import datetime, timezone, timedelta
from typing import Optional
from loguru import logger
from waxprep.app.database.client import get_db
import os

class ConversationManager:
    def __init__(self):
        self.db = get_db()

    async def ensure_active(self, student_id: str, platform: str) -> str:
        timeout_minutes = int(os.environ.get("SESSION_TIMEOUT_MINUTES", "30"))
        try:
            timeout = (datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)).isoformat()
            r = (
                self.db.table("conversations")
                .select("id")
                .eq("student_id", student_id)
                .eq("is_active", True)
                .eq("platform", platform)
                .gte("last_message_at", timeout)
                .order("started_at", desc=True)
                .limit(1)
                .execute()
            )
            if r.data:
                return r.data[0]["id"]

            result = self.db.table("conversations").insert({
                "student_id": student_id,
                "platform": platform,
                "is_active": True,
                "session_state": "teaching",
            }).execute()
            return result.data[0]["id"]
        except Exception as e:
            logger.error(f"Conversation ensure failed: {e}")
            raise

    async def save_message(self, conversation_id: str, student_id: str, direction: str, content: str) -> None:
        try:
            self.db.table("messages").insert({
                "conversation_id": conversation_id,
                "student_id": student_id,
                "direction": direction,
                "content": content,
                "message_type": "text",
            }).execute()
            self.db.table("conversations").update({
                "last_message_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", conversation_id).execute()
        except Exception as e:
            logger.warning(f"Message save failed: {e}")

    async def close_stale_sessions(self) -> int:
        timeout_minutes = int(os.environ.get("SESSION_TIMEOUT_MINUTES", "30"))
        try:
            timeout = (datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)).isoformat()
            stale = (
                self.db.table("conversations")
                .select("id, student_id")
                .eq("is_active", True)
                .lt("last_message_at", timeout)
                .execute()
            )
            count = 0
            for s in (stale.data or []):
                await self._summarize_and_close(s["id"], s["student_id"])
                count += 1
            return count
        except Exception as e:
            logger.error(f"Close stale sessions failed: {e}")
            return 0

    # NEW — Close stale review sessions (2 hours idle)
    async def close_stale_reviews(self) -> int:
        try:
            review_timeout = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
            stale_reviews = (
                self.db.table("conversations")
                .select("id, student_id")
                .eq("is_active", True)
                .eq("session_state", "review")
                .lt("last_message_at", review_timeout)
                .execute()
            )
            count = 0
            for s in (stale_reviews.data or []):
                conv_id = s["id"]
                student_id = s["student_id"]
                
                # Clear review_session_id from knowledge_maps
                self.db.table("knowledge_maps").update({
                    "review_session_id": None,
                }).eq("student_id", student_id).eq("review_session_id", conv_id).execute()
                
                # Close the review conversation
                self.db.table("conversations").update({
                    "is_active": False,
                    "ended_at": datetime.now(timezone.utc).isoformat(),
                    "summary": "Review session ended (2 hours idle).",
                }).eq("id", conv_id).execute()
                
                count += 1
                logger.info(f"Closed stale review: {student_id[:8]}")
            
            return count
        except Exception as e:
            logger.error(f"Close stale reviews failed: {e}")
            return 0

    # NEW — Complete review session after 3 questions
    async def complete_review_session(self, conversation_id: str, student_id: str) -> None:
        try:
            # Clear review_session_id from knowledge_maps
            self.db.table("knowledge_maps").update({
                "review_session_id": None,
            }).eq("student_id", student_id).eq("review_session_id", conversation_id).execute()
            
            # Close the review conversation
            self.db.table("conversations").update({
                "is_active": False,
                "ended_at": datetime.now(timezone.utc).isoformat(),
                "summary": "Review session completed (3 questions done).",
            }).eq("id", conversation_id).execute()
            
            logger.info(f"Completed review session: {student_id[:8]}")
        except Exception as e:
            logger.warning(f"Complete review session failed: {e}")

    async def _summarize_and_close(self, conversation_id: str, student_id: str) -> None:
        try:
            msgs = (
                self.db.table("messages")
                .select("direction, content")
                .eq("conversation_id", conversation_id)
                .order("timestamp", desc=False)
                .execute()
            )

            if not msgs.data or len(msgs.data) < 3:
                self.db.table("conversations").update({
                    "is_active": False,
                    "ended_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", conversation_id).execute()
                return

            from waxprep.app.brain.engine import brain
            conv_text = "\n".join([
                f"{'Student' if m['direction'] == 'inbound' else 'WaxPrep'}: {m['content']}"
                for m in msgs.data
            ])
            prompt = (
                f"Summarize this WaxPrep session in 2 sentences for the teacher's memory file. "
                f"Include: topic covered, student understanding level, any misconceptions, next step.\n\n"
                f"{conv_text[:3000]}"
            )
            try:
                summary = await brain._call_model(prompt)
                if not summary:
                    summary = "Session completed. Continue teaching from last topic."
            except Exception:
                summary = "Session completed. Continue teaching from last topic."

            self.db.table("conversations").update({
                "is_active": False,
                "ended_at": datetime.now(timezone.utc).isoformat(),
                "summary": summary,
            }).eq("id", conversation_id).execute()

            from waxprep.app.cache.redis import rdel
            await rdel(f"wax:session:{student_id}")
            await rdel(f"wax:episodic:{student_id}")

        except Exception as e:
            logger.warning(f"Session summarize failed: {e}")

conversation_manager = ConversationManager()
