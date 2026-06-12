"""
================================================================================
WAXPREP BRAIN v4.0 - SUPERNATURAL MEMORY ARCHITECTURE
AI-commanded Nigerian educational platform
================================================================================

UPGRADES FROM v3.0:
1. All __init__.py files for proper package structure
2. Memory system completely rebuilt with 24h TTLs
3. Intent detector uses correct memory keys
4. Context builder includes full 7-layer memory context
5. Engine has structured onboarding flow
6. All disconnected components are now connected
7. Generate explanations job is now scheduled
================================================================================
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from loguru import logger
import sys

from waxprep.app.database.client import get_db
from waxprep.app.cache.redis import get_redis
from waxprep.app.brain.engine import brain
from waxprep.app.jobs.scheduler import start_scheduler, stop_scheduler
from waxprep.app.api import webhook, admin

logger.remove()
logger.add(sys.stdout, format="{time:HH:mm:ss} | {level} | {message}", level="INFO")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("WaxPrep Brain v4.0 starting - Supernatural Memory Architecture")

    try:
        db = get_db()
        db.table("students").select("id").limit(1).execute()
        logger.info("Database ready")
    except Exception as e:
        logger.error(f"Database failed: {e}")

    try:
        r = await get_redis()
        if r:
            logger.info("Cache ready")
    except Exception as e:
        logger.warning(f"Cache unavailable: {e}")

    try:
        import httpx
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(brain.health_url)
            if resp.status_code == 200:
                logger.info("WaxPrep model is alive")
            else:
                logger.warning(f"Model health check returned {resp.status_code}")
    except Exception as e:
        logger.warning(f"Model health check failed: {e}")

    start_scheduler()
    logger.info("WaxPrep Brain v4.0 ready - The tutor that actually knows you.")

    yield

    stop_scheduler()
    logger.info("WaxPrep Brain stopped")

app = FastAPI(
    title="WaxPrep Brain v4.0",
    description="Supernatural Memory Architecture - AI-commanded Nigerian educational platform",
    version="4.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)

@app.exception_handler(Exception)
async def catch_all(request: Request, exc: Exception):
    logger.error(f"Unhandled: {request.url.path} — {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"error": "server error"})

app.include_router(webhook.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")

@app.get("/health")
async def health():
    return {"status": "alive", "version": "4.0.0", "architecture": "supernatural-memory"}

@app.head("/health")
async def health_head():
    return {}
