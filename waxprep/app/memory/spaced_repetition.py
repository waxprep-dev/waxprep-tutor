import json
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from loguru import logger
from groq import Groq
from waxprep.app.core.config import settings
from waxprep.app.database.client import get_db_client

class SpacedRepetitionEngine:
    def __init__(self):
        self.db = get_db_client()
        self.groq = Groq(api_key=settings.groq_api_key)

    async def update_after_review(
        self,
        student_id: str,
        concept_id: str,
        performance_score: float,
    ) -> None:
        try:
            r = (
                self.db.table("knowledge_maps")
                .select("*")
                .eq("student_id", student_id)
                .eq("concept_id", concept_id)
                .execute()
            )
            if not r.data:
                return

            rec = r.data[0]
            params = rec.get("forgetting_curve_params") or {}
            if isinstance(params, str):
                params = json.loads(params)

            ef = params.get("ease_factor", 2.5)
            interval = params.get("interval_days", 1)
            reps = params.get("repetitions", 0)

            if performance_score >= 0.6:
                if reps == 0:
                    new_interval = 1
                elif reps == 1:
                    new_interval = 6
                else:
                    new_interval = round(interval * ef)
                new_ef = max(1.3, ef + 0.1 + 0.1 * (performance_score - 0.6))
                new_reps = reps + 1
                new_mastery = min(100, rec["mastery_score"] + performance_score * 15)
            else:
                new_interval = 1
                new_ef = max(1.3, ef - 0.2)
                new_reps = 0
                new_mastery = max(0, rec["mastery_score"] - 10)

            next_review = (datetime.utcnow() + timedelta(days=new_interval)).isoformat()
            self.db.table("knowledge_maps").update({
                "mastery_score": round(new_mastery, 2),
                "last_assessed_at": datetime.utcnow().isoformat(),
                "assessment_count": rec["assessment_count"] + 1,
                "last_assessment_performance": performance_score,
                "next_review_due_at": next_review,
                "forgetting_curve_params": json.dumps({
                    "ease_factor": round(new_ef, 3),
                    "interval_days": new_interval,
                    "repetitions": new_reps,
                }),
            }).eq("student_id", student_id).eq("concept_id", concept_id).execute()
        except Exception as e:
            logger.error(f"Spaced rep update failed: {e}")

    async def schedule_due_reviews(self, student_id: str, platform: str) -> int:
        try:
            profile = self.db.table("student_profiles").select("student_name").eq("student_id", student_id).execute()
            name = profile.data[0].get("student_name", "there") if profile.data else "there"

            due = (
                self.db.table("knowledge_maps")
                .select("concept_id, subject, last_assessed_at")
                .eq("student_id", student_id)
                .lte("next_review_due_at", datetime.utcnow().isoformat())
                .limit(3)
                .execute()
            )

            count = 0
            for review in (due.data or []):
                pending = (
                    self.db.table("scheduled_notifications")
                    .select("id")
                    .eq("student_id", student_id)
                    .eq("related_concept_id", review["concept_id"])
                    .eq("status", "pending")
                    .execute()
                )
                if pending.data:
                    continue

                concept_name = review["concept_id"].replace("_", " ")
                prompt = (
                    f"Write a 2-sentence natural review message from WaxPrep to {name}. "
                    f"The concept is '{concept_name}' in {review['subject']}. "
                    f"Do NOT say 'scheduled review' or 'reminder'. "
                    f"Sound like a teacher who just thought of something important. "
                    f"End with one recall question. Message:"
                )
                try:
                    r = self.groq.chat.completions.create(
                        model=settings.groq_fast_model,
                        messages=[{"role": "user", "content": prompt}],
                        max_tokens=100,
                        temperature=0.7,
                    )
                    message = r.choices[0].message.content.strip()
                    self.db.table("scheduled_notifications").insert({
                        "student_id": student_id,
                        "notification_type": "spaced_rep_review",
                        "scheduled_for": datetime.utcnow().isoformat(),
                        "platform": platform,
                        "content": message,
                        "status": "pending",
                        "related_concept_id": review["concept_id"],
                    }).execute()
                    count += 1
                except Exception as e:
                    logger.warning(f"Review message generation failed: {e}")

            return count
        except Exception as e:
            logger.error(f"Schedule reviews failed: {e}")
            return 0
