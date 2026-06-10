import os
import numpy as np
import google.generativeai as genai
from typing import Dict, Any, Optional, Tuple
from loguru import logger

genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))

def get_embedding(text: str) -> list:
    """
    Convert any text to 768-number embedding using Gemini gemini-embedding-001.
    This is the SECOND Gemini (embeddings) — separate from the main Gemini 1.5 Flash.
    """
    if not text or not text.strip():
        return [0.0] * 768
    
    try:
        model = "models/gemini-embedding-001"
        result = genai.embed_content(
            model=model,
            content=text.strip(),
            task_type="retrieval_query",
        )
        return result["embedding"]  # List of 768 floats
    except Exception as e:
        logger.warning(f"Embedding failed: {e}")
        return [0.0] * 768


def cosine_similarity(a: list, b: list) -> float:
    """
    Compare two embeddings. 1.0 = same meaning, 0.0 = different meaning.
    """
    a = np.array(a, dtype=np.float32)
    b = np.array(b, dtype=np.float32)
    
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
    
    return float(np.dot(a, b) / (norm_a * norm_b))


def _analyze_message_tone(message: str) -> Dict[str, float]:
    """
    Analyze the tone of the message without keywords.
    Uses embedding comparison to known emotional patterns.
    """
    message = message.lower().strip()
    
    # Get embedding of the message
    msg_emb = get_embedding(message)
    
    # Define emotional anchors (these are fixed reference embeddings)
    # We use short phrases that capture the essence of each emotion
    anchors = {
        "frustration": [
            "i don't understand anything",
            "this is too hard",
            "i give up",
            "i feel stupid",
            "nothing makes sense",
        ],
        "curiosity": [
            "teach me something",
            "i want to learn",
            "explain this to me",
            "how does this work",
        ],
        "goodbye": [
            "good night",
            "i'm going now",
            "see you later",
            "talk tomorrow",
        ],
        "confusion": [
            "wait what",
            "i don't get it",
            "can you explain again",
            "that doesn't make sense",
        ],
        "chat": [
            "how are you",
            "what's up",
            "i'm fine thanks",
            "my friend said something",
        ],
    }
    
    scores = {}
    for emotion, phrases in anchors.items():
        # Average similarity to all phrases of this emotion
        similarities = []
        for phrase in phrases:
            phrase_emb = get_embedding(phrase)
            sim = cosine_similarity(msg_emb, phrase_emb)
            similarities.append(sim)
        
        scores[emotion] = float(np.mean(similarities)) if similarities else 0.0
    
    return scores


def _get_conversation_context(memory_layers: Dict[str, Any]) -> Dict[str, Any]:
    """
    Read the last few messages to understand what just happened.
    This gives CONTEXT to the current message.
    """
    short_term = memory_layers.get("short_term", {})
    messages = short_term.get("messages", [])
    
    if not messages:
        return {
            "last_was_teaching": False,
            "last_was_question": False,
            "student_just_said": "",
            "waxprep_just_said": "",
            "turn_count": 0,
        }
    
    # Get last student message (before current)
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
    
    # Check if WaxPrep just taught something
    teaching_indicators = ["is a", "means", "works by", "example", "think of it", "imagine"]
    last_was_teaching = any(ind in last_waxprep.lower() for ind in teaching_indicators)
    
    # Check if WaxPrep just asked a question
    last_was_question = "?" in last_waxprep
    
    return {
        "last_was_teaching": last_was_teaching,
        "last_was_question": last_was_question,
        "student_just_said": last_student,
        "waxprep_just_said": last_waxprep,
        "turn_count": len(messages),
    }


def detect_intent(student_message: str, memory_layers: Dict[str, Any]) -> Dict[str, Any]:
    """
    MAIN FUNCTION: Build a rich intent from message + full memory context.
    
    This is NOT a fixed 6-intent system. It builds a DYNAMIC intent
    based on what the student said + their history + their state.
    
    Returns a rich intent dictionary that context_builder will use.
    """
    
    message = student_message.strip()
    msg_lower = message.lower()
    
    # === PART 1: Analyze the message itself ===
    tone_scores = _analyze_message_tone(message)
    
    # Get the strongest emotion from tone
    primary_emotion = max(tone_scores, key=tone_scores.get)
    primary_score = tone_scores[primary_emotion]
    
    # === PART 2: Read conversation context ===
    conv_context = _get_conversation_context(memory_layers)
    
    # === PART 3: Read student profile ===
    long_term = memory_layers.get("long_term", {})
    
    student_name = long_term.get("student_name", "")
    current_subject = long_term.get("current_subject", "")
    current_topic = long_term.get("current_topic", "")
    emotional_state = long_term.get("emotional_state", "neutral")
    socratic_pressure = long_term.get("socratic_pressure_score", 5.0)
    pidgin_preference = long_term.get("dna", {}).get("pidgin_comfort", "adaptive")
    class_level = long_term.get("class_level", "UNKNOWN")
    
    # === PART 4: Read knowledge state ===
    knowledge = memory_layers.get("long_term", {})
    mastered = knowledge.get("mastered_concepts", [])
    struggling = knowledge.get("struggling_concepts", [])
    
    # === PART 5: Determine PRIMARY intent ===
    # This is the MAIN thing the student wants
    
    primary_intent = "CHAT"  # Default
    
    # Check if message is a clear teaching request
    teach_emb = get_embedding(message)
    teach_anchors = [
        "teach me", "explain", "i want to learn", "show me how",
        "break it down", "start from basics", "my foundation is weak",
    ]
    teach_sims = [cosine_similarity(teach_emb, get_embedding(a)) for a in teach_anchors]
    max_teach_sim = max(teach_sims) if teach_sims else 0.0
    
    # Check if message is a clear question
    question_anchors = [
        "what is", "how does", "why is", "when is", "where can",
        "who discovered", "can you explain",
    ]
    question_sims = [cosine_similarity(teach_emb, get_embedding(a)) for a in question_anchors]
    max_question_sim = max(question_sims) if question_sims else 0.0
    
    # Check if message is goodbye
    goodbye_anchors = [
        "good night", "goodnight", "bye", "see you", "i'm going",
        "make i sleep", "talk later", "i dey go",
    ]
    goodbye_sims = [cosine_similarity(teach_emb, get_embedding(a)) for a in goodbye_anchors]
    max_goodbye_sim = max(goodbye_sims) if goodbye_sims else 0.0
    
    # Decide primary intent based on highest similarity
    if max_goodbye_sim > 0.75:
        primary_intent = "GOODBYE"
    elif max_teach_sim > 0.70:
        primary_intent = "TEACH"
    elif max_question_sim > 0.70:
        primary_intent = "QUESTION"
    elif primary_score > 0.65:
        # If emotion is strong, use it as intent
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
    
    # === PART 6: Determine SECONDARY intent (context-dependent) ===
    secondary_intent = None
    
    # If they said "ok" after teaching, they might be ready or confused
    if msg_lower in ["ok", "okay", "k", "yes", "sharp", "exactly"]:
        if conv_context["last_was_teaching"]:
            # If they mastered this before, "ok" means continue
            if current_topic and current_topic.replace(" ", "_") in mastered:
                secondary_intent = "READY"
            else:
                # Might be confused but saying ok to be polite
                secondary_intent = "POLITE_OK"
        else:
            secondary_intent = "CHAT"
    
    # If they said "teach me" but are frustrated
    if primary_intent == "TEACH" and emotional_state == "frustrated":
        secondary_intent = "FRUSTRATED"
    
    # If they said "I don't understand" after a question
    if primary_intent == "CONFUSED" and conv_context["last_was_question"]:
        secondary_intent = "NEEDS_REEXPLAIN"
    
    # === PART 7: Build the RICH intent object ===
    rich_intent = {
        # Core intent
        "primary": primary_intent,
        "secondary": secondary_intent,
        "confidence": round(max(max_teach_sim, max_question_sim, max_goodbye_sim, primary_score), 2),
        
        # Student identity
        "student_name": student_name,
        "class_level": class_level,
        
        # Academic context
        "subject": current_subject,
        "topic": current_topic,
        "mastered_concepts": mastered,
        "struggling_concepts": struggling,
        
        # Emotional state
        "emotional_state": emotional_state,
        "socratic_pressure": socratic_pressure,
        "tone_scores": tone_scores,
        
        # Language
        "pidgin_preference": pidgin_preference,
        
        # Conversation context
        "last_was_teaching": conv_context["last_was_teaching"],
        "last_was_question": conv_context["last_was_question"],
        "turn_count": conv_context["turn_count"],
        
        # Time context (we'll add this in context_builder)
        "time_context": "",
        
        # The original message
        "original_message": message,
    }
    
    logger.info(f"Intent detected: {primary_intent}" + (f" + {secondary_intent}" if secondary_intent else "") + f" | msg='{message[:40]}...'")
    
    return rich_intent


def get_intent_summary(intent: Dict[str, Any]) -> str:
    """
    Convert rich intent to a human-readable summary for logging.
    """
    parts = [intent["primary"]]
    if intent.get("secondary"):
        parts.append(f"+{intent['secondary']}")
    if intent.get("subject"):
        parts.append(f"|{intent['subject']}")
    if intent.get("topic"):
        parts.append(f":{intent['topic']}")
    return " ".join(parts)
# Deploy trigger
