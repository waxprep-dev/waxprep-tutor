from supabase import create_client, Client
from functools import lru_cache
from waxprep.app.core.config import settings
from loguru import logger

@lru_cache()
def get_db_client() -> Client:
    try:
        client = create_client(settings.supabase_url, settings.supabase_service_key)
        logger.info("Supabase database client initialized")
        return client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client: {e}")
        raise
