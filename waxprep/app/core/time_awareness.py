from datetime import datetime, timezone, timedelta
from typing import Optional
import pytz

NIGERIA_TZ = pytz.timezone("Africa/Lagos")

def get_nigeria_now() -> datetime:
    return datetime.now(timezone.utc).astimezone(NIGERIA_TZ)

def get_time_context_string() -> str:
    now = get_nigeria_now()
    hour = now.hour
    day = now.strftime("%A")
    time_str = now.strftime("%I:%M %p")

    if 0 <= hour < 5:
        period = "very late at night"
        note = "Student is messaging very late — acknowledge it briefly, like 'Still up this late?'"
    elif 5 <= hour < 9:
        period = "early morning"
        note = "Early morning session."
    elif 9 <= hour < 17:
        period = "daytime"
        note = ""
    elif 17 <= hour < 20:
        period = "evening"
        note = ""
    else:
        period = "night"
        note = ""

    ctx = f"Current Nigerian time: {time_str} WAT on {day} ({period})."
    if note:
        ctx += f" {note}"
    return ctx

def get_session_gap_context(last_active_at: Optional[str]) -> str:
    if not last_active_at:
        return ""
    try:
        last = datetime.fromisoformat(last_active_at.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        hours = (now - last.replace(tzinfo=timezone.utc)).total_seconds() / 3600
        if hours < 1:
            return "Continuing same session."
        elif hours < 24:
            return f"Student last messaged {int(hours)} hours ago."
        elif hours < 48:
            return "Student was away for about a day."
        elif hours < 168:
            return f"Student has been away for {int(hours/24)} days."
        else:
            return f"Student has been away for {int(hours/24)} days — a significant gap. Reconnect gently."
    except Exception:
        return ""

def format_exam_countdown(exam_date: Optional[str]) -> str:
    if not exam_date:
        return ""
    try:
        exam_dt = datetime.fromisoformat(str(exam_date))
        if exam_dt.tzinfo is None:
            exam_dt = exam_dt.replace(tzinfo=timezone.utc)
        days = (exam_dt - datetime.now(timezone.utc)).days
        if days < 0:
            return ""
        elif days == 0:
            return "EXAM IS TODAY — be encouraging, focus on confidence."
        elif days <= 7:
            return f"Exam in {days} days — prioritize weak areas, build confidence."
        elif days <= 30:
            return f"Exam in {days} days — good time for targeted revision."
        return ""
    except Exception:
        return ""
