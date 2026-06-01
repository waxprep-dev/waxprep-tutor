import random
from waxprep.app.core.constants import Platform, WAX_CODE_PREFIX, DEFAULT_REGION_CODE

def generate_wax_code(platform: Platform, phone_number: str = None) -> str:
    region = _detect_region(phone_number)
    random_part = _random_string(6)
    suffix = "W" if platform == Platform.WHATSAPP else ("T" if platform == Platform.TELEGRAM else "X")
    return f"{WAX_CODE_PREFIX}-{region}-0000-{random_part}-{suffix}"

def _detect_region(phone_number: str = None) -> str:
    if not phone_number:
        return DEFAULT_REGION_CODE
    if phone_number.startswith("234") or phone_number.startswith("+234"):
        return "NG"
    if phone_number.startswith("233"):
        return "GH"
    if phone_number.startswith("254"):
        return "KE"
    return DEFAULT_REGION_CODE

def _random_string(length: int) -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choices(chars, k=length))
