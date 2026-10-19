/* ==================================================================
   heli v4 接口客户端
   ------------------------------------------------------------------
   与 heli-src/routes.py 一一对应。所有写操作都以服务端返回为准，
   不在前端伪造成功；失败统一抛 ApiError（沿用 api/errors.ts）。
   ================================================================== */

import { ApiError, codeFromStatus, normalizeError } from "./errors";

const BASE = "/api";

export interface Library {
  id: string;
  name: string;
  description: string;
  archived_at: string | null;
  group_ids: string[];
  source_count: number;
  indexed_count: number;
}

export interface Group {
  id: string;
  name: string;
  parent_id: string | null;
  order_index: number;
  hue: string;
  library_ids: string[];
}

export interface Source {
  id: string;
  library_id: string;
  path: string;
  title: string;
  kind: string;
  status: "indexed" | "registered" | "undecodable";
  archived_at: string | null;
  size: number | null;
  sha256: string | null;
}

export interface Hit {
  source_id: string;
  version_id: string;
  library_id: string;
  title: string;
  snippet: string;
  position: number | null;
  score: number;
}

export interface Citation {
  index: number;
  source_id: string;
  version_id: string;
  title: string;
  quote: string;
  position: number | null;
}

export interface Run {
  id: string;
  task_id: string;
  kind: string;
  status: "queued" | "running" | "cancelling" | "done" | "failed" | "cancelled" | "interrupted";
  input: { scope?: { kind: string; id: string | null }; resolved?: { library_ids: string[]; source_total?: number }; as_of?: string };
  output: { artifact_id?: string; hits?: number; versions?: string[] };
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface Task {
  id: string;
  title: string;
  goal: string;
  scope: { kind: string; id?: string | null };
  template_id: string | null;
  messages: { id: string; role: string; content: string; created_at: string }[];
  runs: Run[];
  artifacts: { id: string; title: string; kind: string; status: string; revision: number }[];
  created_at: string;
  updated_at: string;
}

export interface Artifact {
  id: string;
  task_id: string | null;
  run_id: string | null;
  title: string;
  kind: string;
  status: string;
  body_md: string;
  citations: Citation[];
  revision: number;
  revisions: number[];
  updated_at: string;
}

export interface Health {
  ok: boolean;
  schema_version: string;
  data_root: string;
  model_channel: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch (cause) {
    throw normalizeError(cause);
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    let message = text || `HTTP ${response.status}`;
    if (payload && typeof payload === "object" && "error" in payload) {
      message = String((payload as { error: unknown }).error) || message;
    }
    throw new ApiError(codeFromStatus(response.status), message, response.status, message);
  }
  return (payload ?? {}) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  health: () => request<Health>("/health"),

  libraries: () => request<{ libraries: Library[] }>("/libraries"),
  createLibrary: (name: string, description = "") =>
    request<Library>("/libraries", json("POST", { name, description })),
  updateLibrary: (id: string, patch: { name?: string; description?: string }) =>
    request<Library>(`/libraries/${id}`, json("PATCH", patch)),
  background: (id: string) =>
    request<{ subject_type: string; subject_id: string; text: string; updated_at: string | null }>(
      `/libraries/${id}/background`),
  setBackground: (id: string, text: string) =>
    request<{ subject_type: string; subject_id: string; text: string; updated_at: string | null }>(
      `/libraries/${id}/background`, json("PUT", { text })),
  archiveLibrary: (id: string) => request<Library>(`/libraries/${id}`, { method: "DELETE" }),
  restoreLibrary: (id: string) => request<Library>(`/libraries/${id}/restore`, { method: "POST" }),

  groups: () => request<{ groups: Group[] }>("/groups"),
  createGroup: (name: string, parent_id: string | null = null, hue = "neutral") =>
    request<Group>("/groups", json("POST", { name, parent_id, hue })),
  deleteGroup: (id: string) => request<unknown>(`/groups/${id}`, { method: "DELETE" }),
  setMembers: (groupId: string, libraryIds: string[]) =>
    request<Group>(`/groups/${groupId}/members`, json("PUT", { library_ids: libraryIds })),
  addMember: (groupId: string, libraryId: string) =>
    request<Group>(`/groups/${groupId}/members`, json("POST", { library_id: libraryId })),
  removeMember: (groupId: string, libraryId: string) =>
    request<Group>(`/groups/${groupId}/members/${libraryId}`, { method: "DELETE" }),

  sources: (libraryId: string) =>
    request<{ sources: Source[] }>(`/libraries/${libraryId}/sources`),
  /* 文件名走 query：HTTP 头只能是 latin-1，中文文件名放 X-Filename 会直接抛编码错误 */
  importSource: async (libraryId: string, filename: string, file: Blob) =>
    request<{ source: Source; status: string; indexed: boolean; unchanged: boolean }>(
      `/libraries/${libraryId}/sources?name=${encodeURIComponent(filename)}`,
      { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file },
    ),
  archiveSource: (sourceId: string) => request<Source>(`/sources/${sourceId}`, { method: "DELETE" }),
  sourceText: (sourceId: string, versionId?: string) =>
    request<{ source_id: string; version_id: string; title: string; text: string }>(
      `/sources/${sourceId}/text${versionId ? `?version=${encodeURIComponent(versionId)}` : ""}`,
    ),

  search: (query: string, scope: string, limit = 20) =>
    request<{ hits: Hit[]; resolved: { library_ids: string[] } }>(
      `/search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}&limit=${limit}`,
    ),

  tasks: () => request<{ tasks: Omit<Task, "messages" | "runs" | "artifacts">[] }>("/tasks"),
  createTask: (title: string, goal: string, scope: { kind: string; id?: string | null }) =>
    request<Task>("/tasks", json("POST", { title, goal, scope })),
  task: (id: string) => request<Task>(`/tasks/${id}`),
  addMessage: (id: string, content: string) =>
    request<unknown>(`/tasks/${id}/messages`, json("POST", { content })),
  startRun: (id: string, kind = "research") =>
    request<Run>(`/tasks/${id}/runs`, json("POST", { kind })),
  run: (id: string) => request<Run>(`/runs/${id}`),
  cancelRun: (id: string) => request<Run>(`/runs/${id}/cancel`, { method: "POST" }),

  artifacts: () => request<{ artifacts: Omit<Artifact, "body_md" | "citations">[] }>("/artifacts"),
  artifact: (id: string) => request<Artifact>(`/artifacts/${id}`),
  createArtifact: (payload: { title: string; body_md?: string; task_id?: string | null }) =>
    request<Artifact>("/artifacts", json("POST", payload)),
  updateArtifact: (id: string, patch: { title?: string; body_md?: string; status?: string }) =>
    request<Artifact>(`/artifacts/${id}`, json("PATCH", patch)),
  exportMarkdown: async (id: string) => {
    const response = await fetch(`${BASE}/artifacts/${id}/export.md`);
    if (!response.ok) throw new ApiError("UNKNOWN", "导出失败", response.status, "导出失败");
    return response.text();
  },
};
