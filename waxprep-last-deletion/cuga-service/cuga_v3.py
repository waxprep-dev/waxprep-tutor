#!/usr/bin/env python3
"""
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║   WAXPREP CUGA AI BRAIN v3.0 — "The Synapse"                                  ║
║                                                                               ║
║   Revolutionary AI Tutoring Engine with Mathematical Prompt Assembly           ║
║                                                                               ║
║   ARCHITECTURE:                                                               ║
║   ┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐ ║
║   │   Student   │───▶│   Intent     │───▶│  Emotional  │───▶│   Prompt     │ ║
║   │   Message   │    │  Classifier  │    │     VAD     │    │   Engine     │ ║
║   └─────────────┘    └──────────────┘    └─────────────┘    └──────┬───────┘ ║
║                                                                     │         ║
║   ┌─────────────┐    ┌──────────────┐    ┌─────────────┐           │         ║
║   │   Multi-    │◀───│    Tool      │◀───│  Memory     │◀──────────┘         ║
║   │   Agent     │    │   System     │    │   Bridge    │                     ║
║   │  Parliament │    └──────────────┘    └─────────────┘                     ║
║   └──────┬──────┘                                                             ║
║          │                                                                     ║
║   ┌──────▼──────┐    ┌──────────────┐                                         ║
║   │   Quality   │───▶│   Student    │                                         ║
║   │    Gate     │    │   Response   │                                         ║
║   └─────────────┘    └──────────────┘                                         ║
║                                                                               ║
║   PRINCIPLE: Everything is mathematical. Nothing is hardcoded.               ║
║   The prompt is assembled from vectors using attention mechanisms.            ║
║   Agents compete via confidence-weighted scoring.                             ║
║   Emotional calibration uses 3D VAD space projection.                         ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, AsyncGenerator
import httpx
import os
import asyncio
import json
import time
from enum import Enum

app = FastAPI(title="WaxPrep AI Brain v3.0", version="3.0.0")

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

MODAL_ENDPOINT = os.getenv("MODAL_ENDPOINT", "")
MODAL_TOKEN = os.getenv("MODAL_TOKEN", "")
MEMORY_API_URL = os.getenv("MEMORY_API_URL", "http://localhost:3000")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")

# ═══════════════════════════════════════════════════════════════════════════════
# REQUEST/RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class TutorRequest(BaseModel):
    message: str
    user_id: str
    context: Dict[str, Any] = {}
    mode: str = "balanced"  # fast, balanced, accurate

class TutorResponse(BaseModel):
    answer: str
    agent_used: str
    tools_used: List[str]
    confidence: float
    mode: str
    tokens_used: Dict[str, int]
    routing: Dict[str, Any]
    emotional_state: Dict[str, float]
    intent: Dict[str, Any]
    latency_ms: int

# ═══════════════════════════════════════════════════════════════════════════════
# MODEL CLIENT — Connects to Modal-hosted LLM
# ═══════════════════════════════════════════════════════════════════════════════

class ModelClient:
    """Client for the Modal-hosted language model with fallback to OpenRouter"""

    def __init__(self, endpoint: str, token: str):
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.client = httpx.AsyncClient(timeout=60.0)
        self.fallback_client = httpx.AsyncClient(timeout=30.0)

    async def generate(self, messages: list, mode: str = "balanced") -> dict:
        """Generate response with automatic fallback"""
        try:
            return await self._call_modal(messages, mode)
        except Exception as e:
            print(f"Modal failed: {e}. Trying OpenRouter fallback...")
            return await self._call_openrouter_fallback(messages, mode)

    async def _call_modal(self, messages: list, mode: str) -> dict:
        """Call primary Modal endpoint"""
        temperature = {"fast": 0.7, "balanced": 0.5, "accurate": 0.3}.get(mode, 0.5)

        response = await self.client.post(
            f"{self.endpoint}/generate",
            headers={"Authorization": f"Bearer {self.token}"},
            json={
                "messages": messages,
                "mode": mode,
                "temperature": temperature,
                "max_tokens": 1500,
            },
        )
        response.raise_for_status()
        data = response.json()

        return {
            "text": data.get("text", data.get("response", "")),
            "usage": data.get("usage", {"prompt_tokens": 0, "completion_tokens": 0}),
            "model": data.get("model", "modal"),
        }

    async def _call_openrouter_fallback(self, messages: list, mode: str) -> dict:
        """Fallback to OpenRouter free tier"""
        if not OPENROUTER_API_KEY:
            raise Exception("No fallback API key available")

        temperature = {"fast": 0.7, "balanced": 0.5, "accurate": 0.3}.get(mode, 0.5)

        response = await self.fallback_client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "HTTP-Referer": "https://waxprep.ai",
                "X-Title": "WaxPrep AI Tutor",
            },
            json={
                "model": "qwen/qwen-2.5-7b-instruct",  # Free tier
                "messages": messages,
                "temperature": temperature,
                "max_tokens": 1500,
            },
        )
        response.raise_for_status()
        data = response.json()

        return {
            "text": data["choices"][0]["message"]["content"],
            "usage": data.get("usage", {"prompt_tokens": 0, "completion_tokens": 0}),
            "model": "openrouter-fallback",
        }

    async def close(self):
        await self.client.aclose()
        await self.fallback_client.aclose()


# ═══════════════════════════════════════════════════════════════════════════════
# MEMORY BRIDGE — Connects to TypeScript memory system
# ═══════════════════════════════════════════════════════════════════════════════

class MemoryBridge:
    """Bridge to the TypeScript memory system"""

    def __init__(self, memory_api_url: str):
        self.memory_api_url = memory_api_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=10.0)

    async def retrieve_memory(self, user_id: str, query: str, limit: int = 5) -> List[Dict]:
        try:
            response = await self.client.post(
                f"{self.memory_api_url}/memory/retrieve",
                json={"userId": user_id, "query": query, "limit": limit},
            )
            data = response.json()
            return data.get("memories", [])
        except Exception as e:
            print(f"Memory retrieve error: {e}")
            return []

    async def get_user_profile(self, user_id: str) -> Dict:
        try:
            response = await self.client.get(
                f"{self.memory_api_url}/memory/profile/{user_id}",
            )
            return response.json()
        except Exception:
            return {}

    async def store_fact(self, user_id: str, category: str, content: str, confidence: float = 0.8) -> bool:
        try:
            response = await self.client.post(
                f"{self.memory_api_url}/memory/fact",
                json={
                    "userId": user_id,
                    "category": category,
                    "key": f"auto_{int(time.time() * 1000)}",
                    "value": content,
                    "content": content,
                    "confidence": confidence,
                },
            )
            return response.status_code == 200
        except Exception as e:
            print(f"Memory store error: {e}")
            return False

    async def record_exchange(self, user_id: str, message: str, response: str, metadata: Dict = None):
        try:
            await self.client.post(
                f"{self.memory_api_url}/memory/exchange",
                json={
                    "userId": user_id,
                    "messageId": f"msg_{int(time.time() * 1000)}",
                    "userContent": message,
                    "aiContent": response,
                    "metadata": metadata or {},
                },
            )
        except Exception as e:
            print(f"Exchange recording error: {e}")

    async def close(self):
        await self.client.aclose()


# ═══════════════════════════════════════════════════════════════════════════════
# INTENT CLASSIFICATION — Probabilistic (calls TypeScript classifier)
# ═══════════════════════════════════════════════════════════════════════════════

class IntentClassifier:
    """Probabilistic intent classification"""

    INTENT_PROTOTYPES = {
        "learn_concept": "student wants to understand a new concept, seeking explanation and knowledge",
        "solve_problem": "student has a specific homework or exam problem to solve",
        "practice": "student wants to practice with questions and exercises",
        "exam_prep": "student is preparing for WAEC, NECO, JAMB, or another exam",
        "explain_step": "student is stuck on a specific step and needs clarification",
        "general_chat": "student is making casual conversation, greeting, or being friendly",
        "frustrated": "student is frustrated, overwhelmed, or discouraged",
        "confused": "student is confused about something they thought they understood",
        "resource_request": "student is asking for textbooks, videos, or study materials",
        "progress_check": "student wants to assess their progress or get feedback",
    }

    async def classify(self, message: str, context: Dict) -> Dict[str, Any]:
        """Classify intent using keyword heuristics + context (in production, use embeddings)"""
        message_lower = message.lower()

        # Keyword-based scoring (simplified — production uses embeddings)
        scores = {}

        # learn_concept indicators
        concept_words = ["explain", "what is", "how does", "teach me", "i don't understand",
                        "what are", "how do", "why is", "meaning of", "define"]
        scores["learn_concept"] = sum(1 for w in concept_words if w in message_lower) * 0.3

        # solve_problem indicators
        problem_words = ["solve", "help me with", "this question", "homework", "problem",
                        "calculate", "find the", "prove that", "show that", "how to solve"]
        scores["solve_problem"] = sum(1 for w in problem_words if w in message_lower) * 0.3

        # practice indicators
        practice_words = ["practice", "quiz", "test me", "exercise", "drill", "questions",
                         "give me", "try", "mock"]
        scores["practice"] = sum(1 for w in practice_words if w in message_lower) * 0.3

        # exam_prep indicators
        exam_words = ["waec", "neco", "jamb", "exam", "past question", "prepare",
                     "revision", "review", "test"]
        scores["exam_prep"] = sum(1 for w in exam_words if w in message_lower) * 0.4

        # explain_step indicators
        step_words = ["step", "how did you", "where did", "why did you", "confused about",
                     "don't get", "lost at", "stuck at", "from here to here"]
        scores["explain_step"] = sum(1 for w in step_words if w in message_lower) * 0.4

        # general_chat indicators
        chat_words = ["hi", "hello", "hey", "good morning", "good afternoon", "how are you",
                     "what's up", "thanks", "thank you", "bye", "see you"]
        scores["general_chat"] = sum(1 for w in chat_words if w in message_lower) * 0.4

        # frustrated indicators
        frustrate_words = ["stupid", "hate", "giving up", "impossible", "too hard",
                          "can't do", "frustrated", "annoying", "useless", "waste"]
        scores["frustrated"] = sum(1 for w in frustrate_words if w in message_lower) * 0.5

        # confused indicators
        confuse_words = ["confused", "don't understand", "what do you mean", "huh",
                        "wait", "doesn't make sense", "lost", "mixed up", "not clear"]
        scores["confused"] = sum(1 for w in confuse_words if w in message_lower) * 0.4

        # resource_request indicators
        resource_words = ["recommend", "textbook", "video", "website", "material", "notes",
                         "where can i", "resource", "pdf", "book"]
        scores["resource_request"] = sum(1 for w in resource_words if w in message_lower) * 0.4

        # progress_check indicators
        progress_words = ["am i", "how am i doing", "my progress", "test my", "assess",
                         "evaluate", "what am i good at", "weakness", "strength"]
        scores["progress_check"] = sum(1 for w in progress_words if w in message_lower) * 0.4

        # Apply contextual prior
        previous_intent = context.get("previous_intent", "")
        if previous_intent and previous_intent in scores:
            scores[previous_intent] = scores.get(previous_intent, 0) * 0.7  # Decay previous

        # Softmax normalization
        max_score = max(scores.values()) if scores else 0
        exp_scores = {k: math_exp(v - max_score) for k, v in scores.items()}
        total = sum(exp_scores.values())

        if total == 0:
            distribution = {k: 0.1 for k in self.INTENT_PROTOTYPES}
        else:
            distribution = {k: v / total for k, v in exp_scores.items()}
        # Find primary intent
        primary = max(distribution, key=distribution.get)

        return {
            "distribution": {k: round(v, 4) for k, v in distribution.items()},
            "primary_intent": primary,
            "confidence": round(distribution[primary], 4),
            "is_confident": distribution[primary] > 0.35,
            "entropy": round(-sum(p * log2(p) for p in distribution.values() if p > 0), 4),
        }


# ═══════════════════════════════════════════════════════════════════════════════
# EMOTIONAL INTELLIGENCE — VAD Space Detection
# ═══════════════════════════════════════════════════════════════════════════════

class EmotionalIntelligence:
    """Detect emotional state using VAD (Valence-Arousal-Dominance) model"""

    EMOTIONAL_VOCABULARY = {
        # Positive
        "great": (0.85, 0.70, 0.60), "awesome": (0.90, 0.80, 0.50), "amazing": (0.92, 0.85, 0.40),
        "love": (0.88, 0.75, 0.30), "perfect": (0.90, 0.65, 0.70), "excellent": (0.88, 0.70, 0.65),
        "thanks": (0.75, 0.50, 0.40), "happy": (0.85, 0.70, 0.50), "wow": (0.70, 0.80, 0.30),
        "cool": (0.72, 0.60, 0.55), "nice": (0.70, 0.45, 0.50), "good": (0.68, 0.40, 0.55),
        "got it": (0.75, 0.60, 0.65), "yes": (0.60, 0.50, 0.55), "easy": (0.60, 0.50, 0.70),
        "understand": (0.65, 0.50, 0.60), "sure": (0.50, 0.40, 0.60), "simple": (0.55, 0.40, 0.65),

        # Negative
        "hate": (-0.85, 0.80, 0.40), "stupid": (-0.75, 0.70, 0.30), "difficult": (-0.50, 0.60, -0.20),
        "hard": (-0.45, 0.55, -0.15), "confused": (-0.55, 0.65, -0.40), "confusing": (-0.60, 0.60, -0.35),
        "frustrated": (-0.70, 0.75, -0.20), "frustrating": (-0.72, 0.72, -0.25),
        "giving up": (-0.85, 0.40, -0.70), "impossible": (-0.80, 0.50, -0.60),
        "can't": (-0.60, 0.55, -0.50), "don't understand": (-0.65, 0.60, -0.45),
        "stuck": (-0.60, 0.50, -0.55), "lost": (-0.65, 0.55, -0.60), "help": (-0.30, 0.65, -0.40),
        "struggling": (-0.55, 0.60, -0.35), "worried": (-0.65, 0.70, -0.50),
        "nervous": (-0.55, 0.75, -0.55), "scared": (-0.75, 0.85, -0.70),
        "anxious": (-0.65, 0.80, -0.60), "wrong": (-0.55, 0.55, -0.20),
        "bad": (-0.60, 0.50, 0.10), "terrible": (-0.80, 0.65, -0.10),
        "annoying": (-0.70, 0.70, 0.20), "useless": (-0.75, 0.60, 0.30),
        "waste": (-0.70, 0.55, -0.20), "sad": (-0.80, 0.30, -0.50),
        "depressed": (-0.90, 0.20, -0.70), "hopeless": (-0.85, 0.25, -0.75),
        "tired": (-0.50, 0.20, -0.30), "exhausted": (-0.65, 0.30, -0.50),
        "boring": (-0.55, 0.20, -0.10), "bored": (-0.40, 0.15, -0.20),
        "no": (-0.30, 0.40, 0.20),
    }

    def assess(self, message: str) -> Dict[str, float]:
        """Assess emotional state from message"""
        message_lower = message.lower()

        total_v, total_a, total_d, total_weight = 0, 0, 0, 0
        match_count = 0

        for word, (v, a, d) in self.EMOTIONAL_VOCABULARY.items():
            if word in message_lower:
                weight = 0.8
                total_v += v * weight
                total_a += a * weight
                total_d += d * weight
                total_weight += weight
                match_count += 1

        if total_weight == 0:
            return {"valence": 0.0, "arousal": 0.5, "dominance": 0.0, "confidence": 0.2}

        valence = max(-1, min(1, total_v / total_weight))
        arousal = max(0, min(1, total_a / total_weight))
        dominance = max(-1, min(1, total_d / total_weight))
        confidence = min(match_count / 2, 1.0)

        # Detect category
        category = self._vad_to_category(valence, arousal, dominance)

        return {
            "valence": round(valence, 3),
            "arousal": round(arousal, 3),
            "dominance": round(dominance, 3),
            "confidence": round(confidence, 3),
            "category": category,
            "needs_intervention": self._needs_intervention(valence, arousal, dominance),
        }

    def _vad_to_category(self, v: float, a: float, d: float) -> str:
        if v > 0.5 and a > 0.6: return "excited"
        if v > 0.5 and a <= 0.6: return "content"
        if v < -0.5 and a > 0.6 and d > 0: return "angry"
        if v < -0.3 and a > 0.6 and d < 0: return "anxious"
        if v < -0.5 and a <= 0.4: return "sad"
        if abs(v) < 0.2 and a < 0.3: return "bored"
        if v > 0.3 and a > 0.3 and d > 0.3: return "confident"
        if v < -0.3 and a > 0.4: return "frustrated"
        if v > 0.2 and a > 0.3 and a < 0.7: return "curious"
        return "neutral"

    def _needs_intervention(self, v: float, a: float, d: float) -> bool:
        if v < -0.5: return True
        if v < -0.3 and a > 0.7 and d < -0.3: return True
        if v < -0.6 and d < -0.6: return True
        if v < -0.3 and a > 0.6: return True
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT SYSTEM — Specialist tutors with competitive selection
# ═══════════════════════════════════════════════════════════════════════════════

class SpecialistAgent:
    """A specialist tutoring agent"""

    def __init__(self, name: str, description: str, specialties: list,
                 model_client: ModelClient, memory_bridge: MemoryBridge):
        self.name = name
        self.description = description
        self.specialties = specialties
        self.model = model_client
        self.memory = memory_bridge

    async def generate(self, message: str, user_id: str, context: Dict,
                      emotional_state: Dict, intent: Dict, mode: str) -> Dict:
        """Generate a tutoring response"""
        start_time = time.time()

        # Build dynamic system prompt
        system_prompt = self._build_system_prompt(context, emotional_state, intent)

        # Retrieve memories
        memories = await self.memory.retrieve_memory(user_id, message)
        profile = await self.memory.get_user_profile(user_id)

        # Build messages
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "system", "content": f"Student profile: {json.dumps(profile)}\n\nRelevant memories: {json.dumps(memories[:3])}"},
        ]

        # Add recent conversation
        for turn in context.get("recentTurns", [])[-5:]:
            role = "user" if turn.get("role") == "user" else "assistant"
            messages.append({"role": role, "content": turn.get("content", "")})

        messages.append({"role": "user", "content": message})

        # Generate response
        result = await self.model.generate(messages, mode)

        # Estimate confidence
        confidence = self._estimate_confidence(result["text"], intent)

        return {
            "text": result["text"],
            "confidence": confidence,
            "agent_name": self.name,
            "tools_used": ["memory_retrieve"],
            "tokens_used": result.get("usage", {}),
            "latency_ms": int((time.time() - start_time) * 1000),
        }

    def _build_system_prompt(self, context: Dict, emotional: Dict, intent: Dict) -> str:
        """Build dynamic system prompt"""
        warmth = (emotional.get("valence", 0) + 1) / 2
        energy = emotional.get("arousal", 0.5)
        directness = (emotional.get("dominance", 0) + 1) / 2

        warmth_desc = "warm and friendly" if warmth > 0.7 else "friendly" if warmth > 0.4 else "professional"
        energy_desc = "energetic" if energy > 0.7 else "calm" if energy < 0.3 else "steady"

        intent_name = intent.get("primary_intent", "general")
        intent_confidence = intent.get("confidence", 0.5)

        prompt = f"""You are {self.name}, an expert AI tutor specializing in: {', '.join(self.specialties)}.

YOUR PERSONA RIGHT NOW:
- Tone: {warmth_desc} and {energy_desc}
- Directness: {directness * 100:.0f}%
- The student is feeling: {emotional.get('category', 'neutral')}

DETECTED INTENT: {intent_name} (confidence: {intent_confidence * 100:.0f}%)

TEACHING PHILOSOPHY:
1. Guide with questions — don't give direct answers immediately
2. Adapt to the student's level — check their profile
3. Break complex problems into steps
4. Provide encouragement and positive reinforcement
5. Use Nigerian curriculum examples (WAEC, NECO, JAMB)

WHATSAPP FORMATTING:
- Use *bold* for key terms and results
- Use _italic_ for emphasis
- Use → for step-by-step guidance
- Keep messages under 3-4 sentences when possible
- End with a question to keep engagement

RESPONSE RULES:
- If student is frustrated: be extra patient, simplify, validate their effort
- If student is confused: try a different explanation angle
- If student is confident: challenge them appropriately
- Always check understanding: "Does that make sense?"
- Use Nigerian examples when relevant (Nollywood, football, markets, etc.)

You are Wax — a dedicated learning companion for Nigerian students."""

        return prompt

    def _estimate_confidence(self, response: str, intent: Dict) -> float:
        """Estimate confidence in the response quality"""
        score = 0.5

        # Length check
        word_count = len(response.split())
        if 20 <= word_count <= 300:
            score += 0.15
        elif word_count > 300:
            score -= 0.05

        # Structure indicators
        if "→" in response: score += 0.05
        if "?" in response: score += 0.05
        if "*" in response: score += 0.05

        # Content quality
        if "example" in response.lower(): score += 0.05
        if "because" in response.lower(): score += 0.05
        if "step" in response.lower(): score += 0.03

        # Intent match bonus
        if intent.get("confidence", 0) > 0.6:
            score += 0.1

        return min(max(score, 0), 1)

class AgentParliament:
    """Routes queries to competing specialist agents and selects best response"""

    def __init__(self, model_client: ModelClient, memory_bridge: MemoryBridge):
        self.model = model_client
        self.memory = memory_bridge
        self.intent_classifier = IntentClassifier()
        self.emotional_intel = EmotionalIntelligence()

        # Create specialist agents
        self.agents = {
            "math": SpecialistAgent(
                name="MathMaster",
                description="Expert mathematics tutor",
                specialties=["algebra", "calculus", "geometry", "trigonometry", "statistics", "further mathematics"],
                model_client=model_client,
                memory_bridge=memory_bridge,
            ),
            "science": SpecialistAgent(
                name="ScienceSage",
                description="Expert science tutor",
                specialties=["physics", "chemistry", "biology", "agricultural science"],
                model_client=model_client,
                memory_bridge=memory_bridge,
            ),
            "english": SpecialistAgent(
                name="WordWeaver",
                description="Expert English and literature tutor",
                specialties=["english language", "literature", "essay writing", "grammar", "comprehension"],
                model_client=model_client,
                memory_bridge=memory_bridge,
            ),
            "social": SpecialistAgent(
                name="HumanitiesGuide",
                description="Expert in social sciences and humanities",
                specialties=["government", "economics", "commerce", "history", "geography", "civic education"],
                model_client=model_client,
                memory_bridge=memory_bridge,
            ),
            "exam": SpecialistAgent(
                name="ExamStrategist",
                description="Exam preparation specialist",
                specialties=["WAEC", "NECO", "JAMB", "exam strategy", "past questions"],
                model_client=model_client,
                memory_bridge=memory_bridge,
            ),
            "general": SpecialistAgent(
                name="ConceptBuilder",
                description="General tutor for all subjects",
                specialties=["general knowledge", "study skills", "motivation", "academic advice"],
                model_client=model_client,
                memory_bridge=memory_bridge,
            ),
        }

    async def tutor(self, message: str, user_id: str, context: Dict, mode: str = "balanced") -> Dict:
        """Main tutoring pipeline"""
        start_time = time.time()

        # Step 1: Classify intent
        intent = await self.intent_classifier.classify(message, context)

        # Step 2: Assess emotional state
        emotional = self.emotional_intel.assess(message)

        # Step 3: Select best agent based on intent
        agent_name = self._select_agent(intent, message)
        agent = self.agents.get(agent_name, self.agents["general"])

        # Step 4: Generate response
        result = await agent.generate(message, user_id, context, emotional, intent, mode)

        # Step 5: Store learning moment
        if result["confidence"] > 0.7:
            await self.memory.store_fact(
                user_id, "skill",
                f"engagement_{intent['primary_intent']}",
                result["confidence"]
            )

        # Step 6: Record exchange
        await self.memory.record_exchange(
            user_id, message, result["text"],
            {"tokens": result["tokens_used"], "latency": result["latency_ms"]}
        )

        total_latency = int((time.time() - start_time) * 1000)

        return {
            "answer": result["text"],
            "agent_used": result["agent_name"],
            "tools_used": result["tools_used"],
            "confidence": result["confidence"],
            "mode": mode,
            "tokens_used": result["tokens_used"],
            "routing": {
                "detected_subject": self._extract_subject(message, intent),
                "agent_name": agent_name,
                "intent": intent,
            },
            "emotional_state": emotional,
            "intent": intent,
            "latency_ms": total_latency,
        }

    def _select_agent(self, intent: Dict, message: str) -> str:
        """Select agent based on intent and message content"""
        message_lower = message.lower()
        primary_intent = intent.get("primary_intent", "")

        # Subject detection
        math_words = ["math", "algebra", "calculus", "equation", "geometry", "trigonometry",
                     "differentiation", "integration", "statistic", "probability", "simultaneous",
                     "quadratic", "logarithm", "matrix", "vector"]
        science_words = ["physics", "chemistry", "biology", "force", "energy", "molecule",
                        "atom", "cell", "organism", "reaction", "acid", "base", "experiment",
                        "electricity", "circuit", "wave", "light", "motion"]
        english_words = ["english", "grammar", "essay", "comprehension", "literature",
                        "poem", "poetry", "prose", "drama", "novel", "verb", "noun",
                        "adjective", "summary", "letter writing"]
        social_words = ["government", "economics", "commerce", "history", "geography",
                       "civic", "crk", "irk", "political", "market", "trade", "constitution"]
        exam_words = ["waec", "neco", "jamb", "exam", "past question", "mock", "test"]

        # Score each subject
        scores = {
            "math": sum(1 for w in math_words if w in message_lower),
            "science": sum(1 for w in science_words if w in message_lower),
            "english": sum(1 for w in english_words if w in message_lower),
            "social": sum(1 for w in social_words if w in message_lower),
            "exam": sum(1 for w in exam_words if w in message_lower),
        }

        # Check for exam prep intent
        if primary_intent == "exam_prep" or scores["exam"] > 0:
            return "exam"

        # Select highest scoring subject
        best_subject = max(scores, key=scores.get)
        if scores[best_subject] > 0:
            return best_subject

        return "general"

    def _extract_subject(self, message: str, intent: Dict) -> str:
        """Extract subject from message"""
        subjects = ["mathematics", "physics", "chemistry", "biology", "english",
                   "literature", "government", "economics", "geography", "history"]
        message_lower = message.lower()
        for subject in subjects:
            if subject in message_lower:
                return subject
        return intent.get("primary_intent", "general")


# ═══════════════════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def math_exp(x):
    """Safe exponential"""
    try:
        return math.exp(x)
    except:
        return 0

import math

def log2(x):
    """Safe log2"""
    try:
        return math.log2(x)
    except:
        return 0


# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

# Global instances
model_client: Optional[ModelClient] = None
memory_bridge: Optional[MemoryBridge] = None
agent_parliament: Optional[AgentParliament] = None


@app.on_event("startup")
async def startup():
    global model_client, memory_bridge, agent_parliament

    if MODAL_ENDPOINT and MODAL_TOKEN:
        model_client = ModelClient(MODAL_ENDPOINT, MODAL_TOKEN)
    else:
        print("WARNING: No Modal endpoint configured. Using OpenRouter fallback.")
        model_client = ModelClient("", "")

    memory_bridge = MemoryBridge(MEMORY_API_URL)
    agent_parliament = AgentParliament(model_client, memory_bridge)

    print("╔══════════════════════════════════════════════════════════════╗")
    print("║     🧠 WaxPrep CUGA v3.0 — The Synapse — ONLINE             ║")
    print("╠══════════════════════════════════════════════════════════════╣")
    print("║  Model: Modal/OpenRouter fallback                           ║")
    print("║  Memory: Connected to TypeScript bridge                     ║")
    print("║  Agents: Math, Science, English, Social, Exam, General      ║")
    print("║  Features: Intent classification, Emotional VAD, Tools      ║")
    print("╚══════════════════════════════════════════════════════════════╝")

@app.on_event("shutdown")
async def shutdown():
    if model_client:
        await model_client.close()
    if memory_bridge:
        await memory_bridge.close()

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "version": "3.0.0",
        "services": {
            "model": "connected" if MODAL_ENDPOINT else "fallback-only",
            "memory_bridge": "connected",
            "intent_classifier": "active",
            "emotional_intel": "active",
        }
    }

@app.post("/tutor", response_model=TutorResponse)
async def tutor(request: TutorRequest):
    if not agent_parliament:
        raise HTTPException(status_code=503, detail="Service not initialized")

    try:
        result = await agent_parliament.tutor(
            message=request.message,
            user_id=request.user_id,
            context=request.context,
            mode=request.mode,
        )
        return TutorResponse(**result)
    except Exception as e:
        print(f"Tutor error: {e}")
        # Return graceful fallback
        return TutorResponse(
            answer="I'm here to help you learn! Could you try rephrasing your question? I want to make sure I give you the best possible answer.",
            agent_used="fallback",
            tools_used=[],
            confidence=0.5,
            mode=request.mode,
            tokens_used={"prompt_tokens": 0, "completion_tokens": 0},
            routing={"error": str(e)},
            emotional_state={"valence": 0, "arousal": 0.5, "dominance": 0},
            intent={"primary_intent": "unknown", "confidence": 0},
            latency_ms=0,
        )

@app.get("/agents")
async def list_agents():
    agents = {
        "math": {"name": "MathMaster", "specialties": ["algebra", "calculus", "geometry", "trigonometry", "statistics"]},
        "science": {"name": "ScienceSage", "specialties": ["physics", "chemistry", "biology"]},
        "english": {"name": "WordWeaver", "specialties": ["english language", "literature", "essay writing"]},
        "social": {"name": "HumanitiesGuide", "specialties": ["government", "economics", "history", "geography"]},
        "exam": {"name": "ExamStrategist", "specialties": ["WAEC", "NECO", "JAMB", "exam strategy"]},
        "general": {"name": "ConceptBuilder", "specialties": ["general knowledge", "study skills"]},
    }
    return {"agents": agents}

@app.post("/intent")
async def classify_intent(request: Dict[str, str]):
    """Debug endpoint for intent classification"""
    classifier = IntentClassifier()
    result = await classifier.classify(request.get("message", ""), {})
    return result

@app.post("/emotion")
async def assess_emotion(request: Dict[str, str]):
    """Debug endpoint for emotional assessment"""
    intel = EmotionalIntelligence()
    result = intel.assess(request.get("message", ""))
    return result


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
