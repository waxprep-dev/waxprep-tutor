from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone, timedelta
from loguru import logger
from waxprep.app.database.client import get_db

def parse_study_intent(message: str) -> Optional[Tuple[str, int]]:
    """
    Parse if student wants to start independent study.
    Returns: (topic, duration_minutes) or None
    """
    msg_lower = message.lower().strip()
    
    # Study intent indicators
    study_phrases = [
        "i'm studying", "i am studying", "let me study", "i want to study",
        "i need to study", "going to study", "about to study", "study time",
        "let me read", "i'm reading", "i want to read", "reviewing"
    ]
    
    has_intent = any(phrase in msg_lower for phrase in study_phrases)
    if not has_intent:
        return None
    
    # Extract topic - look for "for" or "about" or "on"
    topic = ""
    for marker in [" for ", " about ", " on ", " regarding "]:
        if marker in msg_lower:
            parts = msg_lower.split(marker)
            if len(parts) > 1:
                topic = parts[1].split(".")[0].split("?")[0].strip()
                break
    
    # Extract duration - look for "for X minutes" or "X min"
    duration = 20  # default
    import re
    duration_match = re.search(r'(\d+)\s*(min|minute|minutes)', msg_lower)
    if duration_match:
        duration = int(duration_match.group(1))
        duration = max(5, min(60, duration))  # clamp 5-60 minutes
    
    if not topic:
        topic = "general study"
    
    return topic, duration

def generate_observation_message(topic: str, duration: int) -> str:
    """
    Generate the message WaxPrep sends when starting observation.
    """
    messages = [
        f"Sharp! Study {topic} well. I'll watch quietly. Ask me questions when you're done in {duration} minutes.",
        f"Oya, focus on {topic}. I'm here if you need help. See you in {duration} minutes!",
        f"Go and learn {topic} well. I'll check what you understood when you're done. {duration} minutes!",
    ]
    import random
    return random.choice(messages)

def generate_evaluation_questions(topic: str, subject: str, weak_concepts: List[str]) -> List[Dict[str, str]]:
    """
    Generate 3 targeted questions based on what was studied and weak areas.
    """
    questions = []
    
    # Question 1: Core concept understanding
    questions.append({
        "question": f"After studying {topic}, explain in your own words: what is the most important idea you learned?",
        "concept": topic,
        "type": "core_understanding",
    })
    
    # Question 2: Application (harder)
    questions.append({
        "question": f"How would you use what you learned about {topic} to solve a real problem? Give an example.",
        "concept": topic,
        "type": "application",
    })
    
    # Question 3: Weak area focus (if available)
    if weak_concepts:
        weak = weak_concepts[0].replace("_", " ")
        questions.append({
            "question": f"You've struggled with {weak} before. After today's study, how would you explain it now?",
            "concept": weak,
            "type": "weak_area_check",
        })
    else:
        questions.append({
            "question": f"What part of {topic} still confuses you? Be honest — no wahala.",
            "concept": topic,
            "type": "self_assessment",
        })
    
    return questions

def evaluate_ghost_answer(answer: str, question_type: str, concept: str) -> Tuple[float, str]:
    """
    Evaluate a student's answer to a ghost teacher question.
    """
    answer_lower = answer.lower()
    word_count = len(answer.split())
    
    # Empty or too short
    if word_count < 3:
        return 0.2, "Try to say more. Even a few sentences help me understand what you learned."
    
    # Check for understanding indicators
    understanding_indicators = [
        "because", "this means", "so that", "which leads to", "therefore",
        "for example", "like when", "in nigeria", "in real life", "i understand"
    ]
    
    confusion_indicators = [
        "don't understand", "confused", "don't get it", "hard", "difficult",
        "not sure", "maybe", "i think", "i guess"
    ]
    
    understanding_score = sum(1 for w in understanding_indicators if w in answer_lower)
    confusion_score = sum(1 for w in confusion_indicators if w in answer_lower)
    
    # Calculate score
    base_score = min(1.0, word_count / 20)  # More words = more engagement, up to 20 words
    understanding_bonus = min(0.4, understanding_score * 0.1)
    confusion_penalty = min(0.3, confusion_score * 0.1)
    
    score = base_score + understanding_bonus - confusion_penalty
    score = max(0.0, min(1.0, score))
    
    # Feedback
    if score >= 0.7:
        feedback = "Excellent! You really understood this. Well done!"
    elif score >= 0.5:
        feedback = "Good progress. You grasp the main ideas. Keep practicing!"
    elif score >= 0.3:
        feedback = "You're getting there. Some parts are clear, others need more work."
    else:
        feedback = "This topic needs more time. Let's go through it together again."
    
    return round(score, 2), feedback

def should_send_nudge(session_started_at: str) -> bool:
    """
    Check if we should send a gentle nudge (student inactive for 10+ minutes).
    """
    try:
        started = datetime.fromisoformat(session_started_at.replace("Z", "+00:00"))
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - started).total_seconds() / 60
        return elapsed >= 10
    except Exception:
        return False

def generate_nudge_message() -> str:
    """
    Generate ONE gentle nudge if student seems stuck.
    """
    nudges = [
        "How's it going? Send me a quick update if you need help.",
        "Still there? If you're stuck, just say 'help' and I'll jump in.",
        "Don't let the topic frustrate you. I'm here if you need a hint.",
    ]
    import random
    return random.choice(nudges)
