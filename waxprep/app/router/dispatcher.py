import json
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from loguru import logger
from waxprep.app.gateways.normalizer import NormalizedMessage
from waxprep.app.identity.manager import IdentityManager
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
from waxprep.app.core.constants import Platform, MessageDirection, MessageType
from waxprep.app.core.time_awareness import (
    get_time_context_string,
    get_session_gap_context,
    format_exam_countdown,
)
from waxprep.app.curriculum.navigator import CurriculumNavigator
from waxprep.app.database.client import get_db_client
from waxprep.app.cache.student_cache import StudentCache
from waxprep.app.cache.dedup_cache import DeduplicationCache
from waxprep.app.memory.event_logger import LearningEventLogger
from waxprep.app.memory.artifact_writer import MemoryArtifactWriter
from waxprep.app.memory.session_summary import SessionSummaryGenerator
from waxprep.app.memory.spaced_repetition import SpacedRepetitionEngine
from waxprep.app.assessment.engine import AssessmentEngine
from waxprep.app.assessment.jamb_simulator import JAMBSimulator

identity_manager = IdentityManager()
history_manager = ConversationHistoryManager()
ai_engine = WaxPrepAIEngine()
event_logger = LearningEventLogger()
artifact_writer = MemoryArtifactWriter()
session_summary_gen = SessionSummaryGenerator()
spaced_rep = SpacedRepetitionEngine()
profile_extractor = ProfileIntelligenceExtractor()
assessment_engine = AssessmentEngine()
jamb_simulator = JAMBSimulator()
frustration_detector = FrustrationDetector()
student_cache = StudentCache()
dedup_cache = DeduplicationCache()
curriculum_navigator = CurriculumNavigator()

_message_counts: Dict[str, int] = {}

async def dispatch_message(normalized_message: NormalizedMessage) -> None:
    try:
        if await dedup_cache.is_duplicate(normalized_message.platform_message_id):
            logger.debug(f"Duplicate message ignored: {normalized_message.platform_message_id}")
            return
        await dedup_cache.mark_processed(normalized_message.platform_message_id)

        if normalized_message.is_voice and normalized_message.media_url:
            try:
                from waxprep.app.gateways.whatsapp.voice_transcriber import VoiceTranscriber
                t = VoiceTranscriber()
                text = await t.transcribe_whatsapp_audio(normalized_message.media_url)
                if text and len(text.strip()) > 3:
                    normalized_message.content = text
                    normalized_message.is_voice = False
                    logger.info(f"Voice transcribed: {text[:60]}")
                else:
                    normalized_message.content = "I sent a voice note."
            except Exception as e:
                logger.warning(f"Voice transcription error: {e}")
                normalized_message.content = "I sent a voice note."

        if not normalized_message.content or not normalized_message.content.strip():
            return

        student = await identity_manager.get_or_create_student(
            platform=normalized_message.platform,
            platform_user_id=normalized_message.platform_user_id,
        )

        conversation = await history_manager.get_or_create_active_conversation(
            student_id=student["id"],
            platform=normalized_message.platform.value,
        )

        is_new_session = await _is_new_session(student["id"], normalized_message.platform.value)
        is_returning = student.get("session_count", 0) > 0

        await _mark_read(normalized_message)

        msg_upper = normalized_message.content.strip().upper()

        if jamb_simulator.has_active_simulation(student["id"]) and msg_upper in ["A", "B", "C", "D"]:
            response_text = await jamb_simulator.process_answer(
                student_id=student["id"],
                answer=msg_upper,
            )
            if response_text:
                await _send_and_log(normalized_message, student, conversation, response_text, "assessment_response", "jamb_sim")
                return

        await history_manager.save_message(
            conversation_id=conversation["id"],
            student_id=student["id"],
            direction=MessageDirection.INBOUND.value,
            content=normalized_message.content,
            message_type=normalized_message.message_type,
            platform_message_id=normalized_message.platform_message_id,
        )

        conversation_history = await history_manager.get_history_for_ai(
            conversation_id=conversation["id"],
            limit=15,
        )

        recent_context = " | ".join([
            m["content"][:60]
            for m in conversation_history[-3:]
            if m["role"] == "user"
        ]) if conversation_history else ""

        intent = await ai_engine.classify_intent(
            normalized_message.content,
            recent_context,
        )

        student_profile_data = await student_cache.get_student_profile(student["id"])
        merged_student = {**student}
        if student_profile_data:
            merged_student["profile"] = student_profile_data

        detected_subject, detected_topic = detect_subject_and_topic(normalized_message.content)
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
            await student_cache.update_student_profile(student["id"], profile_updates)
            if student_profile_data:
                student_profile_data.update(profile_updates)

        frustration_analysis = frustration_detector.analyze(
            student_id=student["id"],
            message=normalized_message.content,
            intent=intent,
        )

        memory_context = await artifact_writer.get_context_string(student["id"])
        knowledge_map_items = await student_cache.get_knowledge_map(student["id"])
        km_summary = build_knowledge_map_summary(knowledge_map_items)

        active_misconceptions = []
        try:
            misc = (
                get_db_client()
                .table("misconceptions")
                .select("description, status, concept_id, subject")
                .eq("student_id", student["id"])
                .in_("status", ["active", "resolving"])
                .limit(5)
                .execute()
            )
            active_misconceptions = misc.data or []
        except Exception:
            pass

        previous_summary = None
        return_greeting = None
        if is_new_session and is_returning:
            previous_summary = await history_manager.get_previous_session_summary(student["id"])
            if previous_summary:
                return_greeting = await session_summary_gen.generate_return_greeting(student["id"])

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
        datetime_context = time_ctx
        if gap_ctx:
            datetime_context += " " + gap_ctx
        if exam_ctx:
            datetime_context += " " + exam_ctx

        assessment_context = None
        if assessment_engine.has_active_assessment(student["id"]) and intent in ["assessment_response", "unknown"]:
            evaluation = await assessment_engine.evaluate_answer(
                student_id=student["id"],
                student_answer=normalized_message.content,
            )
            if evaluation:
                feedback_prompt = build_assessment_feedback_prompt(
                    question=evaluation.get("question", ""),
                    student_answer=normalized_message.content,
                    correct_answer=evaluation.get("correct_answer", ""),
                    subject=evaluation.get("subject", current_subject or ""),
                    concept=evaluation.get("concept", ""),
                    attempts=evaluation.get("attempts", 1),
                )
                response_text = await ai_engine.generate_from_prompt(feedback_prompt)
                await _send_and_log(normalized_message, student, conversation, response_text, intent, "assessment_feedback")
                if evaluation.get("is_correct"):
                    frustration_detector.record_success(student["id"])
                    await spaced_rep.update_after_review(
                        student_id=student["id"],
                        concept_id=evaluation.get("concept", "").lower().replace(" ", "_"),
                        performance_score=evaluation.get("score", 0.8),
                    )
                return

        jamb_triggers = [
            "jamb practice", "practice jamb", "jamb simulation",
            "mock jamb", "past questions", "jamb test",
        ]
        if any(t in normalized_message.content.lower() for t in jamb_triggers):
            name = student_profile_data.get("student_name", "there") if student_profile_data else "there"
            response_text = await jamb_simulator.start_simulation(
                student_id=student["id"],
                subjects=["biology", "mathematics", "physics", "chemistry", "english"],
                questions_per_subject=3,
                student_name=name,
            )
            await _send_and_log(normalized_message, student, conversation, response_text, intent, "jamb_sim_start")
            return

        _message_counts[student["id"]] = _message_counts.get(student["id"], 0) + 1

        if (
            frustration_analysis.get("frustration_level", 0) < 2
            and _message_counts.get(student["id"], 0) >= 8
            and current_subject
            and current_topic
        ):
            _message_counts[student["id"]] = 0
            difficulty = 2
            try:
                km_for_topic = [k for k in knowledge_map_items if k.get("concept_id") == current_topic.lower().replace(" ", "_")]
                if km_for_topic:
                    ms = km_for_topic[0]["mastery_score"]
                    difficulty = 4 if ms >= 70 else 3 if ms >= 50 else 2 if ms >= 30 else 1
            except Exception:
                pass

            question_data = await assessment_engine.generate_question(
                student_id=student["id"],
                subject=current_subject,
                concept=current_topic,
                class_level=student.get("inferred_class_level", "SS1") or "SS1",
                difficulty=difficulty,
                misconceptions=[m.get("description", "") for m in active_misconceptions if m.get("status") == "active"],
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
            current_message=normalized_message.content,
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

        await _send_and_log(
            normalized_message, student, conversation,
            response_text, intent, ai_result.get("model_used", "unknown"),
        )

        if len(conversation_history) % 5 == 0 or len(conversation_history) <= 2:
            try:
                import asyncio
                asyncio.create_task(
                    profile_extractor.extract_and_update(
                        student_id=student["id"],
                        conversation_history=conversation_history,
                    )
                )
            except Exception:
                pass

        if intent in ["emotional"]:
            await _handle_emotional(student["id"], conversation["id"], normalized_message.content)

        await _update_student(student["id"], student, conversation["id"])

        if is_new_session:
            days = await _days_since_last(student["id"])
            await event_logger.log_session_started(
                student_id=student["id"],
                session_id=conversation["id"],
                is_returning=is_returning,
                days_since_last=days,
            )

        logger.info(
            f"Dispatched: {student['wax_code']} | {intent} | "
            f"{ai_result.get('model_used', '?')} | "
            f"{ai_result.get('processing_time_ms', 0)}ms | "
            f"F:{frustration_analysis.get('frustration_level', 0)}"
        )

    except Exception as e:
        logger.error(f"Dispatch error for {normalized_message.platform_user_id}: {e}", exc_info=True)
        await _send_error(normalized_message)

async def _send_and_log(
    normalized_message: NormalizedMessage,
    student: Dict[str, Any],
    conversation: Dict[str, Any],
    text: str,
    intent: str,
    model: str,
) -> None:
    await _send_platform(normalized_message.platform, normalized_message.platform_user_id, text)
    await history_manager.save_message(
        conversation_id=conversation["id"],
        student_id=student["id"],
        direction=MessageDirection.OUTBOUND.value,
        content=text,
        message_type=MessageType.TEACHING.value,
        intent=intent,
        metadata={"model_used": model},
    )
    await event_logger.log_message(
        student_id=student["id"],
        session_id=conversation["id"],
        intent=intent,
        student_message=normalized_message.content,
        waxprep_response=text,
    )

async def _send_platform(platform: Platform, user_id: str, text: str) -> None:
    try:
        if platform == Platform.WHATSAPP:
            from waxprep.app.gateways.whatsapp.sender import WhatsAppSender
            await WhatsAppSender().send_text(user_id, text)
        elif platform == Platform.TELEGRAM:
            from waxprep.app.gateways.telegram.sender import TelegramSender
            await TelegramSender().send_text(user_id, text)
    except Exception as e:
        logger.error(f"Platform send failed for {user_id}: {e}")

async def _is_new_session(student_id: str, platform: str) -> bool:
    try:
        db = get_db_client()
        timeout = (datetime.utcnow() - timedelta(minutes=30)).isoformat()
        r = (
            db.table("conversations")
            .select("id")
            .eq("student_id", student_id)
            .eq("is_active", True)
            .eq("platform", platform)
            .gte("last_message_at", timeout)
            .execute()
        )
        return not bool(r.data)
    except Exception:
        return False

async def _days_since_last(student_id: str) -> int:
    try:
        db = get_db_client()
        r = (
            db.table("conversations")
            .select("ended_at")
            .eq("student_id", student_id)
            .eq("is_active", False)
            .order("ended_at", desc=True)
            .limit(1)
            .execute()
        )
        if r.data and r.data[0].get("ended_at"):
            ended = datetime.fromisoformat(r.data[0]["ended_at"].replace("Z", "+00:00"))
            return max(0, (datetime.utcnow().replace(tzinfo=ended.tzinfo) - ended).days)
        return 0
    except Exception:
        return 0

async def _handle_emotional(student_id: str, session_id: str, message: str) -> None:
    try:
        msg_lower = message.lower()
        state = "emotional_expression"
        for s, keywords in {
            "frustrated": ["frustrated", "hard", "confusing", "don't get"],
            "discouraged": ["give up", "can't", "hopeless"],
            "anxious": ["exam", "nervous", "scared", "worried"],
        }.items():
            if any(k in msg_lower for k in keywords):
                state = s
                break
        await event_logger.log_emotional_moment(
            student_id=student_id,
            session_id=session_id,
            emotional_state=state,
            trigger=message[:200],
        )
        if state in ["discouraged", "anxious"]:
            await artifact_writer.write_emotional_note(
                student_id=student_id,
                note=f"Student expressed {state}: {message[:150]}",
            )
    except Exception:
        pass

async def _mark_read(normalized_message: NormalizedMessage) -> None:
    try:
        if normalized_message.platform == Platform.WHATSAPP:
            from waxprep.app.gateways.whatsapp.sender import WhatsAppSender
            await WhatsAppSender().mark_as_read(normalized_message.platform_message_id)
    except Exception:
        pass

async def _send_error(normalized_message: NormalizedMessage) -> None:
    try:
        await _send_platform(
            normalized_message.platform,
            normalized_message.platform_user_id,
            "I'm having a quick technical moment — try again in a bit.",
        )
    except Exception:
        pass

async def _update_student(student_id: str, student: Dict, conversation_id: str) -> None:
    try:
        db = get_db_client()
        if not student.get("onboarding_complete"):
            exchanges = student.get("onboarding_exchanges", 0) + 1
            updates = {"onboarding_exchanges": exchanges}
            if exchanges >= 5:
                updates["onboarding_complete"] = True
                await history_manager.update_conversation_state(conversation_id, "teaching")
            db.table("students").update(updates).eq("id", student_id).execute()
        db.table("students").update({
            "last_active_at": datetime.utcnow().isoformat(),
            "total_messages_received": student.get("total_messages_received", 0) + 1,
        }).eq("id", student_id).execute()
    except Exception as e:
        logger.warning(f"Student update failed: {e}")
