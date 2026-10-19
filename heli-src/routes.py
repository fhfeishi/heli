"""routes：请求解析、参数校验、响应形状。业务逻辑不在这里。"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Callable

import artifacts, catalog, content, retrieval, tasks
from errors import HeliError, Invalid, NotFound
from models import Scope
from storage import Store, SCHEMA_VERSION


@dataclass
class Response:
    status: int = 200
    payload: dict | list | None = None
    body: bytes | None = None
    content_type: str = "application/json; charset=utf-8"
    headers: dict = field(default_factory=dict)


@dataclass
class Request:
    method: str
    path: str
    query: dict
    body: bytes
    headers: dict

    def json(self) -> dict:
        if not self.body:
            return {}
        try:
            data = json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise Invalid(f"请求体不是合法 JSON：{error}") from error
        if not isinstance(data, dict):
            raise Invalid("请求体必须是 JSON 对象")
        return data


Handler = Callable[[Store, Request, dict], Response]

ROUTES: list[tuple[str, re.Pattern, Handler]] = []


def route(method: str, pattern: str):
    compiled = re.compile("^" + pattern + "$")
    def register(fn: Handler) -> Handler:
        ROUTES.append((method, compiled, fn))
        return fn
    return register


def dispatch(store: Store, request: Request) -> Response:
    for method, pattern, handler in ROUTES:
        if method != request.method:
            continue
        match = pattern.match(request.path)
        if match:
            return handler(store, request, match.groupdict())
    raise NotFound(f"接口不存在：{request.method} {request.path}")


# ---------------------------------------------------------------- 元信息


@route("GET", r"/api/health")
def health(store: Store, request: Request, params: dict) -> Response:
    return Response(payload={"ok": True, "schema_version": SCHEMA_VERSION,
                             "data_root": str(store.root), "model_channel": "none"})


@route("GET", r"/")
def index(store: Store, request: Request, params: dict) -> Response:
    return Response(payload={"name": "heli", "api": "/api",
                             "docs": "见 .logsdev/library-platform-top-level-design.md"})


# ---------------------------------------------------------------- 资料库


@route("GET", r"/api/libraries")
def libraries_list(store: Store, request: Request, params: dict) -> Response:
    include = request.query.get("include_archived") in ("1", "true")
    return Response(payload={"libraries": catalog.list_libraries(store, include_archived=include)})


@route("POST", r"/api/libraries")
def libraries_create(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    return Response(status=201, payload=catalog.create_library(store, body.get("name"),
                                                               body.get("description", "")))


@route("GET", r"/api/libraries/(?P<lib>[^/]+)")
def libraries_get(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=catalog.get_library(store, params["lib"]))


@route("PATCH", r"/api/libraries/(?P<lib>[^/]+)")
def libraries_update(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    changes = {}
    if "name" in body:
        changes["name"] = body["name"]
    if "description" in body:
        changes["description"] = body["description"]
    if not changes:
        raise Invalid("没有可更新的字段")
    return Response(payload=catalog.update_library(store, params["lib"], **changes))


@route("DELETE", r"/api/libraries/(?P<lib>[^/]+)")
def libraries_archive(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=catalog.archive_library(store, params["lib"], True))


@route("POST", r"/api/libraries/(?P<lib>[^/]+)/restore")
def libraries_restore(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=catalog.archive_library(store, params["lib"], False))


@route("GET", r"/api/libraries/(?P<lib>[^/]+)/background")
def library_background(store: Store, request: Request, params: dict) -> Response:
    catalog.get_library(store, params["lib"], include_archived=True)
    return Response(payload=catalog.get_background(store, "library", params["lib"]))


@route("PUT", r"/api/libraries/(?P<lib>[^/]+)/background")
def library_background_set(store: Store, request: Request, params: dict) -> Response:
    catalog.get_library(store, params["lib"], include_archived=True)
    return Response(payload=catalog.set_background(store, "library", params["lib"],
                                                   request.json().get("text", "")))


# ---------------------------------------------------------------- 组


@route("GET", r"/api/groups")
def groups_list(store: Store, request: Request, params: dict) -> Response:
    return Response(payload={"groups": catalog.list_groups(store)})


@route("POST", r"/api/groups")
def groups_create(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    return Response(status=201, payload=catalog.create_group(
        store, body.get("name"), body.get("parent_id"), body.get("hue", "neutral")))


@route("GET", r"/api/groups/(?P<group>[^/]+)")
def groups_get(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=catalog.get_group(store, params["group"]))


@route("PATCH", r"/api/groups/(?P<group>[^/]+)")
def groups_update(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    changes = {key: body[key] for key in ("name", "parent_id", "hue") if key in body}
    if not changes:
        raise Invalid("没有可更新的字段")
    return Response(payload=catalog.update_group(store, params["group"], **changes))


@route("DELETE", r"/api/groups/(?P<group>[^/]+)")
def groups_delete(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=catalog.delete_group(store, params["group"]))


@route("PUT", r"/api/groups/(?P<group>[^/]+)/members")
def groups_members_set(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    return Response(payload=catalog.set_group_members(store, params["group"],
                                                      body.get("library_ids", [])))


@route("POST", r"/api/groups/(?P<group>[^/]+)/members")
def groups_members_add(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    return Response(payload=catalog.add_member(store, params["group"], str(body.get("library_id"))))


@route("DELETE", r"/api/groups/(?P<group>[^/]+)/members/(?P<lib>[^/]+)")
def groups_members_remove(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=catalog.remove_member(store, params["group"], params["lib"]))


@route("GET", r"/api/groups/(?P<group>[^/]+)/background")
def group_background(store: Store, request: Request, params: dict) -> Response:
    catalog.get_group(store, params["group"])
    return Response(payload=catalog.get_background(store, "group", params["group"]))


@route("PUT", r"/api/groups/(?P<group>[^/]+)/background")
def group_background_set(store: Store, request: Request, params: dict) -> Response:
    catalog.get_group(store, params["group"])
    return Response(payload=catalog.set_background(store, "group", params["group"],
                                                   request.json().get("text", "")))


# ---------------------------------------------------------------- 资料


@route("GET", r"/api/libraries/(?P<lib>[^/]+)/sources")
def sources_list(store: Store, request: Request, params: dict) -> Response:
    catalog.get_library(store, params["lib"], include_archived=True)
    include = request.query.get("include_archived") in ("1", "true")
    return Response(payload={"sources": content.list_sources(store, params["lib"], include_archived=include)})


@route("POST", r"/api/libraries/(?P<lib>[^/]+)/sources")
def sources_import(store: Store, request: Request, params: dict) -> Response:
    filename = request.headers.get("x-filename") or request.query.get("name") or "untitled.txt"
    # 传完整相对路径：content 内部用 basename 存文件名、用 rel_path 保留 notes/2024/ 这类子目录
    result = content.import_source(store, params["lib"], filename, request.body, rel_path=filename)
    return Response(status=201, payload=result)


@route("GET", r"/api/sources/(?P<src>[^/]+)")
def sources_get(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=content.get_source(store, params["src"], include_archived=True))


@route("DELETE", r"/api/sources/(?P<src>[^/]+)")
def sources_archive(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=content.archive_source(store, params["src"], True))


@route("POST", r"/api/sources/(?P<src>[^/]+)/restore")
def sources_restore(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=content.archive_source(store, params["src"], False))


@route("GET", r"/api/sources/(?P<src>[^/]+)/original")
def sources_original(store: Store, request: Request, params: dict) -> Response:
    path, source = content.original_path(store, params["src"])
    return Response(body=path.read_bytes(), content_type="application/octet-stream",
                    headers={"X-Filename": source["title"],
                             "Content-Disposition": f'inline; filename="{source["title"]}"'})


@route("GET", r"/api/sources/(?P<src>[^/]+)/text")
def sources_text(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=content.read_text(store, params["src"], request.query.get("version")))


# ---------------------------------------------------------------- 检索


@route("GET", r"/api/search")
def search(store: Store, request: Request, params: dict) -> Response:
    scope = Scope.parse(request.query.get("scope") or "all")
    query = request.query.get("q", "")
    limit = int(request.query.get("limit", "20"))
    resolved = retrieval.resolve_scope(store, scope)
    hits = retrieval.search(store, scope, query, limit)
    return Response(payload={"scope": {"kind": scope.kind, "id": scope.id},
                             "resolved": {"library_ids": resolved.library_ids,
                                          "source_ids": resolved.source_ids},
                             "query": query, "hits": hits})


# ---------------------------------------------------------------- 任务与运行


@route("GET", r"/api/tasks")
def tasks_list(store: Store, request: Request, params: dict) -> Response:
    return Response(payload={"tasks": tasks.list_tasks(store)})


@route("POST", r"/api/tasks")
def tasks_create(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    return Response(status=201, payload=tasks.create_task(
        store, title=body.get("title"), goal=body.get("goal", ""),
        scope=body.get("scope") or {"kind": "all"}, template_id=body.get("template_id")))


@route("GET", r"/api/tasks/(?P<task>[^/]+)")
def tasks_get(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=tasks.get_task(store, params["task"]))


@route("POST", r"/api/tasks/(?P<task>[^/]+)/messages")
def tasks_message(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    return Response(status=201, payload=tasks.add_message(
        store, params["task"], body.get("content", ""), body.get("role", "user")))


@route("POST", r"/api/tasks/(?P<task>[^/]+)/runs")
def tasks_run(store: Store, request: Request, params: dict) -> Response:
    body = request.json() if request.body else {}
    return Response(status=202, payload=tasks.start_run(store, params["task"], body.get("kind", "research")))


@route("GET", r"/api/runs/(?P<run>[^/]+)")
def runs_get(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=tasks.get_run(store, params["run"]))


@route("POST", r"/api/runs/(?P<run>[^/]+)/cancel")
def runs_cancel(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=tasks.cancel_run(store, params["run"]))


# ---------------------------------------------------------------- 成果


@route("GET", r"/api/artifacts")
def artifacts_list(store: Store, request: Request, params: dict) -> Response:
    return Response(payload={"artifacts": artifacts.list_artifacts(store, request.query.get("task_id"))})


@route("POST", r"/api/artifacts")
def artifacts_create(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    return Response(status=201, payload=artifacts.create(
        store, title=body.get("title"), body_md=body.get("body_md", ""),
        kind=body.get("kind", "report"), task_id=body.get("task_id"), run_id=body.get("run_id"),
        citations=body.get("citations") or [], status=body.get("status", "draft")))


@route("GET", r"/api/artifacts/(?P<art>[^/]+)")
def artifacts_get(store: Store, request: Request, params: dict) -> Response:
    return Response(payload=artifacts.get(store, params["art"]))


@route("PATCH", r"/api/artifacts/(?P<art>[^/]+)")
def artifacts_update(store: Store, request: Request, params: dict) -> Response:
    body = request.json()
    return Response(payload=artifacts.update(
        store, params["art"], title=body.get("title"), body_md=body.get("body_md"),
        status=body.get("status"), citations=body.get("citations")))


@route("GET", r"/api/artifacts/(?P<art>[^/]+)/export\.md")
def artifacts_export(store: Store, request: Request, params: dict) -> Response:
    text = artifacts.export_markdown(store, params["art"])
    return Response(body=text.encode("utf-8"), content_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="artifact.md"'})


def error_response(error: HeliError) -> Response:
    return Response(status=error.status, payload=error.payload())
