"""提取（source → target 转化）：方案持久化、不可变历史及乐观并发控制。

【本模块承担的任务】——对应每个子库 `kb.json` 的 `target_task` 字段。
两类 knowledge_type 里只有「科学研究与应用类技术验收报告，自然科学基金」这类库做转化，
因此只有这些库有 target 目录与 target_task 字段；「source code and documentation」类库
（如 langchain_docs）不做转化，没有 target 目录，也没有 target_task 字段。

任务原文（与 kb.json 的 target_task 一字不差）：

    按任务方案从原文提取技术应用要素（应用场景 / 问题 / 技术方法 / 成果指标 / 作者 / 时间），
    每篇一份结果写入 target/<结果 id>.json（外部文档 id，与内部 16 位 doc_id 不是一回事），保留原文证据 quote 与字符定位 locator；
    方案原件归档在资料库根 .datascripts/target-schema/<plan_id>.json，
    读写实现见后端 kbctl/extraction.py。

【落盘约定】

- 方案（plan）：资料库根 `.datascripts/target-schema/<plan_id>.json`，跨库共享；
  旧位置 `<kb>/target/<plan_id>/target-schema.json` 仍可读（兼容已存在的库内方案）。
- 结果（result）：`<kb>/target/<结果 id>.json`，平铺、不分子目录（**不重组**）。
  文件名是导入时的外部文档 id（基金库为 20 位十六进制），**不是**内部 16 位 `doc_id`；
  两者不要混用，与来源的关联只走 `source_hash`。
- 关联键：结果里的 `source_hash` 对应 `sources.last_seen_sha256`。
  注意结果的 `doc_id`（20 位十六进制）与 `sources.source_id`（src_ 前缀）不是一套标识，
  不要拿 doc_id 去 join sources。

【状态 stale】

结果的 `source_hash` 不在当前 `sources.last_seen_sha256` 集合里 = 原文变过，结果过期需重跑。
本模块 `result_detail()` 已逐条给出 `stale`；批量巡检见资料库脚本
`.datascripts/check-stale.py`（只读，不改数据）。

【已弃用】

资料库根 `_registry.json` 不再维护——它是磁盘的派生缓存
（`verify.sync_registry` 明确「磁盘为权威」），需要时用
`python -m kbctl --root <根> registry` 重建。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timezone

from .core import KbError
from .pipeline2 import storage_operation


def validate_schema(value):
    if not isinstance(value, dict) or set(value) != {'name', 'record_scope', 'instructions', 'fields'}:
        raise KbError('方案必须包含 name、record_scope、instructions、fields')
    for key in ('name', 'instructions'):
        if not isinstance(value[key], str) or not value[key].strip():
            raise KbError(f'{key} 不能为空')
    if value['record_scope'] not in ('document', 'segment', 'entity'):
        raise KbError('记录粒度必须为 document、segment 或 entity')
    fields = value['fields']
    if not isinstance(fields, list) or not 1 <= len(fields) <= 50:
        raise KbError('方案必须有 1–50 个字段')
    names = set()
    for field in fields:
        if not isinstance(field, dict) or set(field) != {'name', 'type', 'hint', 'required', 'missing'}:
            raise KbError('字段必须包含 name、type、hint、required、missing')
        for key in ('name', 'hint', 'missing'):
            if not isinstance(field[key], str) or (key != 'hint' and not field[key].strip()):
                raise KbError(f'字段 {key} 必须是有效文本')
        if field['name'].strip() in names:
            raise KbError('字段名不能重复')
        names.add(field['name'].strip())
        if field['type'] not in ('string', 'number', 'boolean', 'string[]'):
            raise KbError('字段类型必须为 string、number、boolean 或 string[]')
        if type(field['required']) is not bool:
            raise KbError('required 必须是布尔值')
    return value


def _base_root(kb):
    """资料库根：库根之上一层（<根>/<slug> → <根>）。方案归档在这里，跨库共享。"""
    return kb.root.parent


def _archive_dir(kb):
    return _base_root(kb) / '.datascripts' / 'target-schema'


def _path(kb, plan_id):
    """方案文件的落点。

    - 已存在：读原处。库内 `<kb>/target/<plan_id>/target-schema.json` 优先，
      否则是资料库根的共享归档 `.datascripts/target-schema/<plan_id>.json`
      （编辑共享方案时原地改，全部库一起生效，`history` 保留旧版本）。
    - 不存在（新建）：写在库内。库要保持自包含——整体拷贝/迁移/删除时方案跟着走。
    """
    if not isinstance(plan_id, str) or not re.fullmatch(r'[a-f0-9]{32}', plan_id):
        raise KbError('方案标识无效')
    in_kb = kb.root / 'target' / plan_id / 'target-schema.json'
    archived = _archive_dir(kb) / (plan_id + '.json')
    path = in_kb if (in_kb.is_file() or not archived.is_file()) else archived
    if not path.resolve().is_relative_to(_base_root(kb).resolve()):
        raise KbError('方案路径超出资料库')
    return path


@storage_operation
def list_plans(kb):
    """库内旧位置 + 资料库根归档，合并去重后返回（同一方案只出现一次）。"""
    base = _base_root(kb).resolve()
    candidates = sorted((kb.root / 'target').glob('*/target-schema.json'))
    candidates += sorted(p for p in _archive_dir(kb).glob('*.json') if not p.name.startswith('.'))
    plans, seen = [], set()
    for path in candidates:
        if not path.resolve().is_relative_to(base):
            continue
        try:
            value = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        key = value.get('id') or path.stem
        if key in seen:
            continue
        seen.add(key)
        plans.append(value)
    return {'plans': plans}


@storage_operation
def save_plan(kb, body):
    schema = validate_schema(body.get('schema'))
    plan_id = body.get('id') or uuid.uuid4().hex
    path = _path(kb, plan_id)
    old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    if body.get('id') and old is None:
        raise KbError('方案不存在，请重新加载')
    if old and body.get('base_version') != old['version']:
        raise KbError('方案已被其他窗口修改，请重新加载后保存')
    canonical = json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    version = hashlib.sha256(canonical.encode()).hexdigest()
    if old and old['version'] == version:
        return old
    history = old['history'] + [{k: old[k] for k in ('version', 'schema', 'saved_at')}] if old else []
    result = {'id': plan_id, 'version': version, 'schema': schema,
              'saved_at': datetime.now(timezone.utc).isoformat(), 'history': history}
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    return result


def _result_path(kb, result_id):
    if not isinstance(result_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', result_id):
        raise KbError('结果标识无效')
    path = kb.root / 'target' / (result_id + '.json')
    if not path.resolve().is_relative_to(kb.root.resolve()) or not path.is_file():
        raise KbError('提取结果不存在')
    return path


@storage_operation
def list_results(kb, text='', offset=0, limit=20):
    from . import management
    if offset < 0 or not 1 <= limit <= 100:
        raise KbError('结果分页参数无效')
    with management._connect(kb) as conn:
        sources = conn.execute("SELECT source_id,path,COALESCE(title,auto_title),last_seen_sha256 FROM sources WHERE online=1 AND kind='doc'").fetchall()
    by_hash = {}
    for sid, path, title, sha in sources:
        by_hash.setdefault(sha, []).append({'source_id': sid, 'path': path, 'title': title})
    rows, warnings = [], []
    for path in sorted((kb.root / 'target').glob('*.json')):
        if path.name.startswith('.'):
            continue  # 隐藏文件不是转化结果（例如读写探针 .probe_write.json）
        try:
            value = json.loads(_result_path(kb, path.stem).read_text(encoding='utf-8'))
            if not isinstance(value, dict) or not isinstance(value.get('facets'), list):
                warnings.append({'file': path.name, 'error': '不是 facets 提取结果，未作为结果导入'})
                continue
            matches = by_hash.get(value.get('source_hash'), [])
            if text and text.casefold() not in (json.dumps(value, ensure_ascii=False) + str(matches)).casefold():
                continue
            rows.append({'id': path.stem, 'doc_id': value.get('doc_id'), 'version': value.get('version'),
                         'generated_at': value.get('generated_at'), 'process': value.get('process'),
                         'sources': matches, 'association': 'matched' if matches else 'unmatched',
                         'facet_count': len(value['facets'])})
        except (KbError, ValueError, OSError) as error:
            warnings.append({'file': path.name, 'error': str(error)})
    return {'results': rows[offset:offset+limit], 'total': len(rows), 'offset': offset,
            'next_offset': offset+limit if offset+limit < len(rows) else None, 'warnings': warnings}


@storage_operation
def result_detail(kb, result_id):
    from . import management
    from .core import sha256_bytes
    value = json.loads(_result_path(kb, result_id).read_text(encoding='utf-8'))
    if not isinstance(value, dict) or not isinstance(value.get('facets'), list):
        raise KbError('文件不是 facets 提取结果')
    with management._connect(kb) as conn:
        rows = conn.execute("SELECT source_id,path,COALESCE(title,auto_title) FROM sources WHERE last_seen_sha256=? AND online=1 AND kind='doc'", (value.get('source_hash'),)).fetchall()
    sources = []
    for sid, rel, title in rows:
        path = kb.source_dir / rel
        valid = path.resolve().is_relative_to(kb.source_dir.resolve()) and path.is_file()
        current = sha256_bytes(path.read_bytes()) if valid else None
        sources.append({'source_id': sid, 'title': title, 'path': rel,
                        'stale': current != value.get('source_hash')})
    return {'id': result_id, 'result': value, 'sources': sources,
            'association': 'matched' if sources else 'unmatched'}


@storage_operation
def evidence(kb, result_id, facet_index, item_index, evidence_index, source_id):
    from . import management
    detail = result_detail(kb, result_id)
    source = next((item for item in detail['sources'] if item['source_id'] == source_id), None)
    if not source:
        raise KbError('结果与该来源没有可验证的哈希关联')
    if source['stale']:
        raise KbError('原文已变化，提取结果待更新')
    if min(facet_index, item_index, evidence_index) < 0:
        raise KbError('证据位置无效')
    try:
        item = detail['result']['facets'][facet_index]['items'][item_index]['evidence'][evidence_index]
    except (KeyError, IndexError, TypeError):
        raise KbError('证据不存在')
    if item.get('version') and item['version'] != detail['result'].get('version'):
        raise KbError('证据版本与提取结果不一致，无法核验')
    quote = item.get('quote')
    if not isinstance(quote, str) or not quote:
        raise KbError('证据未提供可核对的摘录')
    row, body = management._frozen_text(kb, source_id)
    start = body.find(quote)
    common = {'source_id': source_id, 'sha256': row[2], 'quote': quote,
              'locator': item.get('locator'), 'target_version': detail['result'].get('version')}
    if start < 0:
        return {**common, 'verified': False, 'reason': '当前阅读正文没有逐字匹配的摘录；仅保留导入的页码或分片标识，未认定为已核验证据'}
    if body.find(quote, start+1) >= 0:
        return {**common, 'verified': False, 'reason': '摘录在正文出现多次，无法唯一定位；请核对导入页码'}
    sections = management._markdown_sections(body)
    section = next((s for s in reversed(sections) if s['char_start'] <= start < s['char_end']), sections[0])
    return {**common, 'verified': True, 'char_start': start, 'char_end': start+len(quote),
            'section_index': section['index'], 'text': body[max(0,start-150):start+len(quote)+150]}


@storage_operation
def content_status(kb):
    from . import management
    from pathlib import Path
    with management._connect(kb) as conn:
        rows = conn.execute("SELECT source_id,path,last_seen_sha256 FROM sources WHERE online=1 AND kind='doc'").fetchall()
        parsed = conn.execute('SELECT count(*) FROM readable_documents r JOIN sources s ON r.source_id=s.source_id WHERE s.online=1 AND r.source_sha256=s.last_seen_sha256').fetchone()[0]
    results = list_results(kb, limit=100)
    unmatched = sum(not item['sources'] for item in results['results'])
    for offset in range(100, results['total'], 100):
        unmatched += sum(not item['sources'] for item in list_results(kb, offset=offset, limit=100)['results'])
    return {'sources': len(rows), 'pdf_sources': sum(Path(row[1]).suffix.lower() == '.pdf' for row in rows),
            'parsed_documents': parsed, 'imported_results': results['total'],
            'unmatched_results': unmatched, 'warnings': results['warnings']}


@storage_operation
def refresh_library(kb):
    from . import management, search
    return {'organization': management.organize(kb), 'index': search.build_index(kb),
            'content': content_status(kb)}
