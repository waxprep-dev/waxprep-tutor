import asyncio
from datetime import datetime, timezone, timedelta
from loguru import logger
from waxprep.app.database.client import get_db
from waxprep.app.brain.engine import brain
from waxprep.app.brain.memory import memory

async def run_re_engagement():
    try:
        db = get_db()
        five_days_ago = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
        fourteen_days_ago = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        inactive = (
            db.table("students")
            .select("id, platform_whatsapp, last_active_at")
            .eq("status", "active")
            .eq("onboarding_complete", True)
            .gte("last_active_at", fourteen_days_ago)
            .lt("last_active_at", five_days_ago)
            .execute()
        )

        if not inactive.data:
            return

        tasks = [_send_one(student, db) for student in inactive.data]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        sent = sum(1 for r in results if r is True)
        if sent > 0:
            logger.info(f"Re-engagement: sent {sent} messages")

    except Exception as e:
        logger.error(f"Re-engagement job failed: {e}")

async def _send_one(student: dict, db) -> bool:
    student_id = student["id"]
    phone = student.get("platform_whatsapp", "")
    if not phone:
        return False
    try:
        layers = await memory.load_all(student_id)
        lt = layers.get("long_term", {})
        ep = layers.get("episodic", {})

        name = lt.get("student_name", "there")
        subject = lt.get("current_subject", "your studies")
        topic = lt.get("current_topic", "")
        days_away = 5
        if student.get("last_active_at"):
            try:
                last = datetime.fromisoformat(student["last_active_at"].replace("Z", "+00:00"))
                days_away = max(1, (datetime.now(timezone.utc) - last.astimezone(timezone.utc)).days)
            except Exception:
                pass

        prev_summary = ep.get("previous_session_summary", "")

        prompt = (
            f"Write a 2-sentence natural re-engagement message from WaxPrep to {name}. "
            f"They have been away for {days_away} days. Last studied: {subject}"
            f"{' — ' + topic if topic else ''}. "
            f"{'Previous session: ' + prev_summary[:200] if prev_summary else ''} "
            f"Do NOT say 'Welcome back', 'I miss you', or 'checking in'. "
            f"Sound like a teacher who genuinely thought of the student. "
            f"End with one engaging question about their topic. "
            f"Nigerian teacher voice. Warm."
        )

        message = await brain._call_model(prompt)
        if not message:
            return False

        from waxprep.app.gateway import whatsapp
        await whatsapp.send_text(phone, message.strip())
        return True

    except Exception as e:
        logger.warning(f"Re-engagement failed for {student_id}: {e}")
        return False
