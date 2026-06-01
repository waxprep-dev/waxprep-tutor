from loguru import logger
import sys
from waxprep.app.core.config import settings

def setup_logging():
    logger.remove()
    fmt = (
        "{time:YYYY-MM-DD HH:mm:ss} | "
        "{level: <8} | "
        "{name}:{line} | "
        "{message}"
    )
    logger.add(
        sys.stdout,
        format=fmt,
        level=settings.log_level,
        colorize=True,
        backtrace=True,
        diagnose=settings.debug,
    )
    return logger
