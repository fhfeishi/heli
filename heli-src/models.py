"""跨模块共识的最小数据结构。数据库行仍是 dict，这里只放需要传递的值对象。"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Scope:
    """用户选择的原始表达。

    kind 为 all / library / group / source 时用 id；
    kind 为 multi 时用 ids：用户同时选了多个库或组（原始需求里的「选择多个知识库」）。
    保留单一 kind 是因为它们是不同的解析规则，多选只是把几条规则的结果并起来。
    """

    kind: str  # all | library | group | source | multi
    id: str | None = None
    ids: tuple[str, ...] = ()

    @classmethod
    def parse(cls, raw: dict | str | None) -> "Scope":
        if not raw:
            return cls("all")
        if isinstance(raw, str):
            # multi:library:a,b / multi:group:x,y —— 也允许混选（库和组各自前缀）
            if raw.startswith("multi:"):
                return cls("multi", ids=tuple(p for p in raw[6:].split(",") if p))
            kind, _, ident = raw.partition(":")
            return cls(kind or "all", ident or None)
        kind = str(raw.get("kind") or "all")
        if kind == "multi":
            items = raw.get("ids") or []
            return cls("multi", ids=tuple(str(item) for item in items if item))
        ident = raw.get("id")
        return cls(kind, str(ident) if ident else None)

    def as_dict(self) -> dict:
        """回写运行快照用：保持原始表达，不把解析后的库 id 当作用户意图。"""
        if self.kind == "multi":
            return {"kind": "multi", "ids": list(self.ids)}
        return {"kind": self.kind, "id": self.id}


@dataclass(frozen=True)
class ResolvedScope:
    library_ids: list[str]
    source_ids: list[str] | None = None  # None = 库内全部来源
    description: str = ""


@dataclass(frozen=True)
class SearchHit:
    source_id: str
    version_id: str
    library_id: str
    title: str
    snippet: str
    position: int | None
    score: float


@dataclass(frozen=True)
class Evidence:
    index: int
    source_id: str
    version_id: str
    title: str
    quote: str
    position: int | None
    extra: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "index": self.index,
            "source_id": self.source_id,
            "version_id": self.version_id,
            "title": self.title,
            "quote": self.quote,
            "position": self.position,
        }
