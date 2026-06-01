from loguru import logger

async def run_session_closer():
    try:
        from waxprep.app.memory.session_summary import SessionSummaryGenerator
        generator = SessionSummaryGenerator()
        count = await generator.close_inactive_sessions()
        if count > 0:
            logger.info(f"Session closer: closed {count} inactive sessions")
    except Exception as e:
        logger.error(f"Session closer failed: {e}")
