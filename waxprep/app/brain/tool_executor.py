"""
================================================================================
TOOL EXECUTOR v4.0 - CONNECTED TO MEMORY SYSTEM
================================================================================
Now properly connected with memory write-back for all state changes.
================================================================================
"""
import asyncio
from typing import Dict, Any, List
from datetime import datetime, timezone, timedelta
from loguru import logger

from waxprep.app.brain.tools import ToolCall, DATA_FETCH_TOOLS
from waxprep.app.brain.memory import memory
from waxprep.app.database.client import get_db
from waxprep.app.cache.redis import rdel

async def execute_all(
    student_id: str,
    tool_calls: List[ToolCall],
) -> Dict[str, Any]:
    results = {}
    for tool in tool_calls:
        try:
            result = await _execute(student_id, tool)
            if result is not None:
                results[tool.name] = result
        except Exception as e:
            logger.error(f"Tool execution failed [{tool.name}]: {e}")
    return results

async def _execute(student_id: str, tool: ToolCall) -> Any:
    db = get_db()
    p = tool.params
    name = tool.name

    if name == "update_level":
        level = p.get("level", "").upper()
        if level:
            db.table("students").update({"inferred_class_level": level}).eq("id", student_id).execute()
            await rdel(f"wax:pm:{student_id}")
            await rdel(f"wax:cm:{student_id}")
        return None

    if name == "update_subject":
        subject = p.get("subject", "").lower().replace(" ", "_")
        if subject:
            db.table("student_profiles").update({"current_subject": subject}).eq("student_id", student_id).execute()
            await rdel(f"wax:pm:{student_id}")
            await rdel(f"wax:cm:{student_id}")
        return None

    if name == "update_topic":
        topic = p.get("topic", "").lower().replace("_", " ")
        if topic:
            db.table("student_profiles").update({"current_topic": topic}).eq("student_id", student_id).execute()
            await rdel(f"wax:pm:{student_id}")
        return None

    if name == "update_exam_target":
        exam = p.get("exam", "").upper()
        if exam:
            db.table("students").update({"primary_exam_target": exam}).eq("id", student_id).execute()
            await rdel(f"wax:cm:{student_id}")
        return None

    if name == "update_name":
        student_name = p.get("name", "")
        if student_name:
            db.table("student_profiles").update({"student_name": student_name}).eq("student_id", student_id).execute()
            await rdel(f"wax:pm:{student_id}")
            await rdel(f"wax:cm:{student_id}")
        return None

    if name == "update_emotional_state":
        state = p.get("state", "neutral")
        db.table("student_profiles").update({"emotional_state_current": state}).eq("student_id", student_id).execute()
        await rdel(f"wax:pm:{student_id}")
        return None

    if name == "save_mastery":
        concept = p.get("concept", "")
        subject = p.get("subject", "general")
        score_str = p.get("score", "0.7")
        if concept:
            try:
                await memory.update_knowledge_map(student_id, concept, subject, float(score_str))
            except Exception as e:
                logger.warning(f"save_mastery failed: {e}")
        return None

    if name == "save_misconception":
        concept = p.get("concept", "")
        subject = p.get("subject", "general")
        description = p.get("description", "")
        if concept and description:
            code = concept.lower().replace(" ", "_") + "_misc"
            existing = db.table("misconceptions").select("id").eq("student_id", student_id).eq("misconception_code", code).execute()
            if not existing.data:
                db.table("misconceptions").insert({
                    "student_id": student_id,
                    "subject": subject,
                    "concept_id": concept.lower().replace(" ", "_"),
                    "misconception_code": code,
                    "description": description,
                    "status": "active",
                }).execute()
        return None

    if name == "resolve_misconception":
        concept = p.get("concept", "")
        if concept:
            code = concept.lower().replace(" ", "_") + "_misc"
            db.table("misconceptions").update({"status": "resolved"}).eq("student_id", student_id).eq("misconception_code", code).execute()
        return None

    if name == "save_episodic":
        await memory.save_episodic_memory(
            student_id=student_id,
            memory_type=p.get("type", "general"),
            description=p.get("description", ""),
            subject=p.get("subject", ""),
            emotion=p.get("emotion", "neutral"),
        )
        return None

    if name == "schedule_review":
        concept = p.get("concept", "")
        days_str = p.get("days", "3")
        if concept:
            try:
                days = int(days_str)
                next_review = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
                concept_id = concept.lower().replace(" ", "_")
                db.table("knowledge_maps").update({"next_review_due_at": next_review}).eq("student_id", student_id).eq("concept_id", concept_id).execute()
                await rdel(f"wax:profile:{student_id}")
            except Exception:
                pass
        return None

    if name == "update_dna":
        field = p.get("field", "")
        value = p.get("value", "")
        if field and value:
            db_field_map = {
                "example_preference": "example_preference",
                "explanation_depth": "explanation_depth",
                "frustration_threshold": "frustration_threshold",
                "pidgin_comfort": "pidgin_preference",
                "response_length": "response_length_pref",
                "study_peak_hour": "study_peak_hour",
            }
            db_field = db_field_map.get(field)
            if db_field:
                try:
                    typed_value = int(value) if field == "frustration_threshold" else value
                    db.table("student_profiles").update({db_field: typed_value}).eq("student_id", student_id).execute()
                    await rdel(f"wax:pm:{student_id}")
                    await rdel(f"wax:cm:{student_id}")
                except Exception as e:
                    logger.warning(f"DNA update failed: {e}")
        return None

    if name == "set_exam_date":
        date_str = p.get("date", "")
        if date_str:
            db.table("students").update({"exam_date": date_str}).eq("id", student_id).execute()
            await rdel(f"wax:cm:{student_id}")
        return None

    if name == "set_parent_phone":
        phone = p.get("phone", "")
        if phone:
            db.table("student_profiles").update({"parent_phone": phone}).eq("student_id", student_id).execute()
        return None

    if name == "update_socratic_pressure":
        score_str = p.get("score", "5")
        reason = p.get("reason", "")
        try:
            score = float(score_str)
            score = max(0.0, min(10.0, score))
            db.table("student_profiles").update({"socratic_pressure_score": score}).eq("student_id", student_id).execute()
            await rdel(f"wax:pm:{student_id}")
            logger.info(f"Socratic pressure updated: {student_id[:8]} -> {score} ({reason})")
        except Exception as e:
            logger.warning(f"update_socratic_pressure failed: {e}")
        return None

    if name == "update_teaching_concept":
        concept = p.get("concept", "")
        if concept:
            try:
                conv = db.table("conversations").select("id").eq("student_id", student_id).eq("is_active", True).order("started_at", desc=True).limit(1).execute()
                if conv.data:
                    conv_id = conv.data[0]["id"]
                    db.table("conversations").update({"last_teaching_concept": concept}).eq("id", conv_id).execute()
            except Exception as e:
                logger.warning(f"update_teaching_concept failed: {e}")
        return None

    if name == "mark_teaching_moment":
        concept = p.get("concept", "")
        depth = p.get("depth", "general")
        if concept:
            await memory.save_episodic_memory(
                student_id=student_id,
                memory_type="teaching_moment",
                description=f"Taught {concept} with depth: {depth}",
                subject=p.get("subject", ""),
                emotion="neutral",
            )
        return None

    if name == "get_theory_question":
        subject = p.get("subject", "")
        topic = p.get("topic", "")
        try:
            query = db.table("waec_theory_questions").select("id, question_text, marks, marking_scheme").eq("subject", subject)
            if topic:
                query = query.eq("topic", topic)
            question = query.order("difficulty", desc=False).limit(1).execute()
            if not question.data:
                return f"No theory questions found for {subject} {topic}."
            q = question.data[0]
            marks = q["marks"]
            return f"Theory Question ({marks} marks): {q['question_text']}\n\n[Submit your answer when ready. Question ID: {q['id']}]"
        except Exception as e:
            return f"Could not fetch theory question: {e}"

    if name == "submit_theory_answer":
        question_id = p.get("question_id", "")
        answer = p.get("answer", "")
        if question_id and answer:
            try:
                q = db.table("waec_theory_questions").select("marks, marking_scheme").eq("id", question_id).execute()
                if not q.data:
                    return "Question not found."
                max_score = q.data[0]["marks"]
                db.table("theory_submissions").insert({
                    "student_id": student_id,
                    "question_id": question_id,
                    "answer_text": answer,
                    "max_score": max_score,
                }).execute()
                return f"Answer submitted ({max_score} marks possible). Evaluation coming..."
            except Exception as e:
                return f"Submit failed: {e}"
        return None

    if name == "start_study_session":
        topic = p.get("topic", "")
        duration = p.get("duration", "20")
        try:
            result = db.table("study_sessions").insert({
                "student_id": student_id,
                "material_topic": topic,
                "status": "active",
            }).execute()
            session_id = result.data[0]["id"] if result.data else "unknown"
            return f"Study session started. ID: {session_id}. Study for {duration} minutes."
        except Exception as e:
            return f"Could not start study session: {e}"

    if name == "end_study_session":
        session_id = p.get("session_id", "")
        status = p.get("status", "completed")
        if session_id:
            try:
                db.table("study_sessions").update({
                    "status": status,
                    "ended_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", session_id).eq("student_id", student_id).execute()
                return f"Study session ended. Status: {status}."
            except Exception as e:
                return f"Could not end study session: {e}"
        return None

    if name == "get_performance":
        subject = p.get("subject", "")
        days = int(p.get("days", "7"))
        try:
            since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            km = db.table("knowledge_maps").select("concept_id, mastery_score, last_assessed_at").eq("student_id", student_id).eq("subject", subject).gte("last_assessed_at", since).execute()
            if not km.data:
                return f"No {subject} assessment data found in the last {days} days."
            summary = ", ".join([f"{k['concept_id'].replace('_', ' ')}: {int(k['mastery_score'])}%" for k in km.data[:5]])
            return f"Recent {subject} performance: {summary}"
        except Exception as e:
            return f"Could not fetch performance data: {e}"

    if name == "get_weak_topics":
        subject = p.get("subject", "")
        try:
            km = db.table("knowledge_maps").select("concept_id, mastery_score").eq("student_id", student_id).eq("subject", subject).lt("mastery_score", 50).order("mastery_score", desc=False).limit(5).execute()
            if not km.data:
                return f"No weak topics found in {subject}. Good foundation!"
            topics = ", ".join([f"{k['concept_id'].replace('_', ' ')} ({int(k['mastery_score'])}%)" for k in km.data])
            return f"Weak topics in {subject}: {topics}"
        except Exception as e:
            return f"Could not fetch weak topics: {e}"

    if name == "get_knowledge_map":
        subject = p.get("subject", "")
        try:
            query = db.table("knowledge_maps").select("concept_id, mastery_score, subject").eq("student_id", student_id)
            if subject:
                query = query.eq("subject", subject)
            km = query.order("mastery_score", desc=True).limit(10).execute()
            if not km.data:
                return "No knowledge map data yet."
            strong = [k for k in km.data if k["mastery_score"] >= 70]
            weak = [k for k in km.data if k["mastery_score"] < 40]
            return f"Strong: {', '.join(k['concept_id'].replace('_',' ') for k in strong[:4])}. Needs work: {', '.join(k['concept_id'].replace('_',' ') for k in weak[:4])}."
        except Exception as e:
            return f"Could not fetch knowledge map: {e}"

    if name == "check_prerequisites":
        topic = p.get("topic", "")
        subject = p.get("subject", "")
        return f"Checking prerequisites for {topic} in {subject}. Teach foundational concepts if needed."

    if name == "get_past_questions":
        subject = p.get("subject", "")
        topic = p.get("topic", "")
        count_str = p.get("count", "3")
        try:
            count = int(count_str)
            query = db.table("jamb_questions").select("question_text, option_a, option_b, option_c, option_d, correct_option, explanation").eq("subject", subject)
            if topic:
                query = query.eq("topic", topic)
            questions = query.limit(count).execute()
            if not questions.data:
                return f"No stored questions for {subject} {topic}. Generate one from your knowledge."
            formatted = []
            for i, q in enumerate(questions.data[:count]):
                formatted.append(f"Q{i+1}: {q['question_text']}\nA) {q['option_a']} B) {q['option_b']} C) {q['option_c']} D) {q['option_d']}\nAnswer: {q['correct_option']}")
            return "\n\n".join(formatted)
        except Exception as e:
            return f"Could not fetch questions: {e}"

    if name == "get_session_history":
        days = int(p.get("days", "7"))
        try:
            since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            sessions = db.table("conversations").select("summary, ended_at").eq("student_id", student_id).gte("started_at", since).not_.is_("summary", "null").order("ended_at", desc=True).limit(5).execute()
            if not sessions.data:
                return f"No sessions found in the last {days} days."
            summaries = [s["summary"][:100] for s in sessions.data if s.get("summary")]
            return f"Recent sessions: {' | '.join(summaries)}"
        except Exception as e:
            return f"Could not fetch session history: {e}"

    logger.warning(f"Unknown tool: {name}")
    return None
