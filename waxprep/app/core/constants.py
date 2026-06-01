from enum import Enum

class Platform(str, Enum):
    WHATSAPP = "whatsapp"
    TELEGRAM = "telegram"
    WEB = "web"

class ClassLevel(str, Enum):
    JSS1 = "JSS1"
    JSS2 = "JSS2"
    JSS3 = "JSS3"
    SS1 = "SS1"
    SS2 = "SS2"
    SS3 = "SS3"
    UNI_100 = "UNI_100"
    UNI_200 = "UNI_200"
    OUT_OF_SCHOOL = "OUT_OF_SCHOOL"
    UNKNOWN = "UNKNOWN"

class MessageDirection(str, Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"

class MessageType(str, Enum):
    TEXT = "text"
    TEACHING = "teaching"
    ASSESSMENT = "assessment"
    NOTIFICATION = "notification"
    SYSTEM = "system"

WAX_CODE_PREFIX = "WAX"
DEFAULT_REGION_CODE = "NG"
