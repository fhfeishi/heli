"""sources_meta：从文件名与正文里推导资料元数据。

为什么不建表
------------
元数据（年份区间、批准号、负责人、项目名）全都能从**已有数据**推出来：
文件名带 `2021_2024_编号_姓名_标题`，正文开头有 frontmatter。
建一张表就要维护同步：导入时写、重命名时改、解析后更新，三处都可能漏，
漏了就出现「表里写着 2021，文件名是 2023」这种自相矛盾。

所以这里只做**推导**，不存。代价是每次要多算一遍——但这批资料只有几千份、
解析是纯字符串操作，比维护一致性便宜得多。真到了算不动的规模，再考虑
物化到 `sources` 表的额外列（那是一次可测的性能优化，不是设计前提）。

前后端各有一份实现（这里与 `heli-web/src/model/sourceMeta.ts`）。
两边必须给出同样的结果，否则界面显示的项目名和检索匹配到的对不上。
改规则时两处一起改。
"""
from __future__ import annotations

import re

# 文件名：`<起>_<止>_<编号>_<负责人>_<项目名>`。
# 前两段是四位年份时才按这套命名解释，否则一律当普通文件名。
_YEAR_SPAN = re.compile(r"^((?:19|20)\d{2})_((?:19|20)\d{2})_")
_GRANT_NO = re.compile(r"^[0-9A-Z]{6,}$", re.IGNORECASE)


def parse_name(path: str) -> dict:
    """从资料路径拆出 {title, years, year_from, year_to, grant_no, owner}。

    拆不出来时 title 回退成去掉扩展名的文件名，其余字段为 None——
    不猜、不改写。
    """
    base = str(path or "").split("/")[-1]
    stem = re.sub(r"\.[^.]+$", "", base)
    fallback = {"title": stem, "years": None, "year_from": None, "year_to": None,
                "grant_no": None, "owner": None}

    match = _YEAR_SPAN.match(stem)
    if not match:
        return fallback
    year_from, year_to = int(match.group(1)), int(match.group(2))
    parts = [part for part in stem[match.end():].split("_") if part]
    if not parts:
        return fallback

    grant_no = parts[0] if _GRANT_NO.match(parts[0]) else None
    tail = parts[1:] if grant_no else parts
    owner = tail[0] if len(tail) > 1 else None
    title = "_".join(tail[1:] if len(tail) > 1 else tail) or fallback["title"]

    return {"title": title, "years": f"{year_from}–{year_to}",
            "year_from": year_from, "year_to": year_to,
            "grant_no": grant_no, "owner": owner}


def year_span(path: str) -> tuple[int, int] | None:
    """只要年份区间。给需要按年份过滤的地方用（retrieval / catalog）。"""
    match = _YEAR_SPAN.match(str(path or "").split("/")[-1])
    return (int(match.group(1)), int(match.group(2))) if match else None


def split_frontmatter(text: str) -> dict:
    """拆正文开头的扁平 YAML frontmatter。

    只处理「`---` 开头、遇到下一个 `---` 结束、中间每行是 `key: value`」。
    出现嵌套或列表就整体放弃，把 frontmatter 当正文——宁可多显示几行，
    也不错误地吃掉内容。
    """
    if not text.startswith("---\n"):
        return {"fields": {}, "body": text}
    end = text.find("\n---", 3)
    if end < 0:
        return {"fields": {}, "body": text}

    fields: dict[str, str] = {}
    for line in text[4:end].split("\n"):
        match = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", line.strip())
        if not match:
            return {"fields": {}, "body": text}
        value = match.group(2).strip()
        if value:
            fields[match.group(1)] = value
    if not fields:
        return {"fields": {}, "body": text}
    return {"fields": fields, "body": text[end + 4:].lstrip("\n")}
