import httpx
from typing import List, Dict, Any
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential
from waxprep.app.core.config import settings
from waxprep.app.core.exceptions import MessageSendError

class TelegramSender:
    def __init__(self):
        self.base = f"https://api.telegram.org/bot{settings.telegram_bot_token}"

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def send_text(self, chat_id: str, text: str) -> Dict[str, Any]:
        if len(text) > 4096:
            parts = self._split(text)
            result = {}
            for part in parts:
                result = await self._send(chat_id, part)
            return result
        return await self._send(chat_id, text)

    async def _send(self, chat_id: str, text: str) -> Dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                r = await client.post(
                    f"{self.base}/sendMessage",
                    json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
                )
                r.raise_for_status()
                return r.json()
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 400:
                    r2 = await client.post(f"{self.base}/sendMessage", json={"chat_id": chat_id, "text": text})
                    r2.raise_for_status()
                    return r2.json()
                raise MessageSendError(f"Telegram error: {e.response.status_code}")

    def _split(self, text: str, max_len: int = 4000) -> List[str]:
        if len(text) <= max_len:
            return [text]
        parts = []
        while len(text) > max_len:
            split_at = text[:max_len].rfind("\n\n")
            if split_at == -1:
                split_at = max_len
            parts.append(text[:split_at].strip())
            text = text[split_at:].strip()
        if text:
            parts.append(text)
        return parts
