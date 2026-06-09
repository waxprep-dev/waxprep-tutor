from typing import Dict, List, Tuple
from loguru import logger

def analyze_interaction(student_message: str, ai_response: str) -> Dict[str, int]:
    """
    Analyze a single student-AI interaction and return signals.
    Returns: {"correct": 0/1, "help_asked": 0/1, "frustrated": 0/1, "gave_up": 0/1}
    """
    msg_lower = student_message.lower()
    
    # Signals that student answered correctly
    correct_indicators = [
        "yes", "correct", "right", "i understand", "got it", "makes sense",
        "sharp", "true", "exactly", "that's it", "now i get", "i see"
    ]
    correct = 1 if any(w in msg_lower for w in correct_indicators) else 0
    
    # Signals that student asked for help
    help_indicators = [
        "help", "explain", "i don't get", "confused", "how do you", "show me",
        "break it down", "simplify", "easier", "don't understand", "abeg explain"
    ]
    help_asked = 1 if any(w in msg_lower for w in help_indicators) else 0
    
    # Signals of frustration
    frustration_indicators = [
        "give up", "forget it", "too hard", "hopeless", "abeg forget",
        "i don't understand", "this is hard", "impossible", "waste of time"
    ]
    frustrated = 1 if any(w in msg_lower for w in frustration_indicators) else 0
    
    # Signals of giving up
    gave_up_indicators = [
        "next", "move on", "skip", "later", "another topic", "forget this",
        "i'm done", "stop", "enough"
    ]
    gave_up = 1 if any(w in msg_lower for w in gave_up_indicators) else 0
    
    return {
        "correct": correct,
        "help_asked": help_asked,
        "frustrated": frustrated,
        "gave_up": gave_up,
    }

def calculate_pressure(current_score: float, signals: Dict[str, int]) -> Tuple[float, str]:
    """
    Calculate new socratic pressure score based on signals.
    Returns: (new_score, reason)
    """
    # Base change
    change = 0.0
    
    if signals["correct"] == 1 and signals["help_asked"] == 0:
        change = +0.8  # Solved without help = increase pressure
        reason = "student_solved_without_hint"
    elif signals["correct"] == 1 and signals["help_asked"] == 1:
        change = +0.3  # Solved with help = small increase
        reason = "student_solved_with_help"
    elif signals["help_asked"] == 1:
        change = -1.5  # Asked for help = decrease pressure
        reason = "student_asked_for_help"
    elif signals["frustrated"] == 1:
        change = -2.5  # Frustrated = big decrease
        reason = "student_frustrated"
    elif signals["gave_up"] == 1:
        change = -3.0  # Gave up = reset pressure
        reason = "student_gave_up"
    else:
        change = 0.0
        reason = "no_clear_signal"
    
    new_score = current_score + change
    
    # Clamp to 0-10 range
    new_score = max(0.0, min(10.0, new_score))
    
    # If gave up, reset to middle-low (3.0) to give them a break
    if signals["gave_up"] == 1:
        new_score = 3.0
        reason = "student_gave_up_reset_to_gentle"
    
    return round(new_score, 1), reason

def get_pressure_band(score: float) -> str:
    """
    Convert numeric score to teaching style band.
    """
    if score <= 3.0:
        return "gentle_direct"
    elif score <= 6.0:
        return "mixed_socratic"
    else:
        return "full_socratic"

def get_pressure_instruction(band: str) -> str:
    """
    Get the prompt instruction for this pressure band.
    """
    instructions = {
        "gentle_direct": (
            "This student frustrates easily. Give direct answers first, "
            "then gentle nudges. Never ask more than 1 question at a time. "
            "Build confidence before challenging."
        ),
        "mixed_socratic": (
            "This student handles moderate pressure. Mix explanations with "
            "guiding questions. Ask 1-2 questions per response. Give hints "
            "if they struggle for more than 2 messages."
        ),
        "full_socratic": (
            "This student loves challenges. Use pure Socratic method. "
            "Ask 2-3 questions per response. Minimal hints. Let them "
            "discover. Only give direct answers if stuck for 3+ messages."
        ),
    }
    return instructions.get(band, instructions["mixed_socratic"])
