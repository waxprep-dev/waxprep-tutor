from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from fastapi.responses import PlainTextResponse
import hashlib
import hmac
from loguru import logger
from waxprep.app.core.config import settings
from waxprep.app.gateways.whatsapp.parser import WhatsAppParser
from waxprep.app.gateways.telegram.parser import TelegramParser
from waxprep.app.router.dispatcher import dispatch_message

router = APIRouter()
whatsapp_parser = WhatsAppParser()
telegram_parser = TelegramParser()

def verify_whatsapp_signature(payload: bytes, signature: str) -> bool:
    if not settings.whatsapp_app_secret:
        return True
    if not signature or not signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        settings.whatsapp_app_secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

@router.get("/webhook/whatsapp")
async def whatsapp_verify(request: Request):
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    if mode == "subscribe" and token == settings.whatsapp_verify_token:
        logger.info("WhatsApp webhook verified successfully")
        return PlainTextResponse(content=challenge)

    logger.warning(f"WhatsApp webhook verification failed — token mismatch")
    raise HTTPException(status_code=403, detail="Verification failed")

@router.post("/webhook/whatsapp")
async def whatsapp_webhook(request: Request, background_tasks: BackgroundTasks):
    body = await request.body()
    signature = request.headers.get("x-hub-signature-256", "")

    if settings.app_env == "production" and not verify_whatsapp_signature(body, signature):
        logger.warning("WhatsApp signature verification failed")
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Failed to parse WhatsApp payload: {e}")
        return {"status": "ok"}

    messages = whatsapp_parser.parse_payload(payload)

    for normalized_message in messages:
        background_tasks.add_task(_process_message_safe, normalized_message)

    return {"status": "ok"}

@router.post("/webhook/telegram")
async def telegram_webhook(request: Request, background_tasks: BackgroundTasks):
    secret = request.headers.get("x-telegram-bot-api-secret-token", "")
    if settings.telegram_webhook_secret and secret != settings.telegram_webhook_secret:
        logger.warning("Telegram secret token mismatch")
        raise HTTPException(status_code=401, detail="Invalid secret")

    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Failed to parse Telegram payload: {e}")
        return {"status": "ok"}

    normalized_message = telegram_parser.parse_update(payload)
    if normalized_message:
        background_tasks.add_task(_process_message_safe, normalized_message)

    return {"status": "ok"}

async def _process_message_safe(normalized_message):
    try:
        await dispatch_message(normalized_message)
    except Exception as e:
        logger.error(
            f"Unhandled error processing message from {normalized_message.platform_user_id}: {e}",
            exc_info=True,
        )
