"""运行配置。项目只认识自己：数据放在仓库根目录 data/，配置只读仓库根目录 .env（可选）。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

VERSION = "0.2.0"


def find_repo_root(start: Path | None = None) -> Path:
    current = (start or Path(__file__)).resolve()
    for directory in [current, *current.parents]:
        if (directory / "pnpm-workspace.yaml").exists():
            return directory
    return Path.cwd()


def load_env_file(path: Path) -> None:
    """只填充尚未设置的环境变量，显式传入的配置优先。"""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def resolve_data_dir() -> Path:
    directory = Path(os.environ.get("NOVEL_WRITER_DATA_DIR") or find_repo_root() / "data").resolve()
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    data_dir: Path
    service_dir: Path
    publisher_db: Path
    library_db: Path
    session_cache_seconds: int
    auto_relogin: bool
    session_watch_minutes: int
    catalog_scan_minutes: int
    login_timeout_seconds: int
    version: str = VERSION

    @property
    def acceptance_dir(self) -> Path:
        path = self.service_dir / "acceptance"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def browser_profiles_dir(self) -> Path:
        return Path(os.environ.get("FANQIE_RUNTIME_BROWSER_ROOT") or self.service_dir / "browser-profiles")


def load_config() -> Config:
    load_env_file(find_repo_root() / ".env")
    data_dir = resolve_data_dir()
    service_dir = Path(os.environ.get("FANQIE_SERVICE_DATA_DIR") or data_dir / "publisher").resolve()
    service_dir.mkdir(parents=True, exist_ok=True)
    return Config(
        host=os.environ.get("FANQIE_SERVICE_HOST", "127.0.0.1"),
        port=_env_int("FANQIE_SERVICE_PORT", 19202),
        data_dir=data_dir,
        service_dir=service_dir,
        publisher_db=data_dir / "publisher.sqlite",
        library_db=Path(os.environ.get("NOVEL_WRITER_DB") or data_dir / "novel-writer.sqlite"),
        session_cache_seconds=_env_int("FANQIE_SESSION_CACHE_MINUTES", 10) * 60,
        auto_relogin=os.environ.get("FANQIE_AUTO_RELOGIN", "1") != "0",
        session_watch_minutes=_env_int("FANQIE_SESSION_WATCH_MINUTES", 180),
        catalog_scan_minutes=_env_int("FANQIE_CATALOG_SCAN_MINUTES", 15),
        login_timeout_seconds=_env_int("FANQIE_LOGIN_TIMEOUT_MS", 10 * 60 * 1000) // 1000,
    )
