from datetime import datetime, timedelta
from loguru import logger
from waxprep.app.database.client import get_db_client

async def run_streak_updater():
    try:
        db = get_db_client()
        yesterday = (datetime.utcnow() - timedelta(days=1)).isoformat()

        inactive_students = (
            db.table("students")
            .select("id")
            .eq("status", "active")
            .lt("last_active_at", yesterday)
            .execute()
        )

        if not inactive_students.data:
            return

        reset_count = 0
        for student in inactive_students.data:
            try:
                profile = (
                    db.table("student_profiles")
                    .select("study_streak_current")
                    .eq("student_id", student["id"])
                    .execute()
                )
                if profile.data and profile.data[0].get("study_streak_current", 0) > 0:
                    db.table("student_profiles").update({
                        "study_streak_current": 0,
                    }).eq("student_id", student["id"]).execute()
                    reset_count += 1
            except Exception:
                pass

        if reset_count > 0:
            logger.info(f"Streak updater: reset streaks for {reset_count} inactive students")

        active_today = (
            db.table("students")
            .select("id")
            .eq("status", "active")
            .gte("last_active_at", yesterday)
            .execute()
        )

        for student in (active_today.data or []):
            try:
                profile = (
                    db.table("student_profiles")
                    .select("study_streak_current, study_streak_max, last_studied_at")
                    .eq("student_id", student["id"])
                    .execute()
                )
                if not profile.data:
                    continue

                p = profile.data[0]
                new_streak = p.get("study_streak_current", 0) + 1
                new_max = max(new_streak, p.get("study_streak_max", 0))

                db.table("student_profiles").update({
                    "study_streak_current": new_streak,
                    "study_streak_max": new_max,
                    "last_studied_at": datetime.utcnow().isoformat(),
                }).eq("student_id", student["id"]).execute()
            except Exception:
                pass

    except Exception as e:
        logger.error(f"Streak updater failed: {e}")
