import json
from typing import Any, Optional
from loguru import logger

_redis_instance = None

async def get_redis():
    global _redis_instance
    if _redis_instance is not None:
        return _redis_instance
    try:
        import redis.asyncio as aioredis
        import os
        url = os.environ.get("REDIS_URL", "")
        if not url:
            return None
        _redis_instance = aioredis.from_url(
            url,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=3,
            socket_connect_timeout=3,
        )
        await _redis_instance.ping()
        return _redis_instance
    except Exception as e:
        logger.warning(f"Redis unavailable: {e}")
        _redis_instance = None
        return None

async def rset(key: str, value: Any, ttl: int = 300) -> bool:
    try:
        r = await get_redis()
        if r is None:
            return False
        await r.setex(key, ttl, json.dumps(value, default=str))
        return True
    except Exception:
        return False

async def rget(key: str) -> Optional[Any]:
    try:
        r = await get_redis()
        if r is None:
            return None
        raw = await r.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None

async def rdel(key: str) -> bool:
    try:
        r = await get_redis()
        if r is None:
            return False
        await r.delete(key)
        return True
    except Exception:
        return False

async def rexists(key: str) -> bool:
    try:
        r = await get_redis()
        if r is None:
            return False
        return bool(await r.exists(key))
    except Exception:
        return False

# NEW: Functions expected by memory.py v3.0
async def rget_json(key: str) -> Optional[Any]:
    """Get and parse JSON from Redis."""
    return await rget(key)

async def rset_json(key: str, value: Any, ttl: int = 300) -> bool:
    """Store JSON in Redis."""
    return await rset(key, value, ttl)
