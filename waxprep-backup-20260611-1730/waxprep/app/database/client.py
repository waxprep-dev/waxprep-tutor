from supabase import create_client, Client
from functools import lru_cache
from loguru import logger
import os

@lru_cache()
def get_db() -> Client:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    client = create_client(url, key)
    logger.debug("Supabase client created")
    return client
