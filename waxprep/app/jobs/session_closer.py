from loguru import logger

async def run_session_closer():
    try:
        from waxprep.app.conversation.manager import conversation_manager
        count = await conversation_manager.close_stale_sessions()
        if count > 0:
            logger.info(f"Closed {count} stale sessions")
    except Exception as e:
        logger.error(f"Session closer failed: {e}")
