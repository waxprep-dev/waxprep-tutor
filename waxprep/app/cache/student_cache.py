from typing import Optional, Dict, Any
from waxprep.app.cache.redis_client import cache_get, cache_set, cache_delete
from waxprep.app.database.client import get_db_client
from loguru import logger

def _profile_key(student_id: str) -> str:
    return f"wax:profile:{student_id}"

def _km_key(student_id: str) -> str:
    return f"wax:km:{student_id}"

class StudentCache:
    def __init__(self):
        self.db = get_db_client()

    async def get_student_profile(self, student_id: str) -> Optional[Dict[str, Any]]:
        cached = await cache_get(_profile_key(student_id))
        if cached is not None:
            return cached
        try:
            r = self.db.table("student_profiles").select("*").eq("student_id", student_id).execute()
            if r.data:
                await cache_set(_profile_key(student_id), r.data[0], 600)
                return r.data[0]
        except Exception as e:
            logger.error(f"Profile fetch error for {student_id}: {e}")
        return None

    async def update_student_profile(self, student_id: str, updates: Dict[str, Any]) -> None:
        try:
            self.db.table("student_profiles").update(updates).eq("student_id", student_id).execute()
            await cache_delete(_profile_key(student_id))
        except Exception as e:
            logger.error(f"Profile update error for {student_id}: {e}")

    async def get_knowledge_map(self, student_id: str) -> list:
        cached = await cache_get(_km_key(student_id))
        if cached is not None:
            return cached
        try:
            r = (
                self.db.table("knowledge_maps")
                .select("concept_id, subject, mastery_score, next_review_due_at")
                .eq("student_id", student_id)
                .order("mastery_score", desc=True)
                .limit(15)
                .execute()
            )
            data = r.data or []
            await cache_set(_km_key(student_id), data, 3600)
            return data
        except Exception as e:
            logger.error(f"Knowledge map fetch error for {student_id}: {e}")
            return []

    async def invalidate(self, student_id: str) -> None:
        await cache_delete(_profile_key(student_id))
        await cache_delete(_km_key(student_id))
