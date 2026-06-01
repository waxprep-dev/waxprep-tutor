import httpx
import tempfile
import os
from typing import Optional
from loguru import logger
from groq import Groq
from waxprep.app.core.config import settings

class VoiceTranscriber:
    def __init__(self):
        self.groq = Groq(api_key=settings.groq_api_key)
        self.headers = {"Authorization": f"Bearer {settings.whatsapp_access_token}"}

    async def transcribe_whatsapp_audio(self, media_id: str) -> Optional[str]:
        try:
            audio_bytes = await self._download(media_id)
            if not audio_bytes:
                return None
            return await self._transcribe(audio_bytes)
        except Exception as e:
            logger.error(f"Voice transcription failed: {e}")
            return None

    async def _download(self, media_id: str) -> Optional[bytes]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                r = await client.get(
                    f"https://graph.facebook.com/v21.0/{media_id}",
                    headers=self.headers,
                )
                r.raise_for_status()
                url = r.json().get("url")
                if not url:
                    return None
                audio = await client.get(url, headers=self.headers)
                audio.raise_for_status()
                return audio.content
            except Exception as e:
                logger.error(f"Audio download failed: {e}")
                return None

    async def _transcribe(self, audio_bytes: bytes) -> Optional[str]:
        with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        try:
            with open(tmp_path, "rb") as f:
                result = self.groq.audio.transcriptions.create(
                    file=("audio.ogg", f, "audio/ogg"),
                    model="whisper-large-v3-turbo",
                    response_format="text",
                    language="en",
                )
            return result.strip() if result else None
        except Exception as e:
            logger.warning(f"Whisper transcription failed: {e}")
            return None
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
