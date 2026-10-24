"""parsers：把「外部解析器」抽成一层接口。

为什么需要这层
--------------
现在正文来源有两条：内置的 pypdf 抽文本层、以及用户自己跑 MinerU 后
把 markdown 挂回来（`content.attach_*`）。以后可能接本地 MinerU 服务、
接别的 OCR，或者让模型做版面理解。

这些实现的**输入输出形状是一样的**：给一份原件（或它的路径），
产出一段正文 + 一个来源标记。差别只在「怎么算」。所以这里只定义形状，
不实现任何解析：调用方拿到的是 `ParseResult`，不关心背后是 pypdf 还是 HTTP。

不在这里做的事
--------------
- 不调度、不重试、不管并发（那是 pipeline / cli 的职责）
- 不写数据库（落库统一走 content.attach_text，保证 version 语义只有一处）
- 不判断「该不该解析」（调用方按 status 决定）
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class ParseResult:
    """一次解析的产物。

    text 为 None 表示「解析跑通了，但没有可用正文」（扫描件没有文本层）。
    这与「解析失败」不同：前者是资料本身的性质，要如实标 registered；
    后者应该抛异常，让调用方知道这次没成。
    """

    text: str | None
    # 记进 derived.locator，用来区分正文来源：pypdf 是 "chars"，
    # 外部解析器用 "chars:<name>"。事后能查出这段正文是谁给的。
    origin: str
    # 解析器自己报的补充信息（页数、耗时、告警）。落不落库由调用方决定。
    detail: dict | None = None


class Parser(Protocol):
    """解析器接口。

    name 用于 locator 与日志；available() 让调用方在没装依赖时
    提前退到「仅登记」，而不是解析到一半才失败。
    """

    name: str

    def available(self) -> bool:
        """依赖是否就绪（如 pypdf 已安装、服务可达）。"""
        ...

    def supports(self, path: Path | str) -> bool:
        """这份文件归不归它管（按扩展名 / 类型判断）。"""
        ...

    def parse(self, path: Path | str, data: bytes | None = None) -> ParseResult:
        """解析。data 给定时用它，否则读 path。"""
        ...


# ------------------------------------------------------------------ 内置实现

class PdfTextParser:
    """pypdf 抽文本层。

    扫描件没有文本层时返回 text=None —— 这是正常的「没有正文」，
    不是错误。把它当错误会让人以为资料坏了。
    """

    name = "pdf-text"

    def __init__(self) -> None:
        try:
            from pypdf import PdfReader  # noqa: F401
        except ImportError:
            self._reader = None
        else:
            from pypdf import PdfReader
            self._reader = PdfReader

    def available(self) -> bool:
        return self._reader is not None

    def supports(self, path: Path | str) -> bool:
        return Path(str(path)).suffix.lower() == ".pdf"

    def parse(self, path: Path | str, data: bytes | None = None) -> ParseResult:
        if self._reader is None:
            return ParseResult(None, "chars", {"reason": "pypdf 未安装"})
        raw = data if data is not None else Path(path).read_bytes()
        import io

        try:
            reader = self._reader(io.BytesIO(raw))
            if reader.is_encrypted:
                return ParseResult(None, "chars", {"reason": "加密 PDF"})
            pages = list(reader.pages)
        except Exception as error:
            # 坏文件（缺 xref、截断）不是「解析失败」而是「这份文件没有可读文本层」：
            # 调用方据此标 registered，原件仍然完整保存、可下载。
            return ParseResult(None, "chars", {"reason": f"{type(error).__name__}: {error}"})
        parts = []
        for page in pages:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                # 单页抽不出来不该让整份失败：其余页仍有价值
                parts.append("")
        text = "\n".join(part for part in parts if part.strip()).strip()
        return ParseResult(text or None, "chars", {"pages": len(pages)})


class ExternalMarkdownParser:
    """外部解析器（如 MinerU）产出的 markdown。

    这一层不负责「跑 MinerU」——那需要知道它装在哪、怎么调、输出到哪，
    属于部署问题。它只负责把**已经拿到的 markdown** 规范成 ParseResult，
    好让调用方和内置解析器用同一条路落库。

    接本地 MinerU 时，新增一个 Parser 实现、在 parse() 里调它的 CLI 或 HTTP，
    其余代码不用动。
    """

    name = "markdown"

    def __init__(self, origin: str = "mineru") -> None:
        self._origin = origin

    def available(self) -> bool:
        # 外部产物是「用户已经跑好了」，不存在依赖缺失
        return True

    def supports(self, path: Path | str) -> bool:
        return Path(str(path)).suffix.lower() in (".md", ".markdown")

    def parse(self, path: Path | str, data: bytes | None = None) -> ParseResult:
        raw = data if data is not None else Path(path).read_bytes()
        text = raw.decode("utf-8", errors="replace").strip()
        return ParseResult(text or None, f"chars:{self._origin}", {"bytes": len(raw)})


# ------------------------------------------------------------------ 注册表

def registry() -> list[Parser]:
    """按优先级排列的解析器。调用方取第一个 supports() 且 available() 的。

    内置 pypdf 在前：它是同步的、不依赖外部进程，能用就用。
    外部 markdown 在后：只在用户明确把产物交过来时才走。
    """
    return [PdfTextParser(), ExternalMarkdownParser()]
