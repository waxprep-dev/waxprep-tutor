from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from loguru import logger
from waxprep.app.gateways.normalizer import NormalizedMessage
from waxprep.app.core.constants import Platform
from waxprep.app.conversation.history_manager import ConversationHistoryManager
from waxprep.app.ai.engine import WaxPrepAIEngine
from waxprep.app.ai.prompts import (
    build_teaching_prompt,
    build_knowledge_map_summary,
    build_assessment_feedback_prompt,
)
from waxprep.app.ai.subject_detector import detect_subject_and_topic
from waxprep.app.ai.frustration_detector import FrustrationDetector
from waxprep.app.ai.profile_extractor import ProfileIntelligenceExtractor
from waxprep.app.curriculum.navigator import CurriculumNavigator
from waxprep.app.core.time_awareness import (
    get_time_context_string,
    get_session_gap_context,
    format_exam_countdown,
)
from waxprep.app.database.client import get_db_client
from waxprep.app.cache.student_cache import StudentCache
from waxprep.app.memory.event_logger import LearningEventLogger
from waxprep.app.memory.artifact_writer import MemoryArtifactWriter
from waxprep.app.memory.session_summary import SessionSummaryGenerator
from waxprep.app.assessment.engine import AssessmentEngine
from waxprep.app.assessment.jamb_simulator import JAMBSimulator

history_manager = ConversationHistoryManager()
ai_engine = WaxPrepAIEngine()
event_logger = LearningEventLogger()
artifact_writer = MemoryArtifactWriter()
session_summary_gen = SessionSummaryGenerator()
profile_extractor = ProfileIntelligenceExtractor()
assessment_engine = AssessmentEngine()
jamb_simulator = JAMBSimulator()
frustration_detector = FrustrationDetector()
student_cache = StudentCache()
curriculum_navigator = CurriculumNavigator()

_web_msg_counts: Dict[str, int] = {}

async def dispatch_web_message(
    student_id: str,
    message_content: str,
) -> str:
    try:
        if not message_content or not message_content.strip():
            return "Please send a message."

        student = get_db_client().table("students").select("*").eq("id", student_id).execute()
        if not student.data:
            return "Student account not found. Please log in again."
        student = student.data[0]

        conversation = await history_manager.get_or_create_active_conversation(
            student_id=student_id,
            platform=Platform.WEB.value,
        )

        is_new_session = await _web_is_new_session(student_id)
        is_returning = student.get("session_count", 0) > 0

        msg_upper = message_content.strip().upper()

        if jamb_simulator.has_active_simulation(student_id) and msg_upper in ["A", "B", "C", "D"]:
            response = await jamb_simulator.process_answer(student_id=student_id, answer=msg_upper)
            if response:
                await history_manager.save_message(
                    conversation_id=conversation["id"],
                    student_id=student_id,
                    direction="inbound",
                    content=message_content,
                    message_type="text",
                )
                await history_manager.save_message(
                    conversation_id=conversation["id"],
                    student_id=student_id,
                    direction="outbound",
                    content=response,
                    message_type="teaching",
                    intent="assessment_response",
                )
                return response

        await history_manager.save_message(
            conversation_id=conversation["id"],
            student_id=student_id,
            direction="inbound",
            content=message_content,
            message_type="text",
        )

        conversation_history = await history_manager.get_history_for_ai(
            conversation_id=conversation["id"],
            limit=15,
        )

        recent_context = " | ".join([
            m["content"][:60] for m in conversation_history[-3:] if m["role"] == "user"
        ]) if conversation_history else ""

        intent = await ai_engine.classify_intent(message_content, recent_context)

        student_profile_data = await student_cache.get_student_profile(student_id)
        merged_student = {**student}
        if student_profile_data:
            merged_student["profile"] = student_profile_data

        detected_subject, detected_topic = detect_subject_and_topic(message_content)
        current_subject = student_profile_data.get("current_subject") if student_profile_data else None
        current_topic = student_profile_data.get("current_topic") if student_profile_data else None

        profile_updates = {}
        if detected_subject and detected_subject != current_subject:
            profile_updates["current_subject"] = detected_subject
            current_subject = detected_subject
        if detected_topic and detected_topic != current_topic:
            profile_updates["current_topic"] = detected_topic
            current_topic = detected_topic
        if profile_updates:
            await student_cache.update_student_profile(student_id, profile_updates)

        frustration_analysis = frustration_detector.analyze(
            student_id=student_id,
            message=message_content,
            intent=intent,
        )

        memory_context = await artifact_writer.get_context_string(student_id)
        knowledge_map_items = await student_cache.get_knowledge_map(student_id)
        km_summary = build_knowledge_map_summary(knowledge_map_items)

        active_misconceptions = []
        try:
            misc = get_db_client().table("misconceptions").select(
                "description, status, concept_id"
            ).eq("student_id", student_id).in_("status", ["active", "resolving"]).limit(5).execute()
            active_misconceptions = misc.data or []
        except Exception:
            pass

        previous_summary = None
        return_greeting = None
        if is_new_session and is_returning:
            previous_summary = await history_manager.get_previous_session_summary(student_id)
            if previous_summary:
                return_greeting = await session_summary_gen.generate_return_greeting(student_id)

        curriculum_context = ""
        if current_subject and current_topic:
            class_level = student.get("inferred_class_level", "SS1") or "SS1"
            curriculum_context = curriculum_navigator.get_topic_context(
                subject=current_subject,
                topic=current_topic,
                class_level=class_level,
            )

        time_ctx = get_time_context_string()
        gap_ctx = get_session_gap_context(student.get("last_active_at"))
        exam_ctx = format_exam_countdown(student.get("exam_date"))
        datetime_context = f"{time_ctx} {gap_ctx} {exam_ctx}".strip()

        assessment_context = None
        if assessment_engine.has_active_assessment(student_id) and intent in ["assessment_response", "unknown"]:
            evaluation = await assessment_engine.evaluate_answer(
                student_id=student_id,
                student_answer=message_content,
            )
            if evaluation:
                feedback_prompt = build_assessment_feedback_prompt(
                    question=evaluation.get("question", ""),
                    student_answer=message_content,
                    correct_answer=evaluation.get("correct_answer", ""),
                    subject=evaluation.get("subject", current_subject or ""),
                    concept=evaluation.get("concept", ""),
                    attempts=evaluation.get("attempts", 1),
                )
                response_text = await ai_engine.generate_from_prompt(feedback_prompt)
                await history_manager.save_message(
                    conversation_id=conversation["id"],
                    student_id=student_id,
                    direction="outbound",
                    content=response_text,
                    message_type="teaching",
                    intent="assessment_feedback",
                )
                if evaluation.get("is_correct"):
                    frustration_detector.record_success(student_id)
                return response_text

        jamb_triggers = ["jamb practice", "practice jamb", "past questions", "jamb simulation"]
        if any(t in message_content.lower() for t in jamb_triggers):
            name = student_profile_data.get("student_name", "there") if student_profile_data else "there"
            response_text = await jamb_simulator.start_simulation(
                student_id=student_id,
                subjects=["biology", "mathematics", "physics", "chemistry", "english"],
                questions_per_subject=3,
                student_name=name,
            )
            await history_manager.save_message(
                conversation_id=conversation["id"],
                student_id=student_id,
                direction="outbound",
                content=response_text,
                message_type="teaching",
                intent="jamb_sim_start",
            )
            return response_text

        _web_msg_counts[student_id] = _web_msg_counts.get(student_id, 0) + 1

        if (
            frustration_analysis.get("frustration_level", 0) < 2
            and _web_msg_counts.get(student_id, 0) >= 8
            and current_subject
            and current_topic
        ):
            _web_msg_counts[student_id] = 0
            difficulty = 2
            question_data = await assessment_engine.generate_question(
                student_id=student_id,
                subject=current_subject,
                concept=current_topic,
                class_level=student.get("inferred_class_level", "SS1") or "SS1",
                difficulty=difficulty,
                recent_context=recent_context,
            )
            if question_data:
                assessment_context = {
                    "current_question": question_data["question"],
                    "correct_answer": question_data["correct_answer"],
                    "attempts": 0,
                }

        system_prompt, messages = build_teaching_prompt(
            student_profile=merged_student,
            conversation_history=conversation_history[:-1],
            current_message=message_content,
            session_state=conversation.get("session_state", "teaching"),
            previous_session_summary=previous_summary,
            active_misconceptions=active_misconceptions,
            current_topic=current_topic,
            current_subject=current_subject,
            memory_context=memory_context if memory_context else None,
            knowledge_map_summary=km_summary if km_summary else None,
            curriculum_context=curriculum_context if curriculum_context else None,
            frustration_instruction=frustration_analysis.get("instruction") if frustration_analysis.get("instruction") else None,
            current_datetime=datetime_context,
            return_greeting=return_greeting,
            is_returning_student=is_new_session and is_returning and bool(previous_summary),
            assessment_context=assessment_context,
        )

        ai_result = await ai_engine.generate_response(system_prompt=system_prompt, messages=messages)
        response_text = ai_result["response"]

        await history_manager.save_message(
            conversation_id=conversation["id"],
            student_id=student_id,
            direction="outbound",
            content=response_text,
            message_type="teaching",
            intent=intent,
            metadata={"model_used": ai_result.get("model_used")},
        )

        if len(conversation_history) % 5 == 0 or len(conversation_history) <= 2:
            try:
                import asyncio
                asyncio.create_task(
                    profile_extractor.extract_and_update(
                        student_id=student_id,
                        conversation_history=conversation_history,
                    )
                )
            except Exception:
                pass

        try:
            get_db_client().table("students").update({
                "last_active_at": datetime.utcnow().isoformat(),
                "total_messages_received": student.get("total_messages_received", 0) + 1,
            }).eq("id", student_id).execute()
        except Exception:
            pass

        return response_text

    except Exception as e:
        logger.error(f"Web dispatch error for {student_id}: {e}", exc_info=True)
        return "I'm having a quick technical moment — please try again."

async def _web_is_new_session(student_id: str) -> bool:
    try:
        db = get_db_client()
        timeout = (datetime.utcnow() - timedelta(minutes=30)).isoformat()
        r = db.table("conversations").select("id").eq("student_id", student_id).eq("is_active", True).eq("platform", Platform.WEB.value).gte("last_message_at", timeout).execute()
        return not bool(r.data)
    except Exception:
        return False
