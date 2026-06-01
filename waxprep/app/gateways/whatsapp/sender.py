import httpx
from typing import List, Dict, Any, Optional
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential
from waxprep.app.core.config import settings
from waxprep.app.core.exceptions import MessageSendError

WHATSAPP_API = "https://graph.facebook.com/v21.0"

class WhatsAppSender:
    def __init__(self):
        self.url = f"{WHATSAPP_API}/{settings.whatsapp_phone_number_id}/messages"
        self.headers = {
            "Authorization": f"Bearer {settings.whatsapp_access_token}",
            "Content-Type": "application/json",
        }

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def send_text(self, to: str, text: str) -> Dict[str, Any]:
        if len(text) > 4096:
            parts = self._split_message(text)
            result = {}
            for part in parts:
                result = await self._post({
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": to,
                    "type": "text",
                    "text": {"body": part, "preview_url": False},
                })
            return result
        return await self._post({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {"body": text, "preview_url": False},
        })

    async def send_buttons(
        self,
        to: str,
        body: str,
        buttons: List[Dict],
        header: str = None,
        footer: str = None,
    ) -> Dict:
        buttons = buttons[:3]
        action_buttons = [
            {"type": "reply", "reply": {"id": b.get("id", f"btn_{i}"), "title": b.get("title", "Option")[:20]}}
            for i, b in enumerate(buttons)
        ]
        interactive = {
            "type": "button",
            "body": {"text": body},
            "action": {"buttons": action_buttons},
        }
        if header:
            interactive["header"] = {"type": "text", "text": header}
        if footer:
            interactive["footer"] = {"text": footer}

        try:
            return await self._post({
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to,
                "type": "interactive",
                "interactive": interactive,
            })
        except Exception:
            fallback = body + "\n\n" + "\n".join([f"• {b['title']}" for b in buttons])
            return await self.send_text(to, fallback)

    async def send_list(
        self,
        to: str,
        body: str,
        button_label: str,
        sections: List[Dict],
        header: str = None,
    ) -> Dict:
        interactive = {
            "type": "list",
            "body": {"text": body},
            "action": {"button": button_label[:20], "sections": sections},
        }
        if header:
            interactive["header"] = {"type": "text", "text": header}
        try:
            return await self._post({
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to,
                "type": "interactive",
                "interactive": interactive,
            })
        except Exception:
            fallback = body + "\n\n"
            for s in sections:
                for row in s.get("rows", []):
                    fallback += f"• {row.get('title', '')}\n"
            return await self.send_text(to, fallback)

    async def send_mcq(self, to: str, question: str, a: str, b: str, c: str, d: str, intro: str = None) -> Dict:
        body = f"{intro}\n\n{question}" if intro else question
        sections = [{"title": "Your Answer", "rows": [
            {"id": "mcq_A", "title": "A", "description": a[:72]},
            {"id": "mcq_B", "title": "B", "description": b[:72]},
            {"id": "mcq_C", "title": "C", "description": c[:72]},
            {"id": "mcq_D", "title": "D", "description": d[:72]},
        ]}]
        return await self.send_list(to=to, body=body, button_label="Choose Answer", sections=sections)

    async def send_subject_selector(self, to: str, prompt: str) -> Dict:
        sections = [
            {"title": "Sciences", "rows": [
                {"id": "subject_mathematics", "title": "Mathematics"},
                {"id": "subject_physics", "title": "Physics"},
                {"id": "subject_chemistry", "title": "Chemistry"},
                {"id": "subject_biology", "title": "Biology"},
                {"id": "subject_further_mathematics", "title": "Further Mathematics"},
            ]},
            {"title": "Arts and Social Sciences", "rows": [
                {"id": "subject_english_language", "title": "English Language"},
                {"id": "subject_economics", "title": "Economics"},
                {"id": "subject_government", "title": "Government"},
                {"id": "subject_literature", "title": "Literature"},
                {"id": "subject_geography", "title": "Geography"},
            ]},
            {"title": "Practice", "rows": [
                {"id": "action_jamb_practice", "title": "JAMB Practice"},
                {"id": "action_waec_practice", "title": "WAEC Practice"},
            ]},
        ]
        return await self.send_list(to=to, body=prompt, button_label="Select Subject", sections=sections, header="WaxPrep")

    async def send_level_selector(self, to: str) -> Dict:
        sections = [
            {"title": "Junior Secondary", "rows": [
                {"id": "level_JSS1", "title": "JSS 1"},
                {"id": "level_JSS2", "title": "JSS 2"},
                {"id": "level_JSS3", "title": "JSS 3"},
            ]},
            {"title": "Senior Secondary", "rows": [
                {"id": "level_SS1", "title": "SS 1"},
                {"id": "level_SS2", "title": "SS 2"},
                {"id": "level_SS3", "title": "SS 3"},
            ]},
            {"title": "Beyond School", "rows": [
                {"id": "level_UNI_100", "title": "University"},
                {"id": "level_OUT_OF_SCHOOL", "title": "Out of School"},
            ]},
        ]
        return await self.send_list(to=to, body="What level are you in?", button_label="Select Level", sections=sections)

    async def mark_as_read(self, message_id: str) -> None:
        try:
            await self._post({
                "messaging_product": "whatsapp",
                "status": "read",
                "message_id": message_id,
            })
        except Exception:
            pass

    async def _post(self, payload: Dict) -> Dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                r = await client.post(self.url, json=payload, headers=self.headers)
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as e:
                logger.error(f"WhatsApp API {e.response.status_code}: {e.response.text[:200]}")
                raise MessageSendError(f"WhatsApp error: {e.response.status_code}")
            except httpx.TimeoutException:
                raise MessageSendError("WhatsApp request timed out")

    def _split_message(self, text: str, max_len: int = 4000) -> List[str]:
        if len(text) <= max_len:
            return [text]
        parts = []
        while len(text) > max_len:
            split_at = text[:max_len].rfind("\n\n")
            if split_at == -1:
                split_at = text[:max_len].rfind(". ")
            if split_at == -1:
                split_at = max_len
            parts.append(text[:split_at].strip())
            text = text[split_at:].strip()
        if text:
            parts.append(text)
        return parts
