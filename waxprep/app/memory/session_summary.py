import json
from typing import Optional
from datetime import datetime, timedelta
from loguru import logger
from groq import Groq
from waxprep.app.core.config import settings
from waxprep.app.database.client import get_db_client

SUMMARY_PROMPT = """Summarize this WaxPrep teaching session in one concise paragraph for the teacher's memory file. Include: topics covered, what the student understood well, what confused them, emotional state, any personal context shared, and what would be the natural next step. This summary will be read before the next session.
Conversation:
"""

GREETING_PROMPT = """Generate a natural 2-sentence return greeting from WaxPrep to this student. Do NOT say "Welcome back" or "I'm glad you're back." Reference what they were working on naturally, like a teacher who remembers. End with a question reconnecting to the last topic.
Student name: {name}
Days away: {days}
Last session summary: {summary}
Greeting:"""

class SessionSummaryGenerator:
    def __init__(self):
        self.groq = Groq(api_key=settings.groq_api_key)
        self.db = get_db_client()

    async def generate_and_save_summary(
        self,
        conversation_id: str,
        student_id: str,
    ) -> Optional[str]:
        try:
            r = (
                self.db.table("messages")
                .select("direction, content")
                .eq("conversation_id", conversation_id)
                .order("timestamp", desc=False)
                .execute()
            )
            if not r.data or len(r.data) < 3:
                return None

            conv_text = "\n".join([
                f"{'Student' if m['direction'] == 'inbound' else 'WaxPrep'}: {m['content']}"
                for m in r.data
            ])
            prompt = SUMMARY_PROMPT + conv_text[:6000]
            response = self.groq.chat.completions.create(
                model=settings.groq_fast_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
                temperature=0.3,
            )
            summary = response.choices[0].message.content.strip()

            self.db.table("conversations").update({
                "summary": summary,
                "is_active": False,
                "ended_at": datetime.utcnow().isoformat(),
            }).eq("id", conversation_id).execute()

            return summary
        except Exception as e:
            logger.error(f"Summary generation failed: {e}")
            return None

    async def generate_return_greeting(self, student_id: str) -> Optional[str]:
        try:
            profile = self.db.table("student_profiles").select("student_name").eq("student_id", student_id).execute()
            name = profile.data[0].get("student_name", "there") if profile.data else "there"

            summary_r = (
                self.db.table("conversations")
                .select("summary, ended_at")
                .eq("student_id", student_id)
                .eq("is_active", False)
                .not_.is_("summary", "null")
                .order("ended_at", desc=True)
                .limit(1)
                .execute()
            )
            if not summary_r.data or not summary_r.data[0].get("summary"):
                return None

            last = summary_r.data[0]
            days = 0
            if last.get("ended_at"):
                try:
                    ended = datetime.fromisoformat(last["ended_at"].replace("Z", "+00:00"))
                    days = (datetime.utcnow().replace(tzinfo=ended.tzinfo) - ended).days
                except Exception:
                    days = 1

            prompt = GREETING_PROMPT.format(
                name=name,
                days=days,
                summary=last["summary"][:500],
            )
            response = self.groq.chat.completions.create(
                model=settings.groq_fast_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=100,
                temperature=0.7,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Return greeting failed: {e}")
            return None

    async def close_inactive_sessions(self) -> int:
        try:
            timeout = (datetime.utcnow() - timedelta(minutes=settings.session_timeout_minutes)).isoformat()
            stale = (
                self.db.table("conversations")
                .select("id, student_id")
                .eq("is_active", True)
                .lt("last_message_at", timeout)
                .execute()
            )
            count = 0
            for s in (stale.data or []):
                await self.generate_and_save_summary(s["id"], s["student_id"])
                count += 1
            return count
        except Exception as e:
            logger.error(f"Close inactive sessions failed: {e}")
            return 0
