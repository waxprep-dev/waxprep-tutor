import json
from typing import Any, Optional
from loguru import logger

_redis_client = None

STUDENT_PROFILE_TTL = 600
KNOWLEDGE_MAP_TTL = 3600
DEDUP_TTL = 120

async def get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        import redis.asyncio as aioredis
        from waxprep.app.core.config import settings
        _redis_client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=3,
            socket_connect_timeout=3,
        )
        await _redis_client.ping()
        logger.info("Redis cache connected")
    except Exception as e:
        logger.warning(f"Redis unavailable, will use database only: {e}")
        _redis_client = None
    return _redis_client

async def cache_set(key: str, value: Any, ttl: int = 300) -> bool:
    try:
        r = await get_redis()
        if r is None:
            return False
        await r.setex(key, ttl, json.dumps(value, default=str))
        return True
    except Exception:
        return False

async def cache_get(key: str) -> Optional[Any]:
    try:
        r = await get_redis()
        if r is None:
            return None
        raw = await r.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None

async def cache_delete(key: str) -> bool:
    try:
        r = await get_redis()
        if r is None:
            return False
        await r.delete(key)
        return True
    except Exception:
        return False

async def cache_exists(key: str) -> bool:
    try:
        r = await get_redis()
        if r is None:
            return False
        return bool(await r.exists(key))
    except Exception:
        return False
