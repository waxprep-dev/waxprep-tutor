from fastapi import APIRouter, HTTPException, Header
from datetime import datetime, timezone, timedelta
from loguru import logger
from waxprep.app.database.client import get_db
import os

router = APIRouter()

def require_admin(x_admin_secret: str = Header(None)):
    secret = os.environ.get("APP_SECRET_KEY", "")
    if not x_admin_secret or x_admin_secret != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

@router.get("/admin/stats")
async def stats(admin=require_admin):
    db = get_db()
    total = db.table("students").select("id", count="exact").execute()
    active_day = db.table("students").select("id", count="exact").gte("last_active_at", (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()).execute()
    active_week = db.table("students").select("id", count="exact").gte("last_active_at", (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()).execute()
    msgs_today = db.table("messages").select("id", count="exact").gte("timestamp", (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()).execute()
    concepts = db.table("knowledge_maps").select("id", count="exact").execute()
    return {
        "students": {"total": total.count or 0, "active_today": active_day.count or 0, "active_week": active_week.count or 0},
        "messages_today": msgs_today.count or 0,
        "concepts_tracked": concepts.count or 0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/admin/students")
async def list_students(limit: int = 50, admin=require_admin):
    db = get_db()
    r = db.table("students").select("id, wax_code, inferred_class_level, primary_exam_target, total_messages_received, session_count, last_active_at, onboarding_complete, platform_whatsapp").order("last_active_at", desc=True).limit(limit).execute()
    return {"students": r.data or []}

@router.get("/admin/students/{student_id}")
async def get_student(student_id: str, admin=require_admin):
    db = get_db()
    student = db.table("students").select("*").eq("id", student_id).execute()
    if not student.data:
        raise HTTPException(status_code=404, detail="Not found")
    profile = db.table("student_profiles").select("*").eq("student_id", student_id).execute()
    km = db.table("knowledge_maps").select("*").eq("student_id", student_id).execute()
    episodic = db.table("episodic_memories").select("*").eq("student_id", student_id).order("created_at", desc=True).limit(10).execute()
    recent_msgs = db.table("messages").select("direction, content, timestamp").eq("student_id", student_id).order("timestamp", desc=True).limit(20).execute()
    misconceptions = db.table("misconceptions").select("*").eq("student_id", student_id).execute()
    return {
        "student": student.data[0],
        "profile": profile.data[0] if profile.data else {},
        "knowledge_map": km.data or [],
        "episodic_memories": episodic.data or [],
        "recent_messages": list(reversed(recent_msgs.data or [])),
        "misconceptions": misconceptions.data or [],
    }

@router.get("/admin/health")
async def health_check(admin=require_admin):
    db = get_db()
    checks = {}
    try:
        db.table("students").select("id").limit(1).execute()
        checks["database"] = "healthy"
    except Exception as e:
        checks["database"] = f"error: {str(e)[:80]}"
    
    try:
        from waxprep.app.cache.redis import get_redis
        r = await get_redis()
        if r:
            await r.ping()
            checks["redis"] = "healthy"
        else:
            checks["redis"] = "unavailable"
    except Exception as e:
        checks["redis"] = f"error: {str(e)[:80]}"

    import httpx, os
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(os.environ.get("WAXPREP_MODEL_HEALTH_URL", ""))
            checks["model"] = "healthy" if resp.status_code == 200 else f"status_{resp.status_code}"
    except Exception as e:
        checks["model"] = f"error: {str(e)[:80]}"

    checks["overall"] = "healthy" if all(v == "healthy" for v in checks.values()) else "degraded"
    return checks
