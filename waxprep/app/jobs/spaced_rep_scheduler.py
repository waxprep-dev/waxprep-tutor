from loguru import logger
from waxprep.app.database.client import get_db_client

async def run_spaced_rep_scheduler():
    try:
        db = get_db_client()
        students = (
            db.table("students")
            .select("id, platform_whatsapp, platform_telegram, status")
            .eq("status", "active")
            .execute()
        )

        if not students.data:
            return

        from waxprep.app.memory.spaced_repetition import SpacedRepetitionEngine
        engine = SpacedRepetitionEngine()

        total_scheduled = 0
        for student in students.data:
            platform = "whatsapp" if student.get("platform_whatsapp") else "telegram"
            count = await engine.schedule_due_reviews(
                student_id=student["id"],
                platform=platform,
            )
            total_scheduled += count

        if total_scheduled > 0:
            logger.info(f"Spaced rep scheduler: scheduled {total_scheduled} review notifications")

    except Exception as e:
        logger.error(f"Spaced rep scheduler failed: {e}")
