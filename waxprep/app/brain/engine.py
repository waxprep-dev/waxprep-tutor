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
        self.health_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash"
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
                self._gemini = genai.GenerativeModel("gemini-1.5-flash")
                logger.info("Gemini 1.5 Flash ready")
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
        
        # === NEW: INTENT DETECTION (Step 0) ===
        from waxprep.app.brain.intent_detector import detect_intent
        from waxprep.app.brain.context_builder import build_focused_prompt, get_fallback_response
        from waxprep.app.brain.guardrail import check_response, get_stricter_instruction, safe_fallback

        # Load all memory layers (same as before)
        memory_layers = await memory.load_all(student_id)

        # Detect intent from message + full context
        intent = detect_intent(student_message, memory_layers)
        logger.info(f"Intent: {intent.get('primary')}" + (f"+{intent.get('secondary')}" if intent.get('secondary') else ""))

        # Build focused prompt using intent (NEW — replaces giant prompt)
        prompt = build_focused_prompt(intent, memory_layers, student_message)
        
        # Keep old prompt as fallback for complex cases
        # If intent confidence is low, use old system
        if intent.get("confidence", 0) < 0.5:
            logger.info("Intent confidence low, using legacy prompt")
            prompt = build_prompt(memory_layers, student_message)

        response = None

        if self._gemini:
            response = await self._call_gemini(prompt)

        if not response and self._groq:
            response = await self._call_groq(prompt)

        if not response:
            return get_fallback_response(intent)

        # === NEW: GUARDRAIL CHECK ===
        passed, reason = check_response(response, intent)
        
        if not passed:
            logger.warning(f"Guardrail failed: {reason}. Regenerating with stricter instruction...")
            
            # Regenerate with stricter instruction
            stricter = get_stricter_instruction(intent, reason)
            stricter_prompt = f"{stricter}\n\nStudent: {student_message}\n\nRespond:"
            
            if self._gemini:
                response = await self._call_gemini(stricter_prompt)
            
            if not response and self._groq:
                response = await self._call_groq(stricter_prompt)
            
            if response:
                passed, reason = check_response(response, intent)
                if not passed:
                    logger.error(f"Guardrail failed again: {reason}. Using safe fallback.")
                    response = safe_fallback(intent)
            else:
                response = safe_fallback(intent)

        clean, tool_calls = parse_tools(response)

        if tool_calls:
            await execute_all(student_id, tool_calls)

        if not clean or not clean.strip():
            return get_fallback_response(intent)

        elapsed = int((time.time() - start) * 1000)
        logger.info(f"Brain responded: {student_id[:8]} | {elapsed}ms")

        # === MODIFIED: Elaborative interrogation — SKIP if frustrated or confused ===
        why_question = None
        primary_intent = intent.get("primary", "CHAT")
        secondary_intent = intent.get("secondary")
        
        # Only ask why-questions if:
        # 1. Intent is TEACH or QUESTION
        # 2. NOT frustrated
        # 3. NOT confused
        # 4. Socratic pressure is moderate or high
        if primary_intent in ["TEACH", "QUESTION"] and secondary_intent != "FRUSTRATED":
            if intent.get("socratic_pressure", 5.0) >= 4.0:
                try:
                    from waxprep.app.brain.elaborative_interrogation import detect_teaching_moment, generate_why_question, should_ask_why
                    from waxprep.app.database.client import get_db

                    concept = detect_teaching_moment(clean)
                    if concept:
                        db = get_db()
                        conv = db.table("conversations").select("id, last_teaching_concept").eq("student_id", student_id).eq("is_active", True).order("started_at", desc=True).limit(1).execute()
                        if conv.data:
                            conv_id = conv.data[0]["id"]
                            db.table("conversations").update({"last_teaching_concept": concept}).eq("id", conv_id).execute()

                        if should_ask_why({
                            "messages": memory_layers.get("short_term", {}).get("messages", []),
                            "emotional_state": memory_layers.get("long_term", {}).get("emotional_state", "neutral"),
                            "socratic_pressure_score": memory_layers.get("long_term", {}).get("socratic_pressure_score", 5.0),
                        }):
                            subject = memory_layers.get("long_term", {}).get("current_subject", "")
                            why_question = generate_why_question(concept, subject)
                            logger.info(f"Why-question generated: {concept} -> {why_question[:50]}...")
                except Exception as e:
                    logger.debug(f"Elaborative interrogation check: {e}")

        asyncio.create_task(
            self._update_memory_background(student_id, student_message, clean)
        )

        if why_question:
            # Guardrail: check if adding why-question is safe
            combined = f"{clean}\n\n{why_question}"
            passed, reason = check_response(combined, intent)
            if passed:
                return combined
            else:
                logger.warning(f"Why-question blocked by guardrail: {reason}")
                return clean

        return clean

    async def _call_gemini(self, prompt: str) -> Optional[str]:
        try:
            def _sync_call():
                response = self._gemini.generate_content(
                    prompt,
                    generation_config={
                        "temperature": 0.7,
                        "max_output_tokens": 600,
                        "top_p": 0.9,
                    },
                )
                return response.text

            result = await asyncio.to_thread(_sync_call)
            if result and result.strip():
                return result.strip()
            return None
        except Exception as e:
            err = str(e).lower()
            if "rate" in err or "quota" in err:
                logger.warning(f"Gemini rate limit hit, trying fallback")
            else:
                logger.error(f"Gemini error: {e}")
            return None

    async def _call_groq(self, prompt: str) -> Optional[str]:
        try:
            import os

            def _sync_call():
                completion = self._groq.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.7,
                    max_tokens=600,
                )
                return completion.choices[0].message.content

            result = await asyncio.to_thread(_sync_call)
            if result and result.strip():
                return result.strip()
            return None
        except Exception as e:
            err = str(e).lower()
            if "rate" in err or "429" in err:
                logger.warning("Groq rate limit hit")
            else:
                logger.error(f"Groq error: {e}")
            return None

    async def _call_model(self, prompt: str) -> Optional[str]:
        result = await self._call_gemini(prompt)
        if not result:
            result = await self._call_groq(prompt)
        return result

    async def _update_memory_background(self, student_id: str, message: str, response: str) -> None:
        try:
            from waxprep.app.brain.memory import memory
            await memory.update_session_cache(student_id, {"role": "user", "content": message})
            await memory.update_session_cache(student_id, {"role": "assistant", "content": response})

            msg_lower = message.lower()
            pidgin_words = ["abeg", "omo", "na ", "wetin", "dey ", "make i", "sha ", "sef ", "how far"]
            pidgin_score = sum(1 for w in pidgin_words if w in msg_lower)

            db_updates = {}
            if pidgin_score >= 3:
                db_updates["pidgin_preference"] = "heavy"
            elif pidgin_score >= 1:
                db_updates["pidgin_preference"] = "adaptive"

            # EMOTIONAL STATE: Use intent detection result if available
            # This is more accurate than keyword matching
            frustration_words = ["give up", "forget it", "too hard", "hopeless", "abeg forget", "i don't understand"]
            if any(w in msg_lower for w in frustration_words):
                db_updates["emotional_state_current"] = "frustrated"
            else:
                positive_words = ["yes", "got it", "understand", "sharp", "correct", "thanks"]
                if any(w in msg_lower for w in positive_words):
                    db_updates["emotional_state_current"] = "neutral"

            import pytz
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).astimezone(pytz.timezone("Africa/Lagos"))
            db_updates["study_peak_hour"] = now.hour

            if db_updates:
                await memory.update_dna(student_id, db_updates)

            # SOCRATIC PRESSURE: Update based on intent (more accurate)
            try:
                from waxprep.app.brain.socratic_pressure import analyze_interaction, calculate_pressure
                from waxprep.app.database.client import get_db

                signals = analyze_interaction(message, response)
                db = get_db()
                profile = db.table("student_profiles").select("socratic_pressure_score").eq("student_id", student_id).execute()
                current_score = 5.0
                if profile.data and profile.data[0].get("socratic_pressure_score") is not None:
                    current_score = float(profile.data[0]["socratic_pressure_score"])

                new_score, reason = calculate_pressure(current_score, signals)

                if abs(new_score - current_score) >= 0.5:
                    db.table("student_profiles").update({"socratic_pressure_score": new_score}).eq("student_id", student_id).execute()
                    await memory.update_dna(student_id, {"socratic_pressure_score": new_score})
                    logger.info(f"Socratic pressure: {student_id[:8]} {current_score} -> {new_score} ({reason})")
            except Exception as e:
                logger.debug(f"Socratic pressure update: {e}")

            # EVALUATE WHY-QUESTION ANSWER
            try:
                from waxprep.app.brain.elaborative_interrogation import evaluate_why_answer
                from waxprep.app.database.client import get_db

                db = get_db()
                conv = db.table("conversations").select("last_teaching_concept").eq("student_id", student_id).eq("is_active", True).order("started_at", desc=True).limit(1).execute()
                if conv.data and conv.data[0].get("last_teaching_concept"):
                    concept = conv.data[0]["last_teaching_concept"]
                    feedback, score = evaluate_why_answer(message, concept)
                    if score >= 0.6:
                        await memory.update_knowledge_map(student_id, concept, "general", score)
                        await memory.save_episodic_memory(
                            student_id=student_id,
                            memory_type="elaborative_interrogation",
                            description=f"Answered why-question about {concept}: {feedback}",
                            emotion="excited" if score >= 0.8 else "neutral",
                        )
                        logger.info(f"Why-answer evaluated: {student_id[:8]} {concept} score={score}")
            except Exception as e:
                logger.debug(f"Why-answer evaluation: {e}")

        except Exception as e:
            logger.debug(f"Background memory update: {e}")

brain = WaxPrepBrain()
