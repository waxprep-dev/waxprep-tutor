from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from loguru import logger

_scheduler = AsyncIOScheduler()

def setup_scheduler():
    from waxprep.app.jobs.session_closer import run_session_closer
    from waxprep.app.jobs.notification_dispatcher import run_notification_dispatcher
    from waxprep.app.jobs.spaced_rep_scheduler import run_spaced_rep_scheduler
    from waxprep.app.jobs.streak_updater import run_streak_updater
    from waxprep.app.jobs.re_engagement_job import run_re_engagement

    _scheduler.add_job(
        run_session_closer,
        trigger=IntervalTrigger(minutes=5),
        id="session_closer",
        replace_existing=True,
        name="Close inactive sessions every 5 minutes",
    )

    _scheduler.add_job(
        run_notification_dispatcher,
        trigger=IntervalTrigger(minutes=10),
        id="notification_dispatcher",
        replace_existing=True,
        name="Dispatch pending notifications every 10 minutes",
    )

    _scheduler.add_job(
        run_spaced_rep_scheduler,
        trigger=CronTrigger(hour=8, minute=0),
        id="spaced_rep_scheduler",
        replace_existing=True,
        name="Schedule spaced repetition reviews daily at 8am",
    )

    _scheduler.add_job(
        run_streak_updater,
        trigger=CronTrigger(hour=0, minute=0),
        id="streak_updater",
        replace_existing=True,
        name="Update study streaks at midnight",
    )

    _scheduler.add_job(
        run_re_engagement,
        trigger=CronTrigger(hour=9, minute=0),
        id="re_engagement",
        replace_existing=True,
        name="Re-engage inactive students at 9am",
    )

    _scheduler.start()
    logger.info("All background jobs scheduled and running")

def shutdown_scheduler():
    try:
        if _scheduler.running:
            _scheduler.shutdown(wait=False)
            logger.info("Background scheduler stopped")
    except Exception as e:
        logger.warning(f"Scheduler shutdown issue: {e}")
