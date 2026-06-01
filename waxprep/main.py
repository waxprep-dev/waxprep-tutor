from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from loguru import logger
import os
from waxprep.app.core.config import settings
from waxprep.app.core.logging import setup_logging
from waxprep.app.api.routes import webhooks, web_app, admin
from waxprep.app.database.client import get_db_client
from waxprep.app.jobs.scheduler import setup_scheduler, shutdown_scheduler

setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"WaxPrep {settings.app_version} starting in {settings.app_env} mode")
    try:
        db = get_db_client()
        db.table("students").select("id").limit(1).execute()
        logger.info("Database connection verified")
    except Exception as e:
        logger.error(f"Database connection failed on startup: {e}")

    try:
        setup_scheduler()
        logger.info("Background jobs started")
    except Exception as e:
        logger.error(f"Background jobs failed to start: {e}")

    logger.info("WaxPrep is ready")
    yield

    shutdown_scheduler()
    logger.info("WaxPrep shut down cleanly")

app = FastAPI(
    title="WaxPrep",
    description="AI teacher for Nigerian students",
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url=None,
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"status": "error", "message": "Internal server error"}
    )

static_dir = os.path.join(os.path.dirname(__file__), "app", "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

app.include_router(webhooks.router, prefix="/api/v1")
app.include_router(web_app.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "WaxPrep", "version": settings.app_version}

@app.head("/health")
async def health_head():
    return {}

@app.get("/")
async def root():
    return {"service": "WaxPrep", "status": "running", "version": settings.app_version}
