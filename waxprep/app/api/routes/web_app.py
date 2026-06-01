from fastapi import APIRouter, HTTPException, Depends, Header, Request
from pydantic import BaseModel
from typing import Optional
import secrets
import bcrypt
from datetime import datetime, timedelta
from loguru import logger
from waxprep.app.database.client import get_db_client
from waxprep.app.identity.manager import IdentityManager
from waxprep.app.core.constants import Platform
from waxprep.app.router.web_dispatcher import dispatch_web_message
from waxprep.app.ai.prompts import build_knowledge_map_summary

router = APIRouter()
identity_manager = IdentityManager()

class RegisterRequest(BaseModel):
    email: str
    password: str
    username: str
    phone_number: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class ChatRequest(BaseModel):
    message: str

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False

def generate_token() -> str:
    return secrets.token_urlsafe(48)

async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Please log in to continue")
    token = authorization.replace("Bearer ", "")
    db = get_db_client()
    session = (
        db.table("web_sessions")
        .select("*, web_users(*)")
        .eq("session_token", token)
        .gte("expires_at", datetime.utcnow().isoformat())
        .execute()
    )
    if not session.data:
        raise HTTPException(status_code=401, detail="Session expired — please log in again")
    return session.data[0]

@router.post("/web/register")
async def register(req: RegisterRequest):
    db = get_db_client()
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    existing_email = db.table("web_users").select("id").eq("email", req.email).execute()
    if existing_email.data:
        raise HTTPException(status_code=400, detail="This email is already registered")

    existing_username = db.table("web_users").select("id").eq("username", req.username).execute()
    if existing_username.data:
        raise HTTPException(status_code=400, detail="This username is already taken")

    platform = Platform.WHATSAPP if req.phone_number else Platform.TELEGRAM
    platform_id = req.phone_number.replace(" ", "").replace("+", "") if req.phone_number else f"web_{secrets.token_hex(8)}"

    try:
        student = await identity_manager.get_or_create_student(
            platform=platform,
            platform_user_id=platform_id,
        )
    except Exception as e:
        logger.error(f"Student creation failed during registration: {e}")
        raise HTTPException(status_code=500, detail="Registration failed — please try again")

    password_hash = hash_password(req.password)
    result = db.table("web_users").insert({
        "student_id": student["id"],
        "email": req.email,
        "password_hash": password_hash,
        "username": req.username,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Registration failed")

    return {
        "message": "Account created successfully",
        "wax_code": student["wax_code"],
    }

@router.post("/web/login")
async def login(req: LoginRequest, request: Request):
    db = get_db_client()
    user = db.table("web_users").select("*").eq("email", req.email).execute()
    if not user.data:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    record = user.data[0]
    if not verify_password(req.password, record["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = generate_token()
    expires_at = (datetime.utcnow() + timedelta(days=30)).isoformat()

    db.table("web_sessions").insert({
        "user_id": record["id"],
        "session_token": token,
        "expires_at": expires_at,
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent", "")[:200],
    }).execute()

    db.table("web_users").update({
        "last_login": datetime.utcnow().isoformat()
    }).eq("id", record["id"]).execute()

    student = db.table("students").select("*").eq("id", record["student_id"]).execute()
    profile = db.table("student_profiles").select("*").eq("student_id", record["student_id"]).execute()

    return {
        "token": token,
        "expires_at": expires_at,
        "user": {
            "id": record["id"],
            "email": record["email"],
            "username": record["username"],
        },
        "student": student.data[0] if student.data else {},
        "profile": profile.data[0] if profile.data else {},
    }

@router.post("/web/chat")
async def web_chat(req: ChatRequest, session=Depends(get_current_user)):
    student_id = session["web_users"]["student_id"]
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    if len(req.message) > 2000:
        raise HTTPException(status_code=400, detail="Message is too long (max 2000 characters)")

    response_text = await dispatch_web_message(
        student_id=student_id,
        message_content=req.message.strip(),
    )

    return {
        "response": response_text,
        "timestamp": datetime.utcnow().isoformat(),
    }

@router.get("/web/dashboard")
async def get_dashboard(session=Depends(get_current_user)):
    student_id = session["web_users"]["student_id"]
    db = get_db_client()
    student = db.table("students").select("*").eq("id", student_id).execute()
    profile = db.table("student_profiles").select("*").eq("student_id", student_id).execute()
    knowledge = db.table("knowledge_maps").select("*").eq("student_id", student_id).execute()
    misconceptions = (
        db.table("misconceptions")
        .select("*")
        .eq("student_id", student_id)
        .eq("status", "active")
        .execute()
    )
    recent_sessions = (
        db.table("conversations")
        .select("id, started_at, ended_at, summary, session_state, platform")
        .eq("student_id", student_id)
        .order("started_at", desc=True)
        .limit(5)
        .execute()
    )
    recent_events = (
        db.table("learning_events")
        .select("event_type, subject, timestamp, details")
        .eq("student_id", student_id)
        .order("timestamp", desc=True)
        .limit(20)
        .execute()
    )

    return {
        "student": student.data[0] if student.data else {},
        "profile": profile.data[0] if profile.data else {},
        "knowledge_map": knowledge.data or [],
        "active_misconceptions": misconceptions.data or [],
        "recent_sessions": recent_sessions.data or [],
        "recent_events": recent_events.data or [],
    }

@router.get("/web/chat-history")
async def get_chat_history(limit: int = 50, session=Depends(get_current_user)):
    student_id = session["web_users"]["student_id"]
    db = get_db_client()
    conversations = (
        db.table("conversations")
        .select("id")
        .eq("student_id", student_id)
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )

    if not conversations.data:
        return {"messages": [], "conversation_id": None}

    conv_id = conversations.data[0]["id"]
    messages = (
        db.table("messages")
        .select("direction, content, message_type, timestamp, intent_classified")
        .eq("conversation_id", conv_id)
        .order("timestamp", desc=False)
        .limit(limit)
        .execute()
    )

    return {
        "messages": messages.data or [],
        "conversation_id": conv_id,
    }

@router.get("/web/knowledge-map")
async def get_knowledge_map(session=Depends(get_current_user)):
    student_id = session["web_users"]["student_id"]
    db = get_db_client()
    km = db.table("knowledge_maps").select("*").eq("student_id", student_id).execute()

    subjects = {}
    for concept in (km.data or []):
        subj = concept["subject"]
        if subj not in subjects:
            subjects[subj] = {
                "subject": subj,
                "concepts": [],
                "avg_mastery": 0,
            }
        subjects[subj]["concepts"].append({
            "id": concept["concept_id"],
            "name": concept["concept_id"].replace("_", " ").title(),
            "mastery": concept["mastery_score"],
            "next_review": concept.get("next_review_due_at"),
            "level": (
                "mastered" if concept["mastery_score"] >= 70
                else "partial" if concept["mastery_score"] >= 40
                else "needs_work"
            ),
        })

    for subj_data in subjects.values():
        concepts = subj_data["concepts"]
        if concepts:
            subj_data["avg_mastery"] = round(
                sum(c["mastery"] for c in concepts) / len(concepts), 1
            )

    return {"subjects": list(subjects.values())}

@router.get("/web/stats")
async def get_student_stats(session=Depends(get_current_user)):
    student_id = session["web_users"]["student_id"]
    db = get_db_client()
    student = (
        db.table("students")
        .select("session_count, total_messages_received, last_active_at")
        .eq("id", student_id)
        .execute()
    )

    km = db.table("knowledge_maps").select("mastery_score").eq("student_id", student_id).execute()
    concepts = km.data or []
    mastered = len([c for c in concepts if c["mastery_score"] >= 70])
    partial = len([c for c in concepts if 40 <= c["mastery_score"] < 70])
    weak = len([c for c in concepts if c["mastery_score"] < 40])

    assessments = (
        db.table("assessment_questions")
        .select("final_score")
        .eq("student_id", student_id)
        .eq("status", "completed")
        .execute()
    )
    avg_score = 0
    if assessments.data:
        scores = [a["final_score"] for a in assessments.data if a.get("final_score") is not None]
        avg_score = round(sum(scores) / len(scores) * 100, 1) if scores else 0

    profile = (
        db.table("student_profiles")
        .select("study_streak_current, study_streak_max")
        .eq("student_id", student_id)
        .execute()
    )

    return {
        "sessions": student.data[0]["session_count"] if student.data else 0,
        "total_messages": student.data[0]["total_messages_received"] if student.data else 0,
        "concepts_total": len(concepts),
        "concepts_mastered": mastered,
        "concepts_partial": partial,
        "concepts_weak": weak,
        "avg_assessment_score": avg_score,
        "assessments_completed": len(assessments.data) if assessments.data else 0,
        "streak_current": profile.data[0]["study_streak_current"] if profile.data else 0,
        "streak_max": profile.data[0]["study_streak_max"] if profile.data else 0,
    }

@router.post("/web/voice-transcribe")
async def transcribe_voice(request: Request, session=Depends(get_current_user)):
    try:
        body = await request.body()
        if len(body) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Audio file too large (max 10MB)")
        import tempfile, os
        from groq import Groq
        from waxprep.app.core.config import settings

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(body)
            tmp_path = tmp.name

        try:
            client = Groq(api_key=settings.groq_api_key)
            with open(tmp_path, "rb") as f:
                result = client.audio.transcriptions.create(
                    file=("audio.webm", f, "audio/webm"),
                    model="whisper-large-v3-turbo",
                    response_format="text",
                    language="en",
                )
            return {"transcript": result.strip() if result else ""}
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Web voice transcription error: {e}")
        raise HTTPException(status_code=500, detail="Transcription failed")

@router.post("/web/logout")
async def logout(session=Depends(get_current_user)):
    db = get_db_client()
    db.table("web_sessions").update({
        "expires_at": datetime.utcnow().isoformat()
    }).eq("user_id", session["web_users"]["id"]).execute()
    return {"message": "Logged out successfully"}

@router.get("/web/profile")
async def get_profile(session=Depends(get_current_user)):
    student_id = session["web_users"]["student_id"]
    db = get_db_client()
    profile = db.table("student_profiles").select("*").eq("student_id", student_id).execute()
    student = db.table("students").select("wax_code, inferred_class_level, primary_exam_target, exam_date, status").eq("id", student_id).execute()
    return {
        "profile": profile.data[0] if profile.data else {},
        "student": student.data[0] if student.data else {},
        "user": {
            "email": session["web_users"]["email"],
            "username": session["web_users"]["username"],
        },
    }
