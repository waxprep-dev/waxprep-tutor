class WaxPrepBaseException(Exception):
    def __init__(self, message: str, code: str = None):
        self.message = message
        self.code = code
        super().__init__(self.message)

class StudentNotFoundError(WaxPrepBaseException): pass
class AIModelError(WaxPrepBaseException): pass
class AIModelUnavailableError(AIModelError): pass
class DatabaseError(WaxPrepBaseException): pass
class MessageSendError(WaxPrepBaseException): pass
class DuplicateMessageError(WaxPrepBaseException): pass
