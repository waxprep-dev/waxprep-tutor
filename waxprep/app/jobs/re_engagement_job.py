from datetime import datetime, timedelta
from loguru import logger
from waxprep.app.database.client import get_db_client

async def run_re_engagement():
    try:
        db = get_db_client()
        five_days_ago = (datetime.utcnow() - timedelta(days=5)).isoformat()
        fourteen_days_ago = (datetime.utcnow() - timedelta(days=14)).isoformat()

        inactive_students = (
            db.table("students")
            .select("id, platform_whatsapp, platform_telegram, inferred_class_level, primary_exam_target")
            .eq("status", "active")
            .eq("onboarding_complete", True)
            .gte("last_active_at", fourteen_days_ago)
            .lt("last_active_at", five_days_ago)
            .execute()
        )

        if not inactive_students.data:
            return

        from groq import Groq
        from waxprep.app.core.config import settings
        client = Groq(api_key=settings.groq_api_key)

        sent = 0
        for student in inactive_students.data:
            try:
                already_pending = (
                    db.table("scheduled_notifications")
                    .select("id")
                    .eq("student_id", student["id"])
                    .eq("notification_type", "re_engagement")
                    .eq("status", "pending")
                    .execute()
                )
                if already_pending.data:
                    continue

                profile = (
                    db.table("student_profiles")
                    .select("student_name, current_subject, current_topic")
                    .eq("student_id", student["id"])
                    .execute()
                )

                name = "there"
                current_subject = None
                current_topic = None
                if profile.data:
                    p = profile.data[0]
                    name = p.get("student_name", "there") or "there"
                    current_subject = p.get("current_subject")
                    current_topic = p.get("current_topic")

                last_session = (
                    db.table("conversations")
                    .select("summary, ended_at")
                    .eq("student_id", student["id"])
                    .not_.is_("summary", "null")
                    .order("ended_at", desc=True)
                    .limit(1)
                    .execute()
                )

                summary_text = ""
                if last_session.data and last_session.data[0].get("summary"):
                    summary_text = last_session.data[0]["summary"][:300]

                topic_context = ""
                if current_topic and current_subject:
                    topic_context = f"They were working on {current_topic} in {current_subject}."
                elif current_subject:
                    topic_context = f"They were working on {current_subject}."

                days_away = (datetime.utcnow() - datetime.fromisoformat(
                    student['last_active_at'].replace('Z', '+00:00')
                )).days

                prompt = (
                    f"Write a short, natural 2-sentence re-engagement message from WaxPrep to a Nigerian student named {name}. "
                    f"They have been away for about {days_away} days. "
                    f"{topic_context} "
                    f"{'Last session summary: ' + summary_text if summary_text else ''} "
                    f"Do NOT say 'Welcome back' or 'I miss you' or anything robotic. "
                    f"Sound like a teacher who just thought of something to check with the student. "
                    f"End with a question that naturally invites them to resume studying. "
                    f"Message:"
                )

                r = client.chat.completions.create(
                    model=settings.groq_fast_model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=100,
                    temperature=0.7,
                )
                message = r.choices[0].message.content.strip()

                platform = "whatsapp" if student.get("platform_whatsapp") else "telegram"

                db.table("scheduled_notifications").insert({
                    "student_id": student["id"],
                    "notification_type": "re_engagement",
                    "scheduled_for": datetime.utcnow().isoformat(),
                    "platform": platform,
                    "content": message,
                    "status": "pending",
                }).execute()

                sent += 1

            except Exception as e:
                logger.warning(f"Re-engagement generation failed for {student['id']}: {e}")

        if sent > 0:
            logger.info(f"Re-engagement job: scheduled {sent} messages")

    except Exception as e:
        logger.error(f"Re-engagement job failed: {e}")
