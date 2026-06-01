import json
from typing import List, Optional
from datetime import datetime
from loguru import logger
from waxprep.app.database.client import get_db_client

class MemoryArtifactWriter:
    def __init__(self):
        self.db = get_db_client()

    async def write(
        self,
        student_id: str,
        artifact_type: str,
        content: str,
        impact_score: float = 0.5,
    ) -> None:
        try:
            existing = (
                self.db.table("memory_artifacts")
                .select("id, access_count")
                .eq("student_id", student_id)
                .eq("artifact_type", artifact_type)
                .ilike("content", f"%{content[:40]}%")
                .eq("status", "active")
                .execute()
            )
            if existing.data:
                self.db.table("memory_artifacts").update({
                    "last_accessed_at": datetime.utcnow().isoformat(),
                    "access_count": existing.data[0]["access_count"] + 1,
                }).eq("id", existing.data[0]["id"]).execute()
                return

            self.db.table("memory_artifacts").insert({
                "student_id": student_id,
                "artifact_type": artifact_type,
                "content": content,
                "composite_score": 1.0,
                "impact_score": impact_score,
                "status": "active",
            }).execute()
        except Exception as e:
            logger.warning(f"Artifact write failed: {e}")

    async def write_personal_context(self, student_id: str, context: str) -> None:
        await self.write(student_id, "personal_context", context, impact_score=0.9)

    async def write_emotional_note(self, student_id: str, note: str) -> None:
        await self.write(student_id, "emotional_note", note, impact_score=0.85)

    async def get_context_string(self, student_id: str) -> str:
        try:
            r = (
                self.db.table("memory_artifacts")
                .select("content")
                .eq("student_id", student_id)
                .eq("status", "active")
                .order("composite_score", desc=True)
                .limit(6)
                .execute()
            )
            return " | ".join([a["content"] for a in (r.data or [])]) if r.data else ""
        except Exception as e:
            logger.error(f"Memory context build failed: {e}")
            return ""
