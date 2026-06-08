from datetime import datetime, timezone
from loguru import logger
from waxprep.app.database.client import get_db
from waxprep.app.brain.engine import brain

async def run_spaced_repetition():
    try:
        db = get_db()
        now = datetime.now(timezone.utc).isoformat()
        due = (
            db.table("knowledge_maps")
            .select("student_id, concept_id, subject, mastery_score")
            .lte("next_review_due_at", now)
            .limit(100)
            .execute()
        )

        if not due.data:
            return

        student_concepts: dict = {}
        for item in due.data:
            sid = item["student_id"]
            if sid not in student_concepts:
                student_concepts[sid] = []
            student_concepts[sid].append(item)

        sent = 0
        for student_id, concepts in student_concepts.items():
            try:
                student = db.table("students").select("platform_whatsapp, status").eq("id", student_id).execute()
                if not student.data or student.data[0]["status"] != "active":
                    continue
                phone = student.data[0].get("platform_whatsapp", "")
                if not phone:
                    continue

                top_concept = concepts[0]
                concept_name = top_concept["concept_id"].replace("_", " ")
                subject = top_concept["subject"]
                mastery = int(top_concept["mastery_score"])

                prompt = (
                    f"Write a 2-sentence natural review message from WaxPrep to a student. "
                    f"Concept due for review: '{concept_name}' in {subject} (mastery: {mastery}%). "
                    f"Do NOT say 'scheduled review' or 'reminder'. "
                    f"Sound like a teacher who just thought of something. "
                    f"End with one simple recall question. Be warm and Nigerian."
                )

                message = await brain._call_model(prompt)
                if not message:
                    continue

                from waxprep.app.gateway import whatsapp
                await whatsapp.send_text(phone, message.strip())
                sent += 1

            except Exception as e:
                logger.warning(f"Spaced rep failed for {student_id}: {e}")

        if sent > 0:
            logger.info(f"Spaced repetition: sent {sent} review messages")

    except Exception as e:
        logger.error(f"Spaced repetition job failed: {e}")
