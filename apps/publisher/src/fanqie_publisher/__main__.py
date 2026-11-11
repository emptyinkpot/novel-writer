"""启动入口：uv run fanqie-publisher（默认 http://127.0.0.1:19202）。"""
from __future__ import annotations

import logging

import uvicorn

from .api import create_app
from .config import load_config


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="[%(name)s] %(message)s")
    config = load_config()
    uvicorn.run(create_app(), host=config.host, port=config.port, log_level="info")


if __name__ == "__main__":
    main()
