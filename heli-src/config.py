"""唯一配置入口。"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_NAME = "heli.db"


def resolve_data_root(explicit: str | os.PathLike | None = None) -> Path:
    """应用数据根（heli.db 与原件）。

    优先级：显式参数 > 环境变量 HELI_DATA > 项目根 .env > <项目根>/heli-data。
    与资料库根分开：这里是 heli 自己的数据，不是被管理的资料。
    """
    if explicit:
        return _native_path(explicit).expanduser().resolve()
    env = os.environ.get("HELI_DATA")
    if env:
        return _native_path(env).expanduser().resolve()
    configured = _dotenv_value("HELI_DATA")
    if configured:
        return _native_path(configured).expanduser().resolve()
    return PROJECT_ROOT / "heli-data"


def data_root_source() -> str:
    """数据根从哪来的，便于 `python heli-src/config.py` 自检。"""
    if os.environ.get("HELI_DATA"):
        return "环境变量 HELI_DATA"
    if _dotenv_value("HELI_DATA"):
        return "项目根 .env"
    return "默认（<项目根>/heli-data）"


@dataclass(frozen=True)
class LLMConfig:
    """模型通道配置。key 只在内存里，绝不写日志/成果/运行输入。"""

    provider: str = "deepseek"
    base: str = "https://api.deepseek.com"
    model: str = "deepseek-chat"
    key: str = ""
    timeout: float = 180.0
    max_output_tokens: int = 4096

    @property
    def available(self) -> bool:
        return bool(self.key.strip())

    @property
    def label(self) -> str:
        """给 /api/health 与设置页看的通道名。没 key 就是 none，不假装。"""
        return f"{self.provider}/{self.model}" if self.available else "none"


def llm_config() -> LLMConfig:
    """优先级：环境变量 > 项目根 .env > 默认。

    故意不做「有 key 就联网自检」：启动路径不依赖外网，通道是否真的通由运行时的
    第一次调用暴露，错误原样带回运行记录。
    """

    def pick(env_name: str, dotenv_name: str, fallback: str = "") -> str:
        return (os.environ.get(env_name) or _dotenv_value(dotenv_name) or fallback).strip()

    def number(env_name: str, dotenv_name: str, fallback: float) -> float:
        try:
            return float(pick(env_name, dotenv_name) or fallback)
        except ValueError:
            return fallback

    return LLMConfig(
        base=pick("DEEPSEEK_URL", "DEEPSEEK_URL", "https://api.deepseek.com"),
        model=pick("HELI_LLM_MODEL", "HELI_LLM_MODEL", "deepseek-chat"),
        key=pick("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"),
        timeout=number("HELI_LLM_TIMEOUT", "HELI_LLM_TIMEOUT", 180.0),
        max_output_tokens=int(number("HELI_LLM_MAX_TOKENS", "HELI_LLM_MAX_TOKENS", 4096)),
    )


@dataclass(frozen=True)
class Settings:
    data_root: Path
    port: int = 8788
    # 模型通道：有 key 就是 deepseek/<model>，没有就是 none —— 明确暴露，不假装有
    model_channel: str = "none"
    llm: LLMConfig = field(default_factory=LLMConfig)

    @classmethod
    def load(cls, data_root=None, port: int | None = None) -> "Settings":
        llm = llm_config()
        return cls(
            data_root=resolve_data_root(data_root),
            port=port or int(os.environ.get("HELI_PORT", "8788")),
            model_channel=os.environ.get("HELI_MODEL_CHANNEL") or llm.label,
            llm=llm,
        )

    @property
    def db_path(self) -> Path:
        return self.data_root / DB_NAME

# ---------------------------------------------------------------- 旧库根 ----
# 只服务两件事：一次性导入旧资料库、启动时提示；不是应用数据根。

def _dotenv_value(name: str) -> str | None:
    """读项目根 .env 里的单个键（不引第三方解析库）。"""
    path = PROJECT_ROOT / ".env"
    if not path.is_file():
        return None
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key.strip() == name:
                return value.strip().strip('"').strip("'") or None
    except OSError:
        return None
    return None


def _in_wsl() -> bool:
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return False


def _native_path(value: str | os.PathLike) -> Path:
    """把路径换算成当前环境能用的形式。

    `.env` 里写的是 `e:/local_db/.knowledge`（Windows 视角），但后端通常跑在 WSL；
    不换算就会拿到一个在 WSL 里不存在的路径，`[ -d ]` 直接判假。
    同一环境原样返回，不做多余改动。
    """
    text = str(value).replace("\\", "/")
    drive = re.match(r"^([A-Za-z]):/(.*)$", text)
    if drive and _in_wsl():
        return Path(f"/mnt/{drive.group(1).lower()}/{drive.group(2)}")
    mounted = re.match(r"^/mnt/([A-Za-z])/(.*)$", text)
    if mounted and not _in_wsl():
        return Path(f"{mounted.group(1).upper()}:/{mounted.group(2)}")
    return Path(text)


def resolve_knowledge_root(explicit: str | None = None) -> Path:
    """优先级：显式参数 > 环境变量 > 项目根 .env > <项目根>/.knowledge。"""
    if explicit:
        return _native_path(explicit).expanduser()
    for key in ("HELI_KNOWLEDGE", "KNOWLEDGE_ROOT"):
        value = os.environ.get(key)
        if value:
            return _native_path(value).expanduser()
    return _native_path(_dotenv_value("KNOWLEDGE_ROOT") or (PROJECT_ROOT / ".knowledge")).expanduser()


if __name__ == "__main__":  # python heli-src/config.py --print-root
    import sys

    if "--print-root" in sys.argv:
        print(resolve_knowledge_root())
    else:
        current = Settings.load()
        print(f"data_root     {current.data_root}  ← {data_root_source()}")
        print(f"db            {current.db_path}")
        print(f"knowledge_root {resolve_knowledge_root()}")
        print(f"port          {current.port}")
        print(f"model_channel {current.model_channel}")
        print(f"llm_model     {current.llm.model}  base={current.llm.base}  "
              f"key={'已配置（%d 字符）' % len(current.llm.key) if current.llm.available else '未配置'}")

