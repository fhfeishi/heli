"""本地资料管理：稳定章节树、分页目录、固定内容阅读；不依赖向量引擎。"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from contextlib import closing
from pathlib import PurePosixPath, Path

from . import schema2, pipeline2 as p
from .core import KbError, sha256_bytes, DEFAULT_KB_JSON
import uuid


def _connect(kb):
    return closing(schema2.connect2(kb.db_path))



@p.storage_operation
def adopt(kb):
    """登记已有 source/ 目录，不移动、不覆盖原文、解析或 target。"""
    if not kb.source_dir.is_dir():
        raise KbError('缺少 source 目录')
    if not kb.kb_json_path.exists():
        if kb.db_path.exists():
            raise KbError('已有数据库却缺少 kb.json，拒绝重新分配库身份')
        cfg = json.loads(json.dumps(DEFAULT_KB_JSON))
        cfg.update(id='kb_' + uuid.uuid4().hex, name=kb.root.name, description='', tags=[])
        kb.write_cfg(cfg)
    kb.datadb_dir.mkdir(exist_ok=True)
    return organize(kb)


def _register_parsed(kb, conn, rows):
    count = 0
    for sid, rel, sha, kind in rows:
        if kind != 'doc' or Path(rel).suffix.lower() != '.pdf':
            continue
        path = kb.parsed_dir / rel / 'markdown.md'
        if not path.exists():
            conn.execute('DELETE FROM readable_documents WHERE source_id=?', (sid,))
            continue
        if not path.resolve().is_relative_to(kb.parsed_dir.resolve()):
            raise KbError('解析文件指向库外')
        data = path.read_bytes()
        data.decode('utf-8')  # 不能把二进制或编码错误作为正文发布
        text_sha = sha256_bytes(data)
        previous = conn.execute('SELECT source_sha256,text_sha256 FROM readable_documents WHERE source_id=?', (sid,)).fetchone()
        if previous and previous[0] != sha and previous[1] == text_sha:
            continue  # 原始 PDF 已变而解析未变，不把旧解析冒充新版本
        snapshot = kb.parsed_dir / '.snapshots' / text_sha / 'document.md'
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        if snapshot.exists():
            if sha256_bytes(snapshot.read_bytes()) != text_sha:
                raise KbError('解析快照校验失败')
        else:
            snapshot.write_bytes(data)
        conn.execute('INSERT INTO readable_documents VALUES (?,?,?,?,?) ON CONFLICT(source_id) '
                     'DO UPDATE SET source_sha256=excluded.source_sha256,text_sha256=excluded.text_sha256,'
                     'snapshot_path=excluded.snapshot_path,parsed_path=excluded.parsed_path',
                     (sid, sha, text_sha, str(snapshot.relative_to(kb.root)), str(path.relative_to(kb.root))))
        count += 1
    conn.commit()
    return count


@p.storage_operation
def organize(kb):
    """扫描并冻结当前原文；仅首次从物理目录初始化人工章节，不覆盖人工组织。"""
    report = p.scan_sources(kb)
    if report['access_errors']:
        raise KbError(f"存在不可读原文：{report['access_errors'][:5]}")
    with _connect(kb) as conn:
        rows = conn.execute("SELECT source_id,path,last_seen_sha256,kind FROM sources WHERE online=1 ORDER BY path").fetchall()
        for sid, path, sha, kind in rows:
            data = (kb.source_dir / path).read_bytes()
            if sha256_bytes(data) != sha:
                raise KbError(f"扫描期间原文变化，请重试：{path}")
            p._snapshot(kb, data, sha)
        parsed_count = _register_parsed(kb, conn, rows)
        initialized = conn.execute("SELECT value FROM meta WHERE key='organization_initialized'").fetchone()
        if not initialized:
            section_ids = {}
            for sid, path, sha, kind in rows:
                if kind != 'doc':
                    continue
                parts = PurePosixPath(path).parts[:-1]
                parent = None
                for depth, title in enumerate(parts):
                    key = parts[:depth + 1]
                    if key not in section_ids:
                        section_ids[key] = p._uid('sec')
                        conn.execute("INSERT INTO sections(section_id,parent_id,title) VALUES (?,?,?)",
                                     (section_ids[key], parent, title))
                    parent = section_ids[key]
                if parent:
                    conn.execute("INSERT INTO section_documents(section_id,source_id) VALUES (?,?)", (parent,sid))
            conn.execute("INSERT INTO meta(key,value) VALUES ('organization_initialized','1')")
            conn.commit()
        return {**report, 'parsed_documents': parsed_count, 'sections': conn.execute('SELECT count(*) FROM sections').fetchone()[0],
                'placements': conn.execute('SELECT count(*) FROM section_documents').fetchone()[0],
                'indexed_documents': conn.execute('SELECT count(*) FROM sources WHERE active_version_id IS NOT NULL').fetchone()[0]}


@p.storage_operation
def edit_section(kb, title, section_id=None, parent_id="@keep", position=None):
    if not title.strip():
        raise KbError('章节名称不能为空')
    with _connect(kb) as conn:
        if section_id and not conn.execute('SELECT 1 FROM sections WHERE section_id=?',(section_id,)).fetchone():
            raise KbError('章节不存在')
        previous = conn.execute('SELECT parent_id,position FROM sections WHERE section_id=?',(section_id,)).fetchone()
        if parent_id == "@keep":
            parent_id = previous[0] if previous else None
        elif parent_id == "root":
            parent_id = None
        if position is None:
            position = previous[1] if previous else 0
        cursor = parent_id
        while cursor:
            if cursor == section_id:
                raise KbError('章节不能移动到自己或子章节下面')
            row = conn.execute('SELECT parent_id FROM sections WHERE section_id=?',(cursor,)).fetchone()
            if row is None:
                raise KbError('父章节不存在')
            cursor = row[0]
        section_id = section_id or p._uid('sec')
        conn.execute('INSERT INTO sections(section_id,parent_id,title,position) VALUES (?,?,?,?) '
                     'ON CONFLICT(section_id) DO UPDATE SET parent_id=excluded.parent_id,title=excluded.title,position=excluded.position',
                     (section_id,parent_id,title.strip(),position))
        conn.commit()
    return {'section_id':section_id, 'parent_id':parent_id, 'title':title.strip(), 'position':position}


@p.storage_operation
def place_document(kb, source_id, section_id, remove=False, position=0):
    with _connect(kb) as conn:
        if not conn.execute("SELECT 1 FROM sources WHERE source_id=? AND kind='doc'",(source_id,)).fetchone():
            raise KbError('正文来源不存在')
        if not conn.execute('SELECT 1 FROM sections WHERE section_id=?',(section_id,)).fetchone():
            raise KbError('章节不存在')
        if remove:
            conn.execute('DELETE FROM section_documents WHERE section_id=? AND source_id=?',(section_id,source_id))
        else:
            conn.execute('INSERT INTO section_documents(section_id,source_id,position) VALUES (?,?,?) '
                         'ON CONFLICT(section_id,source_id) DO UPDATE SET position=excluded.position',
                         (section_id,source_id,position))
        conn.commit()
    return {'source_id':source_id, 'section_id':section_id, 'removed':remove}


@p.storage_operation
def tree(kb):
    with _connect(kb) as conn:
        conn.row_factory = sqlite3.Row
        sections = [dict(r) for r in conn.execute('SELECT * FROM sections ORDER BY position,title,section_id')]
        placements = [dict(r) for r in conn.execute('SELECT * FROM section_documents ORDER BY section_id,position,source_id')]
        docs = [dict(r) for r in conn.execute("SELECT source_id,COALESCE(title,auto_title) title,path,online,last_seen_sha256,active_version_id,"
                                             "(SELECT sha256 FROM versions v WHERE v.version_id=s.active_version_id) indexed_sha256 "
                                             "FROM sources s WHERE kind='doc' ORDER BY path")]
    return {'format':1, 'kb_id':kb.cfg['id'], 'name':kb.cfg['name'],
            'sections':sections,'placements':placements,'documents':docs}


@p.storage_operation
def export_structure(kb):
    result = tree(kb)
    target = kb.root / 'structure.json'
    temp = target.with_suffix('.json.tmp')
    temp.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    os.replace(temp,target)
    return {'path':str(target),'sections':len(result['sections']), 'documents':len(result['documents'])}


@p.storage_operation
def list_documents(kb, section_id=None, text='', offset=0, limit=50):
    if offset < 0 or not 1 <= limit <= 200:
        raise KbError('offset 必须非负，limit 范围 1–200')
    with _connect(kb) as conn:
        conn.row_factory = sqlite3.Row
        where = "s.kind='doc' AND s.online=1"
        args = []
        if text:
            where += " AND (instr(lower(COALESCE(s.title,s.auto_title)),lower(?))>0 OR instr(lower(s.path),lower(?))>0)"
            args += [text,text]
        if section_id:
            if not conn.execute('SELECT 1 FROM sections WHERE section_id=?',(section_id,)).fetchone():
                raise KbError('章节不存在')
            where += (' AND s.source_id IN (WITH RECURSIVE subtree(id) AS '
                      '(SELECT section_id FROM sections WHERE section_id=? UNION ALL '
                      'SELECT c.section_id FROM sections c JOIN subtree t ON c.parent_id=t.id) '
                      'SELECT source_id FROM section_documents WHERE section_id IN (SELECT id FROM subtree))')
            args.append(section_id)
        total = conn.execute('SELECT count(*) FROM sources s WHERE '+where,args).fetchone()[0]
        rows = conn.execute('SELECT s.source_id,COALESCE(s.title,s.auto_title) title,s.path,s.active_version_id,s.last_seen_sha256, '
                            '(SELECT sha256 FROM versions v WHERE v.version_id=s.active_version_id) indexed_sha256 '
                            'FROM sources s WHERE '+where+' ORDER BY s.path,s.source_id LIMIT ? OFFSET ?',args+[limit,offset]).fetchall()
        return {'total':total,'offset':offset,'documents':[dict(r) for r in rows],
                'next_offset':offset+len(rows) if offset+len(rows)<total else None}


@p.storage_operation
def read_document(kb, source_id, offset=0, limit=12000, sha256=None):
    """读取整理时冻结的原文窗口；客户端续读传 sha256，变更后明确拒绝混页。"""
    if offset < 0 or not 1 <= limit <= 50000:
        raise KbError('offset 必须非负，limit 范围 1–50000 字符')
    row, text = _frozen_text(kb, source_id, sha256)
    if offset > len(text):
        raise KbError("阅读位置超过原文长度")
    end = min(offset+limit,len(text))
    return {'kb_id':kb.cfg['id'],'source_id':source_id,'sha256':row[2],
            'title':row[0],'url':row[1],'text':text[offset:end], 'char_start':offset,
            'char_end':end,'total_chars':len(text),'next_offset':end if end<len(text) else None}


def _frozen_text(kb, source_id, sha256=None):
    with _connect(kb) as conn:
        row = conn.execute("SELECT COALESCE(title,auto_title),url,last_seen_sha256,path FROM sources WHERE source_id=? AND online=1 AND kind='doc'", (source_id,)).fetchone()
        if not row:
            raise KbError('正文不存在或已下线')
        title, url, source_sha, rel = row
        if Path(rel).suffix.lower() == '.pdf':
            parsed = conn.execute('SELECT source_sha256,text_sha256,snapshot_path FROM readable_documents WHERE source_id=?', (source_id,)).fetchone()
            if not parsed or parsed[0] != source_sha:
                raise KbError('PDF 尚未登记可读解析正文，请补充 parsed/<原文件名>/markdown.md 后整理资料库')
            content_sha, snapshot = parsed[1], kb.root / parsed[2]
        elif Path(rel).suffix.lower() in ('.md', '.txt', '.markdown', '.mdx'):
            content_sha = source_sha
            snapshot = kb.source_dir / '.snapshots' / source_sha[:2] / source_sha
        else:
            raise KbError('该文件格式尚无可读解析正文')
    if sha256 and sha256 != content_sha:
        raise KbError('阅读正文已更新，请重新定位；不能将新旧版本拼接阅读')
    if not snapshot.resolve().is_relative_to(kb.root.resolve()) or not snapshot.is_file():
        raise KbError('当前正文尚未冻结，请先 v2-manage organize')
    data = snapshot.read_bytes()
    if sha256_bytes(data) != content_sha:
        raise KbError('正文快照校验失败')
    return (title, url, content_sha), data.decode('utf-8')


def _markdown_sections(text):
    """ATX 标题的完整子树范围；代码围栏里的伪标题不参与分节。"""
    headings = []
    fence_char = None
    fence_width = 0
    position = 0
    for line in text.splitlines(keepends=True):
        marker = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line.rstrip('\r\n'))
        if fence_char:
            if marker and marker[1][0] == fence_char and len(marker[1]) >= fence_width and not marker[2].strip():
                fence_char = None
        elif marker:
            fence_char, fence_width = marker[1][0], len(marker[1])
        else:
            heading = re.match(r'^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$', line.rstrip('\r\n'))
            if heading:
                title = re.sub(r'[ \t]+#+[ \t]*$', '', heading[2]).strip()
                headings.append((position, len(heading[1]), title or '未命名章节'))
        position += len(line)
    sections = []
    if not headings or text[:headings[0][0]].strip():
        sections.append({'title': '全文' if not headings else '开篇', 'level': 0,
                         'char_start': 0, 'char_end': headings[0][0] if headings else len(text)})
    for i, (start, level, title) in enumerate(headings):
        end = next((p for p, next_level, _ in headings[i+1:] if next_level <= level), len(text))
        sections.append({'title': title, 'level': level, 'char_start': start, 'char_end': end})
    for i, section in enumerate(sections):
        section['index'] = i
    return sections


@p.storage_operation
def document_outline(kb, source_id, sha256=None):
    row, text = _frozen_text(kb, source_id, sha256)
    with _connect(kb) as conn:
        source = conn.execute('SELECT path,last_seen_sha256 FROM sources WHERE source_id=?', (source_id,)).fetchone()
    return {'source_id': source_id, 'title': row[0], 'url': row[1], 'sha256': row[2],
            'content_kind': 'parsed' if Path(source[0]).suffix.lower() == '.pdf' else 'source',
            'source_sha256': source[1],
            'total_chars': len(text), 'sections': _markdown_sections(text)}


@p.storage_operation
def read_section(kb, source_id, section_index, sha256=None):
    row, text = _frozen_text(kb, source_id, sha256)
    sections = _markdown_sections(text)
    if section_index < 0 or section_index >= len(sections):
        raise KbError('章节不存在')
    section = sections[section_index]
    return {'source_id': source_id, 'title': row[0], 'url': row[1], 'sha256': row[2],
            'section': section, 'text': text[section['char_start']:section['char_end']]}


@p.storage_operation
def follow_links(kb, source_id, offset=0, limit=50):
    if offset < 0 or not 1 <= limit <= 200:
        raise KbError('offset 必须非负，limit 范围 1–200')
    with _connect(kb) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT l.dst_source_id source_id,l.anchor,COALESCE(s.title,s.auto_title) title,s.path '
                            'FROM links l JOIN sources s ON s.source_id=l.dst_source_id '
                            'WHERE l.src_source_id=? AND s.online=1 ORDER BY l.dst_source_id,l.anchor LIMIT ? OFFSET ?',
                            (source_id,limit+1,offset)).fetchall()
    return {'links':[dict(r) for r in rows[:limit]], 'next_offset':offset+limit if len(rows)>limit else None}


@p.storage_operation
def rename_library(kb, name):
    if not name.strip():
        raise KbError('知识库名称不能为空')
    cfg = dict(kb.cfg)
    cfg['name'] = name.strip()
    kb.write_cfg(cfg)
    return {'kb_id':cfg['id'],'name':cfg['name']}
