#!/usr/bin/env python3
"""把 E 侧权威版 README 同步到项目内派生版 README。

规则：

- **权威版**（`--from`，缺省 `<库根>/README.md`）= 与项目无关的库规则。
- **派生版**（`--to`，缺省 `<项目根>/.knowledge/README.md`）= 权威版内容 + 项目特有段落。
- 派生版里包在 `<!-- project-only --> … <!-- /project-only -->` 里的段落会被**原样保留**，
  其余部分一律以权威版为准。改规则请改权威版；只改本项目的接法就改标记块里的段落。
- 块按在派生版中出现的顺序，插到权威版头部引用块（开头的 `>` 段）之后。
- 块里的「上次同步：YYYY-MM-DD」自动更新为今天。

用法：

    python scripts/sync-knowledge-readme.py            # 写入派生版
    python scripts/sync-knowledge-readme.py --check    # 只看有没有差异，不写
    python scripts/sync-knowledge-readme.py --from <md> --to <md>

纯标准库，不依赖第三方。
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TO = PROJECT_ROOT / ".knowledge" / "README.md"
DEFAULT_FALLBACK_WIN = Path(r"E:\local_db\.knowledge") / "README.md"

OPEN = "<!-- project-only -->"
CLOSE = "<!-- /project-only -->"
STAMP_RE = re.compile(r"上次同步：\d{4}-\d{2}-\d{2}")


def authoritative_default() -> Path:
    """库根由 kbctl.config 解析，拿不到再用 Windows 固定位置兜底。"""
    try:
        sys.path.insert(0, str(PROJECT_ROOT / "heli-src"))
        from kbctl.config import get_settings  # noqa: PLC0415

        return get_settings().knowledge_root / "README.md"
    except Exception:
        return DEFAULT_FALLBACK_WIN


def extract_blocks(text: str) -> list[str]:
    """取所有独占一行的 project-only 块（块里正文提到的标记不算）。"""
    blocks, current, inside = [], [], False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped == OPEN:
            if inside:
                raise SystemExit(f"发现嵌套的 {OPEN}，先修好派生版再同步")
            inside, current = True, [line]
            continue
        if stripped == CLOSE:
            if not inside:
                raise SystemExit(f"发现多余的 {CLOSE}，先修好派生版再同步")
            current.append(line)
            blocks.append("\n".join(current))
            inside, current = False, []
            continue
        if inside:
            current.append(line)
    if inside:
        raise SystemExit(f"有 {OPEN} 没有配对结束，先修好派生版再同步")
    return blocks


def header_end(lines: list[str]) -> int:
    """权威版开头 `>` 引用块的结束位置（块之后插入项目段落）。"""
    last = -1
    seen_quote = False
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith(">"):
            seen_quote, last = True, i
            continue
        if not s:
            continue
        if seen_quote:
            break
    return last


def render(auth: str, blocks: list[str], today: str) -> str:
    if not blocks:
        raise SystemExit(
            "派生版里没有 project-only 块——同步会把它整篇覆盖成权威版。\n"
            f"先在派生版里用 {OPEN} … {CLOSE} 包住项目特有段落再跑。"
        )
    lines = auth.splitlines()
    idx = header_end(lines)
    if idx < 0:
        raise SystemExit("权威版开头没找到 `>` 引用块，无法确定插入位置")
    joined = "\n\n".join(STAMP_RE.sub(f"上次同步：{today}", b) for b in blocks)
    out = lines[: idx + 1] + ["", joined] + lines[idx + 1 :]
    return "\n".join(out).rstrip() + "\n"


def write_text(dst: Path, text: str) -> None:
    """先写 .tmp 再原子替换。

    WSL 9P 挂载点上覆盖已有文件常被拒（PermissionError），新建文件没问题，
    所以走「写新文件 + os.replace」；replace 也被拒时由调用方提示用 `cp` 兜底。
    """
    tmp = dst.with_name(dst.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, dst)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="权威版 README → 项目内派生版 README")
    p.add_argument("--from", dest="src", default=None, help="权威版 README 路径")
    p.add_argument("--to", dest="dst", default=str(DEFAULT_TO), help="派生版 README 路径")
    p.add_argument("--check", action="store_true", help="只检查差异，不写入")
    args = p.parse_args(argv)

    src = Path(args.src) if args.src else authoritative_default()
    dst = Path(args.dst)
    if not src.is_file():
        raise SystemExit(f"权威版不存在：{src}")
    if not dst.is_file():
        raise SystemExit(f"派生版不存在：{dst}（先建一个带 {OPEN} 块的文件）")

    auth = src.read_text(encoding="utf-8")
    blocks = extract_blocks(dst.read_text(encoding="utf-8"))
    result = render(auth, blocks, date.today().isoformat())

    if args.check:
        same = result == dst.read_text(encoding="utf-8")
        print(f"权威版：{src}")
        print(f"派生版：{dst}")
        print(f"项目块：{len(blocks)} 个")
        print("结果：一致，无需同步" if same else "结果：有差异，跑一次本脚本即可同步")
        return 0 if same else 1

    try:
        write_text(dst, result)
    except OSError as error:
        tmp = dst.with_name(dst.name + ".tmp")
        print(f"直接覆盖失败（{error}）。", file=sys.stderr)
        print(f"已写入临时文件：{tmp}", file=sys.stderr)
        print(f"请手动执行：cp '{tmp}' '{dst}'", file=sys.stderr)
        return 2
    print(f"已同步：{src} → {dst}（保留 {len(blocks)} 个项目块，上次同步 {date.today().isoformat()}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
