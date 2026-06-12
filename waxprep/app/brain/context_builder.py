"""
================================================================================
CONTEXT BUILDER v4.0 - THE AI ACTUALLY KNOWS THE STUDENT NOW
================================================================================

CRITICAL FIX: The previous version built a ~100 token prompt with NO context.
This version builds a rich, structured prompt with FULL memory context that
makes the AI feel like a real tutor who remembers everything.

The prompt includes:
1. Identity (who WaxPrep is)
2. Student profile (name, level, exam, learning style)
3. Current session state (what they're learning right now)
4. Knowledge map (what they know, what they struggle with)
5. Recent conversation (last 10 messages)
6. Episodic memories (breakthroughs, struggles)
7. Teaching instructions based on intent
8. Curriculum context (Nigerian exam focus)

KEY IMPROVEMENTS:
1. Full memory context from ALL 7 layers
2. Nigerian curriculum alignment (WAEC, NECO, JAMB)
3. Adaptive teaching style based on procedural memory
4. Emotional awareness in every response
5. Subject-agnostic but structured teaching
6. Proper onboarding flow detection
================================================================================
"""

import pytz
from datetime import datetime, timezone
from typing import Dict, Any
from loguru import logger

NIGERIA_TZ = pytz.timezone("Africa/Lagos")

INTENT_RULES = {
    "TEACH": {
        "must": ["EXPLAIN immediately", "NO questions first"],
        "can": ["ONE check question at the END", "Use Nigerian examples"],
        "never": ["Ask what they think", "Ask more than 1 question"],
        "tone": "direct",
        "max_sentences": 6,
    },
    "FRUSTRATED": {
        "must": ["ONE sentence of warmth first", "Then explain simplest version", "NO questions at all"],
        "can": ["Different analogy from before", "Use Pidgin if student uses it"],
        "never": ["Ask questions", "Make them feel stupid", "Repeat failed explanation"],
        "tone": "warm",
        "max_sentences": 4,
    },
    "GOODBYE": {
        "must": ["ONE warm goodbye sentence", "Nothing else"],
        "can": ["Use student name", "Say 'see you tomorrow' if late night"],
        "never": ["Ask questions", "Teach anything", "Be longer than 1 sentence"],
        "tone": "warm",
        "max_sentences": 1,
    },
    "QUESTION": {
        "must": ["ANSWER DIRECTLY first", "Then ONE check question"],
        "can": ["Use Nigerian example", "Connect to what they know"],
        "never": ["Ask before answering", "Give vague answer", "Ask more than 1 question"],
        "tone": "direct",
        "max_sentences": 5,
    },
    "CHAT": {
        "must": ["Be warm and brief", "Redirect to learning gently"],
        "can": ["Ask what subject they want", "Use their name"],
        "never": ["Be too long", "Ignore them", "Force teaching immediately"],
        "tone": "warm",
        "max_sentences": 3,
    },
    "CONFUSED": {
        "must": ["RE-EXPLAIN differently", "NO questions", "Simpler language"],
        "can": ["Use different analogy", "Use Pidgin", "Break into smaller steps"],
        "never": ["Ask what they think", "Repeat same explanation", "Use big words"],
        "tone": "patient",
        "max_sentences": 4,
    },
}


def _get_time_context() -> str:
    now = datetime.now(timezone.utc).astimezone(NIGERIA_TZ)
    hour = now.hour
    if 0 <= hour < 5:
        return "very late night - student is tired, keep it short"
    elif 5 <= hour < 9:
        return "early morning"
    elif 9 <= hour < 12:
        return "morning"
    elif 12 <= hour < 17:
        return "afternoon"
    elif 17 <= hour < 21:
        return "evening"
    else:
        return "night - student may be tired"


def _build_student_profile_section(intent: Dict, memory_layers: Dict) -> str:
    """Build rich student profile from consolidated + procedural memory."""
    consolidated = memory_layers.get("consolidated_memory", {})
    procedural = memory_layers.get("procedural_memory", {})

    parts = []
    name = intent.get("student_name", "")
    if name:
        parts.append(f"Student: {name}")

    level = intent.get("class_level", "UNKNOWN")
    if level and level != "UNKNOWN":
        parts.append(f"Level: {level}")

    exam = consolidated.get("exam_target", "")
    if exam:
        parts.append(f"Exam: {exam}")
        days = consolidated.get("days_until_exam", 0)
        if 0 < days <= 7:
            parts.append(f"URGENT: Exam in {days} days!")
        elif days <= 30:
            parts.append(f"Exam in {days} days")

    # Learning style
    style = procedural.get("preferred_teaching_style", "adaptive")
    if style != "adaptive":
        parts.append(f"Teaching style: {style}")

    # Explanation depth
    depth = procedural.get("explanation_depth", "moderate")
    if depth != "moderate":
        parts.append(f"Explanation depth: {depth}")

    # Example preference
    example_pref = procedural.get("example_preference", "general")
    if example_pref and example_pref != "general":
        parts.append(f"Examples: Use {example_pref}-related examples")

    # Pidgin
    pidgin = intent.get("pidgin_preference", "adaptive")
    if pidgin == "heavy":
        parts.append("Language: Student uses Nigerian Pidgin heavily")

    # Socratic pressure
    pressure = intent.get("socratic_pressure", 5.0)
    if pressure is not None:
        if pressure < 3:
            parts.append("Student frustrates easily - be gentle")
        elif pressure > 7:
            parts.append("Student likes challenges - push them")

    # Streak
    streak = procedural.get("streak_days", 0)
    if streak > 3:
        parts.append(f"Study streak: {streak} days")

    return " | ".join(parts) if parts else "New student - no profile yet"


def _build_knowledge_section(intent: Dict, memory_layers: Dict) -> str:
    """Build knowledge map summary for the prompt."""
    semantic = memory_layers.get("semantic_memory", {})
    mastered = intent.get("mastered_concepts", [])
    struggling = intent.get("struggling_concepts", [])

    parts = []
    if mastered:
        parts.append(f"Strong: {', '.join(mastered[:5])}")
    if struggling:
        parts.append(f"Needs work: {', '.join(struggling[:5])}")

    # Forgetting alerts
    alerts = memory_layers.get("forgetting_alerts", [])
    if alerts:
        parts.append(f"Forgetting: {', '.join(alerts[:3])}")

    return " | ".join(parts) if parts else "No knowledge data yet"


def _build_episodic_section(memory_layers: Dict) -> str:
    """Build episodic memory summary for the prompt."""
    episodic = memory_layers.get("episodic_memory", {})

    parts = []
    breakthroughs = episodic.get("breakthroughs", [])
    if breakthroughs:
        recent = breakthroughs[:2]
        descs = [b.get("description", "") if isinstance(b, dict) else b.description for b in recent]
        parts.append(f"Breakthroughs: {'; '.join(descs)}")

    struggles = episodic.get("struggles", [])
    if struggles:
        recent = struggles[:2]
        descs = [s.get("description", "") if isinstance(s, dict) else s.description for s in recent]
        parts.append(f"Past struggles: {'; '.join(descs)}")

    return " | ".join(parts) if parts else ""


def _build_recent_conversation(memory_layers: Dict, max_messages: int = 10) -> str:
    """Build recent conversation history for the prompt."""
    working = memory_layers.get("working_memory", {})
    messages = working.get("messages", [])

    if not messages:
        return ""

    lines = ["Recent chat:"]
    for msg in messages[-max_messages:]:
        role = "Student" if msg.get("role") == "user" else "WaxPrep"
        content = msg.get("content", "")[:150]
        lines.append(f"{role}: {content}")

    return "\n".join(lines)


def _build_onboarding_context(intent: Dict) -> str:
    """Build context for students who need onboarding."""
    if not intent.get("needs_onboarding") and intent.get("onboarding_complete"):
        return ""

    parts = ["ONBOARDING NEEDED:"]

    if not intent.get("student_name"):
        parts.append("Ask student's name naturally")
    if not intent.get("class_level") or intent.get("class_level") == "UNKNOWN":
        parts.append("Ask class level (JS1-SS3, or university)")
    if not intent.get("subject"):
        parts.append("Ask what subject they want to study")
    if not intent.get("class_level") or intent.get("class_level") == "UNKNOWN":
        parts.append("Ask which exam: WAEC, NECO, or JAMB")

    return "\n".join(parts)


def build_context(intent: Dict[str, Any], memory_layers: Dict[str, Any]) -> str:
    """
    Build a COMPREHENSIVE instruction for the AI based on rich intent + memory.
    This is the KEY function. The output goes directly into the prompt.
    """
    primary = intent.get("primary", "CHAT")
    secondary = intent.get("secondary")
    rules = INTENT_RULES.get(primary, INTENT_RULES["CHAT"])

    name = intent.get("student_name", "")
    subject = intent.get("subject", "")
    topic = intent.get("topic", "")
    emotional_state = intent.get("emotional_state", "neutral")
    pidgin = intent.get("pidgin_preference", "adaptive")
    socratic_pressure = intent.get("socratic_pressure", 5.0)

    parts = []

    # === PART 1: Who is this student? ===
    profile = _build_student_profile_section(intent, memory_layers)
    parts.append(f"[PROFILE] {profile}")

    # === PART 2: What do they want? ===
    if primary == "TEACH":
        if topic:
            parts.append(f"[GOAL] {name or 'Student'} wants to learn: {topic}" + (f" in {subject}" if subject else ""))
        elif subject:
            parts.append(f"[GOAL] {name or 'Student'} wants to learn {subject}")
        else:
            parts.append(f"[GOAL] {name or 'Student'} wants to learn something")

        # NEW: Add knowledge context
        knowledge = _build_knowledge_section(intent, memory_layers)
        if knowledge:
            parts.append(f"[KNOWLEDGE] {knowledge}")

    elif primary == "FRUSTRATED":
        parts.append(f"[GOAL] {name or 'Student'} is frustrated and struggling")
        if topic:
            parts.append(f"[TOPIC] Stuck on: {topic}")

    elif primary == "GOODBYE":
        parts.append(f"[GOAL] {name or 'Student'} is leaving")

    elif primary == "QUESTION":
        if topic:
            parts.append(f"[GOAL] {name or 'Student'} asked about {topic}" + (f" in {subject}" if subject else ""))
        else:
            parts.append(f"[GOAL] {name or 'Student'} asked a question")

    elif primary == "CHAT":
        parts.append(f"[GOAL] {name or 'Student'} is chatting")

    elif primary == "CONFUSED":
        if topic:
            parts.append(f"[GOAL] {name or 'Student'} is confused about {topic}")
        else:
            parts.append(f"[GOAL] {name or 'Student'} is confused")

    # === PART 3: What MUST the AI do? ===
    must_rules = rules.get("must", [])
    if must_rules:
        parts.append(f"[RULES] {' '.join(must_rules)}")

    # === PART 4: Episodic memory context ===
    episodic = _build_episodic_section(memory_layers)
    if episodic:
        parts.append(f"[MEMORY] {episodic}")

    # === PART 5: Special modifiers ===
    if secondary == "FRUSTRATED":
        parts.append("[MODIFIER] Be extra gentle. NO questions.")

    if secondary == "NEEDS_REEXPLAIN":
        parts.append("[MODIFIER] Use a completely different explanation.")

    if secondary == "NEEDS_SUBJECT":
        parts.append("[MODIFIER] Ask what subject they want to study.")

    if emotional_state == "frustrated" and primary not in ["FRUSTRATED", "GOODBYE"]:
        parts.append("[MODIFIER] Student was recently frustrated - be careful.")

    if pidgin == "heavy":
        parts.append("[MODIFIER] Respond in Nigerian Pidgin.")
    elif pidgin == "adaptive":
        original = intent.get("original_message", "").lower()
        pidgin_words = ["abeg", "omo", "na ", "wetin", "dey ", "make i", "sha ", "sef ", "how far", "i dey", "no wahala"]
        if any(w in original for w in pidgin_words):
            parts.append("[MODIFIER] Student uses Pidgin - match their style.")

    time_context = _get_time_context()
    if "very late night" in time_context or "night" in time_context:
        parts.append("[MODIFIER] Keep it very short - it's late.")

    if socratic_pressure is not None and socratic_pressure < 3.0 and primary == "TEACH":
        parts.append("[MODIFIER] Student frustrates easily - give direct answers.")

    # === PART 6: Max length ===
    max_sentences = rules.get("max_sentences", 3)
    parts.append(f"[LIMIT] Max {max_sentences} sentences.")

    # === COMBINE ===
    full_instruction = "\n".join(parts)
    logger.info(f"Context built: {len(full_instruction)} chars | intent={primary}" + (f"+{secondary}" if secondary else ""))

    return full_instruction


def build_focused_prompt(intent: Dict[str, Any], memory_layers: Dict[str, Any], student_message: str) -> str:
    """
    Build the COMPLETE prompt that goes to the AI.
    v4.0: Now includes FULL memory context. Was ~100 tokens, now ~800-1200 tokens.
    """
    # === IDENTITY ===
    identity = (
        "You are WaxPrep, a brilliant Nigerian teacher for WAEC, NECO, JAMB students. "
        "You are warm, direct, patient, and never make students feel stupid. "
        "You connect every concept to Nigerian everyday life. "
        "You speak natural Nigerian English and switch to Pidgin when appropriate."
    )

    # === CONTEXT (rich, memory-aware) ===
    context = build_context(intent, memory_layers)

    # === ONBOARDING ===
    onboarding = _build_onboarding_context(intent)

    # === RECENT CONVERSATION ===
    recent_chat = _build_recent_conversation(memory_layers, max_messages=8)

    # === CURRENT TOPIC ===
    subject = intent.get("subject", "")
    topic = intent.get("topic", "")
    current_focus = ""
    if subject or topic:
        current_focus = f"Current focus: {topic or 'general'}" + (f" in {subject}" if subject else "")

    # === STUDENT MESSAGE ===
    message = f"Student message: {student_message}"

    # === COMBINE ===
    sections = [identity, "---", context]

    if current_focus:
        sections.append(f"---\n{current_focus}")

    if onboarding:
        sections.append(f"---\n{onboarding}")

    if recent_chat:
        sections.append(f"---\n{recent_chat}")

    sections.append(f"---\n{message}")
    sections.append("---\nRespond as WaxPrep. Be warm, natural, Nigerian. Embed tools silently.")

    prompt = "\n\n".join(sections)
    return prompt


def get_fallback_response(intent: Dict[str, Any]) -> str:
    primary = intent.get("primary", "CHAT")
    name = intent.get("student_name", "")
    greeting = name if name else "there"
    topic = intent.get("topic", "")
    subject = intent.get("subject", "")

    fallbacks = {
        "TEACH": f"No wahala {greeting}, let me explain {topic or subject or 'this'} properly. One moment.",
        "FRUSTRATED": f"Sorry {greeting}, let me try a simpler way. No questions, just explanation.",
        "GOODBYE": f"Good night {greeting}! See you next time.",
        "QUESTION": f"Let me get that answer for you, {greeting}.",
        "CHAT": f"Hey {greeting}! What subject are we working on today?",
        "CONFUSED": f"Let me explain that differently, {greeting}. Simpler this time.",
    }

    return fallbacks.get(primary, f"Hey {greeting}, I'm here. What do you need?")
