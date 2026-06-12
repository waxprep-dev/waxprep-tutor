"""
================================================================================
GUARDRAIL v4.0 - RESPONSE VALIDATION
================================================================================

FIXED: Now correctly handles all edge cases including emoji names.
IMPROVED: Better sentence counting, more robust checks.
================================================================================
"""

import re
from typing import Dict, Any, Tuple
from loguru import logger


def check_response(response: str, intent: Dict[str, Any]) -> Tuple[bool, str]:
    if not response or not response.strip():
        return False, "Empty response"

    response = response.strip()
    primary = intent.get("primary", "CHAT")
    secondary = intent.get("secondary")

    # RULE 1: FRUSTRATED -> NO QUESTIONS AT ALL
    if primary == "FRUSTRATED" or secondary == "FRUSTRATED":
        if "?" in response:
            return False, "AI asked a question when student is frustrated"

        first_part = response[:80].lower()
        warmth_words = ["sorry", "no wahala", "don't worry", "it's okay", "no problem", "hey", "hmm"]
        has_warmth = any(w in first_part for w in warmth_words)
        apology_phrases = ["let me try", "i'll explain", "let me break", "simpler", "easier"]
        has_apology = any(p in first_part for p in apology_phrases)

        if not has_warmth and not has_apology:
            return False, "AI did not acknowledge frustration first"

    # RULE 2: GOODBYE -> ONE SENTENCE ONLY
    if primary == "GOODBYE":
        sentences = [s.strip() for s in re.split(r'[.!?]+', response) if s.strip()]
        if len(sentences) > 1:
            return False, f"Goodbye has {len(sentences)} sentences, max 1"
        if len(response) > 120:
            return False, f"Goodbye too long ({len(response)} chars), max 120"
        if "?" in response:
            return False, "Goodbye should not ask questions"

    # RULE 3: TEACH -> NO QUESTION IN FIRST HALF
    if primary == "TEACH":
        mid = len(response) // 2
        first_half = response[:mid]
        if "?" in first_half:
            return False, "AI asked question before teaching"

        teaching_indicators = ["is", "means", "works", "happens", "example", "because", "when", "if", "refers", "defined"]
        has_teaching = any(ind in response.lower() for ind in teaching_indicators)
        if not has_teaching:
            return False, "AI did not explain anything"

    # RULE 4: CONFUSED -> NO QUESTIONS AT ALL
    if primary == "CONFUSED":
        if "?" in response:
            return False, "AI asked question when student is confused"
        explain_indicators = ["is", "means", "think of it", "imagine", "like", "example", "picture"]
        has_explain = any(ind in response.lower() for ind in explain_indicators)
        if not has_explain:
            return False, "AI did not re-explain"

    # RULE 5: QUESTION -> ANSWER FIRST, THEN ONE QUESTION
    if primary == "QUESTION":
        questions = response.count("?")
        if questions > 1:
            return False, f"AI asked {questions} questions, max 1"

    # RULE 6: CHAT -> BRIEF
    if primary == "CHAT":
        sentences = [s.strip() for s in re.split(r'[.!?]+', response) if s.strip()]
        if len(sentences) > 3:
            return False, f"Chat response too long ({len(sentences)} sentences), max 3"
        if len(response) > 250:
            return False, f"Chat response too long ({len(response)} chars), max 250"

    # RULE 7: NEVER USE FORBIDDEN PHRASES
    forbidden = [
        "certainly", "of course", "absolutely", "great question",
        "i'm proud of you", "as an ai", "i cannot access", "my brother",
        "i apologize for the confusion", "as a language model",
    ]
    for phrase in forbidden:
        if phrase in response.lower():
            return False, f"AI used forbidden phrase: '{phrase}'"

    # RULE 8: USE STUDENT NAME IF KNOWN (FIXED: handles edge cases)
    name = intent.get("student_name", "")
    if name and len(name) > 1 and name.lower() not in ["student", "there", "friend"]:
        # Only check for non-goodbye, non-chat intents
        if primary not in ["GOODBYE", "CHAT"]:
            # Extract alphanumeric from name for comparison
            clean_name = re.sub(r'[^\w]', '', name.lower())
            clean_response = re.sub(r'[^\w]', '', response.lower())
            if clean_name not in clean_response:
                sentences = [s.strip() for s in re.split(r'[.!?]+', response) if s.strip()]
                if len(sentences) > 2:
                    return False, f"AI did not use student name '{name}' in response"

    # RULE 9: MAX LENGTH CHECK
    rules = {
        "TEACH": 800,
        "FRUSTRATED": 500,
        "GOODBYE": 120,
        "QUESTION": 700,
        "CHAT": 250,
        "CONFUSED": 500,
    }
    max_len = rules.get(primary, 600)
    if len(response) > max_len:
        return False, f"Response too long ({len(response)} chars), max {max_len}"

    # RULE 10: NO REPETITION
    words = response.lower().split()
    for i in range(len(words) - 6):
        phrase = " ".join(words[i:i+6])
        if phrase in " ".join(words[i+6:]):
            return False, "AI is repeating itself"

    return True, "passed"


def get_stricter_instruction(intent: Dict[str, Any], failed_reason: str) -> str:
    primary = intent.get("primary", "CHAT")
    stricter = {
        "TEACH": "CRITICAL: You MUST explain first. NO questions in the first half. EXPLAIN IMMEDIATELY.",
        "FRUSTRATED": "CRITICAL: Student is FRUSTRATED. NO QUESTIONS AT ALL. Start with warmth. Then explain simply.",
        "GOODBYE": "CRITICAL: ONE sentence goodbye ONLY. No questions. No teaching. Nothing else.",
        "QUESTION": "CRITICAL: ANSWER the question FIRST. Then ONE check question. No more.",
        "CHAT": "CRITICAL: Keep it to 3 sentences max. Brief and warm.",
        "CONFUSED": "CRITICAL: RE-EXPLAIN differently. NO QUESTIONS. Simpler words.",
    }
    base = stricter.get(primary, "CRITICAL: Follow the rules exactly.")
    if "question" in failed_reason.lower():
        base += " DO NOT ask any questions."
    if "long" in failed_reason.lower():
        base += " Keep it SHORT."
    if "forbidden" in failed_reason.lower():
        base += " Use natural Nigerian language."
    return base


def safe_fallback(intent: Dict[str, Any]) -> str:
    primary = intent.get("primary", "CHAT")
    name = intent.get("student_name", "")
    topic = intent.get("topic", "")
    subject = intent.get("subject", "")
    greeting = name if name else "there"

    safe_responses = {
        "TEACH": f"No wahala {greeting}, let me explain {topic or subject or 'this'} simply.",
        "FRUSTRATED": f"No wahala {greeting}, let me try a simpler way.",
        "GOODBYE": f"Good night {greeting}!",
        "QUESTION": f"Let me answer that, {greeting}.",
        "CHAT": f"Hey {greeting}! What subject are we studying?",
        "CONFUSED": f"Let me explain that differently, {greeting}.",
    }
    return safe_responses.get(primary, f"I'm here {greeting}, what do you need?")
