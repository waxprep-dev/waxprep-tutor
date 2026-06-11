"""
HOLOGRAPHIC MEMORY ARCHITECTURE (HMA) v3.0
The core memory engine for WaxPrep - An Adaptive AI Tutor

7-Layer Memory System:
  L0 - Quantum State (QS): Real-time working state of current exchange
  L1 - Working Memory (WM): Last 50 messages + compressed gist
  L2 - Session Memory (SM): 7-day session cards with full context
  L3 - Episodic Memory (EM): Tagged, emotion-weighted learning moments
  L4 - Semantic Memory (SemM): Knowledge graph with forgetting curves
  L5 - Procedural Memory (PM): "How this student learns" DNA
  L6 - Consolidated Memory (CM): Continuously-updated student narrative

Every layer connects to every other layer. Nothing is orphaned.
"""

import json
import hashlib
import asyncio
from typing import Dict, Any, List, Optional, Tuple, Set
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, field, asdict
from loguru import logger

from waxprep.app.database.client import get_db
from waxprep.app.cache.redis import rget, rset, rdel, rget_json, rset_json

# ---------------------------------------------------------------------------
# CONSTANTS
# ---------------------------------------------------------------------------

# TTLs (seconds)
TTL_QS = 300          # Quantum State: 5 minutes (very short, high churn)
TTL_WM = 7200         # Working Memory: 2 hours
TTL_SM = 3600         # Session Memory: 1 hour
TTL_EM = 1800         # Episodic Memory: 30 minutes
TTL_SEM = 600         # Semantic Memory: 10 minutes
TTL_PM = 3600         # Procedural Memory: 1 hour
TTL_CM = 7200         # Consolidated Memory: 2 hours

# Limits
WM_MESSAGE_LIMIT = 50           # Working memory message count
WM_GIST_INTERVAL = 5            # Compress every N messages
SM_DAYS_BACK = 7                # How many days of sessions to load
EM_RECENT_LIMIT = 15            # Recent episodic memories to load
EM_BREAKTHROUGH_LIMIT = 10      # Key breakthrough memories
EM_STRUGGLE_LIMIT = 10          # Key struggle memories
SEM_KNOWLEDGE_LIMIT = 30        # Knowledge map entries to load
SEM_GRAPH_DEPTH = 3             # How deep to traverse knowledge graph
PM_PATTERN_DAYS = 30            # How many days back for pattern analysis

# Emotional arc states
EMOTIONAL_STATES = ["confident", "curious", "neutral", "confused", "frustrated", "discouraged", "excited"]


# ---------------------------------------------------------------------------
# DATA CLASSES - Structured memory containers
# ---------------------------------------------------------------------------

@dataclass
class QuantumState:
    """L0: What is happening RIGHT NOW in this exact exchange."""
    current_concept: str = ""
    last_question_asked: str = ""
    last_teaching_method: str = ""      # "socratic", "direct", "analogy", "example"
    student_just_answered: bool = False
    answer_was_correct: Optional[bool] = None
    emotional_arc_position: str = "neutral"   # Where we are in the emotional journey
    turns_in_current_topic: int = 0
    explanation_attempts_this_concept: int = 0
    student_showed_signs_of_understanding: bool = False
    pending_why_question: bool = False
    last_tool_used: str = ""
    topic_switched: bool = False
    timestamp: str = ""

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict) -> "QuantumState":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class WorkingMemory:
    """L1: Current conversation messages + compressed gist."""
    messages: List[Dict[str, str]] = field(default_factory=list)
    conversation_id: Optional[str] = None
    session_message_count: int = 0
    gist: str = ""                     # Compressed summary of conversation so far
    gist_updated_at: int = 0           # Message count when gist was last updated
    session_start_time: str = ""
    platform: str = "whatsapp"

    def to_dict(self) -> Dict:
        return {
            "messages": self.messages,
            "conversation_id": self.conversation_id,
            "session_message_count": self.session_message_count,
            "gist": self.gist,
            "gist_updated_at": self.gist_updated_at,
            "session_start_time": self.session_start_time,
            "platform": self.platform,
        }

    @classmethod
    def from_dict(cls, d: Dict) -> "WorkingMemory":
        return cls(
            messages=d.get("messages", []),
            conversation_id=d.get("conversation_id"),
            session_message_count=d.get("session_message_count", 0),
            gist=d.get("gist", ""),
            gist_updated_at=d.get("gist_updated_at", 0),
            session_start_time=d.get("session_start_time", ""),
            platform=d.get("platform", "whatsapp"),
        )


@dataclass
class SessionCard:
    """A compressed session - the atomic unit of L2."""
    session_id: str = ""
    date: str = ""
    topics_covered: List[str] = field(default_factory=list)
    concepts_taught: List[str] = field(default_factory=list)
    breakthroughs: List[str] = field(default_factory=list)
    struggles: List[str] = field(default_factory=list)
    emotional_trajectory: List[str] = field(default_factory=list)  # [start, middle, end]
    misconceptions_encountered: List[str] = field(default_factory=list)
    misconceptions_resolved: List[str] = field(default_factory=list)
    student_mood_summary: str = ""     # "started frustrated, ended confident"
    next_recommended_topic: str = ""
    session_quality_score: float = 0.0  # 0-1, derived from engagement + learning signals
    summary: str = ""

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class EpisodicMemory:
    """L3: A single episodic memory entry."""
    memory_id: str = ""
    memory_type: str = ""              # "breakthrough", "struggle", "milestone", "funny", "breakthrough_after_struggle"
    description: str = ""
    subject: str = ""
    topic: str = ""
    concept: str = ""
    emotion: str = "neutral"
    emotion_intensity: float = 0.5     # 0-1
    what_came_before: str = ""         # Context before this moment
    what_came_after: str = ""          # What happened next
    student_reaction: str = ""         # How the student responded
    related_memories: List[str] = field(default_factory=list)  # IDs of related moments
    created_at: str = ""

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class KnowledgeNode:
    """L4: A single concept in the knowledge graph."""
    concept_id: str = ""
    concept_name: str = ""
    subject: str = ""
    mastery_score: float = 0.0         # 0-100
    confidence: float = 0.5            # How sure we are about the mastery score
    assessment_count: int = 0
    last_assessed_at: str = ""
    prerequisites: List[str] = field(default_factory=list)  # concept_ids
    leads_to: List[str] = field(default_factory=list)       # concept_ids
    forgetting_curve_rate: float = 0.3  # Higher = forgets faster
    predicted_retention: float = 1.0    # 0-1, predicted current retention
    next_optimal_review: str = ""      # When to review next (predictive)
    review_history: List[Dict] = field(default_factory=list)
    common_misconceptions: List[str] = field(default_factory=list)
    teaching_strategies_that_worked: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return asdict(self)

    def calculate_retention(self, now: Optional[datetime] = None) -> float:
        """Calculate predicted retention using exponential forgetting curve."""
        if not self.last_assessed_at:
            return 0.0
        if now is None:
            now = datetime.now(timezone.utc)
        try:
            last = datetime.fromisoformat(self.last_assessed_at.replace("Z", "+00:00"))
            days_since = (now - last).total_seconds() / 86400.0
            # R = e^(-rate * t / mastery)
            # Higher mastery = slower forgetting
            effective_rate = self.forgetting_curve_rate / max(1.0, self.mastery_score / 20.0)
            retention = max(0.01, min(1.0, 2.718 ** (-effective_rate * days_since)))
            return retention
        except Exception:
            return 0.5


@dataclass
class ProceduralMemory:
    """L5: How this student learns."""
    # Timing patterns
    optimal_study_hours: List[int] = field(default_factory=list)  # [20, 21, 22] means 8-10pm
    average_session_length_minutes: float = 15.0
    peak_attention_span_minutes: float = 10.0
    best_day_of_week: str = ""

    # Explanation preferences
    example_preference: str = "general"     # "market", "sports", "cooking", "transport", "science"
    explanation_depth: str = "moderate"     # "surface", "moderate", "deep"
    preferred_teaching_style: str = "adaptive"  # "socratic", "direct", "mixed"
    response_length_pref: str = "medium"    # "ultra_short", "short", "medium", "long"

    # Language
    pidgin_preference: str = "adaptive"     # "none", "adaptive", "heavy"

    # Emotional patterns
    frustration_threshold: float = 3.0      # 1-5, lower = frustrates easier
    frustration_recovery_pattern: str = ""  # "needs_break", "needs_simpler", "needs_encouragement"
    typical_emotional_arc: str = ""         # "steady", "volatile", "improving"

    # Learning modality
    learns_best_through: str = "explanation"  # "explanation", "examples", "practice", "teaching_others"
    question_tolerance: float = 5.0         # 0-10, how many Socratic questions they can handle

    # Performance patterns
    correct_first_try_rate: float = 0.5
    weak_subject_areas: List[str] = field(default_factory=list)
    strong_subject_areas: List[str] = field(default_factory=list)

    # Adaptive signals
    last_socratic_pressure: float = 5.0
    last_emotional_state: str = "neutral"
    consecutive_sessions_this_week: int = 0
    streak_days: int = 0

    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class ConsolidatedMemory:
    """L6: The continuously-updated student narrative."""
    student_name: str = ""
    wax_code: str = ""
    class_level: str = "UNKNOWN"
    exam_target: str = ""
    exam_date: str = ""
    days_until_exam: int = 0
    onboarding_complete: bool = False
    total_sessions: int = 0
    total_messages: int = 0
    total_concepts_mastered: int = 0
    total_concepts_struggling: int = 0
    joined_at: str = ""
    narrative_summary: str = ""            # The "life story" paragraph
    learning_velocity: float = 0.0         # Concepts mastered per week
    recent_trend: str = ""               # "improving", "stable", "declining"
    top_recommendations: List[str] = field(default_factory=list)
    risk_flags: List[str] = field(default_factory=list)  # "burnout_risk", "exam_pressure", "inconsistent"

    def to_dict(self) -> Dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# HOLOGRAPHIC MEMORY ENGINE
# ---------------------------------------------------------------------------

class HolographicMemoryEngine:
    """
    The central memory orchestrator.
    Loads all 7 layers, manages cross-layer connections,
    handles compression, retrieval, and forgetting prediction.
    """

    def __init__(self):
        self.db = get_db()
        self._embedding_cache: Dict[str, List[float]] = {}  # In-memory LRU for embeddings
        self._embedding_cache_hits = 0
        self._embedding_cache_misses = 0

    # =====================================================================
    # PUBLIC API: load_all
    # =====================================================================

    async def load_all(self, student_id: str) -> Dict[str, Any]:
        """
        Load all 7 memory layers for a student.
        This is the MAIN entry point - called by engine.py on every message.
        """
        # Load layers in parallel where possible
        qs_task = self._load_l0_quantum_state(student_id)
        wm_task = self._load_l1_working_memory(student_id)
        sm_task = self._load_l2_session_memory(student_id)
        em_task = self._load_l3_episodic_memory(student_id)
        sem_task = self._load_l4_semantic_memory(student_id)
        pm_task = self._load_l5_procedural_memory(student_id)
        cm_task = self._load_l6_consolidated_memory(student_id)

        qs, wm, sm, em, sem, pm, cm = await asyncio.gather(
            qs_task, wm_task, sm_task, em_task, sem_task, pm_task, cm_task
        )

        # === CROSS-LAYER CONNECTIONS ===
        # These connections are what make the memory "holographic"

        # Connect CM narrative to WM gist
        if cm.narrative_summary and not wm.gist:
            wm.gist = f"Student background: {cm.narrative_summary[:200]}"

        # Connect PM patterns to QS state
        if pm.last_emotional_state in ("frustrated", "discouraged"):
            qs.emotional_arc_position = "recovering"

        # Connect SemM knowledge gaps to CM recommendations
        weak_concepts = [n for n in sem.nodes.values() if n.mastery_score < 40]
        if weak_concepts and not cm.top_recommendations:
            cm.top_recommendations = [
                f"Review {n.concept_name} in {n.subject}" for n in weak_concepts[:5]
            ]

        # Connect EM breakthroughs to PM learning style
        breakthroughs = [e for e in em.recent if e.memory_type == "breakthrough"]
        if breakthroughs and not pm.learns_best_through:
            pm.learns_best_through = self._infer_best_learning_method(breakthroughs)

        # Connect SM session quality to PM streak
        recent_sessions = [s for s in sm.sessions if s.date > (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()]
        pm.consecutive_sessions_this_week = len(recent_sessions)

        # === PREDICTIVE FORGETTING ALERTS ===
        forgetting_alerts = []
        for node in sem.nodes.values():
            retention = node.calculate_retention()
            if 0.1 < retention < 0.4 and node.mastery_score > 50:
                forgetting_alerts.append(f"{node.concept_name} ({int(retention*100)}% retention)")
        if forgetting_alerts:
            em.forgetting_alerts = forgetting_alerts[:5]

        return {
            "quantum_state": qs.to_dict(),
            "working_memory": wm.to_dict(),
            "session_memory": sm.to_dict(),
            "episodic_memory": em.to_dict(),
            "semantic_memory": sem.to_dict(),
            "procedural_memory": pm.to_dict(),
            "consolidated_memory": cm.to_dict(),
            "forgetting_alerts": forgetting_alerts[:5],
            "knowledge_graph_summary": sem.get_summary(),
            "emotional_trend": self._calculate_emotional_trend(em),
            "learning_recommendations": self._generate_recommendations(sem, pm, cm),
        }

    # =====================================================================
    # LAYER 0: QUANTUM STATE
    # =====================================================================

    async def _load_l0_quantum_state(self, student_id: str) -> QuantumState:
        key = f"wax:qs:{student_id}"
        cached = await rget_json(key)
        if cached:
            return QuantumState.from_dict(cached)

        try:
            conv = self.db.table("conversations").select(
                "id, session_state, last_teaching_concept, last_message_at"
            ).eq("student_id", student_id).eq("is_active", True).order("started_at", desc=True).limit(1).execute()

            if conv.data:
                c = conv.data[0]
                qs = QuantumState(
                    current_concept=c.get("last_teaching_concept", ""),
                    timestamp=c.get("last_message_at", ""),
                )
                await rset_json(key, qs.to_dict(), TTL_QS)
                return qs
        except Exception as e:
            logger.debug(f"QS reconstruct failed: {e}")

        return QuantumState(timestamp=datetime.now(timezone.utc).isoformat())

    async def update_quantum_state(self, student_id: str, updates: Dict[str, Any]) -> None:
        key = f"wax:qs:{student_id}"
        current = await rget_json(key) or {}
        current.update(updates)
        current["timestamp"] = datetime.now(timezone.utc).isoformat()
        await rset_json(key, current, TTL_QS)

    # =====================================================================
    # LAYER 1: WORKING MEMORY
    # =====================================================================

    async def _load_l1_working_memory(self, student_id: str) -> WorkingMemory:
        key = f"wax:wm:{student_id}"
        cached = await rget_json(key)
        if cached:
            wm = WorkingMemory.from_dict(cached)
            await self._sync_messages_from_db(student_id, wm)
            return wm
        return await self._rebuild_working_memory_from_db(student_id)

    async def _sync_messages_from_db(self, student_id: str, wm: WorkingMemory) -> None:
        if not wm.conversation_id:
            return
        try:
            existing_contents = {m.get("content", "") for m in wm.messages}
            msgs = self.db.table("messages").select(
                "direction, content, timestamp"
            ).eq("conversation_id", wm.conversation_id).order("timestamp", desc=True).limit(WM_MESSAGE_LIMIT).execute()

            new_messages = []
            for m in reversed(msgs.data or []):
                role = "user" if m["direction"] == "inbound" else "assistant"
                content = m.get("content", "")
                if content not in existing_contents:
                    new_messages.append({"role": role, "content": content})

            if new_messages:
                wm.messages.extend(new_messages)
                if len(wm.messages) > WM_MESSAGE_LIMIT:
                    wm.messages = wm.messages[-WM_MESSAGE_LIMIT:]
                wm.session_message_count = len(wm.messages)
                await self._maybe_compress_gist(student_id, wm)
        except Exception as e:
            logger.debug(f"WM sync failed: {e}")

    async def _rebuild_working_memory_from_db(self, student_id: str) -> WorkingMemory:
        try:
            timeout = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
            conv = self.db.table("conversations").select(
                "id, started_at, platform, session_state"
            ).eq("student_id", student_id).eq("is_active", True).gte(
                "last_message_at", timeout
            ).order("started_at", desc=True).limit(1).execute()

            if not conv.data:
                return WorkingMemory()

            conv_id = conv.data[0]["id"]
            msgs = self.db.table("messages").select(
                "direction, content, timestamp"
            ).eq("conversation_id", conv_id).order("timestamp", desc=True).limit(WM_MESSAGE_LIMIT).execute()

            messages = list(reversed([
                {"role": "user" if m["direction"] == "inbound" else "assistant", "content": m["content"]}
                for m in (msgs.data or [])
            ]))

            wm = WorkingMemory(
                messages=messages,
                conversation_id=conv_id,
                session_message_count=len(messages),
                session_start_time=conv.data[0].get("started_at", ""),
                platform=conv.data[0].get("platform", "whatsapp"),
            )

            if len(messages) >= 3:
                wm.gist = await self._generate_conversation_gist(messages)
                wm.gist_updated_at = len(messages)

            await rset_json(f"wax:wm:{student_id}", wm.to_dict(), TTL_WM)
            return wm

        except Exception as e:
            logger.error(f"WM rebuild failed: {e}")
            return WorkingMemory()

    async def update_working_memory(self, student_id: str, new_message: Dict[str, str]) -> None:
        key = f"wax:wm:{student_id}"
        cached = await rget_json(key)
        if cached:
            wm = WorkingMemory.from_dict(cached)
        else:
            wm = WorkingMemory()

        wm.messages.append(new_message)
        if len(wm.messages) > WM_MESSAGE_LIMIT:
            wm.messages = wm.messages[-WM_MESSAGE_LIMIT:]
        wm.session_message_count = len(wm.messages)

        if wm.session_message_count - wm.gist_updated_at >= WM_GIST_INTERVAL:
            await self._maybe_compress_gist(student_id, wm)

        await rset_json(key, wm.to_dict(), TTL_WM)

    async def _maybe_compress_gist(self, student_id: str, wm: WorkingMemory) -> None:
        try:
            from waxprep.app.brain.engine import brain
            recent_msgs = wm.messages[-WM_GIST_INTERVAL:]
            conv_text = "\n".join([f"{'S' if m['role']=='user' else 'W'}: {m['content'][:100]}" for m in recent_msgs])
            prompt = (
                "Summarize this tutor-student exchange in ONE sentence. "
                f"What topic? What happened? Student's understanding level?\n\n{conv_text}"
            )
            gist = await brain._call_model(prompt)
            if gist:
                if wm.gist:
                    wm.gist = f"{wm.gist} | {gist.strip()}"
                else:
                    wm.gist = gist.strip()
                if len(wm.gist) > 500:
                    wm.gist = wm.gist[-500:]
                wm.gist_updated_at = wm.session_message_count
        except Exception as e:
            logger.debug(f"Gist compression failed: {e}")

    async def _generate_conversation_gist(self, messages: List[Dict]) -> str:
        try:
            from waxprep.app.brain.engine import brain
            conv_text = "\n".join([f"{'S' if m['role']=='user' else 'W'}: {m['content'][:80]}" for m in messages[-10:]])
            prompt = f"What is this student learning and how well are they doing? One sentence.\n\n{conv_text}"
            gist = await brain._call_model(prompt)
            return gist.strip() if gist else ""
        except Exception:
            return ""

    # =====================================================================
    # LAYER 2: SESSION MEMORY
    # =====================================================================

    @dataclass
    class _SessionMemoryContainer:
        sessions: List[SessionCard] = field(default_factory=list)
        def to_dict(self) -> Dict:
            return {"sessions": [s.to_dict() for s in self.sessions], "count": len(self.sessions)}

    async def _load_l2_session_memory(self, student_id: str):
        key = f"wax:sm:{student_id}"
        cached = await rget_json(key)
        if cached and cached.get("sessions"):
            container = self._SessionMemoryContainer()
            container.sessions = [SessionCard(**s) for s in cached["sessions"]]
            return container

        try:
            since = (datetime.now(timezone.utc) - timedelta(days=SM_DAYS_BACK)).isoformat()
            sessions = self.db.table("conversations").select(
                "id, started_at, ended_at, summary, session_state"
            ).eq("student_id", student_id).eq("is_active", False).gte(
                "ended_at", since
            ).not_.is_("summary", "null").order("ended_at", desc=True).limit(20).execute()

            cards = []
            for s in (sessions.data or []):
                card = await self._enrich_session_card(s["id"], s)
                cards.append(card)

            container = self._SessionMemoryContainer(sessions=cards)
            await rset_json(key, container.to_dict(), TTL_SM)
            return container

        except Exception as e:
            logger.error(f"SM load failed: {e}")
            return self._SessionMemoryContainer()

    async def _enrich_session_card(self, conv_id: str, conv_data: Dict) -> SessionCard:
        card = SessionCard(
            session_id=conv_id,
            date=conv_data.get("ended_at", ""),
            summary=conv_data.get("summary", ""),
        )

        try:
            msgs = self.db.table("messages").select(
                "direction, content"
            ).eq("conversation_id", conv_id).order("timestamp", desc=False).limit(50).execute()

            if msgs.data:
                contents = [m["content"] for m in msgs.data if m["direction"] == "inbound"]
                card.emotional_trajectory = self._extract_emotional_arc(contents)
                card.student_mood_summary = self._summarize_emotional_arc(card.emotional_trajectory)

            km_updates = self.db.table("knowledge_map_history").select(
                "concept_id, subject, old_score, new_score"
            ).eq("session_id", conv_id).execute()

            if km_updates.data:
                for update in km_updates.data:
                    concept = update["concept_id"].replace("_", " ")
                    if update["new_score"] > update.get("old_score", 0) + 10:
                        card.breakthroughs.append(concept)
                    elif update["new_score"] < update.get("old_score", 100) - 10:
                        card.struggles.append(concept)
                    card.concepts_taught.append(concept)

        except Exception as e:
            logger.debug(f"Session enrichment failed: {e}")

        return card

    def _extract_emotional_arc(self, messages: List[str]) -> List[str]:
        if not messages:
            return []

        frustration_words = ["give up", "too hard", "hopeless", "confused", "don't understand", "stupid"]
        confidence_words = ["got it", "understand", "yes", "correct", "sharp", "easy", "i see"]
        curiosity_words = ["why", "how", "what if", "explain", "tell me more"]

        emotions = []
        for msg in messages:
            msg_lower = msg.lower()
            f_score = sum(1 for w in frustration_words if w in msg_lower)
            c_score = sum(1 for w in confidence_words if w in msg_lower)
            q_score = sum(1 for w in curiosity_words if w in msg_lower)

            if f_score > c_score:
                emotions.append("frustrated")
            elif c_score > f_score:
                emotions.append("confident")
            elif q_score > 0:
                emotions.append("curious")
            else:
                emotions.append("neutral")

        if len(emotions) <= 3:
            return emotions
        third = len(emotions) // 3
        return [emotions[0], emotions[third], emotions[-1]]

    def _summarize_emotional_arc(self, arc: List[str]) -> str:
        if not arc:
            return ""
        if len(arc) == 1:
            return f"Student was {arc[0]}"
        return f"Started {arc[0]}, became {arc[-1]}"

    # =====================================================================
    # LAYER 3: EPISODIC MEMORY
    # =====================================================================

    @dataclass
    class _EpisodicMemoryContainer:
        recent: List[EpisodicMemory] = field(default_factory=list)
        breakthroughs: List[EpisodicMemory] = field(default_factory=list)
        struggles: List[EpisodicMemory] = field(default_factory=list)
        forgetting_alerts: List[str] = field(default_factory=list)

        def to_dict(self) -> Dict:
            return {
                "recent": [e.to_dict() for e in self.recent],
                "breakthroughs": [e.to_dict() for e in self.breakthroughs],
                "struggles": [e.to_dict() for e in self.struggles],
                "breakthrough_count": len(self.breakthroughs),
                "struggle_count": len(self.struggles),
            }

    async def _load_l3_episodic_memory(self, student_id: str):
        key = f"wax:em:{student_id}"
        cached = await rget_json(key)
        if cached and (cached.get("recent") or cached.get("breakthroughs")):
            container = self._EpisodicMemoryContainer()
            container.recent = [EpisodicMemory(**e) for e in cached.get("recent", [])]
            container.breakthroughs = [EpisodicMemory(**e) for e in cached.get("breakthroughs", [])]
            container.struggles = [EpisodicMemory(**e) for e in cached.get("struggles", [])]
            return container

        try:
            recent = self.db.table("episodic_memories").select("*").eq(
                "student_id", student_id
            ).order("created_at", desc=True).limit(EM_RECENT_LIMIT).execute()

            breakthroughs = self.db.table("episodic_memories").select("*").eq(
                "student_id", student_id
            ).eq("memory_type", "breakthrough").order("created_at", desc=True).limit(
                EM_BREAKTHROUGH_LIMIT
            ).execute()

            struggles = self.db.table("episodic_memories").select("*").eq(
                "student_id", student_id
            ).in_("memory_type", ["struggle", "breakthrough_after_struggle"]).order(
                "created_at", desc=True
            ).limit(EM_STRUGGLE_LIMIT).execute()

            container = self._EpisodicMemoryContainer()
            container.recent = [EpisodicMemory(**r) for r in (recent.data or [])]
            container.breakthroughs = [EpisodicMemory(**b) for b in (breakthroughs.data or [])]
            container.struggles = [EpisodicMemory(**s) for s in (struggles.data or [])]

            await rset_json(key, container.to_dict(), TTL_EM)
            return container

        except Exception as e:
            logger.error(f"EM load failed: {e}")
            return self._EpisodicMemoryContainer()

    async def save_episodic_memory(
        self,
        student_id: str,
        memory_type: str,
        description: str,
        subject: str = "",
        topic: str = "",
        concept: str = "",
        emotion: str = "neutral",
        emotion_intensity: float = 0.5,
        what_came_before: str = "",
        what_came_after: str = "",
        student_reaction: str = "",
    ) -> None:
        try:
            self.db.table("episodic_memories").insert({
                "student_id": student_id,
                "memory_type": memory_type,
                "description": description,
                "subject": subject,
                "topic": topic,
                "concept": concept,
                "emotion": emotion,
                "emotion_intensity": emotion_intensity,
                "what_came_before": what_came_before,
                "what_came_after": what_came_after,
                "student_reaction": student_reaction,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            await rdel(f"wax:em:{student_id}")
            logger.info(f"Episodic memory saved: {student_id[:8]} | {memory_type} | {concept or topic}")
        except Exception as e:
            logger.warning(f"Episodic save failed: {e}")

    def _calculate_emotional_trend(self, em) -> str:
        recent_emotions = [e.emotion for e in em.recent[:10]]
        if not recent_emotions:
            return "neutral"

        positive = ["excited", "confident", "curious"]
        negative = ["frustrated", "discouraged", "confused"]

        pos_count = sum(1 for e in recent_emotions if e in positive)
        neg_count = sum(1 for e in recent_emotions if e in negative)

        if pos_count > neg_count * 2:
            return "strongly_positive"
        elif pos_count > neg_count:
            return "improving"
        elif neg_count > pos_count * 2:
            return "struggling"
        elif neg_count > pos_count:
            return "declining"
        return "stable"

    # =====================================================================
    # LAYER 4: SEMANTIC MEMORY (Knowledge Graph)
    # =====================================================================

    @dataclass
    class _SemanticMemoryContainer:
        nodes: Dict[str, KnowledgeNode] = field(default_factory=dict)
        subject_mastery: Dict[str, float] = field(default_factory=dict)

        def to_dict(self) -> Dict:
            return {
                "nodes": {k: v.to_dict() for k, v in self.nodes.items()},
                "subject_mastery": self.subject_mastery,
                "node_count": len(self.nodes),
            }

        def get_summary(self) -> str:
            if not self.nodes:
                return "No knowledge data yet."
            strong = [n for n in self.nodes.values() if n.mastery_score >= 70]
            weak = [n for n in self.nodes.values() if n.mastery_score < 40]
            return f"{len(strong)} strong, {len(weak)} weak out of {len(self.nodes)} concepts"

    async def _load_l4_semantic_memory(self, student_id: str):
        key = f"wax:sem:{student_id}"
        cached = await rget_json(key)
        if cached and cached.get("nodes"):
            container = self._SemanticMemoryContainer()
            container.nodes = {k: KnowledgeNode(**v) for k, v in cached["nodes"].items()}
            container.subject_mastery = cached.get("subject_mastery", {})
            return container

        try:
            km = self.db.table("knowledge_maps").select("*").eq(
                "student_id", student_id
            ).order("mastery_score", desc=True).limit(SEM_KNOWLEDGE_LIMIT).execute()

            container = self._SemanticMemoryContainer()

            for row in (km.data or []):
                node = KnowledgeNode(
                    concept_id=row.get("concept_id", ""),
                    concept_name=row.get("concept_id", "").replace("_", " "),
                    subject=row.get("subject", ""),
                    mastery_score=row.get("mastery_score", 0),
                    assessment_count=row.get("assessment_count", 0),
                    last_assessed_at=row.get("last_assessed_at", ""),
                )
                node.predicted_retention = node.calculate_retention()
                node.next_optimal_review = self._predict_optimal_review(node)
                container.nodes[node.concept_id] = node

            if container.nodes:
                await self._enrich_prerequisites(container)
                container.subject_mastery = self._calculate_subject_mastery(container)

            await rset_json(key, container.to_dict(), TTL_SEM)
            return container

        except Exception as e:
            logger.error(f"SemM load failed: {e}")
            return self._SemanticMemoryContainer()

    async def _enrich_prerequisites(self, container) -> None:
        try:
            concept_ids = list(container.nodes.keys())
            if not concept_ids:
                return

            prereqs = self.db.table("concept_prerequisites").select(
                "concept_id, prerequisite_concept_id"
            ).in_("concept_id", concept_ids).execute()

            for p in (prereqs.data or []):
                cid = p.get("concept_id", "")
                prereq = p.get("prerequisite_concept_id", "")
                if cid in container.nodes:
                    container.nodes[cid].prerequisites.append(prereq)
                if prereq in container.nodes:
                    container.nodes[prereq].leads_to.append(cid)
        except Exception as e:
            logger.debug(f"Prerequisite enrichment failed: {e}")

    def _calculate_subject_mastery(self, container) -> Dict[str, float]:
        subject_scores: Dict[str, List[float]] = {}
        for node in container.nodes.values():
            subj = node.subject
            if subj not in subject_scores:
                subject_scores[subj] = []
            subject_scores[subj].append(node.mastery_score)
        return {s: round(sum(scores)/len(scores), 1) for s, scores in subject_scores.items() if scores}

    def _predict_optimal_review(self, node: KnowledgeNode) -> str:
        try:
            if not node.last_assessed_at:
                return ""
            last = datetime.fromisoformat(node.last_assessed_at.replace("Z", "+00:00"))
            import math
            effective_rate = node.forgetting_curve_rate / max(1.0, node.mastery_score / 20.0)
            if effective_rate <= 0:
                return ""
            days_until_review = -math.log(0.6) / effective_rate
            review_time = last + timedelta(days=days_until_review)
            return review_time.isoformat()
        except Exception:
            return ""

    async def update_knowledge_map(
        self,
        student_id: str,
        concept: str,
        subject: str,
        performance: float,
        teaching_method_used: str = "",
        session_id: str = "",
    ) -> None:
        try:
            concept_id = concept.lower().replace(" ", "_")
            mastery = min(100.0, max(0.0, performance * 100))

            existing = self.db.table("knowledge_maps").select("*").eq(
                "student_id", student_id
            ).eq("concept_id", concept_id).execute()

            old_score = 0.0
            if existing.data:
                old_score = existing.data[0].get("mastery_score", 0)
                new_score = round(old_score * 0.7 + mastery * 0.3, 2)

                strategies = existing.data[0].get("teaching_strategies_that_worked", []) or []
                if teaching_method_used and new_score > old_score:
                    strategies.append(teaching_method_used)
                    strategies = strategies[-10:]

                self.db.table("knowledge_maps").update({
                    "mastery_score": new_score,
                    "last_assessed_at": datetime.now(timezone.utc).isoformat(),
                    "assessment_count": existing.data[0]["assessment_count"] + 1,
                    "predicted_retention": 1.0,
                    "teaching_strategies_that_worked": strategies,
                }).eq("id", existing.data[0]["id"]).execute()
            else:
                self.db.table("knowledge_maps").insert({
                    "student_id": student_id,
                    "concept_id": concept_id,
                    "subject": subject,
                    "mastery_score": mastery,
                    "last_assessed_at": datetime.now(timezone.utc).isoformat(),
                    "assessment_count": 1,
                    "predicted_retention": 1.0,
                }).execute()

            if session_id:
                self.db.table("knowledge_map_history").insert({
                    "student_id": student_id,
                    "session_id": session_id,
                    "concept_id": concept_id,
                    "subject": subject,
                    "old_score": old_score,
                    "new_score": mastery,
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                }).execute()

            await rdel(f"wax:sem:{student_id}")
            await rdel(f"wax:cm:{student_id}")

        except Exception as e:
            logger.error(f"Knowledge map update failed: {e}")

    # =====================================================================
    # LAYER 5: PROCEDURAL MEMORY
    # =====================================================================

    async def _load_l5_procedural_memory(self, student_id: str) -> ProceduralMemory:
        key = f"wax:pm:{student_id}"
        cached = await rget_json(key)
        if cached:
            return ProceduralMemory(**cached)

        try:
            profile = self.db.table("student_profiles").select("*").eq(
                "student_id", student_id
            ).execute()

            if profile.data:
                p = profile.data[0]
                pm = ProceduralMemory(
                    example_preference=p.get("example_preference", "general") or "general",
                    explanation_depth=p.get("explanation_depth", "moderate") or "moderate",
                    preferred_teaching_style=p.get("preferred_teaching_style", "adaptive") or "adaptive",
                    response_length_pref=p.get("response_length_pref", "medium") or "medium",
                    pidgin_preference=p.get("pidgin_preference", "adaptive") or "adaptive",
                    frustration_threshold=p.get("frustration_threshold", 3) or 3,
                    correct_first_try_rate=p.get("correct_first_try_rate", 0.5) or 0.5,
                    last_socratic_pressure=p.get("socratic_pressure_score", 5.0) or 5.0,
                    last_emotional_state=p.get("emotional_state_current", "neutral") or "neutral",
                )

                await self._enrich_procedural_patterns(student_id, pm)
                await rset_json(key, pm.to_dict(), TTL_PM)
                return pm

        except Exception as e:
            logger.error(f"PM load failed: {e}")

        return ProceduralMemory()

    async def _enrich_procedural_patterns(self, student_id: str, pm: ProceduralMemory) -> None:
        try:
            sessions = self.db.table("conversations").select("started_at").eq(
                "student_id", student_id
            ).gte("started_at", (datetime.now(timezone.utc) - timedelta(days=PM_PATTERN_DAYS)).isoformat()).execute()

            if sessions.data:
                hours = []
                for s in sessions.data:
                    try:
                        dt = datetime.fromisoformat(s["started_at"].replace("Z", "+00:00"))
                        hours.append(dt.hour)
                    except Exception:
                        pass
                if hours:
                    from collections import Counter
                    hour_counts = Counter(hours)
                    pm.optimal_study_hours = [h for h, c in hour_counts.most_common(3)]

            pm.streak_days = self._calculate_streak(student_id)

        except Exception as e:
            logger.debug(f"Procedural pattern analysis failed: {e}")

    def _calculate_streak(self, student_id: str) -> int:
        try:
            sessions = self.db.table("conversations").select("started_at").eq(
                "student_id", student_id
            ).order("started_at", desc=True).limit(30).execute()

            if not sessions.data:
                return 0

            study_days = set()
            for s in sessions.data:
                try:
                    dt = datetime.fromisoformat(s["started_at"].replace("Z", "+00:00"))
                    study_days.add(dt.date())
                except Exception:
                    pass

            today = datetime.now(timezone.utc).date()
            streak = 0
            for i in range(30):
                check_day = today - timedelta(days=i)
                if check_day in study_days:
                    streak += 1
                elif i == 0:
                    continue
                else:
                    break
            return streak
        except Exception:
            return 0

    def _infer_best_learning_method(self, breakthroughs: List[EpisodicMemory]) -> str:
        methods = []
        for b in breakthroughs:
            desc = b.description.lower()
            if "analogy" in desc or "like" in desc:
                methods.append("examples")
            elif "explain" in desc or "because" in desc:
                methods.append("explanation")
            elif "practice" in desc or "try" in desc:
                methods.append("practice")
            elif "teach" in desc or "show" in desc:
                methods.append("teaching_others")

        if not methods:
            return "explanation"
        from collections import Counter
        return Counter(methods).most_common(1)[0][0]

    # =====================================================================
    # LAYER 6: CONSOLIDATED MEMORY
    # =====================================================================

    async def _load_l6_consolidated_memory(self, student_id: str) -> ConsolidatedMemory:
        key = f"wax:cm:{student_id}"
        cached = await rget_json(key)
        if cached and cached.get("narrative_summary"):
            return ConsolidatedMemory(**cached)

        try:
            student = self.db.table("students").select("*").eq("id", student_id).execute()
            profile = self.db.table("student_profiles").select("*").eq("student_id", student_id).execute()
            km = self.db.table("knowledge_maps").select("mastery_score").eq("student_id", student_id).execute()

            s = student.data[0] if student.data else {}
            p = profile.data[0] if profile.data else {}

            mastered = sum(1 for k in (km.data or []) if k.get("mastery_score", 0) >= 70)
            struggling = sum(1 for k in (km.data or []) if k.get("mastery_score", 0) < 40)

            days_until_exam = 0
            exam_date = s.get("exam_date", "")
            if exam_date:
                try:
                    exam_dt = datetime.fromisoformat(str(exam_date)).replace(tzinfo=timezone.utc)
                    days_until_exam = max(0, (exam_dt - datetime.now(timezone.utc)).days)
                except Exception:
                    pass

            velocity = self._calculate_learning_velocity(student_id)

            cm = ConsolidatedMemory(
                student_name=p.get("student_name", ""),
                wax_code=s.get("wax_code", ""),
                class_level=s.get("inferred_class_level", "UNKNOWN"),
                exam_target=s.get("primary_exam_target", ""),
                exam_date=str(exam_date) if exam_date else "",
                days_until_exam=days_until_exam,
                onboarding_complete=s.get("onboarding_complete", False),
                total_sessions=s.get("session_count", 0),
                total_messages=s.get("total_messages_received", 0),
                total_concepts_mastered=mastered,
                total_concepts_struggling=struggling,
                joined_at=str(s.get("created_at", "")),
                learning_velocity=velocity,
                narrative_summary=await self._generate_narrative(student_id, s, p, mastered, struggling),
            )

            cm.risk_flags = self._detect_risk_flags(cm, p, pm)

            await rset_json(key, cm.to_dict(), TTL_CM)
            return cm

        except Exception as e:
            logger.error(f"CM load failed: {e}")
            return ConsolidatedMemory()

    def _calculate_learning_velocity(self, student_id: str) -> float:
        try:
            since = (datetime.now(timezone.utc) - timedelta(days=28)).isoformat()
            history = self.db.table("knowledge_map_history").select("new_score, old_score, recorded_at").eq(
                "student_id", student_id
            ).gte("recorded_at", since).execute()

            if not history.data:
                return 0.0

            mastered_this_month = sum(
                1 for h in history.data
                if h.get("new_score", 0) >= 70 and h.get("old_score", 0) < 70
            )
            return round(mastered_this_month / 4.0, 2)
        except Exception:
            return 0.0

    async def _generate_narrative(
        self, student_id: str, student: Dict, profile: Dict, mastered: int, struggling: int
    ) -> str:
        name = profile.get("student_name", "This student")
        level = student.get("inferred_class_level", "")
        exam = student.get("primary_exam_target", "")

        parts = [f"{name}"]
        if level:
            parts.append(f"is a {level} student")
        if exam:
            parts.append(f"preparing for {exam}")
        parts.append(f". They have mastered {mastered} concepts and are working through {struggling} challenging areas.")

        recent_sessions = self.db.table("conversations").select("summary").eq(
            "student_id", student_id
        ).eq("is_active", False).not_.is_("summary", "null").order(
            "ended_at", desc=True
        ).limit(3).execute()

        if recent_sessions.data:
            topics = [s.get("summary", "") for s in recent_sessions.data if s.get("summary")]
            if topics:
                parts.append(f" Recently: {'; '.join(topics[:2])}.")

        return "".join(parts)

    def _detect_risk_flags(self, cm: ConsolidatedMemory, profile: Dict, pm: ProceduralMemory = None) -> List[str]:
        flags = []
        if cm.days_until_exam > 0 and cm.days_until_exam <= 14 and cm.total_concepts_struggling > 5:
            flags.append("exam_pressure_high")
        if cm.learning_velocity < 0.5 and cm.total_sessions > 10:
            flags.append("slow_progress")
        if profile.get("emotional_state_current") in ("frustrated", "discouraged"):
            flags.append("at_risk_of_dropping")
        if pm and pm.streak_days > 14:
            flags.append("potential_burnout")
        return flags

    def _generate_recommendations(self, sem, pm: ProceduralMemory, cm: ConsolidatedMemory) -> List[str]:
        recs = []

        for node in sem.nodes.values():
            if node.mastery_score < 50:
                for prereq_id in node.prerequisites:
                    prereq = sem.nodes.get(prereq_id)
                    if prereq and prereq.mastery_score < 40:
                        recs.append(f"Strengthen {prereq.concept_name} before {node.concept_name}")

        for node in sem.nodes.values():
            if node.mastery_score > 60 and node.predicted_retention < 0.4:
                recs.append(f"Quick review: {node.concept_name} (retention fading)")

        if cm.days_until_exam <= 30:
            weak = [n for n in sem.nodes.values() if n.mastery_score < 50]
            if weak:
                recs.append(f"Exam focus: Prioritize {weak[0].concept_name}")

        return recs[:8]

    # =====================================================================
    # PUBLIC: Update helpers
    # =====================================================================

    async def update_dna(self, student_id: str, updates: Dict) -> None:
        try:
            self.db.table("student_profiles").update(updates).eq("student_id", student_id).execute()
            await rdel(f"wax:pm:{student_id}")
            await rdel(f"wax:cm:{student_id}")
        except Exception as e:
            logger.warning(f"DNA update failed: {e}")

    async def invalidate_all(self, student_id: str) -> None:
        await rdel(f"wax:qs:{student_id}")
        await rdel(f"wax:wm:{student_id}")
        await rdel(f"wax:sm:{student_id}")
        await rdel(f"wax:em:{student_id}")
        await rdel(f"wax:sem:{student_id}")
        await rdel(f"wax:pm:{student_id}")
        await rdel(f"wax:cm:{student_id}")

    async def get_embedding(self, text: str) -> List[float]:
        if not text or not text.strip():
            return [0.0] * 768

        cache_key = hashlib.md5(text.strip().lower()[:200].encode()).hexdigest()
        if cache_key in self._embedding_cache:
            self._embedding_cache_hits += 1
            return self._embedding_cache[cache_key]

        self._embedding_cache_misses += 0

        try:
            import os, google.generativeai as genai
            genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))
            result = genai.embed_content(
                model="models/gemini-embedding-001",
                content=text.strip()[:500],
                task_type="retrieval_query",
            )
            embedding = result["embedding"]
            if len(self._embedding_cache) > 10000:
                keys = list(self._embedding_cache.keys())[:2000]
                for k in keys:
                    del self._embedding_cache[k]
            self._embedding_cache[cache_key] = embedding
            return embedding
        except Exception as e:
            logger.warning(f"Embedding failed: {e}")
            return [0.0] * 768

    def cosine_similarity(self, a: List[float], b: List[float]) -> float:
        import numpy as np
        a_arr = np.array(a, dtype=np.float32)
        b_arr = np.array(b, dtype=np.float32)
        norm_a = np.linalg.norm(a_arr)
        norm_b = np.linalg.norm(b_arr)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a_arr, b_arr) / (norm_a * norm_b))


# Global instance
memory = HolographicMemoryEngine()
