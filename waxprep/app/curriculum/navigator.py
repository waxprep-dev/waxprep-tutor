import json
import os
from typing import Dict, Any, Optional, List
from loguru import logger

CURRICULUM_BASE = os.path.join(os.path.dirname(__file__))

class CurriculumNavigator:
    def __init__(self):
        self._cache: Dict[str, Any] = {}

    def load_curriculum(self, subject: str, class_level: str) -> Optional[Dict[str, Any]]:
        key = f"{class_level}_{subject}".lower()
        if key in self._cache:
            return self._cache[key]

        level_lower = class_level.lower()
        if level_lower.startswith("ss"):
            folder = f"sss_curriculum/{level_lower}"
        elif level_lower.startswith("jss"):
            folder = f"jss_curriculum/{level_lower}"
        else:
            folder = f"sss_curriculum/ss1"

        subject_clean = subject.lower().replace(" ", "_").replace("-", "_")
        path = os.path.join(CURRICULUM_BASE, folder, f"{subject_clean}.json")

        if not os.path.exists(path):
            return None

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._cache[key] = data
            return data
        except Exception as e:
            logger.error(f"Failed to load curriculum {path}: {e}")
            return None

    def get_topic_context(
        self,
        subject: str,
        topic: str,
        class_level: str,
    ) -> str:
        curriculum = self.load_curriculum(subject, class_level)
        if not curriculum:
            return ""

        topic_lower = topic.lower() if topic else ""
        context_parts = []

        waec_topics = curriculum.get("waec_high_priority_topics", [])
        if waec_topics:
            context_parts.append(f"High-priority {subject} topics for WAEC: {', '.join(waec_topics[:5])}")

        for t in curriculum.get("topics", []):
            for st in t.get("subtopics", []):
                st_title = st.get("title", "").lower()
                if not topic_lower or topic_lower in st_title or st_title in topic_lower:
                    waec_freq = st.get("waec_frequency", "")
                    if waec_freq in ["high", "very_high"]:
                        context_parts.append(f"This topic appears with {waec_freq.replace('_', ' ')} frequency in WAEC/JAMB.")

                    misconceptions = st.get("common_misconceptions", [])
                    if misconceptions:
                        context_parts.append(
                            "Common student misconceptions for this topic:\n" +
                            "\n".join([f"- {m}" for m in misconceptions[:3]])
                        )

                    teaching_note = st.get("teaching_note", "")
                    if teaching_note:
                        context_parts.append(f"Teaching note: {teaching_note}")

                    if context_parts:
                        break

        return "\n".join(context_parts) if context_parts else ""

    def get_waec_priority_topics(self, subject: str, class_level: str) -> List[str]:
        curriculum = self.load_curriculum(subject, class_level)
        if not curriculum:
            return []
        return curriculum.get("waec_high_priority_topics", [])
