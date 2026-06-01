from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from datetime import datetime
from waxprep.app.core.constants import Platform

@dataclass
class NormalizedMessage:
    platform: Platform
    platform_user_id: str
    platform_message_id: str
    content: str
    message_type: str
    timestamp: datetime
    raw_payload: Dict[str, Any] = field(default_factory=dict)
    media_url: Optional[str] = None
    media_type: Optional[str] = None
    is_voice: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not self.content or not self.content.strip()

    @property
    def content_clean(self) -> str:
        return self.content.strip() if self.content else ""
