"""跨模块共识的最小数据结构。数据库行仍是 dict，这里只放需要传递的值对象。"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Scope:
    """用户选择的原始表达。"""

    kind: str  # all | library | group | source
    id: str | None = None

    @classmethod
    def parse(cls, raw: dict | str | None) -> "Scope":
        if not raw:
            return cls("all")
        if isinstance(raw, str):
            kind, _, ident = raw.partition(":")
            return cls(kind or "all", ident or None)
        kind = str(raw.get("kind") or "all")
        ident = raw.get("id")
        return cls(kind, str(ident) if ident else None)


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
