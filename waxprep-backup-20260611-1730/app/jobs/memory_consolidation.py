from loguru import logger
from waxprep.app.database.client import get_db
from waxprep.app.brain.engine import brain
from datetime import datetime, timezone, timedelta

async def run_memory_consolidation():
    try:
        db = get_db()
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        closed_sessions = (
            db.table("conversations")
            .select("id, student_id, summary")
            .eq("is_active", False)
            .gte("ended_at", yesterday)
            .is_("summary", "null")
            .limit(50)
            .execute()
        )

        if not closed_sessions.data:
            return

        consolidated = 0
        for session in closed_sessions.data:
            try:
                msgs = (
                    db.table("messages")
                    .select("direction, content")
                    .eq("conversation_id", session["id"])
                    .order("timestamp", desc=False)
                    .execute()
                )

                if not msgs.data or len(msgs.data) < 4:
                    continue

                conv_text = "\n".join([
                    f"{'Student' if m['direction'] == 'inbound' else 'WaxPrep'}: {m['content']}"
                    for m in msgs.data
                ])

                prompt = (
                    f"Extract key learning moments from this WaxPrep session. "
                    f"Return a summary with: topics covered, breakthroughs (moments of clarity), "
                    f"struggles (confusion or frustration), and next steps. Be specific, not generic.\n\n"
                    f"{conv_text[:4000]}"
                )

                summary = await brain._call_model(prompt)
                if summary:
                    db.table("conversations").update({"summary": summary.strip()}).eq("id", session["id"]).execute()
                    consolidated += 1

            except Exception as e:
                logger.warning(f"Memory consolidation failed for session {session['id']}: {e}")

        if consolidated > 0:
            logger.info(f"Memory consolidation: processed {consolidated} sessions")

    except Exception as e:
        logger.error(f"Memory consolidation job failed: {e}")
