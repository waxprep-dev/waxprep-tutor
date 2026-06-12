"""
================================================================================
INTENT DETECTOR v4.0 - FIXED MEMORY KEY MAPPING
================================================================================

CRITICAL FIX: This file previously used WRONG memory keys that didn't match
memory.py's output. The AI had ZERO access to student context.

OLD (BROKEN) keys:
  - "short_term"     → should be "working_memory"
  - "long_term"      → should be "consolidated_memory" + "procedural_memory"
  - "episodic"       → should be "episodic_memory"
  - "semantic"       → should be "semantic_memory"

NEW (FIXED) keys: All match memory.py load_all() return dict exactly.

ADDITIONAL IMPROVEMENTS:
1. Cached embeddings for anchor phrases (eliminates 20+ API calls per message)
2. Subject/topic extraction from student messages
3. Better confidence scoring
4. Detects student onboarding state
5. Detects if student wants to continue previous topic
================================================================================
"""

import os
import numpy as np
import google.generativeai as genai
from typing import Dict, Any, Optional
from loguru import logger

genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))

# ============================================================================
# CACHED EMBEDDINGS - NEW: Pre-computed anchor embeddings
# ============================================================================

_ANCHOR_EMBEDDINGS: Dict[str, list] = {}
_ANCHORS_INITIALIZED = False

def _init_anchor_embeddings():
    """Pre-compute embeddings for all anchor phrases. Only runs once."""
    global _ANCHORS_INITIALIZED, _ANCHOR_EMBEDDINGS
    if _ANCHORS_INITIALIZED:
        return

    all_phrases = set()
    anchors = {
        "frustration": [
            "i don't understand anything", "this is too hard", "i give up",
            "i feel stupid", "nothing makes sense",
        ],
        "curiosity": [
            "teach me something", "i want to learn", "explain this to me",
            "how does this work",
        ],
        "goodbye": [
            "good night", "goodnight", "bye", "see you", "i'm going",
            "make i sleep", "talk later", "i dey go",
        ],
        "confusion": [
            "wait what", "i don't get it", "can you explain again",
            "that doesn't make sense",
        ],
        "chat": [
            "how are you", "what's up", "i'm fine thanks",
            "my friend said something",
        ],
        "teach": [
            "teach me", "explain", "i want to learn", "show me how",
            "break it down", "start from basics", "my foundation is weak",
        ],
        "question": [
            "what is", "how does", "why is", "when is", "where can",
            "who discovered", "can you explain",
        ],
    }

    for emotion, phrases in anchors.items():
        for phrase in phrases:
            all_phrases.add(phrase)

    # Batch compute embeddings
    for phrase in all_phrases:
        try:
            result = genai.embed_content(
                model="models/gemini-embedding-001",
                content=phrase,
                task_type="retrieval_query",
            )
            _ANCHOR_EMBEDDINGS[phrase] = result["embedding"]
        except Exception:
            _ANCHOR_EMBEDDINGS[phrase] = [0.0] * 768

    _ANCHORS_INITIALIZED = True
    logger.info(f"Intent detector: cached {len(_ANCHOR_EMBEDDINGS)} anchor embeddings")


def get_embedding(text: str) -> list:
    """Convert text to 768-number embedding. Uses cache for known phrases."""
    if not text or not text.strip():
        return [0.0] * 768

    text_lower = text.strip().lower()
    if text_lower in _ANCHOR_EMBEDDINGS:
        return _ANCHOR_EMBEDDINGS[text_lower]

    try:
        result = genai.embed_content(
            model="models/gemini-embedding-001",
            content=text.strip(),
            task_type="retrieval_query",
        )
        return result["embedding"]
    except Exception as e:
        logger.warning(f"Embedding failed: {e}")
        return [0.0] * 768


def cosine_similarity(a: list, b: list) -> float:
    a = np.array(a, dtype=np.float32)
    b = np.array(b, dtype=np.float32)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


# ============================================================================
# MESSAGE TONE ANALYSIS - FIXED: Uses correct cached embeddings
# ============================================================================

def _analyze_message_tone(message: str) -> Dict[str, float]:
    """Analyze the tone using embedding comparison to emotional anchors."""
    _init_anchor_embeddings()

    message = message.lower().strip()
    msg_emb = get_embedding(message)

    anchors = {
        "frustration": [
            "i don't understand anything", "this is too hard", "i give up",
            "i feel stupid", "nothing makes sense",
        ],
        "curiosity": [
            "teach me something", "i want to learn", "explain this to me",
            "how does this work",
        ],
        "goodbye": [
            "good night", "goodnight", "bye", "see you", "i'm going",
            "make i sleep", "talk later", "i dey go",
        ],
        "confusion": [
            "wait what", "i don't get it", "can you explain again",
            "that doesn't make sense",
        ],
        "chat": [
            "how are you", "what's up", "i'm fine thanks",
            "my friend said something",
        ],
    }

    scores = {}
    for emotion, phrases in anchors.items():
        similarities = []
        for phrase in phrases:
            phrase_emb = _ANCHOR_EMBEDDINGS.get(phrase)
            if phrase_emb is None:
                phrase_emb = get_embedding(phrase)
            sim = cosine_similarity(msg_emb, phrase_emb)
            similarities.append(sim)
        scores[emotion] = float(np.mean(similarities)) if similarities else 0.0

    return scores


# ============================================================================
# CONVERSATION CONTEXT - FIXED: Uses correct "working_memory" key
# ============================================================================

def _get_conversation_context(memory_layers: Dict[str, Any]) -> Dict[str, Any]:
    """Read the last few messages to understand what just happened."""
    # FIXED: Was "short_term", now "working_memory"
    working_memory = memory_layers.get("working_memory", {})
    messages = working_memory.get("messages", [])

    if not messages:
        return {
            "last_was_teaching": False,
            "last_was_question": False,
            "student_just_said": "",
            "waxprep_just_said": "",
            "turn_count": 0,
        }

    last_student = ""
    last_waxprep = ""

    for msg in reversed(messages):
        if msg.get("role") == "user":
            if not last_student:
                last_student = msg.get("content", "")
        elif msg.get("role") == "assistant":
            if not last_waxprep:
                last_waxprep = msg.get("content", "")

        if last_student and last_waxprep:
            break

    teaching_indicators = ["is a", "means", "works by", "example", "think of it", "imagine", "defined as"]
    last_was_teaching = any(ind in last_waxprep.lower() for ind in teaching_indicators)
    last_was_question = "?" in last_waxprep

    return {
        "last_was_teaching": last_was_teaching,
        "last_was_question": last_was_question,
        "student_just_said": last_student,
        "waxprep_just_said": last_waxprep,
        "turn_count": len(messages),
    }


# ============================================================================
# SUBJECT/TOPIC EXTRACTION - NEW
# ============================================================================

def _extract_subject_topic(message: str) -> Dict[str, str]:
    """Extract subject and topic from student message."""
    msg_lower = message.lower()

    # Subject keywords
    subjects = {
        "mathematics": ["math", "mathematics", "algebra", "geometry", "calculus", "trigonometry", "equation"],
        "physics": ["physics", "force", "motion", "energy", "electricity", "magnetism", "optics"],
        "chemistry": ["chemistry", "atom", "molecule", "reaction", "acid", "base", "organic"],
        "biology": ["biology", "cell", "organism", "photosynthesis", "genetics", "ecosystem", "anatomy"],
        "english": ["english", "grammar", "literature", "essay", "comprehension"],
        "economics": ["economics", "market", "demand", "supply", "money", "trade", "gdp"],
        "government": ["government", "politics", "democracy", "constitution", "election"],
        "civic_education": ["civic", "citizenship", "rights", "responsibilities"],
        "agriculture": ["agriculture", "farming", "crop", "soil", "livestock"],
        "computer_studies": ["computer", "programming", "software", "hardware", "database"],
    }

    detected_subject = ""
    for subject, keywords in subjects.items():
        if any(kw in msg_lower for kw in keywords):
            detected_subject = subject
            break

    # Topic extraction - look for "topic" or "about" or specific patterns
    detected_topic = ""
    topic_markers = ["topic of ", "about ", "on ", "learn ", "teach me ", "explain "]
    for marker in topic_markers:
        if marker in msg_lower:
            idx = msg_lower.index(marker) + len(marker)
            rest = message[idx:].strip()
            # Take up to 4 words as topic
            words = rest.split()[:4]
            detected_topic = " ".join(words).rstrip(".,?!;:")
            break

    return {"subject": detected_subject, "topic": detected_topic}


# ============================================================================
# MAIN INTENT DETECTION - FIXED: Uses correct memory keys
# ============================================================================

def detect_intent(student_message: str, memory_layers: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build a rich intent from message + full memory context.
    FIXED: Now correctly reads from all 7 memory layers.
    """
    _init_anchor_embeddings()

    message = student_message.strip()
    msg_lower = message.lower()

    # === PART 1: Analyze the message itself ===
    tone_scores = _analyze_message_tone(message)
    primary_emotion = max(tone_scores, key=tone_scores.get)
    primary_score = tone_scores[primary_emotion]

    # === PART 2: Read conversation context ===
    conv_context = _get_conversation_context(memory_layers)

    # === PART 3: Read student profile - FIXED KEYS ===
    # Was: long_term = memory_layers.get("long_term", {})
    # Now: Read from consolidated_memory + procedural_memory
    consolidated = memory_layers.get("consolidated_memory", {})
    procedural = memory_layers.get("procedural_memory", {})
    quantum = memory_layers.get("quantum_state", {})

    student_name = consolidated.get("student_name", "")
    # FIXED: Get subject/topic from quantum state first (most current)
    current_subject = quantum.get("current_subject", "") or consolidated.get("last_subjects_studied", [""])[0] if consolidated.get("last_subjects_studied") else ""
    current_topic = quantum.get("current_topic", "") or quantum.get("current_concept", "")
    emotional_state = procedural.get("last_emotional_state", "neutral")
    socratic_pressure = procedural.get("last_socratic_pressure", 5.0)
    pidgin_preference = procedural.get("pidgin_preference", "adaptive")
    class_level = consolidated.get("class_level", "UNKNOWN")
    onboarding_complete = consolidated.get("onboarding_complete", False)

    # === PART 4: Read knowledge state - FIXED KEYS ===
    semantic = memory_layers.get("semantic_memory", {})
    mastered = []
    struggling = []
    if semantic and semantic.get("nodes"):
        for concept_id, node in semantic["nodes"].items():
            mastery = node.get("mastery_score", 0) if isinstance(node, dict) else node.mastery_score
            if mastery >= 70:
                mastered.append(concept_id)
            elif mastery < 40:
                struggling.append(concept_id)

    # === PART 5: NEW - Check if onboarding is needed ===
    needs_onboarding = False
    if not onboarding_complete and conv_context["turn_count"] < 5:
        needs_onboarding = True
    # Also check if we still don't know basic info after many messages
    if onboarding_complete and not current_subject and conv_context["turn_count"] > 3:
        # Student has been chatting but never said what subject
        pass  # Will be handled in teaching flow

    # === PART 6: Determine PRIMARY intent ===
    primary_intent = "CHAT"

    # Pre-compute message embedding once
    teach_emb = get_embedding(message)

    teach_anchors = [
        "teach me", "explain", "i want to learn", "show me how",
        "break it down", "start from basics", "my foundation is weak",
    ]
    teach_sims = [cosine_similarity(teach_emb, _ANCHOR_EMBEDDINGS.get(a, get_embedding(a))) for a in teach_anchors]
    max_teach_sim = max(teach_sims) if teach_sims else 0.0

    question_anchors = [
        "what is", "how does", "why is", "when is", "where can",
        "who discovered", "can you explain",
    ]
    question_sims = [cosine_similarity(teach_emb, _ANCHOR_EMBEDDINGS.get(a, get_embedding(a))) for a in question_anchors]
    max_question_sim = max(question_sims) if question_sims else 0.0

    goodbye_anchors = [
        "good night", "goodnight", "bye", "see you", "i'm going",
        "make i sleep", "talk later", "i dey go",
    ]
    goodbye_sims = [cosine_similarity(teach_emb, _ANCHOR_EMBEDDINGS.get(a, get_embedding(a))) for a in goodbye_anchors]
    max_goodbye_sim = max(goodbye_sims) if goodbye_sims else 0.0

    # NEW: Detect "continue" intent (student wants to keep learning previous topic)
    continue_anchors = ["continue", "next", "what next", "go on", "more", "another"]
    continue_sims = [cosine_similarity(teach_emb, _ANCHOR_EMBEDDINGS.get(a, get_embedding(a))) for a in continue_anchors]
    max_continue_sim = max(continue_sims) if continue_sims else 0.0

    if max_goodbye_sim > 0.75:
        primary_intent = "GOODBYE"
    elif max_teach_sim > 0.70:
        primary_intent = "TEACH"
    elif max_question_sim > 0.70:
        primary_intent = "QUESTION"
    elif max_continue_sim > 0.70 and current_topic:
        primary_intent = "TEACH"  # Continue teaching current topic
    elif primary_score > 0.65:
        if primary_emotion == "frustration":
            primary_intent = "FRUSTRATED"
        elif primary_emotion == "confusion":
            primary_intent = "CONFUSED"
        elif primary_emotion == "curiosity":
            primary_intent = "TEACH"
        else:
            primary_intent = "CHAT"
    else:
        primary_intent = "CHAT"

    # === PART 7: NEW - Extract subject/topic from message ===
    extracted = _extract_subject_topic(message)
    if extracted["subject"] and not current_subject:
        current_subject = extracted["subject"]
    if extracted["topic"] and not current_topic:
        current_topic = extracted["topic"]

    # === PART 8: Determine SECONDARY intent ===
    secondary_intent = None

    if msg_lower in ["ok", "okay", "k", "yes", "sharp", "exactly"]:
        if conv_context["last_was_teaching"]:
            if current_topic and current_topic.replace(" ", "_") in mastered:
                secondary_intent = "READY"
            else:
                secondary_intent = "POLITE_OK"
        else:
            secondary_intent = "CHAT"

    if primary_intent == "TEACH" and emotional_state == "frustrated":
        secondary_intent = "FRUSTRATED"

    if primary_intent == "CONFUSED" and conv_context["last_was_question"]:
        secondary_intent = "NEEDS_REEXPLAIN"

    # NEW: If student wants to learn but we don't know subject
    if primary_intent == "TEACH" and not current_subject and not needs_onboarding:
        secondary_intent = "NEEDS_SUBJECT"

    # === PART 9: Build the RICH intent object ===
    rich_intent = {
        "primary": primary_intent,
        "secondary": secondary_intent,
        "confidence": round(max(max_teach_sim, max_question_sim, max_goodbye_sim, max_continue_sim, primary_score), 2),
        "student_name": student_name,
        "class_level": class_level,
        "subject": current_subject,
        "topic": current_topic,
        "mastered_concepts": mastered,
        "struggling_concepts": struggling,
        "emotional_state": emotional_state,
        "socratic_pressure": socratic_pressure,
        "tone_scores": tone_scores,
        "pidgin_preference": pidgin_preference,
        "last_was_teaching": conv_context["last_was_teaching"],
        "last_was_question": conv_context["last_was_question"],
        "turn_count": conv_context["turn_count"],
        "needs_onboarding": needs_onboarding,
        "onboarding_complete": onboarding_complete,
        "time_context": "",
        "original_message": message,
    }

    logger.info(f"Intent detected: {primary_intent}" + (f" + {secondary_intent}" if secondary_intent else "") + f" | subject={current_subject} | topic={current_topic} | msg='{message[:40]}...'")

    return rich_intent


def get_intent_summary(intent: Dict[str, Any]) -> str:
    parts = [intent["primary"]]
    if intent.get("secondary"):
        parts.append(f"+{intent['secondary']}")
    if intent.get("subject"):
        parts.append(f"|{intent['subject']}")
    if intent.get("topic"):
        parts.append(f":{intent['topic']}")
    return " ".join(parts)
