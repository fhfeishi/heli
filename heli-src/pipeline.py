"""数据管道审计：每次批量处理写一份 `datapipe/runs/<run_id>.json`。

为什么是文件而不是数据库：
- 记录要能在不启动 heli 的情况下直接读，也要能跟着仓库一起归档；
- 记录只描述「做了什么、依据什么规则、结果如何」，不复制资料正文。

两条硬约定：
1. **记录是旁路**：写失败只警告，不影响数据处理本身；
2. **开始即落盘**：运行开始时先写一份 `running`，结束后原子替换为最终状态。
   进程被强杀时，那份 `running` 记录留在原地，审计时能看到「这次没跑完」。
"""
from __future__ import annotations

import json
import os
import platform
import secrets
import sys
import time
from datetime import datetime
from pathlib import Path

from config import PROJECT_ROOT

MAX_ERRORS = 200
MAX_SAMPLES = 20


def pipeline_root() -> Path:
    """审计记录目录；默认 <项目根>/datapipe，可用 HELI_DATAPIPE 覆盖。"""
    configured = os.environ.get("HELI_DATAPIPE")
    return Path(configured).expanduser() if configured else PROJECT_ROOT / "datapipe"


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _git_head() -> str | None:
    """不调 git 子进程：直接读 .git/HEAD，拿到当前提交短哈希。"""
    try:
        head = (PROJECT_ROOT / ".git" / "HEAD").read_text(encoding="utf-8").strip()
        if head.startswith("ref: "):
            ref = PROJECT_ROOT / ".git" / head[5:]
            return ref.read_text(encoding="utf-8").strip()[:12] if ref.is_file() else head[5:]
        return head[:12]
    except OSError:
        return None


class Run:
    """一次批量处理的记录器。用法：

        with pipeline.run("import", {"source_root": ...}) as run:
            item = run.library(lib_id, name, files_seen=10)
            run.skip(item, "hidden", rel)
            run.count("imported")
    """

    def __init__(self, kind: str, params: dict | None = None) -> None:
        self.kind = kind
        self.params = dict(params or {})
        self.run_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{kind}-{secrets.token_hex(3)}"
        self.path = pipeline_root() / "runs" / f"{self.run_id}.json"
        self.started_at = _now()
        self._t0 = time.monotonic()
        self.status = "running"
        self.counters: dict[str, int] = {}
        self.libraries: list[dict] = []
        self.notes: list[str] = []
        self._errors: list[dict] = []
        self._errors_dropped = 0
        self._finished_at: str | None = None
        self._error: str | None = None

    # ---------------------------------------------------------- 记录
    def count(self, key: str, amount: int = 1) -> None:
        self.counters[key] = self.counters.get(key, 0) + amount

    def library(self, library_id: str, name: str, files_seen: int = 0) -> dict:
        item = {
            "library_id": library_id,
            "name": name,
            "files_seen": files_seen,
            "processed": 0,
            "imported": 0,
            "unchanged": 0,
            "indexed": 0,
            "skipped": 0,
            "failed": 0,
            "skipped_reasons": {},
            "skipped_samples": [],
            "errors": [],
        }
        self.libraries.append(item)
        return item

    def skip(self, item: dict, reason: str, rel) -> None:
        item["skipped"] += 1
        item["skipped_reasons"][reason] = item["skipped_reasons"].get(reason, 0) + 1
        if len(item["skipped_samples"]) < MAX_SAMPLES:
            item["skipped_samples"].append({"path": str(rel), "reason": reason})
        self.count("skipped")

    def library_error(self, item: dict, rel, message) -> None:
        item["failed"] += 1
        self.count("failed")
        if len(item["errors"]) < MAX_SAMPLES:
            item["errors"].append({"path": str(rel), "error": str(message)[:500]})
        self.error(rel, message)

    def error(self, path, message) -> None:
        if len(self._errors) >= MAX_ERRORS:
            self._errors_dropped += 1
            return
        self._errors.append({"path": str(path), "error": str(message)[:500]})

    def note(self, message: str) -> None:
        self.notes.append(str(message))

    # ---------------------------------------------------------- 落盘
    def _payload(self) -> dict:
        return {
            "run_id": self.run_id,
            "kind": self.kind,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self._finished_at,
            "duration_sec": round(time.monotonic() - self._t0, 1),
            "entry": f"heli-src/cli.py {self.kind}",
            "git_head": _git_head(),
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "pid": os.getpid(),
            "params": self.params,
            "counters": self.counters,
            "libraries": self.libraries,
            "notes": self.notes,
            "errors": self._errors,
            "errors_dropped": self._errors_dropped,
            "error": self._error,
        }

    def write(self) -> Path:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(self._payload(), ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, self.path)
        return self.path

    def flush(self) -> None:
        """把当前进度写回，长任务被强杀时能看出跑到哪。失败只警告。"""
        try:
            self.write()
        except OSError as write_error:
            print(f"warning: 管道记录写入失败：{write_error}", file=sys.stderr)

    def close(self, status: str = "done", error: str | None = None) -> Path | None:
        self.status = status
        self._error = error
        self._finished_at = _now()
        try:
            path = self.write()
        except OSError as write_error:
            print(f"warning: 管道记录写入失败：{write_error}", file=sys.stderr)
            return None
        print(f"管道记录：{path}", file=sys.stderr)
        return path

    # ---------------------------------------------------------- 上下文
    def __enter__(self) -> "Run":
        self.flush()  # 先留一份 running，进程被强杀时仍有痕迹
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc_type is None:
            self.close("done")
        elif issubclass(exc_type, KeyboardInterrupt):
            self.close("stopped")
        else:
            self.error("<run>", f"{exc_type.__name__}: {exc}")
            self.close("failed", error=f"{exc_type.__name__}: {exc}")
        return False  # 异常继续向上抛，不吞掉


def run(kind: str, params: dict | None = None) -> Run:
    return Run(kind, params)
