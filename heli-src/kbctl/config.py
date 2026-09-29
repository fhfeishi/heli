"""库位置与运行配置：从项目根 `.env` 读取，按当前平台换算路径。

只用标准库，不给 kbctl 引入依赖。

**优先级（高 → 低）**

1. 命令行 `--root`（调用方显式指定，永远最高）
2. 真实环境变量 `HELI_KNOWLEDGE` / `KNOWLEDGE_ROOT`
3. 项目根 `.env` 里的 `KNOWLEDGE_ROOT`
4. 兜底 `<项目根>/.knowledge`

**路径写法**：`.env` 里两种写法都收，按运行环境自动换算——

| `.env` 里写 | WSL 内解析为 | Windows 内解析为 |
|---|---|---|
| `E:/local_db/.knowledge` | `/mnt/e/local_db/.knowledge` | `E:/local_db/.knowledge` |
| `E:\\local_db\\.knowledge` | `/mnt/e/local_db/.knowledge` | `E:/local_db/.knowledge` |
| `/mnt/e/local_db/.knowledge` | 原样 | `E:/local_db/.knowledge` |

已经在目标形态的就原样返回，转换是幂等的。

**`.env` 其它键**：加载后对**所有**键做 `os.environ.setdefault`，
所以 `HELI_EMBEDDING_ROOT` 之类照旧由代码从真实环境读取，只是多了 `.env` 这一层来源；
真实环境变量优先于 `.env`，不会被覆盖。

自检：`python -m kbctl.config`；脚本取库根用 `python -m kbctl.config --print-root`
"""
from __future__ import annotations

import json
import os
import platform
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# kbctl/config.py → kbctl/ → heli-src/ → 项目根
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"

DRIVE_RE = re.compile(r"^([A-Za-z]):[\\/]")
MNT_RE = re.compile(r"^/mnt/([A-Za-z])[\\/](.*)$")


def in_wsl() -> bool:
    """是否运行在 WSL 内（Linux 内核但带微软标记）。"""
    if platform.system() != "Linux":
        return False
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return False


def to_wsl_path(value: str) -> str:
    """Windows 写法 → WSL 写法；已是 POSIX 写法则原样返回。"""
    value = value.replace("\\", "/")
    m = DRIVE_RE.match(value)
    if m:
        return f"/mnt/{m.group(1).lower()}/{value[m.end():]}"
    return value


def to_windows_path(value: str) -> str:
    """WSL 写法 → Windows 写法；已是盘符写法则原样返回。"""
    value = value.replace("\\", "/")
    m = MNT_RE.match(value)
    if m:
        return f"{m.group(1).upper()}:/{m.group(2)}"
    return value


def for_platform(value: str) -> str:
    """把 `.env` 里的路径换算成当前环境能直接用的写法。"""
    return to_wsl_path(value) if in_wsl() else to_windows_path(value)


def read_env(path: str | os.PathLike = ENV_FILE) -> dict[str, str]:
    """极简 `.env` 解析：KEY=VALUE，忽略空行与 `#` 注释，去掉成对引号与可选 export。"""
    env: dict[str, str] = {}
    file = Path(path)
    if not file.is_file():
        return env
    for raw in file.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            env[key] = value
    return env


def load_env(path: str | os.PathLike = ENV_FILE) -> dict[str, str]:
    """读 `.env`，并把其中的键补进 `os.environ`（真实环境变量优先，不覆盖）。"""
    env = read_env(path)
    for key, value in env.items():
        os.environ.setdefault(key, value)
    return env


@dataclass(frozen=True)
class Settings:
    """当前生效的配置。"""

    knowledge_root: Path          # 已按平台换算，可直接 open
    knowledge_root_raw: str       # 原始写法（.env 或环境变量里的值）
    source: str                   # 来源：cli / env:HELI_KNOWLEDGE / env:KNOWLEDGE_ROOT / .env / default
    env_file: Path
    in_wsl: bool

    def as_dict(self) -> dict[str, str]:
        return {
            "knowledge_root": str(self.knowledge_root),
            "knowledge_root_raw": self.knowledge_root_raw,
            "source": self.source,
            "env_file": str(self.env_file),
            "in_wsl": "yes" if self.in_wsl else "no",
        }


def resolve_root(cli_root: str | None = None, env_file: str | os.PathLike = ENV_FILE) -> Settings:
    """按优先级定出库根。`cli_root` 为命令行显式传入的值。"""
    wsl = in_wsl()
    if cli_root:
        return Settings(Path(cli_root), cli_root, "cli", Path(env_file), wsl)

    raw = os.environ.get("HELI_KNOWLEDGE", "").strip()
    if raw:
        return Settings(Path(for_platform(raw)), raw, "env:HELI_KNOWLEDGE", Path(env_file), wsl)

    raw = os.environ.get("KNOWLEDGE_ROOT", "").strip()
    if raw:
        return Settings(Path(for_platform(raw)), raw, "env:KNOWLEDGE_ROOT", Path(env_file), wsl)

    file_env = read_env(env_file)
    raw = file_env.get("KNOWLEDGE_ROOT", "").strip()
    if raw:
        return Settings(Path(for_platform(raw)), raw, ".env", Path(env_file), wsl)

    return Settings(PROJECT_ROOT / ".knowledge", "", "default", Path(env_file), wsl)


_SETTINGS: Settings | None = None


def get_settings(refresh: bool = False) -> Settings:
    """取当前配置（首次调用会把 `.env` 补进 os.environ，结果缓存）。"""
    global _SETTINGS
    if _SETTINGS is None or refresh:
        # 先定库根：此时 os.environ 还没被 .env 污染，来源才判得准
        # （load_env 会 setdefault KNOWLEDGE_ROOT，先跑它就分不清是环境变量还是 .env）
        _SETTINGS = resolve_root()
        # 再把 .env 的其它键（如 HELI_EMBEDDING_ROOT）补进真实环境；真实环境变量优先
        load_env()
    return _SETTINGS


def main(argv=None) -> int:
    """自检入口。`--print-root` 只打印库根（给脚本用），`--json` 输出机器可读结果。"""
    args = list(sys.argv[1:] if argv is None else argv)
    s = get_settings()
    if "--print-root" in args:
        print(s.knowledge_root)
        return 0
    if "--json" in args:
        print(json.dumps(s.as_dict(), ensure_ascii=False, indent=2))
        return 0
    print(f"运行环境：{'WSL' if s.in_wsl else 'Windows/其他'}")
    print(f"项目根：{PROJECT_ROOT}")
    print(f".env：{s.env_file}{'' if s.env_file.is_file() else '（不存在，用默认值或环境变量）'}")
    print(f"库根：{s.knowledge_root}    ← 来源 {s.source}"
          + (f"（原始写法 {s.knowledge_root_raw}）" if s.knowledge_root_raw else ""))
    print(f"存在：{'是' if s.knowledge_root.is_dir() else '否'}")
    if s.knowledge_root.is_dir():
        libs = sorted(p.name for p in s.knowledge_root.iterdir() if (p / "kb.json").is_file())
        print(f"库数量：{len(libs)}")
        for name in libs:
            print(f"  - {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
