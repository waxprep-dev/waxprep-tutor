from typing import Optional, Dict, Any
from datetime import datetime
from loguru import logger
from waxprep.app.core.constants import Platform
from waxprep.app.identity.wax_code import generate_wax_code
from waxprep.app.database.client import get_db_client

class IdentityManager:
    def __init__(self):
        self.db = get_db_client()

    async def get_or_create_student(
        self,
        platform: Platform,
        platform_user_id: str,
    ) -> Dict[str, Any]:
        try:
            field = (
                "platform_whatsapp" if platform == Platform.WHATSAPP
                else "platform_telegram" if platform == Platform.TELEGRAM
                else None
            )

            if field:
                r = self.db.table("students").select("*").eq(field, platform_user_id).execute()
                if r.data:
                    self.db.table("students").update({
                        "last_active_at": datetime.utcnow().isoformat()
                    }).eq("id", r.data[0]["id"]).execute()
                    return r.data[0]

            wax_code = generate_wax_code(
                platform,
                platform_user_id if platform == Platform.WHATSAPP else None,
            )
            student_data = {
                "wax_code": wax_code,
                "status": "active",
                "last_active_at": datetime.utcnow().isoformat(),
            }
            if platform == Platform.WHATSAPP:
                student_data["platform_whatsapp"] = platform_user_id
            elif platform == Platform.TELEGRAM:
                student_data["platform_telegram"] = platform_user_id

            result = self.db.table("students").insert(student_data).execute()
            if not result.data:
                raise Exception("Student insert returned no data")

            student = result.data[0]
            self.db.table("student_profiles").insert({"student_id": student["id"]}).execute()

            logger.info(f"New student created: {wax_code} on {platform.value}")
            return student

        except Exception as e:
            logger.error(f"Identity error for {platform_user_id}: {e}")
            raise

    async def get_profile(self, student_id: str) -> Optional[Dict[str, Any]]:
        try:
            r = self.db.table("student_profiles").select("*").eq("student_id", student_id).execute()
            return r.data[0] if r.data else None
        except Exception as e:
            logger.error(f"Profile fetch error: {e}")
            return None
