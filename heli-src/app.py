"""应用装配与 HTTP 服务。

一个进程：API + 前端静态产物（可选）。`--web` 指向前端 dist 时，非 /api 请求走页面与 SPA 回退。
"""
from __future__ import annotations

import argparse
import errno
import json
import mimetypes
import os
import signal
import sys
import threading
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


PID_FILE = Path(__file__).resolve().parent.parent / ".heli-server.pid"

# 绑定失败时的重试次数（端口被占、落在 Windows 保留段都可能失败）
PORT_TRIES = 20


def _write_pid(path: Path = PID_FILE) -> None:
    try:
        path.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        pass  # PID 文件只是给停止脚本用的便利，写不进去不该阻止启动


def _remove_pid(path: Path = PID_FILE) -> None:
    try:
        if path.exists() and path.read_text(encoding="utf-8").strip() == str(os.getpid()):
            path.unlink()
    except OSError:
        pass


def _bind(store: Store, web: Path | None, port: int, auto: bool):
    """绑端口。显式 --port 时不擅自换端口（尊重明确意图，失败就说明原因）；
    缺省端口则从它开始向上找第一个能用的，避免「端口被占用」挡住启动。"""
    candidates = [port] if not auto else [port + offset for offset in range(PORT_TRIES)]
    refused = []
    for candidate in candidates:
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), build_handler(store, web))
            return server, candidate, refused
        except OSError as error:
            if error.errno not in (errno.EADDRINUSE, errno.EACCES, getattr(errno, "WSAEACCES", 10013)):
                raise
            refused.append(candidate)
    detail = "、".join(str(item) for item in refused[:6])
    raise SystemExit(
        f"端口 {port} 起连续 {PORT_TRIES} 个都不可用（{detail}…）。\n"
        f"多半是 Windows 保留了这一段：netsh interface ipv4 show excludedportrange protocol=tcp\n"
        f"显式换一个：--port 18765")


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
    server, port, refused = _bind(store, web, settings.port, auto=args.port is None)
    if refused:
        print(f"端口 {refused[0]} 不可用，已改用 {port}", flush=True)
    print(f"heli 数据根：{settings.data_root}", flush=True)
    print(f"API：http://127.0.0.1:{port}/api　模型通道：{settings.model_channel}", flush=True)
    if web is not None:
        print(f"页面：http://127.0.0.1:{port}/ ← {web}", flush=True)
    if recovered["interrupted"]:
        print(f"已把 {recovered['interrupted']} 个未完成运行标为中断", flush=True)

    _write_pid()

    def stop(_signum, _frame):
        # 在别的线程里 shutdown：serve_forever 自己在信号线程里停不掉
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        # 不等运行中的任务：Ctrl+C 要当场返回，否则进程卡住、端口继续被占
        tasks.shutdown(wait=False)
        _remove_pid()
        print("已停止", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
