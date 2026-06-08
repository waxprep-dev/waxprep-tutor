import json
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta
from loguru import logger

from waxprep.app.database.client import get_db
from waxprep.app.cache.redis import rget, rset, rdel

LAYER_1_TTL = 0
LAYER_2_TTL = 7200
LAYER_3_TTL = 600
LAYER_4_TTL = 3600
LAYER_5_TTL = 86400

class FiveLayerMemory:
    def __init__(self):
        self.db = get_db()

    async def load_all(self, student_id: str) -> Dict[str, Any]:
        layer3 = await self._load_layer3_longterm(student_id)
        layer2 = await self._load_layer2_shortterm(student_id)
        layer4 = await self._load_layer4_episodic(student_id, layer3)
        layer5 = await self._load_layer5_semantic(layer3.get("current_subject", ""), layer3.get("current_topic", ""))
        layer1 = {}

        return {
            "ephemeral": layer1,
            "short_term": layer2,
            "long_term": layer3,
            "episodic": layer4,
            "semantic": layer5,
        }

    async def _load_layer2_shortterm(self, student_id: str) -> Dict[str, Any]:
        key = f"wax:session:{student_id}"
        cached = await rget(key)
        if cached:
            return cached

        try:
            timeout = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
            conv = (
                self.db.table("conversations")
                .select("id, started_at")
                .eq("student_id", student_id)
                .eq("is_active", True)
                .gte("last_message_at", timeout)
                .order("started_at", desc=True)
                .limit(1)
                .execute()
            )

            if not conv.data:
                return {"messages": [], "conversation_id": None, "session_message_count": 0}

            conv_id = conv.data[0]["id"]
            msgs = (
                self.db.table("messages")
                .select("direction, content, message_type")
                .eq("conversation_id", conv_id)
                .order("timestamp", desc=True)
                .limit(15)
                .execute()
            )

            messages = list(reversed([
                {"role": "user" if m["direction"] == "inbound" else "assistant", "content": m["content"]}
                for m in (msgs.data or [])
            ]))

            result = {
                "messages": messages,
                "conversation_id": conv_id,
                "session_message_count": len(messages),
            }
            await rset(key, result, LAYER_2_TTL)
            return result
        except Exception as e:
            logger.error(f"Short-term memory load failed {student_id}: {e}")
            return {"messages": [], "conversation_id": None, "session_message_count": 0}

    async def _load_layer3_longterm(self, student_id: str) -> Dict[str, Any]:
        key = f"wax:profile:{student_id}"
        cached = await rget(key)
        if cached:
            return cached

        try:
            student = self.db.table("students").select("*").eq("id", student_id).execute()
            profile = self.db.table("student_profiles").select("*").eq("student_id", student_id).execute()
            km = (
                self.db.table("knowledge_maps")
                .select("concept_id, subject, mastery_score, last_assessed_at")
                .eq("student_id", student_id)
                .order("mastery_score", desc=True)
                .limit(20)
                .execute()
            )
            misconceptions = (
                self.db.table("misconceptions")
                .select("description, concept_id, subject, status")
                .eq("student_id", student_id)
                .in_("status", ["active", "resolving"])
                .limit(5)
                .execute()
            )

            s = student.data[0] if student.data else {}
            p = profile.data[0] if profile.data else {}
            knowledge = km.data or []
            misc = misconceptions.data or []

            mastered = [k for k in knowledge if k.get("mastery_score", 0) >= 70]
            struggling = [k for k in knowledge if k.get("mastery_score", 0) < 40]

            result = {
                "student_name": p.get("student_name", "") or "",
                "wax_code": s.get("wax_code", ""),
                "class_level": s.get("inferred_class_level", "UNKNOWN") or "UNKNOWN",
                "exam_target": s.get("primary_exam_target", "") or "",
                "exam_date": str(s.get("exam_date", "")) if s.get("exam_date") else "",
                "current_subject": p.get("current_subject", "") or "",
                "current_topic": p.get("current_topic", "") or "",
                "personal_context": p.get("personal_context", "") or "",
                "study_goals": p.get("study_goals", "") or "",
                "session_count": s.get("session_count", 0),
                "total_messages": s.get("total_messages_received", 0),
                "last_active_at": str(s.get("last_active_at", "")) if s.get("last_active_at") else "",
                "onboarding_complete": s.get("onboarding_complete", False),
                "mastered_concepts": [k["concept_id"].replace("_", " ") for k in mastered[:6]],
                "struggling_concepts": [k["concept_id"].replace("_", " ") for k in struggling[:5]],
                "active_misconceptions": [m.get("description", "") for m in misc[:3]],
                "data_mode": p.get("data_mode", "standard") or "standard",
                "emotional_state": p.get("emotional_state_current", "neutral") or "neutral",
                "dna": {
                    "example_preference": p.get("example_preference", "general") or "general",
                    "explanation_depth": p.get("explanation_depth", "moderate") or "moderate",
                    "frustration_threshold": p.get("frustration_threshold", 3),
                    "pidgin_comfort": p.get("pidgin_preference", "adaptive") or "adaptive",
                    "response_length": p.get("response_length_pref", "medium") or "medium",
                    "study_peak_hour": p.get("study_peak_hour"),
                    "correct_first_try_rate": p.get("correct_first_try_rate", 0.5),
                },
            }
            await rset(key, result, LAYER_3_TTL)
            return result
        except Exception as e:
            logger.error(f"Long-term memory load failed {student_id}: {e}")
            return {}

    async def _load_layer4_episodic(self, student_id: str, long_term: Dict) -> Dict[str, Any]:
        key = f"wax:episodic:{student_id}"
        cached = await rget(key)
        if cached:
            return cached

        try:
            memories = (
                self.db.table("episodic_memories")
                .select("memory_type, description, subject, emotion, created_at")
                .eq("student_id", student_id)
                .order("created_at", desc=True)
                .limit(10)
                .execute()
            )

            prev_summary = (
                self.db.table("conversations")
                .select("summary, ended_at")
                .eq("student_id", student_id)
                .eq("is_active", False)
                .not_.is_("summary", "null")
                .order("ended_at", desc=True)
                .limit(1)
                .execute()
            )

            result = {
                "memories": memories.data or [],
                "previous_session_summary": prev_summary.data[0].get("summary", "") if prev_summary.data else "",
            }
            await rset(key, result, LAYER_4_TTL)
            return result
        except Exception as e:
            logger.warning(f"Episodic memory load failed {student_id}: {e}")
            return {"memories": [], "previous_session_summary": ""}

    async def _load_layer5_semantic(self, subject: str, topic: str) -> Dict[str, Any]:
        if not subject:
            return {}

        key = f"wax:curriculum:{subject}:{topic or 'general'}"
        cached = await rget(key)
        if cached:
            return cached

        import os, json
        base_path = os.path.join(os.path.dirname(__file__), "..", "..", "curriculum")

        for level in ["ss3", "ss2", "ss1", "jss3", "jss2", "jss1"]:
            path = os.path.join(base_path, f"sss_curriculum/{level}/{subject.lower()}.json")
            if not os.path.exists(path):
                path = os.path.join(base_path, f"jss_curriculum/{level}/{subject.lower()}.json")
            if os.path.exists(path):
                try:
                    with open(path, "r") as f:
                        data = json.load(f)

                    waec_priority = data.get("waec_high_priority_topics", [])
                    jamb_priority = data.get("jamb_high_priority_topics", [])

                    topic_context = ""
                    common_misconceptions = []
                    teaching_note = ""

                    if topic:
                        topic_lower = topic.lower()
                        for t in data.get("topics", []):
                            for st in t.get("subtopics", []):
                                st_title = st.get("title", "").lower()
                                if topic_lower in st_title or st_title in topic_lower:
                                    freq = st.get("waec_frequency", "")
                                    if freq in ("high", "very_high"):
                                        topic_context = f"This topic appears with {freq.replace('_', ' ')} frequency in WAEC/JAMB."
                                    common_misconceptions = st.get("common_misconceptions", [])
                                    teaching_note = st.get("teaching_note", "")
                                    break

                    result = {
                        "waec_high_priority": waec_priority[:8],
                        "jamb_high_priority": jamb_priority[:8],
                        "topic_context": topic_context,
                        "common_misconceptions": common_misconceptions[:3],
                        "teaching_note": teaching_note,
                    }
                    await rset(key, result, LAYER_5_TTL)
                    return result
                except Exception as e:
                    logger.warning(f"Curriculum load failed for {subject}: {e}")
                    break

        return {}

    async def invalidate(self, student_id: str) -> None:
        await rdel(f"wax:profile:{student_id}")
        await rdel(f"wax:session:{student_id}")
        await rdel(f"wax:episodic:{student_id}")

    async def update_session_cache(self, student_id: str, new_message: Dict) -> None:
        key = f"wax:session:{student_id}"
        cached = await rget(key)
        if cached and isinstance(cached.get("messages"), list):
            cached["messages"].append(new_message)
            if len(cached["messages"]) > 15:
                cached["messages"] = cached["messages"][-15:]
            cached["session_message_count"] = len(cached["messages"])
            await rset(key, cached, LAYER_2_TTL)

    async def save_episodic_memory(
        self,
        student_id: str,
        memory_type: str,
        description: str,
        subject: str = "",
        emotion: str = "neutral",
    ) -> None:
        try:
            self.db.table("episodic_memories").insert({
                "student_id": student_id,
                "memory_type": memory_type,
                "description": description,
                "subject": subject,
                "emotion": emotion,
            }).execute()
            await rdel(f"wax:episodic:{student_id}")
        except Exception as e:
            logger.warning(f"Episodic save failed: {e}")

    async def update_knowledge_map(
        self,
        student_id: str,
        concept: str,
        subject: str,
        performance: float,
    ) -> None:
        try:
            import os
            concept_id = concept.lower().replace(" ", "_")
            mastery = min(100.0, max(0.0, performance * 100))
            next_review = (datetime.now(timezone.utc) + timedelta(days=int(os.environ.get("SPACED_REP_DAYS", "3")))).isoformat()

            existing = self.db.table("knowledge_maps").select("id, mastery_score, assessment_count").eq("student_id", student_id).eq("concept_id", concept_id).execute()

            if existing.data:
                old = existing.data[0]["mastery_score"]
                new_score = round(old * 0.7 + mastery * 0.3, 2)
                self.db.table("knowledge_maps").update({
                    "mastery_score": new_score,
                    "last_assessed_at": datetime.now(timezone.utc).isoformat(),
                    "assessment_count": existing.data[0]["assessment_count"] + 1,
                    "next_review_due_at": next_review,
                }).eq("id", existing.data[0]["id"]).execute()
            else:
                self.db.table("knowledge_maps").insert({
                    "student_id": student_id,
                    "concept_id": concept_id,
                    "subject": subject,
                    "mastery_score": mastery,
                    "last_assessed_at": datetime.now(timezone.utc).isoformat(),
                    "assessment_count": 1,
                    "next_review_due_at": next_review,
                }).execute()

            await rdel(f"wax:profile:{student_id}")
        except Exception as e:
            logger.error(f"Knowledge map update failed: {e}")

    async def update_dna(self, student_id: str, updates: Dict) -> None:
        try:
            self.db.table("student_profiles").update(updates).eq("student_id", student_id).execute()
            await rdel(f"wax:profile:{student_id}")
        except Exception as e:
            logger.warning(f"DNA update failed: {e}")

memory = FiveLayerMemory()
