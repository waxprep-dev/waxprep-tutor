"""
WaxPrep Brain Engine v3.0
"""

import asyncio
import time
from typing import Dict, Any, List, Optional
from loguru import logger


class WaxPrepBrain:
    def __init__(self):
        self._gemini = None
        self._groq = None
        self._consecutive_failures = 0
        self._init_done = False
        self.health_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash"
        self._init_clients()

    def _init_clients(self):
        if self._init_done:
            return
        import os

        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        if gemini_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=gemini_key)
                self._gemini = genai.GenerativeModel("gemini-2.5-flash")
                logger.info("Gemini 2.5 Flash ready")
            except Exception as e:
                logger.warning(f"Gemini init failed: {e}")

        groq_key = os.environ.get("GROQ_API_KEY", "")
        if groq_key:
            try:
                from groq import Groq
                self._groq = Groq(api_key=groq_key)
                logger.info("Groq Llama 70B ready as fallback")
            except Exception as e:
                logger.warning(f"Groq init failed: {e}")

        self._init_done = True

    async def think(self, student_id: str, student_message: str) -> str:
        start = time.time()

        from waxprep.app.brain.memory import memory
        from waxprep.app.brain.prompt import build_prompt
        from waxprep.app.brain.tools import parse_tools
        from waxprep.app.brain.tool_executor import execute_all
        from waxprep.app.brain.intent_detector import detect_intent
        from waxprep.app.brain.context_builder import build_focused_prompt, get_fallback_response
        from waxprep.app.brain.guardrail import check_response, get_stricter_instruction, safe_fallback

        # STEP 1: LOAD ALL 7 MEMORY LAYERS
        memory_layers = await memory.load_all(student_id)

        # STEP 2: DETECT INTENT
        intent = detect_intent(student_message, memory_layers)

        # STEP 3: UPDATE QUANTUM STATE
        await memory.update_quantum_state(student_id, {
            "emotional_arc_position": intent.get("emotional_state", "neutral"),
            "topic_switched": intent.get("topic_changed", False),
        })

        # STEP 4: BUILD FOCUSED PROMPT
        prompt = build_focused_prompt(intent, memory_layers, student_message)

        if intent.get("confidence", 0) < 0.4:
            prompt = build_prompt(memory_layers, student_message)

        # STEP 5: GENERATE RESPONSE
        response = None

        if self._gemini:
            response = await self._call_gemini(prompt)

        if not response and self._groq:
            response = await self._call_groq(prompt)

        if not response:
            return get_fallback_response(intent)

        # STEP 6: GUARDRAIL CHECK
        passed, reason = check_response(response, intent)

        if not passed:
            stricter = get_stricter_instruction(intent, reason)
            stricter_prompt = f"{stricter}\n\nStudent: {student_message}\n\nRespond:"

            if self._gemini:
                response = await self._call_gemini(stricter_prompt)
            if not response and self._groq:
                response = await self._call_groq(stricter_prompt)

            if response:
                passed, reason = check_response(response, intent)
                if not passed:
                    response = safe_fallback(intent)
            else:
                response = safe_fallback(intent)

        # STEP 7: PARSE AND EXECUTE TOOLS
        clean, tool_calls = parse_tools(response)

        if tool_calls:
            tool_results = await execute_all(student_id, tool_calls, memory_layers)
            from waxprep.app.brain.tools import needs_second_pass
            if needs_second_pass(tool_calls):
                from waxprep.app.brain.prompt import build_tool_result_prompt
                second_prompt = build_tool_result_prompt(prompt, tool_results)
                second_response = None
                if self._gemini:
                    second_response = await self._call_gemini(second_prompt)
                if not second_response and self._groq:
                    second_response = await self._call_groq(second_prompt)
                if second_response:
                    clean, _ = parse_tools(second_response)

        if not clean or not clean.strip():
            return get_fallback_response(intent)

        # STEP 8: ELABORATIVE INTERROGATION
        why_question = None
        primary_intent = intent.get("primary", "CHAT")
        secondary_intent = intent.get("secondary")

        if primary_intent in ["TEACH", "QUESTION"] and secondary_intent != "FRUSTRATED":
            if intent.get("socratic_pressure", 5.0) >= 4.0:
                try:
                    from waxprep.app.brain.elaborative_interrogation import (
                        detect_teaching_moment, generate_why_question, should_ask_why
                    )

                    concept = detect_teaching_moment(clean)
                    if concept:
                        wm = memory_layers.get("working_memory", {})
                        pm = memory_layers.get("procedural_memory", {})

                        if should_ask_why({
                            "messages": wm.get("messages", []),
                            "emotional_state": pm.get("last_emotional_state", "neutral"),
                            "socratic_pressure_score": pm.get("last_socratic_pressure", 5.0),
                            "student_name": intent.get("student_name", ""),
                        }):
                            subject = intent.get("subject", "")
                            why_question = generate_why_question(concept, subject)
                except Exception as e:
                    logger.debug(f"Elaborative interrogation: {e}")

        # STEP 9: UPDATE ALL MEMORY LAYERS (background)
        asyncio.create_task(
            self._update_memory_background(student_id, student_message, clean, intent, memory_layers)
        )

        # STEP 10: RETURN
        if why_question:
            combined = f"{clean}\n\n{why_question}"
            passed, reason = check_response(combined, intent)
            if passed:
                return combined

        elapsed = int((time.time() - start) * 1000)
        logger.info(f"Brain responded: {student_id[:8]} | {elapsed}ms | {len(clean)} chars")
        return clean

    async def _call_gemini(self, prompt: str) -> Optional[str]:
        try:
            def _sync_call():
                response = self._gemini.generate_content(
                    prompt,
                    generation_config={
                        "temperature": 0.65,
                        "max_output_tokens": 700,
                        "top_p": 0.92,
                    },
                )
                return response.text

            result = await asyncio.to_thread(_sync_call)
            if result and result.strip():
                self._consecutive_failures = 0
                return result.strip()
            return None
        except Exception as e:
            self._consecutive_failures += 1
            return None

    async def _call_groq(self, prompt: str) -> Optional[str]:
        try:
            def _sync_call():
                completion = self._groq.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.65,
                    max_tokens=700,
                )
                return completion.choices[0].message.content

            result = await asyncio.to_thread(_sync_call)
            if result and result.strip():
                self._consecutive_failures = 0
                return result.strip()
            return None
        except Exception as e:
            self._consecutive_failures += 1
            return None

    async def _call_model(self, prompt: str) -> Optional[str]:
        result = await self._call_gemini(prompt)
        if not result:
            result = await self._call_groq(prompt)
        return result

    async def _update_memory_background(
        self, student_id, message, response, intent, memory_layers
    ) -> None:
        try:
            from waxprep.app.brain.memory import memory
            from datetime import datetime, timezone

            await memory.update_working_memory(student_id, {"role": "user", "content": message})
            await memory.update_working_memory(student_id, {"role": "assistant", "content": response})

            from waxprep.app.brain.elaborative_interrogation import detect_teaching_moment
            concept = detect_teaching_moment(response)
            await memory.update_quantum_state(student_id, {
                "current_concept": concept or "",
                "last_teaching_method": self._detect_teaching_method(response),
                "turns_in_current_topic": memory_layers.get("quantum_state", {}).get("turns_in_current_topic", 0) + 1,
            })

            db_updates = {}
            msg_lower = message.lower()

            pidgin_words = ["abeg", "omo", "na ", "wetin", "dey ", "make i", "sha ", "sef ", "how far"]
            pidgin_score = sum(1 for w in pidgin_words if w in msg_lower)
            if pidgin_score >= 3:
                db_updates["pidgin_preference"] = "heavy"
            elif pidgin_score >= 1:
                db_updates["pidgin_preference"] = "adaptive"

            frustration_words = ["give up", "forget it", "too hard", "hopeless", "abeg forget", "i don't understand"]
            if any(w in msg_lower for w in frustration_words):
                db_updates["emotional_state_current"] = "frustrated"
            else:
                positive_words = ["yes", "got it", "understand", "sharp", "correct", "thanks", "i see"]
                if any(w in msg_lower for w in positive_words):
                    db_updates["emotional_state_current"] = "neutral"

            import pytz
            now = datetime.now(timezone.utc).astimezone(pytz.timezone("Africa/Lagos"))
            db_updates["study_peak_hour"] = now.hour

            if db_updates:
                await memory.update_dna(student_id, db_updates)

            try:
                from waxprep.app.brain.socratic_pressure import analyze_interaction, calculate_pressure
                signals = analyze_interaction(message, response)
                pm = memory_layers.get("procedural_memory", {})
                current_score = pm.get("last_socratic_pressure", 5.0)
                new_score, reason = calculate_pressure(current_score, signals)
                if abs(new_score - current_score) >= 0.5:
                    await memory.update_dna(student_id, {
                        "socratic_pressure_score": new_score,
                        "preferred_teaching_style": "socratic" if new_score > 6 else "direct" if new_score < 3 else "mixed",
                    })
            except Exception as e:
                logger.debug(f"Socratic update: {e}")

            if "breakthrough" in response.lower() or "finally" in message.lower():
                await memory.save_episodic_memory(
                    student_id=student_id,
                    memory_type="breakthrough",
                    description=f"Student showed understanding: {message[:150]}",
                    emotion="excited",
                    emotion_intensity=0.8,
                    what_came_after=response[:200],
                    student_reaction=message[:200],
                )

        except Exception as e:
            logger.debug(f"Background memory update: {e}")

    def _detect_teaching_method(self, response: str) -> str:
        r = response.lower()
        if "imagine" in r or "think of" in r or "like when" in r:
            return "analogy"
        elif "?" in r:
            return "socratic"
        elif "example" in r or "for instance" in r:
            return "example"
        elif "because" in r or "this is why" in r:
            return "explanation"
        return "direct"


# Global instance
brain = WaxPrepBrain()
