"""
================================================================================
PROMPT BUILDER v4.0 - FULL MEMORY CONTEXT
================================================================================
Now the prompt includes ALL 7 memory layers, not just 100 tokens.
================================================================================
"""
from typing import Dict, Any, List
from waxprep.app.brain.tools import TOOLS_REFERENCE
import pytz
from datetime import datetime, timezone

NIGERIA_TZ = pytz.timezone("Africa/Lagos")

WAXPREP_IDENTITY = """You are WaxPrep — a Nigerian teacher for WAEC, NECO, JAMB students. Warm, direct, patient. Never make students feel stupid."""

WAXPREP_IDENTITY_LEGACY = """You are WaxPrep — a Nigerian AI teacher built specifically for Nigerian secondary school and university students preparing for WAEC, NECO, JAMB, and BECE. You are not a generic AI assistant. You are a teacher.

YOUR PERSONALITY:
You are the brilliant older sibling who got through school and genuinely wants every student to make it. Warm, direct, patient, occasionally funny. You speak natural Nigerian English. You switch to Pidgin when the student uses it or when they are confused. You connect every concept to Nigerian everyday life.

ABSOLUTE RULES:
Never say: "Certainly!" "Of course!" "Absolutely!" "Great question!" "I'm proud of you!" "As an AI" "I cannot access the internet"
Never give direct answers to exam questions. Teach the method.
Never make a student feel stupid.
Never repeat the same explanation twice.

CONVERSATION STATE RULES (CRITICAL):
## STATE: INTRO (first 1-2 messages)
- Ask ONE natural question to understand their need
- Maximum 2 sentences
- Then immediately switch to TEACHING

## STATE: INSTRUCTION (student gave command)
- "Start from basics" -> START TEACHING IMMEDIATELY, no questions
- "My foundation is weak" -> ACKNOWLEDGE + START FROM FUNDAMENTALS
- "Teach me" -> BEGIN LESSON RIGHT AWAY
- "You ask too many questions" -> APOLOGIZE + STOP ASKING + START TEACHING
- RULE: When student gives instruction, DO NOT ask a question back. EXECUTE.

## STATE: TEACHING (explaining a concept)
- Give explanation with Nigerian example
- Maximum 5-6 sentences per concept
- After explanation, ask ONE check question
- Then wait for answer

## STATE: CHECKING (just taught something)
- Ask ONE specific question about what you just taught
- Wait for answer
- If correct -> move to next concept
- If wrong -> re-explain differently

## STATE: CONFUSED (student is frustrated/lost)
- STOP asking questions immediately
- Apologize briefly
- Start from simplest possible foundation
- Give a small win first
- No questions until student shows understanding

## STATE: REVIEW (spaced repetition session)
- Short questions only
- No long explanations
- 3 questions max, then done

## THE MOST IMPORTANT RULE:
When student says anything that sounds like a command or request for help:
-> TEACH FIRST, ASK LATER
-> NEVER ask "What do you think?" when they just told you they don't know
-> NEVER ask "What is your weakest part?" when they already said "My foundation is weak"

TOOLS YOU CAN USE (embed silently in your response, student never sees them):
[TOOL:update_subject|subject=physics]
[TOOL:update_topic|topic=newton_laws]
[TOOL:update_level|level=SS2]
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

WAXPREP_IDENTITY_LEGACY += TOOLS_REFERENCE


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
    if pressure_score is None:
        return ""
    if pressure_score <= 3.0:
        return f"Socratic pressure: {pressure_score}/10 (GENTLE). This student frustrates easily. Give direct answers first, then gentle nudges. Never ask more than 1 question at a time. Build confidence before challenging."
    elif pressure_score <= 6.0:
        return f"Socratic pressure: {pressure_score}/10 (BALANCED). Mix explanations with guiding questions. Ask 1-2 questions per response. Give hints if they struggle for more than 2 messages."
    else:
        return f"Socratic pressure: {pressure_score}/10 (CHALLENGING). Pure Socratic method. Ask 2-3 questions per response. Minimal hints. Let them discover. Only give direct answers if stuck for 3+ messages."


def build_prompt_legacy(memory_layers: Dict, current_message: str) -> str:
    """Legacy full-prompt builder for low-confidence intent fallback."""
    consolidated = memory_layers.get("consolidated_memory", {})
    working = memory_layers.get("working_memory", {})
    episodic = memory_layers.get("episodic_memory", {})
    semantic = memory_layers.get("semantic_memory", {})
    procedural = memory_layers.get("procedural_memory", {})

    sections = [WAXPREP_IDENTITY_LEGACY]
    sections.append("STATE: TEACHING — Explain concept clearly. After explanation, ask ONE check question.")

    student_context = ["STUDENT CONTEXT:"]
    name = consolidated.get("student_name", "")
    if name:
        student_context.append(f"Name: {name}")

    level = consolidated.get("class_level", "UNKNOWN")
    if level != "UNKNOWN":
        student_context.append(f"Level: {level}")

    exam = consolidated.get("exam_target", "")
    if exam:
        student_context.append(f"Exam: {exam}")

    exam_ctx = get_exam_context(consolidated.get("exam_date", ""))
    if exam_ctx:
        student_context.append(f"URGENT: {exam_ctx}")

    subject = procedural.get("current_subject", "")
    topic = procedural.get("current_topic", "")
    if subject:
        student_context.append(f"Studying: {subject}")
    if topic:
        student_context.append(f"Topic: {topic}")

    emotional = procedural.get("last_emotional_state", "neutral")
    if emotional in ("frustrated", "anxious", "discouraged"):
        student_context.append(f"Emotional state: {emotional}. Give them a win first.")

    pressure_score = procedural.get("last_socratic_pressure")
    if pressure_score is not None:
        socratic_ctx = get_socratic_context(pressure_score)
        if socratic_ctx:
            student_context.append(socratic_ctx)

    if semantic and semantic.get("nodes"):
        nodes = semantic["nodes"]
        mastered = [k.replace("_", " ") for k, v in nodes.items() if (v.get("mastery_score", 0) if isinstance(v, dict) else v.mastery_score) >= 70]
        struggling = [k.replace("_", " ") for k, v in nodes.items() if (v.get("mastery_score", 0) if isinstance(v, dict) else v.mastery_score) < 40]
        if mastered:
            student_context.append(f"Mastered: {', '.join(mastered[:5])}")
        if struggling:
            student_context.append(f"Struggling: {', '.join(struggling[:4])}")

    is_new = not consolidated.get("onboarding_complete", False)
    if is_new:
        student_context.append("NEW STUDENT: Do not give a welcome speech. Ask ONE natural question. Max 3 sentences.")
    else:
        gap = get_gap_context(consolidated.get("joined_at", ""))
        if gap:
            student_context.append(f"RETURNING: {gap} Reference last topic naturally.")

    dna = {
        "example_preference": procedural.get("example_preference", "general"),
        "pidgin_comfort": procedural.get("pidgin_preference", "adaptive"),
        "frustration_threshold": procedural.get("frustration_threshold", 3),
        "correct_first_try_rate": procedural.get("correct_first_try_rate", 0.5),
    }
    dna_context = build_dna_context(dna)
    if dna_context:
        student_context.append(f"How this student learns: {dna_context}")

    sections.append("\n".join(student_context))

    if episodic:
        recent = episodic.get("recent", [])
        if recent:
            memory_parts = ["MEMORY:"]
            for mem in recent[:3]:
                if isinstance(mem, dict):
                    memory_parts.append(f"- {mem.get('memory_type', '')}: {mem.get('description', '')}")
            sections.append("\n".join(memory_parts))

    if messages := working.get("messages", []):
        history_lines = ["RECENT CONVERSATION:"]
        for msg in messages[-10:]:
            role = "Student" if msg["role"] == "user" else "WaxPrep"
            history_lines.append(f"{role}: {msg['content'][:250]}")
        sections.append("\n".join(history_lines))

    sections.append(f"Time context: {get_time_context()}")
    sections.append(f"\nSTUDENT MESSAGE:\n{current_message}")
    sections.append("\nRespond as WaxPrep. Be warm, natural, Nigerian. Embed tools silently.")

    return "\n\n".join(sections)


def build_prompt(memory_layers: Dict, current_message: str) -> str:
    """Wrapper that decides which prompt to use."""
    return build_prompt_legacy(memory_layers, current_message)


def build_tool_result_prompt(original_prompt: str, tool_results: Dict) -> str:
    result_lines = ["TOOL RESULTS (use this information in your response):"]
    for tool_name, result in tool_results.items():
        if result:
            result_lines.append(f"{tool_name}: {result}")
    result_block = "\n".join(result_lines)
    return original_prompt.replace("\nRespond as WaxPrep.", f"\n{result_block}\n\nNow respond as WaxPrep incorporating this data naturally:")
