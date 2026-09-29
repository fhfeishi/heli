"""只监听本机的资料库管理 API；复用 CLI 的同一存储操作和锁。"""
from __future__ import annotations

import argparse
import json
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import management, search, extraction
from .core import Kb, KbError


@dataclass
class SourceFile:
    path: Path


# 只覆盖静态站点需要的少量类型，未列出的按二进制流返回
MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
}


def handler_for(root: Path, web: Path | None = None):
    root = root.resolve()
    web = web.resolve() if web is not None else None
    operation_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def _kb(self, slug):
            path = (root / slug).resolve()
            if path.parent != root or path.name != slug or not (path / 'kb.json').is_file():
                raise KbError('资料库不存在')
            return Kb(path)

        def _send_file(self, path: Path):
            data = path.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', MIME_TYPES.get(path.suffix.lower(), 'application/octet-stream'))
            self.send_header('Content-Length', str(len(data)))
            # 带 hash 的构建产物用长缓存，入口页不缓存，避免发版后拿到旧 HTML
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable'
                             if path.name != 'index.html' else 'no-cache')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def _static(self, request):
            rel = unquote(request.path).split('?', 1)[0].strip('/')
            # 空路径取入口页，其余按相对路径定位并拒绝越界
            target = (web / rel) if rel else web
            target = target.resolve()
            if target != web and not target.is_relative_to(web):
                raise KbError('路径越界')
            if rel and target.is_file():
                self._send_file(target)
                return
            index = web / 'index.html'
            if not index.is_file():
                raise KbError('前端构建产物不完整（缺少 index.html），请先构建 heli-web')
            self._send_file(index)

        def _route(self, method):
            request = urlsplit(self.path)
            parts = [unquote(part) for part in request.path.strip('/').split('/')]
            args = parse_qs(request.query)
            if parts == ['api', 'libraries'] and method == 'GET':
                libraries = []
                for path in sorted(root.iterdir()):
                    if path.is_dir() and path.resolve().parent == root and (path / 'kb.json').is_file():
                        kb = Kb(path)
                        libraries.append({'slug': path.name, 'id': kb.cfg['id'], 'name': kb.cfg['name']})
                return {'libraries': libraries}
            if len(parts) < 3 or parts[:2] != ['api', 'libraries']:
                raise KbError('接口不存在')
            kb = self._kb(parts[2])
            tail = parts[3:]
            value = lambda key, default=None: args.get(key, [default])[0]
            if method == 'GET':
                if tail == ['extraction-plans']:
                    return extraction.list_plans(kb)
                if tail == ['extraction-results']:
                    return extraction.list_results(kb, value('q', ''), int(value('offset', '0')), int(value('limit', '20')))
                if len(tail) == 2 and tail[0] == 'extraction-results':
                    return extraction.result_detail(kb, tail[1])
                if len(tail) == 3 and tail[0] == 'extraction-results' and tail[2] == 'evidence':
                    return extraction.evidence(kb, tail[1], int(value('facet', '-1')), int(value('item', '-1')),
                                               int(value('evidence', '-1')), value('source_id'))
                if tail == ['tree']:
                    return management.tree(kb)
                if tail == ['search']:
                    return search.search(kb, value('q', ''), value('section'),
                                         int(value('limit', '20')), int(value('offset', '0')))
                if tail == ['content-status']:
                    return extraction.content_status(kb)
                if tail == ['search-status']:
                    return search.status(kb)
                if tail == ['documents']:
                    return management.list_documents(kb, value('section'), value('text', ''),
                                                     int(value('offset', '0')), int(value('limit', '50')))
                if len(tail) >= 3 and tail[0] == 'documents':
                    source_id = tail[1]
                    if tail[2:] == ['original']:
                        with management._connect(kb) as conn:
                            row = conn.execute('SELECT path FROM sources WHERE source_id=? AND online=1', (source_id,)).fetchone()
                        path = kb.source_dir / row[0] if row else None
                        if not path or not path.is_file() or not path.resolve().is_relative_to(kb.source_dir.resolve()):
                            raise KbError('原始文件不存在')
                        return SourceFile(path)
                    if tail[2:] == ['outline']:
                        return management.document_outline(kb, source_id, value('sha256'))
                    if len(tail) == 4 and tail[2] == 'sections':
                        return management.read_section(kb, source_id, int(tail[3]), value('sha256'))
                    if tail[2:] == ['links']:
                        return management.follow_links(kb, source_id)
            if method == 'POST':
                if self.headers.get_content_type() != 'application/json':
                    raise KbError('写入请求必须使用 application/json')
                origin = self.headers.get('Origin')
                allowed_origins = {f'http://{host}:{port}' for host in ('localhost', '127.0.0.1')
                                   for port in (5173, self.server.server_port)}
                if origin and origin not in allowed_origins:
                    raise KbError('不接受来自其他网站的写入请求')
                length = int(self.headers.get('Content-Length', '0'))
                if length < 1 or length > 65536:
                    raise KbError('请求内容长度无效')
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise KbError('请求内容必须是对象')
                if tail == ['refresh']:
                    return extraction.refresh_library(kb)
                if tail == ['extraction-plans']:
                    return extraction.save_plan(kb, body)
                for key in ('name', 'title', 'source_id', 'section_id', 'parent_id'):
                    if key in body and body[key] is not None and not isinstance(body[key], str):
                        raise KbError(f'{key} 必须是文本')
                if 'remove' in body and not isinstance(body['remove'], bool):
                    raise KbError('remove 必须是布尔值')
                if body.get('position') is not None and type(body['position']) is not int:
                    raise KbError('position 必须是整数')
                if tail == ['name']:
                    if not isinstance(body.get('name'), str):
                        raise KbError('名称不能为空')
                    return management.rename_library(kb, body['name'])
                if tail == ['sections']:
                    if not isinstance(body.get('title'), str):
                        raise KbError('章节名称不能为空')
                    return management.edit_section(kb, body['title'], body.get('section_id'),
                                                   body.get('parent_id', '@keep'), body.get('position'))
                if tail == ['placements']:
                    return management.place_document(kb, str(body['source_id']), str(body['section_id']),
                                                     bool(body.get('remove', False)), int(body.get('position', 0)))
            raise KbError('接口不存在')

        def do_GET(self):
            self._handle('GET')

        def do_POST(self):
            self._handle('POST')

        def _handle(self, method):
            try:
                if urlsplit('http://' + self.headers.get('Host', '')).hostname not in ('localhost', '127.0.0.1'):
                    raise KbError('只接受本机地址访问')
                request = urlsplit(self.path)
                if web is not None and not request.path.startswith('/api'):
                    if method != 'GET':
                        raise KbError('页面只接受读取请求')
                    self._static(request)
                    return
                with operation_lock:
                    result = self._route(method)
                if isinstance(result, SourceFile):
                    data = result.path.read_bytes()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/pdf' if result.path.suffix.lower() == '.pdf' else 'text/plain; charset=utf-8')
                    self.send_header('Content-Length', str(len(data)))
                    self.send_header('X-Content-Type-Options', 'nosniff')
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    self._send(200, result)
            except (KbError, ValueError, KeyError, json.JSONDecodeError) as error:
                self._send(400, {'error': str(error)})
            except Exception:
                self.log_exception()
                self._send(500, {'error': '服务器内部错误'})

        def log_exception(self):
            import traceback
            traceback.print_exc()

    return Handler


def main(argv=None):
    from .config import get_settings
    parser = argparse.ArgumentParser(description='本地资料库 API')
    parser.add_argument('--root', default=str(get_settings().knowledge_root),
                        help='资料库根目录；缺省取自环境变量或项目根 .env 的 KNOWLEDGE_ROOT')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--web', default=None,
                        help='前端构建产物目录；给定时该目录下非 /api 的请求由本服务直接返回页面（SPA 回退 index.html）')
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    if not root.is_dir():
        parser.error(f'资料库根目录不存在：{root}')
    web = Path(args.web).resolve() if args.web else None
    if web is not None and not web.is_dir():
        parser.error(f'前端构建产物目录不存在：{web}')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(root, web))
    print(f'资料库 API：http://127.0.0.1:{args.port}，目录：{root}', flush=True)
    if web is not None:
        print(f'静态页面：http://127.0.0.1:{args.port}/ ← {web}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
