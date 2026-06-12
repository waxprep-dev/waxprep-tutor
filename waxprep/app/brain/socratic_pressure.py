"""
================================================================================
SOCRATIC PRESSURE v4.0 - ADAPTIVE TEACHING INTENSITY
================================================================================
Unchanged from v3.0 - this module was well-designed.
================================================================================
"""
from typing import Dict, Tuple
from loguru import logger

def analyze_interaction(student_message: str, ai_response: str) -> Dict[str, int]:
    msg_lower = student_message.lower()
    correct_indicators = [
        "yes", "correct", "right", "i understand", "got it", "makes sense",
        "sharp", "true", "exactly", "that's it", "now i get", "i see", "clear"
    ]
    correct = 1 if any(w in msg_lower for w in correct_indicators) else 0

    help_indicators = [
        "help", "explain", "i don't get", "confused", "how do you", "show me",
        "break it down", "simplify", "easier", "don't understand", "abeg explain"
    ]
    help_asked = 1 if any(w in msg_lower for w in help_indicators) else 0

    frustration_indicators = [
        "give up", "forget it", "too hard", "hopeless", "abeg forget",
        "i don't understand", "this is hard", "impossible", "waste of time"
    ]
    frustrated = 1 if any(w in msg_lower for w in frustration_indicators) else 0

    gave_up_indicators = [
        "next", "move on", "skip", "later", "another topic", "forget this",
        "i'm done", "stop", "enough"
    ]
    gave_up = 1 if any(w in msg_lower for w in gave_up_indicators) else 0

    return {"correct": correct, "help_asked": help_asked, "frustrated": frustrated, "gave_up": gave_up}

def calculate_pressure(current_score: float, signals: Dict[str, int]) -> Tuple[float, str]:
    change = 0.0
    if signals["correct"] == 1 and signals["help_asked"] == 0:
        change = +0.8
        reason = "student_solved_without_hint"
    elif signals["correct"] == 1 and signals["help_asked"] == 1:
        change = +0.3
        reason = "student_solved_with_help"
    elif signals["help_asked"] == 1:
        change = -1.5
        reason = "student_asked_for_help"
    elif signals["frustrated"] == 1:
        change = -2.5
        reason = "student_frustrated"
    elif signals["gave_up"] == 1:
        change = -3.0
        reason = "student_gave_up"
    else:
        change = 0.0
        reason = "no_clear_signal"

    new_score = max(0.0, min(10.0, current_score + change))
    if signals["gave_up"] == 1:
        new_score = 3.0
        reason = "student_gave_up_reset_to_gentle"

    return round(new_score, 1), reason

def get_pressure_band(score: float) -> str:
    if score <= 3.0:
        return "gentle_direct"
    elif score <= 6.0:
        return "mixed_socratic"
    else:
        return "full_socratic"
