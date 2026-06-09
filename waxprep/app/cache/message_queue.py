from typing import Optional
import asyncio
from datetime import datetime, timezone
from loguru import logger
from waxprep.app.cache.redis import rget, rset, rdel

class MessageQueue:
    """
    Simple rate-limited message queue for WhatsApp API.
    Prevents hitting rate limits during high traffic.
    """
    def __init__(self):
        self.rate_limit = 30  # messages per minute
        self.queue_key = "wax:message_queue"
        self.last_sent_key = "wax:last_message_time"
    
    async def can_send(self) -> bool:
        """
        Check if we can send a message now without hitting rate limit.
        """
        try:
            now = datetime.now(timezone.utc)
            
            # Get count of messages sent in last minute
            count = await rget(self.queue_key)
            if count is None:
                count = 0
            else:
                count = int(count)
            
            if count < self.rate_limit:
                return True
            
            # Check if a minute has passed since first message in window
            last_reset = await rget(self.last_sent_key)
            if last_reset:
                last_reset_time = datetime.fromisoformat(last_reset)
                elapsed = (now - last_reset_time).total_seconds()
                if elapsed >= 60:
                    # Reset window
                    await rdel(self.queue_key)
                    await rset(self.last_sent_key, now.isoformat(), 120)
                    return True
            
            return False
            
        except Exception as e:
            logger.warning(f"Rate limit check failed: {e}")
            return True  # Allow on error, don't block
    
    async def record_sent(self) -> None:
        """
        Record that a message was sent.
        """
        try:
            now = datetime.now(timezone.utc)
            
            # Check if we need to reset the window
            last_reset = await rget(self.last_sent_key)
            if not last_reset:
                await rset(self.last_sent_key, now.isoformat(), 120)
            
            # Increment count
            count = await rget(self.queue_key)
            if count is None:
                await rset(self.queue_key, 1, 60)
            else:
                await rset(self.queue_key, int(count) + 1, 60)
                
        except Exception as e:
            logger.warning(f"Record sent failed: {e}")
    
    async def send_with_rate_limit(self, send_func, *args, **kwargs):
        """
        Wrapper: wait if rate limited, then send and record.
        """
        max_wait = 30  # seconds
        waited = 0
        
        while not await self.can_send():
            if waited >= max_wait:
                logger.warning("Rate limit wait timeout, sending anyway")
                break
            await asyncio.sleep(1)
            waited += 1
        
        result = await send_func(*args, **kwargs)
        await self.record_sent()
        return result

message_queue = MessageQueue()
