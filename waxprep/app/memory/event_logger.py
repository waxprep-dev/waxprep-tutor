import json
from typing import Dict, Any, Optional
from datetime import datetime
from loguru import logger
from waxprep.app.database.client import get_db_client

class LearningEventLogger:
    def __init__(self):
        self.db = get_db_client()

    async def log(
        self,
        student_id: str,
        event_type: str,
        session_id: str,
        concept_id: str = None,
        subject: str = None,
        details: Dict = None,
    ) -> None:
        try:
            self.db.table("learning_events").insert({
                "student_id": student_id,
                "event_type": event_type,
                "concept_id": concept_id,
                "subject": subject,
                "details": json.dumps(details or {}),
                "timestamp": datetime.utcnow().isoformat(),
                "session_id": session_id,
            }).execute()
        except Exception as e:
            logger.warning(f"Event log failed: {e}")

    async def log_message(
        self,
        student_id: str,
        session_id: str,
        intent: str,
        student_message: str,
        waxprep_response: str,
        subject: str = None,
    ) -> None:
        await self.log(
            student_id=student_id,
            event_type="message_exchange",
            session_id=session_id,
            subject=subject,
            details={
                "intent": intent,
                "student_preview": student_message[:100],
                "response_length": len(waxprep_response),
            },
        )

    async def log_session_started(
        self,
        student_id: str,
        session_id: str,
        is_returning: bool,
        days_since_last: int = 0,
    ) -> None:
        await self.log(
            student_id=student_id,
            event_type="session_started",
            session_id=session_id,
            details={
                "is_returning": is_returning,
                "days_since_last": days_since_last,
            },
        )

    async def log_emotional_moment(
        self,
        student_id: str,
        session_id: str,
        emotional_state: str,
        trigger: str,
    ) -> None:
        await self.log(
            student_id=student_id,
            event_type="emotional_moment",
            session_id=session_id,
            details={"emotional_state": emotional_state, "trigger": trigger[:200]},
        )
