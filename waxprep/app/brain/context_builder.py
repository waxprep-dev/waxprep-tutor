import pytz
from datetime import datetime, timezone
from typing import Dict, Any
from loguru import logger

NIGERIA_TZ = pytz.timezone("Africa/Lagos")

# Chief Developer's Rules — mapped to intents
# These are NOT put in the prompt. They are used to BUILD the instruction.
INTENT_RULES = {
    "TEACH": {
        "must": ["EXPLAIN immediately", "NO questions first"],
        "can": ["ONE check question at the END", "Use Nigerian examples"],
        "never": ["Ask what they think", "Ask more than 1 question"],
        "tone": "direct",
        "max_sentences": 4,
    },
    "FRUSTRATED": {
        "must": ["ONE sentence of warmth first", "Then explain simplest version", "NO questions at all"],
        "can": ["Different analogy from before", "Use Pidgin if student uses it"],
        "never": ["Ask questions", "Make them feel stupid", "Repeat failed explanation"],
        "tone": "warm",
        "max_sentences": 3,
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
        "max_sentences": 4,
    },
    "CHAT": {
        "must": ["Be warm and brief", "Redirect to learning gently"],
        "can": ["Ask what subject they want", "Use their name"],
        "never": ["Be too long", "Ignore them", "Force teaching immediately"],
        "tone": "warm",
        "max_sentences": 2,
    },
    "CONFUSED": {
        "must": ["RE-EXPLAIN differently", "NO questions", "Simpler language"],
        "can": ["Use different analogy", "Use Pidgin", "Break into smaller steps"],
        "never": ["Ask what they think", "Repeat same explanation", "Use big words"],
        "tone": "patient",
        "max_sentences": 3,
    },
}


def _get_time_context() -> str:
    """Get time of day in Nigeria for context."""
    now = datetime.now(timezone.utc).astimezone(NIGERIA_TZ)
    hour = now.hour
    
    if 0 <= hour < 5:
        return "very late night — student is tired, keep it short"
    elif 5 <= hour < 9:
        return "early morning"
    elif 9 <= hour < 12:
        return "morning"
    elif 12 <= hour < 14:
        return "afternoon"
    elif 14 <= hour < 17:
        return "afternoon"
    elif 17 <= hour < 21:
        return "evening"
    else:
        return "night — student may be tired"


def _get_student_name_greeting(name: str) -> str:
    """How to address the student."""
    if name:
        return f"{name}"
    return "Student"


def build_context(intent: Dict[str, Any]) -> str:
    """
    Build a 1-2 sentence instruction for the AI based on rich intent.
    
    This is the KEY function. It takes the rich intent and outputs
    a focused instruction that the AI MUST follow.
    
    The instruction is 1-2 sentences max. The AI sees ONLY this.
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
    class_level = intent.get("class_level", "UNKNOWN")
    
    # Build the instruction piece by piece
    parts = []
    
    # === PART 1: Who is this and what do they want? ===
    name_part = _get_student_name_greeting(name)
    
    if primary == "TEACH":
        if topic:
            parts.append(f"{name_part} wants to learn {topic}" + (f" in {subject}" if subject else "") + ".")
        elif subject:
            parts.append(f"{name_part} wants to learn {subject}.")
        else:
            parts.append(f"{name_part} wants to learn something.")
    
    elif primary == "FRUSTRATED":
        parts.append(f"{name_part} is frustrated and struggling.")
        if topic:
            parts.append(f"They're stuck on {topic}.")
    
    elif primary == "GOODBYE":
        parts.append(f"{name_part} is leaving.")
    
    elif primary == "QUESTION":
        if topic:
            parts.append(f"{name_part} asked about {topic}" + (f" in {subject}" if subject else "") + ".")
        else:
            parts.append(f"{name_part} asked a question.")
    
    elif primary == "CHAT":
        parts.append(f"{name_part} is chatting.")
    
    elif primary == "CONFUSED":
        if topic:
            parts.append(f"{name_part} is confused about {topic}.")
        else:
            parts.append(f"{name_part} is confused.")
    
    # === PART 2: What MUST the AI do? (The rules) ===
    must_rules = rules.get("must", [])
    if must_rules:
        # Pick the most important 2 must-rules
        must_text = " ".join(must_rules[:2])
        parts.append(must_text + ".")
    
    # === PART 3: Special modifiers based on context ===
    
    # If secondary is FRUSTRATED, add warmth
    if secondary == "FRUSTRATED":
        parts.append("Be extra gentle. NO questions.")
    
    # If secondary is NEEDS_REEXPLAIN, emphasize different approach
    if secondary == "NEEDS_REEXPLAIN":
        parts.append("Use a completely different explanation.")
    
    # If emotional state is frustrated, reinforce no questions
    if emotional_state == "frustrated" and primary not in ["FRUSTRATED", "GOODBYE"]:
        parts.append("Student was recently frustrated — be careful.")
    
    # If pidgin is heavy, mention it
    if pidgin == "heavy":
        parts.append("Respond in Nigerian Pidgin.")
    elif pidgin == "adaptive":
        # Check if original message has Pidgin
        original = intent.get("original_message", "").lower()
        pidgin_words = ["abeg", "omo", "na ", "wetin", "dey ", "make i", "sha ", "sef ", "how far", "i dey", "no wahala"]
        if any(w in original for w in pidgin_words):
            parts.append("Student uses Pidgin — match their style.")
    
    # If very late night, keep it short
    time_context = _get_time_context()
    if "very late night" in time_context or "night" in time_context:
        parts.append("Keep it very short — it's late.")
    
    # If low socratic pressure, be more direct
    if socratic_pressure is not None and socratic_pressure < 3.0 and primary == "TEACH":
        parts.append("Student frustrates easily — give direct answers.")
    
    # === PART 4: Length limit ===
    max_sentences = rules.get("max_sentences", 3)
    parts.append(f"Max {max_sentences} sentences.")
    
    # === COMBINE ===
    # Join all parts into 1-2 sentences
    full_instruction = " ".join(parts)
    
    # Clean up: remove extra spaces, ensure proper ending
    full_instruction = full_instruction.strip()
    if not full_instruction.endswith("."):
        full_instruction += "."
    
    # Log what we built
    logger.info(f"Context built: {full_instruction[:100]}...")
    
    return full_instruction


def build_focused_prompt(intent: Dict[str, Any], memory_layers: Dict[str, Any], student_message: str) -> str:
    """
    Build the COMPLETE tiny prompt that goes to the AI.
    
    Structure:
    1. Identity (2 sentences)
    2. Context (from build_context)
    3. Student message
    4. Tool reference (silent)
    """
    
    # === IDENTITY: 2 sentences max ===
    identity = "You are WaxPrep, a Nigerian teacher. Warm, direct, patient — you never make students feel stupid."
    
    # === CONTEXT: 1-2 sentences from build_context ===
    context = build_context(intent)
    
    # === STUDENT MESSAGE ===
    message = f"Student: {student_message}"
    
    # === TOOLS (silent, invisible to student) ===
    # We keep this minimal — just remind AI tools exist
    tools = "Use tools silently when you detect useful info."
    
    # === COMBINE ===
    # Total: ~100-150 tokens. Very focused.
    prompt = f"{identity}\n\n{context}\n\n{message}\n\n{tools}"
    
    return prompt


def get_fallback_response(intent: Dict[str, Any]) -> str:
    """
    If AI fails completely, send a safe fallback.
    """
    primary = intent.get("primary", "CHAT")
    name = intent.get("student_name", "")
    greeting = name if name else "there"
    
    fallbacks = {
        "TEACH": f"No wahala {greeting}, let me explain that properly. One moment.",
        "FRUSTRATED": f"Sorry {greeting}, let me try a simpler way. No questions, just explanation.",
        "GOODBYE": f"Good night {greeting}! See you next time.",
        "QUESTION": f"Let me get that answer for you, {greeting}.",
        "CHAT": f"Hey {greeting}! What subject are we working on today?",
        "CONFUSED": f"Let me explain that differently, {greeting}. Simpler this time.",
    }
    
    return fallbacks.get(primary, f"Hey {greeting}, I'm here. What do you need?")
