import json
from typing import Dict, Any, Optional, List
from loguru import logger
from groq import Groq
from waxprep.app.core.config import settings
from waxprep.app.database.client import get_db_client
from datetime import datetime

EXTRACTION_PROMPT = """Analyze this conversation between WaxPrep and a Nigerian student. Return ONLY valid JSON with no extra text.
{
"student_name": null or "first name shared",
"class_level": null or one of: JSS1, JSS2, JSS3, SS1, SS2, SS3, UNI_100, UNI_200, OUT_OF_SCHOOL,
"exam_target": null or one of: WAEC, NECO, JAMB, POST_UTME, BECE,
"current_subject": null or subject name lowercase,
"current_topic": null or specific topic,
"emotional_state": null or one of: neutral, frustrated, anxious, discouraged, motivated, confident,
"language_register": null or one of: formal, semi_formal, informal, pidgin_heavy,
"personal_context": null or brief important background,
"preferred_message_length": null or one of: short, medium, long,
"concepts_discussed": [],
"concepts_mastered": [],
"concepts_confused": [],
"misconceptions_detected": [{"concept": "", "misconception": "", "corrected": true}]
}
Conversation:
"""

class ProfileIntelligenceExtractor:
    def __init__(self):
        self.groq = Groq(api_key=settings.groq_api_key)
        self.db = get_db_client()

    async def extract_and_update(
        self,
        student_id: str,
        conversation_history: List[Dict[str, str]],
    ) -> None:
        if len(conversation_history) < 3:
            return
        try:
            conv_text = "\n".join([
                f"{'Student' if m['role'] == 'user' else 'WaxPrep'}: {m['content']}"
                for m in conversation_history[-20:]
            ])
            prompt = EXTRACTION_PROMPT + conv_text[:4000]
            r = self.groq.chat.completions.create(
                model=settings.groq_fast_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=600,
                temperature=0.1,
            )
            raw = r.choices[0].message.content.strip()
            raw = raw.replace("```json", "").replace("```", "").strip()
            data = json.loads(raw)
            await self._apply(student_id, data)
        except json.JSONDecodeError as e:
            logger.warning(f"Profile extraction JSON parse failed: {e}")
        except Exception as e:
            logger.warning(f"Profile extraction failed: {e}")

    async def _apply(self, student_id: str, data: Dict[str, Any]) -> None:
        try:
            profile_updates = {}
            student_updates = {}

            if data.get("student_name"):
                profile_updates["student_name"] = data["student_name"]
            if data.get("class_level"):
                student_updates["inferred_class_level"] = data["class_level"]
            if data.get("exam_target"):
                student_updates["primary_exam_target"] = data["exam_target"]
            if data.get("emotional_state"):
                profile_updates["emotional_state_current"] = data["emotional_state"]
            if data.get("language_register"):
                profile_updates["language_register"] = data["language_register"]
            if data.get("preferred_message_length"):
                profile_updates["preferred_message_length"] = data["preferred_message_length"]
            if data.get("current_topic"):
                profile_updates["current_topic"] = data["current_topic"]
            if data.get("current_subject"):
                profile_updates["current_subject"] = data["current_subject"]
            if data.get("personal_context"):
                profile_updates["personal_context"] = data["personal_context"]

            if profile_updates:
                self.db.table("student_profiles").update(profile_updates).eq("student_id", student_id).execute()
            if student_updates:
                self.db.table("students").update(student_updates).eq("id", student_id).execute()

            for concept in set(
                data.get("concepts_discussed", []) +
                data.get("concepts_mastered", []) +
                data.get("concepts_confused", [])
            ):
                if not concept:
                    continue
                concept_id = concept.lower().replace(" ", "_")
                subject = data.get("current_subject", "general")
                class_level = data.get("class_level", "UNKNOWN") or "UNKNOWN"

                if concept in data.get("concepts_mastered", []):
                    mastery = 75.0
                elif concept in data.get("concepts_confused", []):
                    mastery = 30.0
                else:
                    mastery = 50.0

                from datetime import timedelta
                next_review = (datetime.utcnow() + timedelta(days=settings.spaced_rep_default_interval_days)).isoformat()

                existing = self.db.table("knowledge_maps").select("id, mastery_score, assessment_count").eq("student_id", student_id).eq("concept_id", concept_id).execute()

                if existing.data:
                    old = existing.data[0]["mastery_score"]
                    new_score = round(old * 0.7 + mastery * 0.3, 2)
                    self.db.table("knowledge_maps").update({
                        "mastery_score": new_score,
                        "last_assessed_at": datetime.utcnow().isoformat(),
                        "assessment_count": existing.data[0]["assessment_count"] + 1,
                        "next_review_due_at": next_review,
                    }).eq("id", existing.data[0]["id"]).execute()
                else:
                    self.db.table("knowledge_maps").insert({
                        "student_id": student_id,
                        "concept_id": concept_id,
                        "subject": subject,
                        "class_level": class_level,
                        "mastery_score": mastery,
                        "last_assessed_at": datetime.utcnow().isoformat(),
                        "assessment_count": 1,
                        "next_review_due_at": next_review,
                        "forgetting_curve_params": json.dumps({
                            "ease_factor": 2.5,
                            "interval_days": settings.spaced_rep_default_interval_days,
                            "repetitions": 1,
                        }),
                    }).execute()

            for m in data.get("misconceptions_detected", []):
                if not m.get("concept") or not m.get("misconception"):
                    continue
                code = m["concept"].lower().replace(" ", "_") + "_misconception"
                existing = self.db.table("misconceptions").select("id").eq("student_id", student_id).eq("misconception_code", code).execute()
                status = "resolved" if m.get("corrected") else "active"
                if existing.data:
                    self.db.table("misconceptions").update({
                        "status": status,
                        "last_confirmed_at": datetime.utcnow().isoformat(),
                    }).eq("id", existing.data[0]["id"]).execute()
                else:
                    self.db.table("misconceptions").insert({
                        "student_id": student_id,
                        "subject": data.get("current_subject", "general"),
                        "concept_id": m["concept"].lower().replace(" ", "_"),
                        "misconception_code": code,
                        "description": m["misconception"],
                        "status": status,
                        "evidence": json.dumps([{"description": m["misconception"]}]),
                    }).execute()

        except Exception as e:
            logger.error(f"Profile extraction apply failed: {e}")
