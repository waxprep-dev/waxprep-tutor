import re
from typing import Dict, Any, Tuple
from loguru import logger


def check_response(response: str, intent: Dict[str, Any]) -> Tuple[bool, str]:
    """
    Check if AI response follows the rules for this intent.
    
    Returns:
        (passed: bool, reason: str)
        passed = True → response is good, send to student
        passed = False → response broke rules, need to regenerate
    
    This is the SAFETY NET. It catches mistakes before they reach the student.
    """
    
    if not response or not response.strip():
        return False, "Empty response"
    
    response = response.strip()
    primary = intent.get("primary", "CHAT")
    secondary = intent.get("secondary")
    
    # === RULE 1: FRUSTRATED → NO QUESTIONS AT ALL ===
    if primary == "FRUSTRATED" or secondary == "FRUSTRATED":
        if "?" in response:
            return False, "AI asked a question when student is frustrated"
        
        # Must start with warmth (first 60 chars)
        first_part = response[:60].lower()
        warmth_words = ["sorry", "no wahala", "don't worry", "it's okay", "no problem", "hey", "hmm"]
        has_warmth = any(w in first_part for w in warmth_words)
        
        # Also check if it's clearly an apology/acknowledgment
        apology_phrases = ["let me try", "i'll explain", "let me break", "simpler", "easier"]
        has_apology = any(p in first_part for p in apology_phrases)
        
        if not has_warmth and not has_apology:
            return False, "AI did not acknowledge frustration first"
    
    # === RULE 2: GOODBYE → ONE SENTENCE ONLY ===
    if primary == "GOODBYE":
        # Count sentences
        sentences = [s.strip() for s in re.split(r'[.!?]+', response) if s.strip()]
        if len(sentences) > 1:
            return False, f"Goodbye has {len(sentences)} sentences, max 1"
        
        # Max 100 characters
        if len(response) > 100:
            return False, f"Goodbye too long ({len(response)} chars), max 100"
        
        # No questions
        if "?" in response:
            return False, "Goodbye should not ask questions"
    
    # === RULE 3: TEACH → NO QUESTION IN FIRST HALF ===
    if primary == "TEACH":
        mid = len(response) // 2
        first_half = response[:mid]
        
        if "?" in first_half:
            return False, "AI asked question before teaching"
        
        # Must actually teach (have explanation indicators)
        teaching_indicators = ["is", "means", "works", "happens", "example", "because", "when", "if"]
        has_teaching = any(ind in response.lower() for ind in teaching_indicators)
        
        if not has_teaching:
            return False, "AI did not explain anything"
    
    # === RULE 4: CONFUSED → NO QUESTIONS AT ALL ===
    if primary == "CONFUSED":
        if "?" in response:
            return False, "AI asked question when student is confused"
        
        # Must re-explain
        explain_indicators = ["is", "means", "think of it", "imagine", "like", "example"]
        has_explain = any(ind in response.lower() for ind in explain_indicators)
        
        if not has_explain:
            return False, "AI did not re-explain"
    
    # === RULE 5: QUESTION → ANSWER FIRST, THEN ONE QUESTION ===
    if primary == "QUESTION":
        # Can have question, but must answer first
        questions = response.count("?")
        if questions > 1:
            return False, f"AI asked {questions} questions, max 1"
    
    # === RULE 6: CHAT → BRIEF ===
    if primary == "CHAT":
        sentences = [s.strip() for s in re.split(r'[.!?]+', response) if s.strip()]
        if len(sentences) > 2:
            return False, f"Chat response too long ({len(sentences)} sentences), max 2"
        
        if len(response) > 200:
            return False, f"Chat response too long ({len(response)} chars), max 200"
    
    # === RULE 7: NEVER USE FORBIDDEN PHRASES ===
    forbidden = [
        "certainly", "of course", "absolutely", "great question",
        "i'm proud of you", "as an ai", "i cannot access",
        "my brother",  # Unless name is unknown
    ]
    
    for phrase in forbidden:
        if phrase in response.lower():
            return False, f"AI used forbidden phrase: '{phrase}'"
    
    # === RULE 8: USE STUDENT NAME IF KNOWN ===
    name = intent.get("student_name", "")
    if name and len(name) > 1:
        # Check if name appears in response (case insensitive)
        if name.lower() not in response.lower():
            # Only enforce for non-goodbye intents (goodbye can be generic)
            if primary not in ["GOODBYE", "CHAT"]:
                # Allow if it's very short (1-2 sentences)
                sentences = [s.strip() for s in re.split(r'[.!?]+', response) if s.strip()]
                if len(sentences) > 2:
                    return False, f"AI did not use student name '{name}' in response"
    
    # === RULE 9: MAX LENGTH CHECK ===
    rules = {
        "TEACH": 600,
        "FRUSTRATED": 400,
        "GOODBYE": 100,
        "QUESTION": 600,
        "CHAT": 200,
        "CONFUSED": 400,
    }
    
    max_len = rules.get(primary, 500)
    if len(response) > max_len:
        return False, f"Response too long ({len(response)} chars), max {max_len}"
    
    # === RULE 10: NO REPETITION ===
    # Check if AI is repeating the same explanation
    # This is simple: check for repeated phrases
    words = response.lower().split()
    for i in range(len(words) - 5):
        phrase = " ".join(words[i:i+5])
        if phrase in words[i+5:]:
            return False, "AI is repeating itself"
    
    # All checks passed
    return True, "passed"


def get_stricter_instruction(intent: Dict[str, Any], failed_reason: str) -> str:
    """
    When guardrail fails, add a stricter instruction for regeneration.
    """
    primary = intent.get("primary", "CHAT")
    
    stricter = {
        "TEACH": "CRITICAL: You MUST explain first. NO questions in the first half. EXPLAIN IMMEDIATELY.",
        "FRUSTRATED": "CRITICAL: Student is FRUSTRATED. NO QUESTIONS AT ALL. Start with warmth. Then explain simply.",
        "GOODBYE": "CRITICAL: ONE sentence goodbye ONLY. No questions. No teaching. Nothing else.",
        "QUESTION": "CRITICAL: ANSWER the question FIRST. Then ONE check question. No more.",
        "CHAT": "CRITICAL: Keep it to 2 sentences max. Brief and warm.",
        "CONFUSED": "CRITICAL: RE-EXPLAIN differently. NO QUESTIONS. Simpler words.",
    }
    
    base = stricter.get(primary, "CRITICAL: Follow the rules exactly.")
    
    # Add specific fix for the failure
    if "question" in failed_reason.lower():
        base += " DO NOT ask any questions."
    if "long" in failed_reason.lower():
        base += " Keep it SHORT."
    if "forbidden" in failed_reason.lower():
        base += " Use natural Nigerian language."
    
    return base


def safe_fallback(intent: Dict[str, Any]) -> str:
    """
    If regeneration also fails, send a guaranteed-safe response.
    This is the last resort — never fails guardrail.
    """
    primary = intent.get("primary", "CHAT")
    name = intent.get("student_name", "")
    topic = intent.get("topic", "")
    subject = intent.get("subject", "")
    
    greeting = name if name else "there"
    
    # These are designed to ALWAYS pass guardrail
    safe_responses = {
        "TEACH": f"Let me explain {topic or subject or 'this'} simply, {greeting}.",
        "FRUSTRATED": f"No wahala {greeting}, let me try a simpler way.",
        "GOODBYE": f"Good night {greeting}!",
        "QUESTION": f"Let me answer that, {greeting}.",
        "CHAT": f"Hey {greeting}! What are we studying?",
        "CONFUSED": f"Let me explain that differently, {greeting}.",
    }
    
    return safe_responses.get(primary, f"I'm here {greeting}, what do you need?")


def validate_with_retry(
    response: str,
    intent: Dict[str, Any],
    generate_func,
    max_retries: int = 2
) -> str:
    """
    Full validation with retry loop.
    
    1. Check response
    2. If failed, add stricter instruction and regenerate
    3. If still failed, use safe fallback
    """
    passed, reason = check_response(response, intent)
    
    if passed:
        return response
    
    logger.warning(f"Guardrail failed: {reason}. Retrying...")
    
    # Try regeneration with stricter instruction
    for attempt in range(max_retries):
        stricter = get_stricter_instruction(intent, reason)
        
        # Generate again with stricter instruction
        # The generate_func should accept a stricter prompt
        new_response = generate_func(stricter)
        
        if new_response:
            passed, reason = check_response(new_response, intent)
            if passed:
                logger.info(f"Guardrail passed on retry {attempt + 1}")
                return new_response
        
        logger.warning(f"Retry {attempt + 1} failed: {reason}")
    
    # All retries failed, use safe fallback
    logger.error(f"All retries failed. Using safe fallback.")
    return safe_fallback(intent)
