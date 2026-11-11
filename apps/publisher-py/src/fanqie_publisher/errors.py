from __future__ import annotations

from typing import Any


class ServiceError(Exception):
    """带错误码和 HTTP 状态的服务错误，对外 JSON 结构与 TS 版一致。"""

    def __init__(self, code: str, message: str, status: int = 500, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details


def driver_failed(message: str, details: Any = None) -> ServiceError:
    """浏览器侧操作失败。登录态守卫据此判断是否要复查登录态并重试。"""
    return ServiceError("fanqie_driver_failed", message, 502, details)
