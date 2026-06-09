from typing import Optional, Dict, Tuple
from loguru import logger

def detect_teaching_moment(ai_response: str) -> Optional[str]:
    response_lower = ai_response.lower()
    teaching_phrases = [
        "is a", "means that", "refers to", "is defined as",
        "works by", "happens when", "occurs when", "is the process",
        "is called", "is known as", "in other words", "to put it simply",
        "basically", "essentially", "the reason", "this is because"
    ]
    has_teaching = any(phrase in response_lower for phrase in teaching_phrases)
    if not has_teaching:
        return None
    sentences = ai_response.split('.')
    for sentence in sentences:
        sentence_lower = sentence.lower().strip()
        for phrase in teaching_phrases:
            if phrase in sentence_lower:
                parts = sentence_lower.split(phrase)
                if len(parts) > 0:
                    concept = parts[0].strip()
                    words = concept.split()
                    if len(words) >= 2:
                        return ' '.join(words[-4:]).strip()
    return None

def generate_why_question(concept: str, subject: str = "") -> str:
    templates = {
        "biology": [
            f"Why does {concept} matter for living things?",
            f"Why would an organism struggle without {concept}?",
            f"Why is {concept} essential for survival?",
        ],
        "chemistry": [
            f"Why does {concept} behave this way at the molecular level?",
            f"Why is understanding {concept} important for reactions?",
            f"Why can't we ignore {concept} when mixing substances?",
        ],
        "physics": [
            f"Why does {concept} work the way it does in real life?",
            f"Why would engineering fail without understanding {concept}?",
            f"Why does {concept} affect everything around us?",
        ],
        "mathematics": [
            f"Why does the {concept} method work?",
            f"Why would we use {concept} instead of a simpler approach?",
            f"Why does {concept} give us the right answer?",
        ],
        "economics": [
            f"Why does {concept} affect prices and markets?",
            f"Why would a country struggle without understanding {concept}?",
            f"Why does {concept} matter to everyday Nigerians?",
        ],
        "default": [
            f"Why does {concept} work the way it does?",
            f"Why is understanding {concept} important?",
            f"Why would things be different without {concept}?",
        ]
    }
    subject_lower = subject.lower() if subject else "default"
    subject_templates = templates.get(subject_lower, templates["default"])
    if len(concept.split()) <= 2:
        return subject_templates[1]
    else:
        return subject_templates[0]

def evaluate_why_answer(student_answer: str, concept: str) -> Tuple[str, float]:
    answer_lower = student_answer.lower()
    deep_indicators = [
        "because", "this means", "so that", "which leads to",
        "as a result", "therefore", "which causes", "the reason",
        "without this", "if not", "consequently", "that's why"
    ]
    surface_indicators = [
        "it is", "means", "is defined as", "refers to",
        "is called", "is known as", "is a type of"
    ]
    deep_score = sum(1 for w in deep_indicators if w in answer_lower)
    surface_score = sum(1 for w in surface_indicators if w in answer_lower)
    if deep_score >= 2:
        score = 0.8 + (min(deep_score, 4) * 0.05)
        feedback = "Excellent! You explained the 'why' clearly. You understand how this connects to bigger ideas."
    elif deep_score == 1:
        score = 0.6
        feedback = "Good start. You touched on the reason, but can you explain what happens because of this?"
    elif surface_score >= 2 and deep_score == 0:
        score = 0.3
        feedback = "You described what it is, but I want to know WHY it matters. What would happen if this didn't exist?"
    else:
        score = 0.5
        feedback = "Tell me more about why this is important. What problem does it solve?"
    return feedback, round(score, 2)

def should_ask_why(conversation_state: Dict) -> bool:
    recent_messages = conversation_state.get("messages", [])
    recent_content = " ".join([m.get("content", "") for m in recent_messages[-3:]])
    why_indicators = ["why", "explain why", "what would happen if", "reason"]
    already_asked = any(w in recent_content.lower() for w in why_indicators)
    if already_asked:
        return False
    emotional_state = conversation_state.get("emotional_state", "neutral")
    if emotional_state in ("frustrated", "discouraged"):
        return False
    pressure = conversation_state.get("socratic_pressure_score", 5.0)
    if pressure is not None and pressure < 2.0:
        return False
    return True
