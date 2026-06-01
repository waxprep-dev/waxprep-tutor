import time
from typing import Dict, Any, List, Tuple
from loguru import logger
from groq import Groq
from waxprep.app.core.config import settings
from waxprep.app.core.exceptions import AIModelError, AIModelUnavailableError
import google.generativeai as genai

class WaxPrepAIEngine:
    def __init__(self):
        self._groq_keys = settings.all_groq_keys
        self._key_index = 0
        self._groq = self._make_groq()
        genai.configure(api_key=settings.gemini_api_key)
        self._gemini = genai.GenerativeModel(settings.gemini_model)

    def _make_groq(self) -> Groq:
        key = self._groq_keys[self._key_index]
        return Groq(api_key=key)

    def _rotate_key(self) -> None:
        if len(self._groq_keys) > 1:
            self._key_index = (self._key_index + 1) % len(self._groq_keys)
            self._groq = self._make_groq()
            logger.info(f"Rotated to Groq key {self._key_index + 1}")

    async def generate_response(
        self,
        system_prompt: str,
        messages: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        start = time.time()
        response_text = None
        model_used = None

        try:
            response_text, model_used = await self._call_groq(
                system_prompt, messages, settings.groq_primary_model
            )
        except AIModelUnavailableError:
            self._rotate_key()
            try:
                response_text, model_used = await self._call_groq(
                    system_prompt, messages, settings.groq_primary_model
                )
            except Exception as e:
                logger.warning(f"Groq failed after key rotation: {e}")
        except AIModelError as e:
            logger.warning(f"Groq model error: {e}")

        if response_text is None:
            try:
                response_text, model_used = await self._call_gemini(system_prompt, messages)
            except Exception as e:
                logger.error(f"Gemini fallback also failed: {e}")
                response_text = "I'm having a quick technical moment — try again in a bit."
                model_used = "fallback"

        return {
            "response": self._clean_response(response_text),
            "model_used": model_used,
            "processing_time_ms": int((time.time() - start) * 1000),
        }

    async def classify_intent(self, message: str, recent_context: str = "") -> str:
        prompt = (
            f"Classify this Nigerian student's message to their AI teacher.\n"
            f"Context: {recent_context[:100] if recent_context else 'None'}\n"
            f"Message: \"{message}\"\n\n"
            f"Reply with ONLY one word from: GREETING, TEACHING_REQUEST, CLARIFICATION, "
            f"ASSESSMENT_RESPONSE, PROGRESS_CHECK, EMOTIONAL, CASUAL, TOPIC_CHANGE, "
            f"CONFUSION, COMMAND, UNKNOWN\n\nIntent:"
        )
        try:
            r = self._groq.chat.completions.create(
                model=settings.groq_fast_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=10,
                temperature=0.1,
            )
            raw = r.choices[0].message.content.strip().upper()
            valid = ["GREETING", "TEACHING_REQUEST", "CLARIFICATION", "ASSESSMENT_RESPONSE",
                     "PROGRESS_CHECK", "EMOTIONAL", "CASUAL", "TOPIC_CHANGE", "CONFUSION",
                     "COMMAND", "UNKNOWN"]
            for v in valid:
                if v in raw:
                    return v.lower()
            return "unknown"
        except Exception:
            return "unknown"

    async def generate_from_prompt(self, prompt: str, max_tokens: int = 400) -> str:
        try:
            r = self._groq.chat.completions.create(
                model=settings.groq_primary_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.6,
            )
            return self._clean_response(r.choices[0].message.content)
        except Exception as e:
            logger.error(f"Single prompt generation failed: {e}")
            try:
                r = self._gemini.generate_content(prompt)
                return self._clean_response(r.text)
            except Exception:
                return "I had a technical moment. Please try again."

    async def _call_groq(
        self,
        system_prompt: str,
        messages: List[Dict],
        model: str,
    ) -> Tuple[str, str]:
        all_messages = [{"role": "system", "content": system_prompt}] + messages
        try:
            r = self._groq.chat.completions.create(
                model=model,
                messages=all_messages,
                max_tokens=settings.groq_max_tokens,
                temperature=settings.groq_temperature,
            )
            return r.choices[0].message.content, model
        except Exception as e:
            err = str(e).lower()
            if "rate limit" in err or "429" in err or "503" in err or "unavailable" in err:
                raise AIModelUnavailableError(str(e))
            raise AIModelError(str(e))

    async def _call_gemini(
        self,
        system_prompt: str,
        messages: List[Dict],
    ) -> Tuple[str, str]:
        full = system_prompt + "\n\n"
        for m in messages[:-1]:
            role = "Student" if m["role"] == "user" else "WaxPrep"
            full += f"{role}: {m['content']}\n"
        if messages:
            full += f"\nStudent: {messages[-1]['content']}\n\nWaxPrep:"
        r = self._gemini.generate_content(full)
        return r.text, settings.gemini_model

    def _clean_response(self, text: str) -> str:
        if not text:
            return "I had a technical moment. Please try again."
        text = text.strip()
        banned_starts = [
            "Certainly! ", "Of course! ", "Absolutely! ", "Sure! ",
            "Great question! ", "That's a great question! ",
        ]
        for ban in banned_starts:
            if text.startswith(ban):
                text = text[len(ban):]
                if text:
                    text = text[0].upper() + text[1:]
        if len(text) > 4000:
            last_period = text[:3900].rfind(".")
            if last_period > 3000:
                text = text[:last_period + 1]
        return text
