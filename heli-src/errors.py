"""业务异常：带 HTTP 语义，但业务模块本身不依赖 HTTP。"""
from __future__ import annotations


class HeliError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, message: str, *, detail=None):
        super().__init__(message)
        self.message = message
        self.detail = detail

    def payload(self) -> dict:
        body = {"error": self.message, "code": self.code}
        if self.detail is not None:
            body["detail"] = self.detail
        return body


class Invalid(HeliError):
    status = 422
    code = "invalid"


class NotFound(HeliError):
    status = 404
    code = "not_found"


class Conflict(HeliError):
    status = 409
    code = "conflict"


class Unsupported(HeliError):
    status = 415
    code = "unsupported"
