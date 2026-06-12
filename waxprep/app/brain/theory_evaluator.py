"""
================================================================================
THEORY EVALUATOR v4.0 - WAEC THEORY ANSWER EVALUATION
================================================================================
Unchanged from v3.0 - solid keyword-based evaluation.
================================================================================
"""
from typing import Dict, Any, Tuple, Optional
from loguru import logger

def evaluate_theory_answer(answer_text: str, marking_scheme: Dict[str, Any]) -> Tuple[float, str, Dict[str, Any]]:
    if not answer_text or not marking_scheme:
        return 0.0, "No answer or marking scheme provided.", {}

    criteria = marking_scheme.get("criteria", [])
    if not criteria:
        return 0.0, "No criteria found in marking scheme.", {}

    answer_lower = answer_text.lower()
    total_marks = marking_scheme.get("total_marks", 0)

    breakdown = []
    earned_marks = 0.0

    for criterion in criteria:
        criterion_type = criterion.get("type", "")
        criterion_marks = criterion.get("points", 0)
        key_phrases = criterion.get("key_phrases", [])
        phrases_found = 0
        for phrase in key_phrases:
            if phrase.lower() in answer_lower:
                phrases_found += 1
        phrase_ratio = phrases_found / len(key_phrases) if key_phrases else 0.0
        criterion_score = round(criterion_marks * min(1.0, phrase_ratio), 1)
        earned_marks += criterion_score
        status = "full" if criterion_score >= criterion_marks else "partial" if criterion_score > 0 else "missing"
        breakdown.append({
            "type": criterion_type,
            "marks_earned": criterion_score,
            "marks_possible": criterion_marks,
            "status": status,
            "phrases_found": phrases_found,
            "phrases_total": len(key_phrases),
        })

    overall_score = round((earned_marks / total_marks) * 100, 1) if total_marks > 0 else 0.0

    feedback_parts = [f"Score: {earned_marks}/{total_marks} marks ({overall_score}%)"]
    for item in breakdown:
        if item["status"] == "full":
            feedback_parts.append(f"✅ {item['type'].capitalize()}: Got it! ({item['marks_earned']}/{item['marks_possible']})")
        elif item["status"] == "partial":
            feedback_parts.append(f"⚠️ {item['type'].capitalize()}: Partial — {item['phrases_found']}/{item['phrases_total']} key points. ({item['marks_earned']}/{item['marks_possible']})")
        else:
            feedback_parts.append(f"❌ {item['type'].capitalize()}: Missing — mention: {', '.join(key_phrases[:3])}. (0/{item['marks_possible']})")

    missing = [b for b in breakdown if b["status"] == "missing"]
    if missing:
        feedback_parts.append(f"\n💡 Focus on: {missing[0]['type'].capitalize()} — most marks here.")
    elif overall_score >= 80:
        feedback_parts.append("\n🌟 Excellent! You covered all criteria well.")

    feedback = "\n".join(feedback_parts)
    return overall_score, feedback, {
        "earned_marks": earned_marks,
        "total_marks": total_marks,
        "breakdown": breakdown,
        "percentage": overall_score,
    }

def generate_theory_feedback(score: float, concept: str) -> str:
    if score >= 80:
        return f"Sharp! You really understand {concept}. Keep this energy!"
    elif score >= 60:
        return f"Good work on {concept}. A few more details and you'll hit excellence."
    elif score >= 40:
        return f"You're getting there with {concept}. Let's build the missing pieces together."
    else:
        return f"{concept} is tricky — let's break it down smaller. No wahala, we go make am."
