from typing import Dict, Any

FRUSTRATION_SIGNALS = [
    "don't get it", "dont get it", "not understanding", "confused",
    "too hard", "give up", "forget it", "make it simple",
    "still don't understand", "explain again", "what is this",
    "negative zero", "0/10", "hopeless", "i'm lost",
    "bro please", "abeg", "i don't know anything",
]

STRATEGIES = {
    0: "normal",
    1: "simplify",
    2: "change_approach",
    3: "offer_choice",
    4: "graceful_exit",
}

STRATEGY_INSTRUCTIONS = {
    1: (
        "MILD FRUSTRATION DETECTED: Drop to the most fundamental level. "
        "Use a very simple Nigerian everyday analogy. "
        "Give them something easy to answer first to rebuild confidence."
    ),
    2: (
        "MODERATE FRUSTRATION: Do NOT continue the same explanation. "
        "Change approach completely — different method, different angle, different analogy. "
        "Say: 'Let me try this from a completely different direction...'"
    ),
    3: (
        "HIGH FRUSTRATION: Acknowledge briefly without dwelling. "
        "Offer two choices: completely different explanation of same topic, or switch topic entirely. "
        "Do not push the same approach again."
    ),
    4: (
        "STUDENT ABOUT TO LEAVE: Do not continue teaching. "
        "Acknowledge their experience, give permission to take a break, "
        "make it easy to come back: 'That is fair — let us come at this from a completely different angle when you return.'"
    ),
}

class FrustrationDetector:
    def __init__(self):
        self._state: Dict[str, Dict] = {}

    def analyze(self, student_id: str, message: str, intent: str) -> Dict[str, Any]:
        msg_lower = message.lower()
        current = self._state.get(student_id, {"level": 0, "consecutive_confusion": 0})

        signals = [s for s in FRUSTRATION_SIGNALS if s in msg_lower]
        is_goodbye = any(w in msg_lower for w in ["bye", "later", "i'm done", "forget it"])
        is_confusion = intent in ["confusion", "emotional"]

        score = len(signals) * 2
        if is_goodbye:
            score += 5
        if is_confusion:
            score += 2
            current["consecutive_confusion"] = current.get("consecutive_confusion", 0) + 1
        else:
            current["consecutive_confusion"] = max(0, current.get("consecutive_confusion", 0) - 1)

        if score >= 5:
            current["level"] = min(4, current.get("level", 0) + 2)
        elif score >= 3:
            current["level"] = min(4, current.get("level", 0) + 1)
        elif score == 0 and not is_confusion:
            current["level"] = max(0, current.get("level", 0) - 1)

        if current.get("consecutive_confusion", 0) >= 3:
            current["level"] = max(current.get("level", 0), 3)
        if is_goodbye:
            current["level"] = 4

        self._state[student_id] = current
        level = current["level"]

        return {
            "frustration_level": level,
            "strategy": STRATEGIES[level],
            "instruction": STRATEGY_INSTRUCTIONS.get(level, ""),
        }

    def record_success(self, student_id: str) -> None:
        current = self._state.get(student_id, {"level": 0})
        current["level"] = max(0, current.get("level", 0) - 1)
        current["consecutive_confusion"] = 0
        self._state[student_id] = current
