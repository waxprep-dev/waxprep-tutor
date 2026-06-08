from datetime import datetime, timezone
from loguru import logger
from waxprep.app.database.client import get_db

async def run_dedup_cleanup():
    try:
        db = get_db()
        now = datetime.now(timezone.utc).isoformat()
        db.table("message_dedup").delete().lt("expires_at", now).execute()
        logger.debug("Dedup cleanup complete")
    except Exception as e:
        logger.error(f"Dedup cleanup failed: {e}")
