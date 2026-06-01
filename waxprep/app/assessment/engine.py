import json
import time
from typing import Dict, Any, Optional, List
from datetime import datetime
from loguru import logger
from groq import Groq
from waxprep.app.core.config import settings
from waxprep.app.database.client import get_db_client

QUESTION_GENERATION_PROMPT = """Generate a teaching assessment question for a Nigerian student.
Subject: {subject}
Topic: {concept}
Class level: {class_level}
Difficulty (1-5): {difficulty}
Recent conversation context: {context}
Generate a question that feels like a natural part of the conversation — not a formal test. It should test understanding of {concept}.
Return ONLY valid JSON:
{{
"question": "the question as WaxPrep would naturally ask it",
"correct_answer": "the complete correct answer",
"answer_key_points": ["key point 1", "key point 2"],
"hint_level_1": "gentle hint without giving answer away",
"hint_level_2": "more direct hint still requiring student to think",
"difficulty_actual": {difficulty}
}}"""

ANSWER_EVALUATION_PROMPT = """Evaluate this Nigerian student's answer to a teaching question.
Question: {question}
Correct answer: {correct_answer}
Key points: {key_points}
Student's answer: {student_answer}
Attempt number: {attempts}
Return ONLY valid JSON:
{{
"is_correct": true or false,
"is_partially_correct": true or false,
"score": 0.0 to 1.0,
"correct_elements": ["what student got right"],
"missing_elements": ["what student missed or got wrong"],
"misconception_detected": null or "description of specific misconception shown",
"feedback_type": "correct" or "partially_correct" or "wrong_hint1" or "wrong_hint2" or "wrong_explain"
}}"""

class AssessmentEngine:
    def __init__(self):
        self.groq = Groq(api_key=settings.groq_api_key)
        self.db = get_db_client()
        self._active: Dict[str, Dict] = {}

    async def generate_question(
        self,
        student_id: str,
        subject: str,
        concept: str,
        class_level: str,
        difficulty: int = 2,
        misconceptions: List[str] = None,
        recent_context: str = "",
    ) -> Optional[Dict[str, Any]]:
        try:
            prompt = QUESTION_GENERATION_PROMPT.format(
                subject=subject,
                concept=concept,
                class_level=class_level,
                difficulty=difficulty,
                context=recent_context[:200],
            )
            r = self.groq.chat.completions.create(
                model=settings.groq_fast_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
                temperature=0.6,
            )
            raw = r.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()
            data = json.loads(raw)
            data["student_id"] = student_id
            data["subject"] = subject
            data["concept"] = concept
            data["class_level"] = class_level
            data["attempts"] = 0
            self._active[student_id] = data

            try:
                self.db.table("assessment_questions").insert({
                    "student_id": student_id,
                    "subject": subject,
                    "concept_id": concept.lower().replace(" ", "_"),
                    "question_text": data["question"],
                    "correct_answer": data["correct_answer"],
                    "difficulty": difficulty,
                    "status": "active",
                }).execute()
            except Exception:
                pass

            return data
        except Exception as e:
            logger.warning(f"Question generation failed: {e}")
            return None

    async def evaluate_answer(
        self,
        student_id: str,
        student_answer: str,
    ) -> Optional[Dict[str, Any]]:
        active = self._active.get(student_id)
        if not active:
            return None

        active["attempts"] = active.get("attempts", 0) + 1

        try:
            prompt = ANSWER_EVALUATION_PROMPT.format(
                question=active["question"],
                correct_answer=active["correct_answer"],
                key_points=json.dumps(active.get("answer_key_points", [])),
                student_answer=student_answer,
                attempts=active["attempts"],
            )
            r = self.groq.chat.completions.create(
                model=settings.groq_fast_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300,
                temperature=0.1,
            )
            raw = r.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()
            evaluation = json.loads(raw)
            evaluation["question"] = active["question"]
            evaluation["correct_answer"] = active["correct_answer"]
            evaluation["hint_level_1"] = active.get("hint_level_1", "")
            evaluation["hint_level_2"] = active.get("hint_level_2", "")
            evaluation["attempts"] = active["attempts"]
            evaluation["concept"] = active.get("concept", "")
            evaluation["subject"] = active.get("subject", "")

            if evaluation.get("is_correct"):
                del self._active[student_id]
                try:
                    self.db.table("assessment_questions").update({
                        "status": "completed",
                        "final_score": evaluation.get("score", 0.8),
                        "attempts_taken": active["attempts"],
                        "completed_at": datetime.utcnow().isoformat(),
                    }).eq("student_id", student_id).eq("status", "active").execute()
                except Exception:
                    pass

            return evaluation
        except Exception as e:
            logger.error(f"Answer evaluation failed: {e}")
            return {
                "is_correct": False,
                "is_partially_correct": False,
                "score": 0.0,
                "feedback_type": "wrong_hint1",
                "question": active.get("question", ""),
                "hint_level_1": active.get("hint_level_1", "Think about the core idea."),
                "hint_level_2": active.get("hint_level_2", ""),
                "attempts": active.get("attempts", 1),
                "concept": active.get("concept", ""),
                "subject": active.get("subject", ""),
            }

    def has_active_assessment(self, student_id: str) -> bool:
        return student_id in self._active

    def get_assessment_context(self, student_id: str) -> Optional[Dict]:
        active = self._active.get(student_id)
        if not active:
            return None
        return {
            "current_question": active.get("question"),
            "correct_answer": active.get("correct_answer"),
            "attempts": active.get("attempts", 0),
        }
