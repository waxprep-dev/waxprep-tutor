#!/usr/bin/env python3
"""
WaxPrep AI Brain — CUGA FastAPI Service
Wraps CUGA agent harness and connects to YOUR memory system + Modal model
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, AsyncGenerator
import httpx
import os
import asyncio
import json

app = FastAPI(title="WaxPrep AI Brain", version="2.0.0")

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════

MODAL_ENDPOINT = os.getenv("MODAL_ENDPOINT", "")
MODAL_TOKEN = os.getenv("MODAL_TOKEN", "")
MEMORY_API_URL = os.getenv("MEMORY_API_URL", "http://localhost:3000")

# ═══════════════════════════════════════════════════════════════
# CUSTOM MODEL CLIENT (connects to YOUR Modal endpoint)
# ═══════════════════════════════════════════════════════════════

class ModalModelClient:
    """Client for YOUR Modal-hosted Qwen model"""

    def __init__(self, endpoint: str, token: str):
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.client = httpx.AsyncClient(timeout=60.0)

    async def generate(self, messages: list, mode: str = "balanced") -> dict:
        """Call YOUR Modal model endpoint"""
        response = await self.client.post(
            f"{self.endpoint}/generate",
            headers={"Authorization": f"Bearer {self.token}"},
            json={"messages": messages, "mode": mode},
        )
        response.raise_for_status()
        return response.json()

    async def close(self):
        await self.client.aclose()


# ═══════════════════════════════════════════════════════════════
# MEMORY TOOLS — Bridge to YOUR TypeScript memory system
# ═══════════════════════════════════════════════════════════════

class MemoryTools:
    """Tools that bridge CUGA to YOUR TypeScript memory system"""

    def __init__(self, memory_api_url: str):
        self.memory_api_url = memory_api_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=10.0)

    async def retrieve_user_memory(self, user_id: str, query: str) -> str:
        """Retrieve relevant memories for a user"""
        try:
            response = await self.client.post(
                f"{self.memory_api_url}/memory/retrieve",
                json={"userId": user_id, "query": query},
            )
            data = response.json()
            memories = data.get("memories", [])
            return "\n".join([f"- {m['content']}" for m in memories[:5]])
        except Exception as e:
            return f"[Memory unavailable: {e}]"

    async def store_learning_moment(self, user_id: str, topic: str,
                                    understanding_level: str) -> str:
        """Store a learning moment in long-term memory"""
        try:
            response = await self.client.post(
                f"{self.memory_api_url}/memory/fact",
                json={
                    "userId": user_id,
                    "category": "skill",
                    "key": f"understanding_{topic}",
                    "value": understanding_level,
                    "content": f"Student demonstrated {understanding_level} understanding of {topic}",
                },
            )
            return "Learning moment stored"
        except Exception as e:
            return f"[Storage failed: {e}]"

    async def get_user_profile(self, user_id: str) -> dict:
        """Retrieve user profile"""
        try:
            response = await self.client.get(
                f"{self.memory_api_url}/memory/profile/{user_id}",
            )
            return response.json()
        except Exception:
            return {}

    async def get_recent_progress(self, user_id: str, subject: str) -> str:
        """Get recent learning progress"""
        try:
            response = await self.client.post(
                f"{self.memory_api_url}/memory/search",
                json={
                    "userId": user_id,
                    "query": f"{subject} progress learning",
                    "limit": 5,
                },
            )
            data = response.json()
            return str(data.get("memories", []))
        except Exception:
            return "[]"

    async def store_concept_mastery(self, user_id: str, concept: str,
                                     level: float) -> str:
        """Store concept mastery level"""
        try:
            response = await self.client.post(
                f"{self.memory_api_url}/memory/fact",
                json={
                    "userId": user_id,
                    "category": "skill",
                    "key": f"mastery_{concept}",
                    "value": str(level),
                    "content": f"Mastery level of {concept}: {level:.0%}",
                    "confidence": level,
                },
            )
            return "Mastery stored"
        except Exception as e:
            return f"[Failed: {e}]"

    async def close(self):
        await self.client.aclose()


# ═══════════════════════════════════════════════════════════════
# TUTOR AGENT SYSTEM (Without CUGA dependency for immediate use)
# ═══════════════════════════════════════════════════════════════
# Note: When CUGA is installed, replace with CugaAgent/CugaSupervisor

class TutorAgent:
    """Tutoring agent that uses YOUR Modal model + memory tools"""

    def __init__(self, name: str, description: str, specialties: list,
                 model_client: ModalModelClient, memory_tools: MemoryTools):
        self.name = name
        self.description = description
        self.specialties = specialties
        self.model = model_client
        self.memory = memory_tools

    async def tutor(self, message: str, user_id: str, context: dict,
                    mode: str = "balanced") -> dict:
        """Process a tutoring request"""

        # Build system prompt from agent personality
        system_prompt = self._build_system_prompt(context)

        # Retrieve relevant memories
        memories = await self.memory.retrieve_user_memory(user_id, message)
        profile = await self.memory.get_user_profile(user_id)

        # Build messages for the model
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "system", "content": f"Student profile: {json.dumps(profile)}\n\nRelevant memories:\n{memories}"},
        ]

        # Add recent conversation history
        for turn in context.get("recentTurns", [])[-5:]:
            role = "user" if turn.get("role") == "user" else "assistant"
            messages.append({"role": role, "content": turn.get("content", "")})

        # Add current message
        messages.append({"role": "user", "content": message})

        # Call YOUR Modal model
        result = await self.model.generate(messages, mode)

        # Store learning moment
        await self.memory.store_learning_moment(
            user_id, self._extract_topic(message), "engaged"
        )

        return {
            "answer": result["text"],
            "agent_used": self.name,
            "tools_used": ["memory_retrieve", "memory_store"],
            "confidence": 0.9,
            "mode": mode,
            "tokens": result.get("usage", {}),
        }

    def _build_system_prompt(self, context: dict) -> str:
        """Build specialized system prompt for this agent"""
        return f"""You are {self.name}, an expert tutor specializing in: {', '.join(self.specialties)}.

Your teaching philosophy:
1. Use the Socratic method — guide with hints, don't give direct answers
2. Adapt to the student's level — check their profile for skill indicators
3. Break complex problems into steps
4. Provide encouragement and positive reinforcement
5. Use examples relevant to Nigerian curriculum (WAEC, NECO, JAMB)

Response format for WhatsApp:
- Keep under 3 sentences per message
- Use bullet points for lists
- Use → for step-by-step guidance
- End with a question to keep the student engaged

Current context: {json.dumps(context.get('activeTask', {}))}"""

    def _extract_topic(self, message: str) -> str:
        """Extract topic from message for memory storage"""
        # Simple keyword extraction
        words = message.lower().split()
        subjects = ["algebra", "calculus", "geometry", "physics", "chemistry",
                    "biology", "english", "literature", "history"]
        for subject in subjects:
            if subject in words:
                return subject
        return "general"


class TutorSupervisor:
    """Routes messages to the appropriate specialized tutor"""

    def __init__(self, model_client: ModalModelClient, memory_tools: MemoryTools):
        self.model = model_client
        self.memory = memory_tools

        # Create specialized agents
        self.agents = {
            "math": TutorAgent(
                name="MathMaster",
                description="Mathematics tutor",
                specialties=["algebra", "calculus", "geometry", "trigonometry", "statistics"],
                model_client=model_client,
                memory_tools=memory_tools,
            ),
            "science": TutorAgent(
                name="ScienceSage",
                description="Science tutor",
                specialties=["physics", "chemistry", "biology"],
                model_client=model_client,
                memory_tools=memory_tools,
            ),
            "language": TutorAgent(
                name="LanguageLens",
                description="Language tutor",
                specialties=["english", "grammar", "literature", "writing"],
                model_client=model_client,
                memory_tools=memory_tools,
            ),
            "exam": TutorAgent(
                name="ExamExpert",
                description="Exam preparation tutor",
                specialties=["WAEC", "NECO", "JAMB", "test strategies"],
                model_client=model_client,
                memory_tools=memory_tools,
            ),
        }

        # General tutor for fallback
        self.general_agent = TutorAgent(
            name="WaxPrep Tutor",
            description="General tutoring assistant",
            specialties=["general education", "study skills", "motivation"],
            model_client=model_client,
            memory_tools=memory_tools,
        )

    async def route(self, message: str, context: dict) -> str:
        """Determine which agent should handle this message"""
        lower = message.lower()

        # Direct keyword routing
        math_keywords = ["math", "algebra", "calculus", "equation", "solve",
                        "derivative", "integral", "geometry", "trigonometry",
                        "statistics", "probability", "x +", "x -", "=", "√"]
        science_keywords = ["physics", "chemistry", "biology", "force", "energy",
                           "atom", "molecule", "cell", "organism", "reaction",
                           "velocity", "acceleration", "gravity"]
        language_keywords = ["english", "grammar", "essay", "write", "literature",
                            "poem", "novel", "verb", "noun", "adjective", "spelling"]
        exam_keywords = ["exam", "waec", "neco", "jamb", "test", "past question",
                        "mock", "preparation", "study plan", "revision"]

        scores = {
            "math": sum(1 for k in math_keywords if k in lower),
            "science": sum(1 for k in science_keywords if k in lower),
            "language": sum(1 for k in language_keywords if k in lower),
            "exam": sum(1 for k in exam_keywords if k in lower),
        }

        # Return agent with highest score, or general if no match
        best = max(scores, key=scores.get)
        return best if scores[best] > 0 else "general"

    async def invoke(self, message: str, user_id: str, context: dict,
                     mode: str = "balanced") -> dict:
        """Route and process message through appropriate agent"""

        # Route to best agent
        agent_key = await self.route(message, context)
        agent = self.agents.get(agent_key, self.general_agent)

        # Process through agent
        result = await agent.tutor(message, user_id, context, mode)
        result["routing"] = {
            "detected_subject": agent_key,
            "agent_name": agent.name,
        }

        return result


# ═══════════════════════════════════════════════════════════════
# GLOBALS
# ═══════════════════════════════════════════════════════════════

model_client: Optional[ModalModelClient] = None
memory_tools: Optional[MemoryTools] = None
supervisor: Optional[TutorSupervisor] = None

@app.on_event("startup")
async def startup():
    global model_client, memory_tools, supervisor

    print("Starting WaxPrep AI Brain...")

    if not MODAL_ENDPOINT:
        print("WARNING: MODAL_ENDPOINT not set. Using mock mode.")

    model_client = ModalModelClient(MODAL_ENDPOINT, MODAL_TOKEN)
    memory_tools = MemoryTools(MEMORY_API_URL)
    supervisor = TutorSupervisor(model_client, memory_tools)

    print("AI Brain initialized successfully!")

@app.on_event("shutdown")
async def shutdown():
    if model_client:
        await model_client.close()
    if memory_tools:
        await memory_tools.close()

# ═══════════════════════════════════════════════════════════════
# REQUEST/RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════

class TutorRequest(BaseModel):
    message: str
    user_id: str
    context: Dict[str, Any] = {}
    mode: str = "balanced"

class TutorResponse(BaseModel):
    answer: str
    agent_used: str
    tools_used: List[str]
    confidence: float
    mode: str
    tokens_used: dict = {}
    routing: dict = {}

# ═══════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.post("/tutor", response_model=TutorResponse)
async def tutor_endpoint(request: TutorRequest):
    """Main tutoring endpoint — called by YOUR messageWorker"""

    if not supervisor:
        raise HTTPException(503, "AI Brain not initialized")

    try:
        result = await supervisor.invoke(
            message=request.message,
            user_id=request.user_id,
            context=request.context,
            mode=request.mode,
        )

        return TutorResponse(**result)

    except Exception as e:
        raise HTTPException(500, f"Tutoring error: {str(e)}")

@app.post("/tutor/stream")
async def tutor_stream(request: TutorRequest):
    """Streaming endpoint for real-time responses"""

    if not supervisor:
        raise HTTPException(503, "AI Brain not initialized")

    async def event_stream() -> AsyncGenerator[str, None]:
        # For now, non-streaming with chunked delivery
        result = await supervisor.invoke(
            message=request.message,
            user_id=request.user_id,
            context=request.context,
            mode=request.mode,
        )

        # Stream word by word for better UX
        words = result["answer"].split()
        for word in words:
            yield f"data: {word} "
            await asyncio.sleep(0.05)  # Small delay for natural feel

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
    )

@app.get("/health")
async def health():
    """Health check"""
    return {
        "status": "healthy",
        "version": "2.0.0",
        "services": {
            "modal": "configured" if MODAL_ENDPOINT else "not configured",
            "memory": MEMORY_API_URL,
            "supervisor": "initialized" if supervisor else "not initialized",
        }
    }

@app.get("/agents")
async def list_agents():
    """List available tutoring agents"""
    if not supervisor:
        raise HTTPException(503, "Not initialized")

    return {
        "agents": {
            key: {
                "name": agent.name,
                "description": agent.description,
                "specialties": agent.specialties,
            }
            for key, agent in supervisor.agents.items()
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
