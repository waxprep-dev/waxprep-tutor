import asyncio
import time
import httpx
from typing import Dict, Any, Optional
from loguru import logger
import os

from waxprep.app.brain.memory import memory
from waxprep.app.brain.prompt import build_prompt, build_tool_result_prompt
from waxprep.app.brain.tools import parse_tools, needs_second_pass
from waxprep.app.brain.tool_executor import execute_all

FALLBACK_RESPONSES = [
    "I'm having a quick technical moment — send that again and I'll get it.",
    "Something on my end — try that one more time.",
    "Quick technical issue — resend and we continue.",
]

_fallback_index = 0

class WaxPrepBrain:
    def __init__(self):
        self.model_url = os.environ.get("WAXPREP_MODEL_URL", "https://wazawax-waxprepmodel.hf.space/generate")
        self.health_url = os.environ.get("WAXPREP_MODEL_HEALTH_URL", "https://wazawax-waxprepmodel.hf.space/health")
        self.timeout = float(os.environ.get("WAXPREP_MODEL_TIMEOUT", "300"))
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0

    def _circuit_open(self) -> bool:
        if self._consecutive_failures >= 5 and time.time() < self._circuit_open_until:
            return True
        if time.time() >= self._circuit_open_until:
            self._consecutive_failures = 0
        return False

    def _on_failure(self):
        self._consecutive_failures += 1
        if self._consecutive_failures >= 5:
            self._circuit_open_until = time.time() + 120
            logger.warning("Brain circuit breaker open — 2 minute cooldown")

    def _on_success(self):
        self._consecutive_failures = 0

    async def _call_model(self, prompt: str) -> Optional[str]:
        if self._circuit_open():
            return None
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.post(
                    self.model_url,
                    json={"question": prompt},
                    headers={"Content-Type": "application/json"},
                )
                if r.status_code == 200:
                    data = r.json()
                    answer = data.get("answer", "").strip()
                    if answer:
                        self._on_success()
                        return answer
                    return None
                elif r.status_code in (502, 503, 504):
                    self._on_failure()
                    return None
                else:
                    logger.error(f"Model returned {r.status_code}: {r.text[:200]}")
                    self._on_failure()
                    return None
        except httpx.TimeoutException:
            logger.warning(f"Model timed out after {self.timeout}s")
            self._on_failure()
            return None
        except Exception as e:
            logger.error(f"Model call failed: {e}")
            self._on_failure()
            return None

    async def think(self, student_id: str, student_message: str) -> str:
        global _fallback_index
        start = time.time()

        memory_layers = await memory.load_all(student_id)
        prompt = build_prompt(memory_layers, student_message)

        raw_response = await self._call_model(prompt)
        if not raw_response:
            resp = FALLBACK_RESPONSES[_fallback_index % len(FALLBACK_RESPONSES)]
            _fallback_index += 1
            return resp

        clean_response, tool_calls = parse_tools(raw_response)

        tool_results = {}
        if tool_calls:
            tool_results = await execute_all(student_id, tool_calls)

        if needs_second_pass(tool_calls) and tool_results:
            followup_prompt = build_tool_result_prompt(prompt, tool_results)
            second_response = await self._call_model(followup_prompt)
            if second_response:
                clean_response, remaining_tools = parse_tools(second_response)
                if remaining_tools:
                    await execute_all(student_id, remaining_tools)

        if not clean_response:
            clean_response = FALLBACK_RESPONSES[_fallback_index % len(FALLBACK_RESPONSES)]
            _fallback_index += 1

        elapsed = int((time.time() - start) * 1000)
        logger.info(f"Brain: {student_id[:8]} | {elapsed}ms | {len(tool_calls)} tools")

        asyncio.create_task(
            self._background_memory_update(
                student_id=student_id,
                student_message=student_message,
                ai_response=clean_response,
                memory_layers=memory_layers,
            )
        )

        return clean_response

    async def _background_memory_update(
        self,
        student_id: str,
        student_message: str,
        ai_response: str,
        memory_layers: Dict,
    ) -> None:
        try:
            await memory.update_session_cache(student_id, {"role": "user", "content": student_message})
            await memory.update_session_cache(student_id, {"role": "assistant", "content": ai_response})

            msg_lower = student_message.lower()
            engagement_words = ["i get it", "i understand now", "ohhh", "makes sense", "clear now", "so that means"]
            confusion_words = ["don't get it", "still confused", "not understanding", "explain again"]
            frustration_words = ["give up", "forget it", "too hard", "hopeless", "abeg forget", "leave it"]
            pidgin_words = ["abeg", "omo", "na", "wetin", "dey", "make i", "sha", "sef", "how far"]

            dna_updates = {}
            pidgin_score = sum(1 for w in pidgin_words if w in msg_lower)
            if pidgin_score >= 3:
                dna_updates["pidgin_preference"] = "heavy"
            elif pidgin_score >= 1:
                dna_updates["pidgin_preference"] = "adaptive"

            if any(w in msg_lower for w in frustration_words):
                db = memory.db
                profile = db.table("student_profiles").select("frustration_threshold").eq("student_id", student_id).execute()
                if profile.data:
                    current = profile.data[0].get("frustration_threshold", 3) or 3
                    dna_updates["frustration_threshold"] = max(1, int(current) - 1)

            if any(w in msg_lower for w in engagement_words):
                if len(ai_response) < 400:
                    dna_updates["response_length_pref"] = "short"

            if dna_updates:
                await memory.update_dna(student_id, dna_updates)

            from datetime import datetime, timezone
            import pytz
            now = datetime.now(timezone.utc).astimezone(pytz.timezone("Africa/Lagos"))
            db = memory.db
            db.table("student_profiles").update({"study_peak_hour": now.hour}).eq("student_id", student_id).execute()

        except Exception as e:
            logger.debug(f"Background memory update failed: {e}")

brain = WaxPrepBrain()
