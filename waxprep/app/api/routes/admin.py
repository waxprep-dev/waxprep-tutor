from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from loguru import logger
from datetime import datetime, timedelta
from waxprep.app.database.client import get_db_client
from waxprep.app.core.config import settings

router = APIRouter()
ADMIN_SECRET = settings.app_secret_key

def require_admin(x_admin_secret: str = Header(None)):
    if not x_admin_secret or x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=401, detail="Admin access denied")
    return True

@router.get("/admin/stats")
async def get_stats(admin=require_admin):
    db = get_db_client()
    total_students = db.table("students").select("id", count="exact").execute()
    active_today = (
        db.table("students")
        .select("id", count="exact")
        .gte("last_active_at", (datetime.utcnow() - timedelta(days=1)).isoformat())
        .execute()
    )
    active_week = (
        db.table("students")
        .select("id", count="exact")
        .gte("last_active_at", (datetime.utcnow() - timedelta(days=7)).isoformat())
        .execute()
    )
    total_messages = db.table("messages").select("id", count="exact").execute()
    messages_today = (
        db.table("messages")
        .select("id", count="exact")
        .gte("timestamp", (datetime.utcnow() - timedelta(days=1)).isoformat())
        .execute()
    )
    total_sessions = db.table("conversations").select("id", count="exact").execute()
    total_concepts = db.table("knowledge_maps").select("id", count="exact").execute()
    misconceptions = (
        db.table("misconceptions")
        .select("id", count="exact")
        .eq("status", "active")
        .execute()
    )
    pending_notifications = (
        db.table("scheduled_notifications")
        .select("id", count="exact")
        .eq("status", "pending")
        .execute()
    )
    question_bank = db.table("jamb_questions").select("id", count="exact").execute()

    return {
        "students": {
            "total": total_students.count or 0,
            "active_today": active_today.count or 0,
            "active_this_week": active_week.count or 0,
        },
        "messages": {
            "total": total_messages.count or 0,
            "today": messages_today.count or 0,
        },
        "sessions": total_sessions.count or 0,
        "knowledge": {
            "concepts_tracked": total_concepts.count or 0,
            "active_misconceptions": misconceptions.count or 0,
        },
        "pending_notifications": pending_notifications.count or 0,
        "question_bank_size": question_bank.count or 0,
        "timestamp": datetime.utcnow().isoformat(),
    }

@router.get("/admin/students")
async def list_students(
    limit: int = 50,
    offset: int = 0,
    admin=require_admin,
):
    db = get_db_client()
    students = (
        db.table("students")
        .select("id, wax_code, inferred_class_level, primary_exam_target, status, last_active_at, session_count, total_messages_received, platform_whatsapp, platform_telegram, onboarding_complete")
        .order("last_active_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return {"students": students.data or [], "count": len(students.data or [])}

@router.get("/admin/students/{student_id}")
async def get_student_detail(student_id: str, admin=require_admin):
    db = get_db_client()
    student = db.table("students").select("*").eq("id", student_id).execute()
    if not student.data:
        raise HTTPException(status_code=404, detail="Student not found")

    profile = db.table("student_profiles").select("*").eq("student_id", student_id).execute()
    km = db.table("knowledge_maps").select("*").eq("student_id", student_id).order("mastery_score", desc=True).execute()
    misconceptions = db.table("misconceptions").select("*").eq("student_id", student_id).execute()
    sessions = (
        db.table("conversations")
        .select("id, platform, started_at, ended_at, summary, session_state, message_count")
        .eq("student_id", student_id)
        .order("started_at", desc=True)
        .limit(10)
        .execute()
    )
    artifacts = (
        db.table("memory_artifacts")
        .select("artifact_type, content, created_at")
        .eq("student_id", student_id)
        .eq("status", "active")
        .order("composite_score", desc=True)
        .execute()
    )
    recent_messages = (
        db.table("messages")
        .select("direction, content, timestamp, intent_classified")
        .eq("student_id", student_id)
        .order("timestamp", desc=True)
        .limit(30)
        .execute()
    )

    return {
        "student": student.data[0],
        "profile": profile.data[0] if profile.data else {},
        "knowledge_map": km.data or [],
        "misconceptions": misconceptions.data or [],
        "sessions": sessions.data or [],
        "memory_artifacts": artifacts.data or [],
        "recent_messages": list(reversed(recent_messages.data or [])),
    }

@router.get("/admin/messages/recent")
async def get_recent_messages(hours: int = 24, admin=require_admin):
    db = get_db_client()
    since = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
    messages = (
        db.table("messages")
        .select("student_id, direction, content, timestamp, intent_classified, ai_model_used")
        .gte("timestamp", since)
        .order("timestamp", desc=True)
        .limit(200)
        .execute()
    )
    return {"messages": messages.data or [], "since": since}

@router.get("/admin/question-bank")
async def get_question_bank_stats(admin=require_admin):
    db = get_db_client()
    all_q = db.table("jamb_questions").select("subject").execute()
    by_subject = {}
    for q in (all_q.data or []):
        subj = q["subject"]
        by_subject[subj] = by_subject.get(subj, 0) + 1

    total = db.table("jamb_questions").select("id", count="exact").execute()

    return {
        "total": total.count or 0,
        "by_subject": by_subject,
    }

@router.post("/admin/broadcast")
async def broadcast_message(
    message: str,
    platform: str = "whatsapp",
    limit: int = 10,
    admin=require_admin,
):
    db = get_db_client()
    field = "platform_whatsapp" if platform == "whatsapp" else "platform_telegram"
    students = (
        db.table("students")
        .select("id, platform_whatsapp, platform_telegram")
        .not_.is_(field, "null")
        .gte("last_active_at", (datetime.utcnow() - timedelta(days=30)).isoformat())
        .order("last_active_at", desc=True)
        .limit(limit)
        .execute()
    )

    sent = 0
    failed = 0
    for student in (students.data or []):
        try:
            if platform == "whatsapp" and student.get("platform_whatsapp"):
                from waxprep.app.gateways.whatsapp.sender import WhatsAppSender
                await WhatsAppSender().send_text(student["platform_whatsapp"], message)
                sent += 1
            elif platform == "telegram" and student.get("platform_telegram"):
                from waxprep.app.gateways.telegram.sender import TelegramSender
                await TelegramSender().send_text(student["platform_telegram"], message)
                sent += 1
        except Exception as e:
            logger.warning(f"Broadcast failed for {student['id']}: {e}")
            failed += 1

    return {"sent": sent, "failed": failed, "message": message}

@router.get("/admin/health")
async def admin_health(admin=require_admin):
    db = get_db_client()
    checks = {}
    try:
        db.table("students").select("id").limit(1).execute()
        checks["database"] = "healthy"
    except Exception as e:
        checks["database"] = f"error: {str(e)[:80]}"

    try:
        from waxprep.app.cache.redis_client import get_redis
        r = await get_redis()
        if r:
            await r.ping()
            checks["redis"] = "healthy"
        else:
            checks["redis"] = "unavailable"
    except Exception as e:
        checks["redis"] = f"error: {str(e)[:80]}"

    try:
        from groq import Groq
        from waxprep.app.core.config import settings
        client = Groq(api_key=settings.groq_api_key)
        r = client.chat.completions.create(
            model=settings.groq_fast_model,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
        )
        checks["groq"] = "healthy"
    except Exception as e:
        checks["groq"] = f"error: {str(e)[:80]}"

    checks["overall"] = "healthy" if all(v == "healthy" for v in checks.values()) else "degraded"
    checks["timestamp"] = datetime.utcnow().isoformat()
    return checks
