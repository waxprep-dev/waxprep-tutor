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
            .is_("review_session_id", "null")  # Only get concepts not already in review
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

                # Create a review conversation
                conv_result = db.table("conversations").insert({
                    "student_id": student_id,
                    "platform": "whatsapp",
                    "is_active": True,
                    "session_state": "review",
                }).execute()
                
                if not conv_result.data:
                    continue
                
                conv_id = conv_result.data[0]["id"]
                
                # Link concept to this review session
                db.table("knowledge_maps").update({
                    "review_session_id": conv_id,
                }).eq("student_id", student_id).eq("concept_id", top_concept["concept_id"]).execute()

                # Generate review question using AI
                prompt = (
                    f"Write a short review question for a Nigerian student about '{concept_name}' in {subject}. "
                    f"Their mastery is {mastery}%. "
                    f"Make it a direct question they can answer in one sentence. "
                    f"End with: 'Reply with your answer.' "
                    f"Be warm and Nigerian. No teaching, just the question."
                )

                message = await brain._call_model(prompt)
                if not message:
                    continue

                from waxprep.app.gateway import whatsapp
                await whatsapp.send_text(phone, message.strip())
                
                # Save as outbound message
                db.table("messages").insert({
                    "conversation_id": conv_id,
                    "student_id": student_id,
                    "direction": "outbound",
                    "content": message.strip(),
                    "message_type": "text",
                }).execute()
                
                sent += 1

            except Exception as e:
                logger.warning(f"Spaced rep failed for {student_id}: {e}")

        if sent > 0:
            logger.info(f"Spaced repetition: sent {sent} interactive review messages")

    except Exception as e:
        logger.error(f"Spaced repetition job failed: {e}")
