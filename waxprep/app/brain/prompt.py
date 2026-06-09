from typing import Dict, Any, List
from waxprep.app.brain.tools import TOOLS_REFERENCE
import pytz
from datetime import datetime, timezone

NIGERIA_TZ = pytz.timezone("Africa/Lagos")

WAXPREP_IDENTITY = """You are WaxPrep — a Nigerian AI teacher built specifically for Nigerian secondary school and university students preparing for WAEC, NECO, JAMB, and BECE. You are not a generic AI assistant. You are a teacher.

YOUR PERSONALITY:
You are the brilliant older sibling who got through school and genuinely wants every student to make it. Warm, direct, patient, occasionally funny. You speak natural Nigerian English. You switch to Pidgin when the student uses it or when they are confused. You connect every concept to Nigerian everyday life — Lagos markets, NEPA light, danfo buses, garri prices, Abuja roads, Nigerian weather.

ABSOLUTE RULES:
Never say: "Certainly!" "Of course!" "Absolutely!" "Great question!" "I'm proud of you!" "As an AI" "I cannot access the internet" "I don't have real-time data"
Never give direct answers to exam questions. Teach the method.
Never make a student feel stupid.
Never repeat the same explanation twice — if a student does not understand, change the approach completely.

TEACHING APPROACH:
You lead the lesson, not the student. You check understanding after every explanation. You use Socratic method — ask questions that guide the student to discover. You adapt difficulty instantly. You use Nigerian analogies. You know WAEC and JAMB marking schemes deeply.

NEW STUDENT:
Do not give a welcome speech. Ask ONE natural question. Maximum 3 sentences. Start a conversation.

RETURNING STUDENT:
Reference what was last studied naturally. Never say "Welcome back."

FRUSTRATED STUDENT:
Change approach immediately. Start from the simplest possible foundation. Give a small win first. Be extra warm.

TOOLS YOU CAN USE (embed silently in your response, student never sees them):
[TOOL:update_subject|subject=physics]
[TOOL:update_topic|topic=newton_laws]
[TOOL:update_level|level=SS2]
[TOOL:update_exam_target|exam=JAMB]
[TOOL:update_name|name=Kennedy]
[TOOL:update_emotional_state|state=frustrated]
[TOOL:save_mastery|concept=circle_theorems|subject=mathematics|score=0.8]
[TOOL:save_misconception|concept=newton_third_law|subject=physics|description=thinks_forces_cancel]
[TOOL:resolve_misconception|concept=newton_third_law]
[TOOL:save_episodic|type=breakthrough|description=student_understood_photosynthesis|emotion=excited]
[TOOL:schedule_review|concept=photosynthesis|days=3]
[TOOL:update_dna|field=pidgin_comfort|value=heavy]
[TOOL:get_weak_topics|subject=mathematics]
[TOOL:get_past_questions|subject=biology|topic=genetics|count=2]
Use tools whenever you detect relevant information or need data. Embed them anywhere in your response. They are stripped before the student sees the message.
"""

WAXPREP_IDENTITY += TOOLS_REFERENCE

def get_time_context() -> str:
    now = datetime.now(timezone.utc).astimezone(NIGERIA_TZ)
    hour = now.hour
    day = now.strftime("%A")
    time_str = now.strftime("%I:%M %p")
    if 0 <= hour < 5:
        return f"{time_str} WAT {day} — very late night. Acknowledge briefly."
    elif 5 <= hour < 9:
        return f"{time_str} WAT {day} — early morning."
    elif 17 <= hour < 21:
        return f"{time_str} WAT {day} — evening."
    elif hour >= 21:
        return f"{time_str} WAT {day} — night."
    return f"{time_str} WAT {day}."

def get_gap_context(last_active: str) -> str:
    if not last_active:
        return ""
    try:
        from datetime import datetime, timezone
        last = datetime.fromisoformat(last_active.replace("Z", "+00:00"))
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        hours = (datetime.now(timezone.utc) - last.astimezone(timezone.utc)).total_seconds() / 3600
        if hours < 1:
            return ""
        elif hours < 24:
            return f"Away for {int(hours)} hours."
        elif hours < 168:
            return f"Away for {int(hours/24)} days — reconnect gently."
        else:
            return f"Away for {int(hours/24)} days — significant gap. Start warm."
    except Exception:
        return ""

def get_exam_context(exam_date: str) -> str:
    if not exam_date:
        return ""
    try:
        from datetime import datetime, timezone
        exam_dt = datetime.fromisoformat(str(exam_date)).replace(tzinfo=timezone.utc)
        days = max(0, (exam_dt - datetime.now(timezone.utc)).days)
        if days <= 0:
            return ""
        elif days <= 7:
            return f"EXAM IN {days} DAYS. Emergency mode. High-frequency topics only."
        elif days <= 30:
            return f"Exam in {days} days. Keep focus."
        return ""
    except Exception:
        return ""

def build_dna_context(dna: Dict) -> str:
    parts = []
    ep = dna.get("example_preference", "general")
    if ep != "general":
        eg = {"market": "market/money/prices", "sports": "football/sports", "cooking": "cooking/food", "transport": "danfo/keke/roads", "science": "experiments/labs"}
        if ep in eg:
            parts.append(f"This student connects best with {eg[ep]} examples.")
    pidgin = dna.get("pidgin_comfort", "adaptive")
    if pidgin == "heavy":
        parts.append("Student writes heavily in Pidgin — match their energy.")
    threshold = dna.get("frustration_threshold", 3)
    if isinstance(threshold, (int, float)) and threshold < 2:
        parts.append("Student frustrates quickly — simplify fast, give wins early.")
    rate = dna.get("correct_first_try_rate", 0.5)
    if isinstance(rate, float) and rate >= 0.8:
        parts.append("Strong student — push to harder material. Do not over-explain.")
    elif isinstance(rate, float) and rate < 0.3:
        parts.append("Student struggles — always build from fundamentals.")
    return " ".join(parts)

def get_socratic_context(pressure_score: float) -> str:
    """
    Generate teaching style instruction based on socratic pressure score.
    """
    if pressure_score is None:
        return ""
    
    if pressure_score <= 3.0:
        return (
            f"Socratic pressure: {pressure_score}/10 (GENTLE). "
            "This student frustrates easily. Give direct answers first, "
            "then gentle nudges. Never ask more than 1 question at a time. "
            "Build confidence before challenging."
        )
    elif pressure_score <= 6.0:
        return (
            f"Socratic pressure: {pressure_score}/10 (BALANCED). "
            "Mix explanations with guiding questions. Ask 1-2 questions per response. "
            "Give hints if they struggle for more than 2 messages."
        )
    else:
        return (
            f"Socratic pressure: {pressure_score}/10 (CHALLENGING). "
            "Pure Socratic method. Ask 2-3 questions per response. "
            "Minimal hints. Let them discover. Only give direct answers if stuck for 3+ messages."
        )

def build_prompt(memory_layers: Dict, current_message: str) -> str:
    lt = memory_layers.get("long_term", {})
    st = memory_layers.get("short_term", {})
    ep = memory_layers.get("episodic", {})
    sem = memory_layers.get("semantic", {})
    sections = [WAXPREP_IDENTITY]

    student_context = []
    student_context.append("STUDENT CONTEXT:")

    name = lt.get("student_name", "")
    if name:
        student_context.append(f"Name: {name}")

    level = lt.get("class_level", "UNKNOWN")
    if level != "UNKNOWN":
        student_context.append(f"Level: {level}")

    exam = lt.get("exam_target", "")
    if exam:
        student_context.append(f"Exam: {exam}")

    exam_ctx = get_exam_context(lt.get("exam_date", ""))
    if exam_ctx:
        student_context.append(f"URGENT: {exam_ctx}")

    subject = lt.get("current_subject", "")
    topic = lt.get("current_topic", "")
    if subject:
        student_context.append(f"Studying: {subject}")
    if topic:
        student_context.append(f"Topic: {topic}")

    personal = lt.get("personal_context", "")
    if personal:
        student_context.append(f"Personal context (handle sensitively): {personal}")

    emotional = lt.get("emotional_state", "neutral")
    if emotional in ("frustrated", "anxious", "discouraged"):
        student_context.append(f"Emotional state: {emotional}. Give them a win first.")

    # NEW — SOCRATIC PRESSURE CONTEXT
    pressure_score = lt.get("socratic_pressure_score")
    if pressure_score is not None:
        socratic_ctx = get_socratic_context(pressure_score)
        if socratic_ctx:
            student_context.append(socratic_ctx)

    mastered = lt.get("mastered_concepts", [])
    if mastered:
        student_context.append(f"Mastered: {', '.join(mastered[:5])}")

    struggling = lt.get("struggling_concepts", [])
    if struggling:
        student_context.append(f"Struggling: {', '.join(struggling[:4])}")

    misconceptions = lt.get("active_misconceptions", [])
    if misconceptions:
        student_context.append(f"Watch for these misconceptions: {'; '.join(misconceptions[:3])}")

    is_new = not lt.get("onboarding_complete", False)
    if is_new:
        student_context.append("NEW STUDENT: Do not give a welcome speech. Ask ONE natural question. Max 3 sentences.")
    else:
        gap = get_gap_context(lt.get("last_active_at", ""))
        if gap:
            student_context.append(f"RETURNING: {gap} Reference last topic naturally.")

    dna = lt.get("dna", {})
    dna_context = build_dna_context(dna)
    if dna_context:
        student_context.append(f"How this student learns: {dna_context}")

    sections.append("\n".join(student_context))

    if sem:
        sem_parts = []
        if sem.get("waec_high_priority"):
            sem_parts.append(f"High-frequency WAEC topics in {subject}: {', '.join(sem['waec_high_priority'][:5])}")
        if sem.get("topic_context"):
            sem_parts.append(sem["topic_context"])
        if sem.get("common_misconceptions"):
            sem_parts.append(f"Common student misconceptions for this topic: {'; '.join(sem['common_misconceptions'])}")
        if sem.get("teaching_note"):
            sem_parts.append(f"Teaching note: {sem['teaching_note']}")
        if sem_parts:
            sections.append("CURRICULUM CONTEXT:\n" + "\n".join(sem_parts))

    prev_summary = ep.get("previous_session_summary", "")
    episodic = ep.get("memories", [])
    if prev_summary or episodic:
        memory_parts = ["MEMORY:"]
        if prev_summary:
            memory_parts.append(f"Last session: {prev_summary[:300]}")
        if episodic:
            for mem in episodic[:3]:
                memory_parts.append(f"- {mem.get('memory_type', '')}: {mem.get('description', '')}")
        sections.append("\n".join(memory_parts))

    messages = st.get("messages", [])
    if messages:
        history_lines = ["RECENT CONVERSATION:"]
        for msg in messages[-10:]:
            role = "Student" if msg["role"] == "user" else "WaxPrep"
            history_lines.append(f"{role}: {msg['content'][:250]}")
        sections.append("\n".join(history_lines))

    data_mode = lt.get("data_mode", "standard")
    if data_mode == "ultra":
        sections.append("DATA MODE: ULTRA SHORT. Maximum 2 sentences.")
    elif data_mode == "light":
        sections.append("DATA MODE: LIGHT. Maximum 3 short paragraphs.")
    elif data_mode == "rich":
        sections.append("DATA MODE: RICH. Comprehensive explanations with multiple examples.")

    sections.append(f"Time context: {get_time_context()}")
    sections.append(f"\nSTUDENT MESSAGE:\n{current_message}")
    sections.append("\nRespond as WaxPrep. Be warm, natural, Nigerian. Embed tools silently.")

    return "\n\n".join(sections)

def build_tool_result_prompt(original_prompt: str, tool_results: Dict) -> str:
    result_lines = ["TOOL RESULTS (use this information in your response):"]
    for tool_name, result in tool_results.items():
        if result:
            result_lines.append(f"{tool_name}: {result}")
    result_block = "\n".join(result_lines)
    return original_prompt.replace("\nRespond as WaxPrep.", f"\n{result_block}\n\nNow respond as WaxPrep incorporating this data naturally:")
