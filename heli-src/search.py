"""search：把一句自然语言需求翻成结构化检索条件。

存在的理由
----------
用户在资料库里说的是「找 2020–2025 年医学方向的研究总结」，
而检索需要的是「年份区间 + 关键词」。这层翻译如果塞进检索函数，
retrieval 就要依赖模型；如果塞进前端，前端就得懂业务。放在这里，
两边都干净。

**模型只负责翻译，不负责检索。** 它产出的是 {keywords, year_from, year_to}，
实际命中由 retrieval.search 决定。这样模型出错时最坏是「检索词选得不好」，
不会编造出资料里没有的内容——后者才是这类系统真正危险的地方。

未配置模型时退化为纯规则解析：能从「2020-2025 年」里取出年份，
其余文字原样当关键词。不假装做了语义理解。
"""
from __future__ import annotations

import json
import re

import config, llm
from errors import Invalid

# 「2020-2025 年」「2020 到 2025」「2020 年至今」这类表达
_RANGE = re.compile(r"((?:19|20)\d{2})\s*(?:-|–|—|~|到|至|至\s*今)\s*((?:19|20)\d{2})?")
_SINGLE = re.compile(r"((?:19|20)\d{2})\s*年")

_SYSTEM = """你是资料库的检索条件解析器。把用户的一句话需求拆成检索条件。

只输出 JSON 对象，字段：
- "keywords": 字符串数组，2–5 个检索词。挑真正能区分内容的名词（领域、方法、对象），
  不要放「资料」「总结」「找」「帮我」这类没有区分度的词，不要放年份。
- "year_from": 整数或 null，资料覆盖期的最早年份
- "year_to": 整数或 null，资料覆盖期的最晚年份

规则：
- 用户没说年份就都填 null，不要猜。
- 用户说「2020 到 2025 年」→ year_from 2020、year_to 2025。
- 用户说「2023 年以后的」→ year_from 2023、year_to null。
- 用户只说「2024 年」→ year_from 2024、year_to 2024。
- keywords 里不要出现年份数字。
"""


def parse(store, query: str) -> dict:
    """把一句话拆成 {keywords, year_from, year_to, source}。

    source 说明这份解析是模型给的还是规则给的，前端要如实显示——
    「规则解析」意味着可能没理解你的意思，用户有权知道。
    """
    text = str(query or "").strip()
    if not text:
        raise Invalid("检索需求不能为空")

    cfg = config.llm_config()
    if not cfg.available:
        return _rule_parse(text, "rule")

    try:
        result = llm.chat(
            [{"role": "system", "content": _SYSTEM},
             {"role": "user", "content": text}],
            cfg=cfg, temperature=0, max_tokens=400, json_mode=True,
        )
        data = json.loads(result.text)
        keywords = [str(item).strip() for item in (data.get("keywords") or []) if str(item).strip()]
        # 模型有时会把年份塞进关键词，清掉——年份走结构化字段，不走全文匹配
        keywords = [word for word in keywords if not _SINGLE.fullmatch(word)]
        if not keywords:
            return _rule_parse(text, "rule")
        return {
            "keywords": keywords[:5],
            "year_from": _int_or_none(data.get("year_from")),
            "year_to": _int_or_none(data.get("year_to")),
            "source": "model",
        }
    except Exception:
        # 模型不可用、超时、返回非法 JSON：退回规则解析，不把失败抛给用户。
        # 检索是高频操作，不该因为模型抖动就用不了。
        return _rule_parse(text, "rule")


def _int_or_none(value) -> int | None:
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return year if 1900 <= year <= 2100 else None


def _rule_parse(text: str, source: str) -> dict:
    """无模型时的退路：正则取年份，剩下的文字当关键词。

    不切词、不做同义扩展——那些是模型的活。这里只保证「能检索」。
    """
    year_from = year_to = None
    match = _RANGE.search(text)
    if match:
        year_from = int(match.group(1))
        year_to = int(match.group(2)) if match.group(2) else None
    else:
        single = _SINGLE.search(text)
        if single:
            year = int(single.group(1))
            # 「2023 年以后」是开区间；只有「2023 年」这种孤立年份才是闭区间
            if re.search(r"以后|之后|以来|起", text):
                year_from, year_to = year, None
            elif re.search(r"以前|之前|之前|早期", text):
                year_from, year_to = None, year
            else:
                year_from = year_to = year

    # 去掉年份表达与常见虚词，剩下的就是关键词
    rest = _RANGE.sub(" ", text)
    rest = _SINGLE.sub(" ", rest)
    for word in ("资料", "文档", "总结", "研究", "帮我", "找一下", "找", "查", "看",
                 "相关的", "方面的", "的", "年", "之间", "期间",
                 "以后", "之后", "以来", "以前", "之前", "早期"):
        rest = rest.replace(word, " ")
    keywords = [part for part in re.split(r"[\s，。、,.!?；;：:]+", rest) if len(part) >= 2]
    return {"keywords": keywords[:5], "year_from": year_from, "year_to": year_to, "source": source}
