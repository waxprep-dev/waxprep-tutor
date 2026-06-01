from datetime import datetime
from loguru import logger
from waxprep.app.database.client import get_db_client

async def run_notification_dispatcher():
    try:
        db = get_db_client()
        now = datetime.utcnow().isoformat()
        pending = (
            db.table("scheduled_notifications")
            .select("*")
            .eq("status", "pending")
            .lte("scheduled_for", now)
            .limit(50)
            .execute()
        )

        if not pending.data:
            return

        sent = 0
        failed = 0

        for notification in pending.data:
            try:
                student = (
                    db.table("students")
                    .select("platform_whatsapp, platform_telegram")
                    .eq("id", notification["student_id"])
                    .execute()
                )

                if not student.data:
                    continue

                s = student.data[0]
                platform = notification["platform"]
                content = notification["content"]
                success = False

                if platform == "whatsapp" and s.get("platform_whatsapp"):
                    from waxprep.app.gateways.whatsapp.sender import WhatsAppSender
                    await WhatsAppSender().send_text(s["platform_whatsapp"], content)
                    success = True
                elif platform == "telegram" and s.get("platform_telegram"):
                    from waxprep.app.gateways.telegram.sender import TelegramSender
                    await TelegramSender().send_text(s["platform_telegram"], content)
                    success = True

                if success:
                    db.table("scheduled_notifications").update({
                        "status": "sent",
                        "sent_at": datetime.utcnow().isoformat(),
                    }).eq("id", notification["id"]).execute()
                    sent += 1
                else:
                    db.table("scheduled_notifications").update({
                        "status": "failed",
                        "error_message": "No valid platform address found",
                    }).eq("id", notification["id"]).execute()
                    failed += 1

            except Exception as e:
                logger.warning(f"Notification send failed for {notification['id']}: {e}")
                try:
                    db.table("scheduled_notifications").update({
                        "status": "failed",
                        "error_message": str(e)[:200],
                    }).eq("id", notification["id"]).execute()
                except Exception:
                    pass
                failed += 1

        if sent > 0 or failed > 0:
            logger.info(f"Notification dispatcher: sent {sent}, failed {failed}")

    except Exception as e:
        logger.error(f"Notification dispatcher job failed: {e}")
