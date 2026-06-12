"""
================================================================================
WEBHOOK HANDLER v4.0 - WHATSAPP MESSAGE PROCESSING
================================================================================
FIXED: Better error handling, voice note support, structured onboarding.
================================================================================
"""
import asyncio
import random
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from fastapi.responses import PlainTextResponse
from loguru import logger
from datetime import datetime, timezone
import os

from waxprep.app.gateway import whatsapp
from waxprep.app.brain.engine import brain
from waxprep.app.database.client import get_db
from waxprep.app.cache.redis import rget, rset, rdel, rexists
from waxprep.app.conversation.manager import conversation_manager

router = APIRouter()

DEDUP_TTL = 120

KNOWN_CORRECTIONS = {
    "afusion": "diffusion", "sales ": "cells ", "nuckelus": "nucleus",
    "nukelus": "nucleus", "fotosynthesis": "photosynthesis",
    "kwadratic": "quadratic", "logharithm": "logarithm",
    "trignometry": "trigonometry", "akseleration": "acceleration",
    "velosity": "velocity", "eletrisity": "electricity",
    "resistence": "resistance", "frikshun": "friction",
}

@router.get("/webhook/whatsapp")
async def verify(request: Request):
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")
    verify_token = os.environ.get("WHATSAPP_VERIFY_TOKEN", "waxprep_verify")
    if mode == "subscribe" and token == verify_token:
        logger.info("WhatsApp webhook verified")
        return PlainTextResponse(content=challenge)
    raise HTTPException(status_code=403, detail="Verification failed")

@router.post("/webhook/whatsapp")
async def receive(request: Request, background_tasks: BackgroundTasks):
    body = await request.body()
    signature = request.headers.get("x-hub-signature-256", "")
    env = os.environ.get("APP_ENV", "production")
    if env == "production" and not whatsapp.verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Failed to parse webhook payload: {e}")
        return {"status": "ok"}

    messages = whatsapp.parse_payload(payload)
    for msg in messages:
        background_tasks.add_task(_handle_message, msg)

    return {"status": "ok"}

async def _handle_message(msg: whatsapp.WhatsAppMessage) -> None:
    try:
        dedup_key = f"wax:dedup:{msg.message_id}"
        if await rexists(dedup_key):
            return
        await rset(dedup_key, True, DEDUP_TTL)

        content = msg.content.strip()

        if msg.is_voice and msg.media_id:
            transcribed = await _transcribe_voice(msg.media_id)
            if transcribed:
                content = transcribed
            else:
                content = "I sent a voice note."

        if not content or len(content) <= 1:
            nudges = ["What do you want to study today?", "What subject are we working on?", "What can I help you with?"]
            await whatsapp.send_text(msg.user_id, random.choice(nudges))
            return

        await whatsapp.mark_read(msg.message_id)

        student_id = await _get_or_create_student(msg.user_id)
        if not student_id:
            await whatsapp.send_text(msg.user_id, "I'm having a moment — try again in a few seconds.")
            return

        # CHECK IF STUDENT WANTS TO START GHOST TEACHER MODE
        ghost_intent = await _check_ghost_teacher_intent(student_id, msg.user_id, content)
        if ghost_intent:
            return

        conv_id = await conversation_manager.ensure_active(student_id, "whatsapp")
        await conversation_manager.save_message(conv_id, student_id, "inbound", content)

        # CHECK IF THIS IS A THEORY ANSWER
        theory_result = await _check_theory_answer(student_id, conv_id, content)
        if theory_result:
            await whatsapp.send_text(msg.user_id, theory_result)
            await conversation_manager.save_message(conv_id, student_id, "outbound", theory_result)
        else:
            # Normal flow
            response = await brain.think(student_id, content)
            await whatsapp.send_text(msg.user_id, response)
            await conversation_manager.save_message(conv_id, student_id, "outbound", response)

        db = get_db()
        current = db.table("students").select("total_messages_received").eq("id", student_id).execute()
        current_count = current.data[0].get("total_messages_received", 0) if current.data else 0
        db.table("students").update({
            "total_messages_received": current_count + 1,
            "last_active_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", student_id).execute()

    except Exception as e:
        logger.error(f"Message handling failed for {msg.user_id}: {e}", exc_info=True)
        try:
            await whatsapp.send_text(msg.user_id, "Quick technical issue — send that again and we continue.")
        except Exception:
            pass

async def _check_ghost_teacher_intent(student_id: str, phone: str, content: str) -> bool:
    try:
        from waxprep.app.brain.ghost_teacher import parse_study_intent, generate_observation_message
        intent = parse_study_intent(content)
        if not intent:
            return False
        topic, duration = intent
        db = get_db()
        result = db.table("study_sessions").insert({
            "student_id": student_id,
            "material_topic": topic,
            "material_type": "general",
            "status": "active",
            "started_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
        if not result.data:
            return False
        session_id = result.data[0]["id"]
        obs_message = generate_observation_message(topic, duration)
        await whatsapp.send_text(phone, obs_message)
        logger.info(f"Ghost teacher started: {student_id[:8]} | {topic} | {duration}min | session={session_id[:8]}")
        return True
    except Exception as e:
        logger.warning(f"Ghost teacher intent check failed: {e}")
        return False

async def _check_theory_answer(student_id: str, conv_id: str, content: str) -> Optional[str]:
    try:
        db = get_db()
        msgs = db.table("messages").select("direction, content").eq("conversation_id", conv_id).order("timestamp", desc=True).limit(2).execute()
        if not msgs.data or len(msgs.data) < 2:
            return None
        last_waxprep_msg = None
        for m in msgs.data:
            if m["direction"] == "outbound":
                last_waxprep_msg = m["content"]
                break
        if not last_waxprep_msg or "Theory Question" not in last_waxprep_msg or "Question ID:" not in last_waxprep_msg:
            return None
        import re
        qid_match = re.search(r"Question ID: ([a-f0-9-]+)", last_waxprep_msg)
        if not qid_match:
            return None
        question_id = qid_match.group(1)
        q = db.table("waec_theory_questions").select("question_text, marks, marking_scheme, subject, topic").eq("id", question_id).execute()
        if not q.data:
            return None
        question = q.data[0]
        marking_scheme = question.get("marking_scheme", {})
        from waxprep.app.brain.theory_evaluator import evaluate_theory_answer, generate_theory_feedback
        score, feedback, breakdown = evaluate_theory_answer(content, marking_scheme)
        db.table("theory_submissions").insert({
            "student_id": student_id,
            "question_id": question_id,
            "answer_text": content,
            "evaluation_json": breakdown,
            "score": score,
            "max_score": question["marks"],
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
        from waxprep.app.brain.memory import memory
        concept = question.get("topic", "general")
        subject = question.get("subject", "general")
        await memory.update_knowledge_map(student_id, concept, subject, score / 100.0)
        final_feedback = generate_theory_feedback(score, concept)
        return f"{feedback}\n\n{final_feedback}"
    except Exception as e:
        logger.warning(f"Theory answer check failed: {e}")
        return None

async def _transcribe_voice(media_id: str) -> str:
    audio_bytes = await whatsapp.download_media(media_id)
    if not audio_bytes:
        return ""
    try:
        import tempfile, os, asyncio
        with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
            try:
                import groq
                groq_key = os.environ.get("GROQ_API_KEY", "")
                if not groq_key:
                    return ""
                client = groq.Groq(api_key=groq_key)
                def _do_transcribe():
                    with open(tmp_path, "rb") as f:
                        r = client.audio.transcriptions.create(
                            file=("audio.ogg", f, "audio/ogg"),
                            model="whisper-large-v3-turbo",
                            response_format="text",
                            language="en",
                        )
                    return r
                result = await asyncio.to_thread(_do_transcribe)
                if not result:
                    return ""
                corrected = result.lower()
                for wrong, right in KNOWN_CORRECTIONS.items():
                    if wrong in corrected:
                        corrected = corrected.replace(wrong, right)
                if result[0].isupper():
                    corrected = corrected[0].upper() + corrected[1:]
                return corrected.strip()
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
    except Exception as e:
        logger.warning(f"Voice transcription failed: {e}")
        return ""

async def _get_or_create_student(whatsapp_id: str) -> str:
    db = get_db()
    cache_key = f"wax:student_id:{whatsapp_id}"
    cached_id = await rget(cache_key)
    if cached_id:
        # Verify student still exists in database (might have been deleted)
        verify = db.table("students").select("id").eq("id", cached_id).execute()
        if verify.data:
            return cached_id
        # Student was deleted, clear cache and continue
        await rdel(cache_key)
    existing = db.table("students").select("id").eq("platform_whatsapp", whatsapp_id).execute()
    if existing.data:
        student_id = existing.data[0]["id"]
        await rset(cache_key, student_id, 86400)
        return student_id
    import random
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    random_part = "".join(random.choices(chars, k=6))
    wax_code = f"WAX-NG-0000-{random_part}-W"
    result = db.table("students").insert({
        "wax_code": wax_code,
        "platform_whatsapp": whatsapp_id,
        "status": "active",
        "last_active_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    if not result.data:
        return ""
    student_id = result.data[0]["id"]
    db.table("student_profiles").insert({"student_id": student_id}).execute()
    await rset(cache_key, student_id, 86400)
    logger.info(f"New student: {wax_code}")
    return student_id
