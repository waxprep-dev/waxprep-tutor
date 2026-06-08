from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from loguru import logger

_scheduler = AsyncIOScheduler()

def start_scheduler():
    from waxprep.app.jobs.session_closer import run_session_closer
    from waxprep.app.jobs.spaced_repetition import run_spaced_repetition
    from waxprep.app.jobs.memory_consolidation import run_memory_consolidation
    from waxprep.app.jobs.re_engagement import run_re_engagement
    from waxprep.app.jobs.dedup_cleanup import run_dedup_cleanup

    _scheduler.add_job(run_session_closer, trigger=IntervalTrigger(minutes=5), id="session_closer", replace_existing=True)
    _scheduler.add_job(run_spaced_repetition, trigger=CronTrigger(hour=8, minute=0), id="spaced_rep", replace_existing=True)
    _scheduler.add_job(run_memory_consolidation, trigger=CronTrigger(hour=3, minute=0), id="memory_consolidation", replace_existing=True)
    _scheduler.add_job(run_re_engagement, trigger=CronTrigger(hour=9, minute=0), id="re_engagement", replace_existing=True)
    _scheduler.add_job(run_dedup_cleanup, trigger=CronTrigger(hour=2, minute=0), id="dedup_cleanup", replace_existing=True)

    _scheduler.start()
    logger.info("All background jobs running")

def stop_scheduler():
    try:
        if _scheduler.running:
            _scheduler.shutdown(wait=False)
    except Exception:
        pass
