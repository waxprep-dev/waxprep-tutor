from datetime import datetime, timezone
from loguru import logger
from waxprep.app.database.client import get_db
from waxprep.app.brain.ghost_teacher import (
    generate_evaluation_questions,
    evaluate_ghost_answer,
    should_send_nudge,
    generate_nudge_message,
)
from waxprep.app.brain.engine import brain
from waxprep.app.gateway import whatsapp

async def run_ghost_evaluator():
    """
    Check active study sessions:
    1. Send nudge if student inactive for 10+ minutes (only once)
    2. Send evaluation questions if session duration is up
    3. Evaluate student answers if they replied
    """
    try:
        db = get_db()
        
        # Get active study sessions
        sessions = (
            db.table("study_sessions")
            .select("id, student_id, material_topic, started_at, observation_notes")
            .eq("status", "active")
            .execute()
        )
        
        if not sessions.data:
            return
        
        for session in sessions.data:
            try:
                session_id = session["id"]
                student_id = session["student_id"]
                topic = session.get("material_topic", "general")
                started_at = session.get("started_at", "")
                
                # Get student phone
                student = db.table("students").select("platform_whatsapp").eq("id", student_id).execute()
                if not student.data:
                    continue
                phone = student.data[0].get("platform_whatsapp", "")
                if not phone:
                    continue
                
                # Check if nudge needed (10+ minutes, no reply)
                if should_send_nudge(started_at):
                    # Check if we already sent nudge
                    if not session.get("observation_notes") or "nudge_sent" not in session.get("observation_notes", ""):
                        nudge = generate_nudge_message()
                        await whatsapp.send_text(phone, nudge)
                        
                        # Mark nudge sent
                        notes = session.get("observation_notes", "") or ""
                        db.table("study_sessions").update({
                            "observation_notes": notes + " | nudge_sent",
                        }).eq("id", session_id).execute()
                        
                        logger.info(f"Ghost nudge sent: {student_id[:8]}")
                
                # Check if student has replied (ended study)
                # Look for messages from student after session started
                conv = db.table("conversations").select("id").eq("student_id", student_id).eq("is_active", True).order("started_at", desc=True).limit(1).execute()
                if conv.data:
                    conv_id = conv.data[0]["id"]
                    msgs = (
                        db.table("messages")
                        .select("direction, content")
                        .eq("conversation_id", conv_id)
                        .eq("direction", "inbound")
                        .order("timestamp", desc=True)
                        .limit(1)
                        .execute()
                    )
                    
                    if msgs.data:
                        last_msg_time = msgs.data[0].get("timestamp", "")
                        # If student sent message after study started, they might be done
                        if last_msg_time and last_msg_time > started_at:
                            # Check if message looks like "done" or "finished"
                            content = msgs.data[0].get("content", "").lower()
                            done_indicators = ["done", "finished", "completed", "i'm done", "i am done", "study over", "that's it"]
                            
                            if any(d in content for d in done_indicators):
                                # End session and send evaluation
                                await _send_evaluation(session_id, student_id, phone, topic)
                
            except Exception as e:
                logger.warning(f"Ghost evaluator failed for session {session_id[:8]}: {e}")
                
    except Exception as e:
        logger.error(f"Ghost evaluator job failed: {e}")

async def _send_evaluation(session_id: str, student_id: str, phone: str, topic: str):
    """
    End study session and send 3 evaluation questions.
    """
    try:
        db = get_db()
        
        # Get student's weak concepts for targeted questions
        weak = (
            db.table("knowledge_maps")
            .select("concept_id")
            .eq("student_id", student_id)
            .lt("mastery_score", 40)
            .limit(3)
            .execute()
        )
        weak_concepts = [k["concept_id"] for k in (weak.data or [])]
        
        # Generate questions
        questions = generate_evaluation_questions(topic, "general", weak_concepts)
        
        # End study session
        db.table("study_sessions").update({
            "status": "completed",
            "ended_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).execute()
        
        # Send evaluation message
        eval_msg = f"Study time done! Let's see what you learned about {topic}.\n\n"
        for i, q in enumerate(questions, 1):
            eval_msg += f"{i}. {q['question']}\n"
        
        eval_msg += "\nReply with your answers (1, 2, 3) and I'll evaluate them."
        
        await whatsapp.send_text(phone, eval_msg)
        
        # Save questions to ghost_evaluations table
        db.table("ghost_evaluations").insert({
            "session_id": session_id,
            "student_id": student_id,
            "questions": questions,
            "max_score": 3,
        }).execute()
        
        logger.info(f"Ghost evaluation sent: {student_id[:8]} | {topic}")
        
    except Exception as e:
        logger.error(f"Send evaluation failed: {e}")
