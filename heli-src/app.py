"""应用装配与 HTTP 服务。

一个进程：API + 前端静态产物（可选）。`--web` 指向前端 dist 时，非 /api 请求走页面与 SPA 回退。
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import tasks
from routes import Request, Response, dispatch, error_response
from config import Settings
from errors import HeliError
from storage import Store

MAX_BODY = 64 * 1024 * 1024  # 单文件上限；导入走原始字节

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}


def build_handler(store: Store, web: Path | None = None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "heli/0.2"

        def do_GET(self):
            self._handle("GET")

        def do_POST(self):
            self._handle("POST")

        def do_PATCH(self):
            self._handle("PATCH")

        def do_PUT(self):
            self._handle("PUT")

        def do_DELETE(self):
            self._handle("DELETE")

        def _handle(self, method: str) -> None:
            try:
                parts = urlsplit(self.path)
                host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
                if host not in ("localhost", "127.0.0.1", ""):
                    raise HeliError("只接受本机地址访问")

                if web is not None and not parts.path.startswith("/api"):
                    if method != "GET":
                        raise HeliError("页面只接受读取请求")
                    self._static(parts.path)
                    return

                length = int(self.headers.get("Content-Length") or 0)
                if length > MAX_BODY:
                    raise HeliError("请求体过大")
                body = self.rfile.read(length) if length else b""
                request = Request(method=method, path=unquote(parts.path.rstrip("/") or "/"),
                                  query={key: value[-1] for key, value in parse_qs(parts.query).items()},
                                  body=body, headers={key.lower(): value for key, value in self.headers.items()})
                self._send(dispatch(store, request))
            except HeliError as error:
                self._send(error_response(error))
            except BrokenPipeError:
                pass
            except Exception:
                traceback.print_exc()
                self._send(Response(status=500, payload={"error": "服务器内部错误", "code": "internal"}))

        def _static(self, path: str) -> None:
            rel = unquote(path).lstrip("/")
            root = web.resolve() if web else None
            target = (root / rel).resolve() if rel else root
            if root is None or (target != root and not target.is_relative_to(root)) or not target.is_file():
                target = root / "index.html" if root else None
            if target is None or not target.is_file():
                raise HeliError("前端构建产物不完整（缺少 index.html），先构建 heli-web")
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", STATIC_TYPES.get(target.suffix.lower(),
                                                               mimetypes.guess_type(target.name)[0] or "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache" if target.name == "index.html"
                             else "public, max-age=31536000, immutable")
            self.end_headers()
            self.wfile.write(data)

        def _send(self, response: Response) -> None:
            data = response.body if response.body is not None else json.dumps(
                response.payload, ensure_ascii=False).encode("utf-8")
            self.send_response(response.status)
            self.send_header("Content-Type", response.content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            for key, value in response.headers.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, fmt, *args):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    return Handler


def create_app(data_root: Path | str, port: int = 0, web: Path | str | None = None) -> tuple[ThreadingHTTPServer, Store]:
    store = Store(Path(data_root))
    store.init()
    tasks.recover(store)
    server = ThreadingHTTPServer(("127.0.0.1", port), build_handler(store, Path(web) if web else None))
    return server, store


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="heli", description="heli 资料管理与研究 Agent")
    parser.add_argument("--data", default=None, help="数据根目录；缺省取 HELI_DATA 或 <项目根>/heli-data")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--web", default=None, help="前端构建产物目录；给定时同时提供页面")
    args = parser.parse_args(argv)

    settings = Settings.load(args.data, args.port)
    settings.data_root.mkdir(parents=True, exist_ok=True)
    store = Store(settings.data_root)
    store.init()
    recovered = tasks.recover(store)
    web = Path(args.web).resolve() if args.web else None
    server = ThreadingHTTPServer(("127.0.0.1", settings.port), build_handler(store, web))
    print(f"heli 数据根：{settings.data_root}", flush=True)
    print(f"API：http://127.0.0.1:{settings.port}/api　模型通道：{settings.model_channel}", flush=True)
    if web is not None:
        print(f"页面：http://127.0.0.1:{settings.port}/ ← {web}", flush=True)
    if recovered["interrupted"]:
        print(f"已把 {recovered['interrupted']} 个未完成运行标为中断", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
