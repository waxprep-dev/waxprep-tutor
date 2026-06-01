from datetime import datetime, timedelta
from waxprep.app.cache.redis_client import cache_exists, cache_set, DEDUP_TTL
from waxprep.app.database.client import get_db_client
from loguru import logger

class DeduplicationCache:
    def __init__(self):
        self.db = get_db_client()

    async def is_duplicate(self, message_id: str) -> bool:
        key = f"wax:dedup:{message_id}"
        if await cache_exists(key):
            return True
        try:
            r = (
                self.db.table("message_dedup")
                .select("platform_message_id")
                .eq("platform_message_id", message_id)
                .execute()
            )
            return bool(r.data)
        except Exception:
            return False

    async def mark_processed(self, message_id: str) -> None:
        key = f"wax:dedup:{message_id}"
        await cache_set(key, True, DEDUP_TTL)
        try:
            expires = (datetime.utcnow() + timedelta(seconds=DEDUP_TTL + 60)).isoformat()
            self.db.table("message_dedup").insert({
                "platform_message_id": message_id,
                "expires_at": expires,
            }).execute()
        except Exception:
            pass
