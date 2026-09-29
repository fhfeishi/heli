/* ==================================================================
   接口契约层（占位）
   ------------------------------------------------------------------
   前端原型目前完全跑在 mock 数据上，但所有会「落库 / 落盘 / 调模型」
   的动作都收敛到这里。接后端时只需把这些函数体换成真实请求，
   组件层不需要改动。

   约定：
   · 所有函数返回 Promise，失败时 reject 一个 Error(message)
   · 流式回答走 chatStream()，产出与阶段事件以回调形式推送
   · 知识库落盘约定：heli/.knowledge/<slug>/{source,parsed,vectordb,datadb/kb.db}
   ================================================================== */

import type {
  Artifact,
  ChatMessage,
  Citation,
  KnowledgeBase,
  KnowledgeDocument,
  ModelOption,
  PromptCard,
  ReportTemplate,
  TaskTemplate,
} from "../types";

/** 统一的前缀，方便全局搜索「还没接后端的地方」 */
const TODO = "待接入后端";

function notReady(op: string): never {
  throw new Error(`${op}：${TODO}`);
}

/* ------------------------------------------------------- 知识库 ------ */

export interface CreateKbPayload {
  name: string;
  description: string;
  slug: string;
  tags: string[];
  chunkStrategy: string;
  embeddingModel?: string;
}

/** POST /api/kb —— 建库同时在本地创建 heli/.knowledge/<slug> 目录树 */
export async function apiCreateKb(_payload: CreateKbPayload): Promise<KnowledgeBase> {
  return notReady("创建知识库");
}

/** PATCH /api/kb/:id —— 重命名、改说明、改切分策略等 */
export async function apiUpdateKb(
  _id: string,
  _patch: Partial<KnowledgeBase>,
): Promise<KnowledgeBase> {
  return notReady("更新知识库");
}

/** DELETE /api/kb/:id —— 同时清理本地目录与向量库 */
export async function apiDeleteKb(_id: string): Promise<void> {
  return notReady("删除知识库");
}

/** POST /api/kb/:id/files —— 上传源文件（本地文件 / 网页 URL / 整个文件夹） */
export async function apiImportFiles(
  _kbId: string,
  _items: { name: string; origin: KnowledgeDocument["origin"]; source: string; size: string }[],
): Promise<KnowledgeDocument[]> {
  return notReady("导入源文件");
}

/** POST /api/kb/:id/files/:fileId/reparse —— 重新解析并重建该文件的向量 */
export async function apiReparseFile(_kbId: string, _fileId: string): Promise<void> {
  return notReady("重新解析文件");
}

/** DELETE /api/kb/:id/files/:fileId —— 移除文件并更新索引 */
export async function apiRemoveFile(_kbId: string, _fileId: string): Promise<void> {
  return notReady("移除文件");
}

/** GET /api/kb/:id/files/:fileId/content —— 取原文（预览 / 导出用） */
export async function apiFetchDocument(
  _kbId: string,
  _fileId: string,
): Promise<KnowledgeDocument> {
  return notReady("获取文件原文");
}

/* --------------------------------------------------- 任务与模板 ------ */

export async function apiSaveTask(_task: TaskTemplate): Promise<TaskTemplate> {
  return notReady("保存任务模板");
}

export async function apiDeleteTask(_id: string): Promise<void> {
  return notReady("删除任务模板");
}

export async function apiListReportTemplates(_type?: string): Promise<ReportTemplate[]> {
  return notReady("拉取报告模板库");
}

/* --------------------------------------------------------- 成果 ------ */

export async function apiSaveArtifact(
  _id: string,
  _patch: Partial<Artifact>,
): Promise<Artifact> {
  return notReady("保存成果");
}

export async function apiDeleteArtifact(_id: string): Promise<void> {
  return notReady("删除成果");
}

/** GET /api/artifacts/:id/export?format=md|docx —— 服务端渲染导出 */
export async function apiExportArtifact(
  _id: string,
  _format: "md" | "docx" | "pdf",
): Promise<Blob> {
  return notReady("导出成果");
}

/* ------------------------------------------------ 提示词 / Skill ----- */

export async function apiSavePrompt(_card: PromptCard): Promise<PromptCard> {
  return notReady("保存提示词 / Skill");
}

export async function apiDeletePrompt(_id: string): Promise<void> {
  return notReady("删除提示词 / Skill");
}

/* ------------------------------------------------------- 会话 -------- */

export async function apiRenameSession(_id: string, _title: string): Promise<void> {
  return notReady("重命名会话");
}

export async function apiDeleteSession(_id: string): Promise<void> {
  return notReady("删除会话");
}

/* ------------------------------------------------------- 模型 -------- */

export async function apiListModels(): Promise<ModelOption[]> {
  return notReady("拉取模型列表");
}

/* ------------------------------------------------------- 对话 -------- */

export interface ChatStreamHandlers {
  /** 阶段事件：用于渲染「思考过程」 */
  onStep?: (step: { title: string; meta: string; status: "running" | "done"; durationMs?: number }) => void;
  /** 增量正文，按 AnswerBlock 粒度推送 */
  onBlock?: (block: NonNullable<ChatMessage["blocks"]>[number]) => void;
  onCitation?: (citation: Citation) => void;
  onDone?: (payload: {
    blocks: NonNullable<ChatMessage["blocks"]>;
    citations: Citation[];
    firstTokenMs: number;
    thinkingMs: number;
    totalMs: number;
    inputTokens: number;
    outputTokens: number;
  }) => void;
  onError?: (message: string) => void;
}

export interface ChatStreamRequest {
  sessionId: string;
  question: string;
  model: string;
  kbIds: string[];
  taskId?: string | null;
  webEnabled: boolean;
  /** 挂载的 Skill / 提示词全文，作为系统提示的一部分 */
  systemHints?: string[];
}

/**
 * SSE / WebSocket 推送一次回答。
 * 原型阶段由 store 内的定时器模拟；接后端时把这里换成 EventSource 即可。
 */
export function chatStream(_req: ChatStreamRequest, _handlers: ChatStreamHandlers): () => void {
  /* 真实实现示例：
     const es = new EventSource(`/api/chat/stream?...`);
     es.addEventListener("step", e => handlers.onStep?.(JSON.parse(e.data)));
     ...
     return () => es.close();
  */
  return () => undefined;
}
