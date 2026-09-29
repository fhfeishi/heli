/* ==================================================================
   统一错误模型（方案 §13.4）
   ------------------------------------------------------------------
   每种 code 有固定的、带「下一步」的呈现：
     LOCK_BUSY         → 稍后重试 + 占用说明
     INDEX_UNAVAILABLE → 检索不可用，但目录与原文可读
     VERSION_CONFLICT  → 新旧页不能混读
   后端暂不下发 code 字段，这里按 HTTP 状态与错误文本推断（见 codeFromPayload）。
   ================================================================== */

export type ApiErrorCode =
  | "NETWORK"
  | "LOCK_BUSY"
  | "VERSION_CONFLICT"
  | "INDEX_UNAVAILABLE"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "UNKNOWN";

export interface ApiErrorPresentation {
  /** 一句话说明这是什么失败 */
  title: string;
  /** 固定的「下一步」，UI 必须与 title 同时出现 */
  next: string;
}

export const API_ERROR_TEXT: Record<ApiErrorCode, ApiErrorPresentation> = {
  NETWORK: { title: "连不上后端服务", next: "确认后端在 127.0.0.1:8765 运行后重试" },
  LOCK_BUSY: { title: "库正在被占用", next: "等当前处理结束后重试" },
  VERSION_CONFLICT: { title: "内容版本已变化", next: "刷新后重新打开，新旧内容不能混读" },
  INDEX_UNAVAILABLE: { title: "检索索引不可用", next: "目录与原文阅读不受影响" },
  NOT_FOUND: { title: "找不到该对象", next: "它可能已被移除，刷新列表确认" },
  CONFLICT: { title: "与现有数据冲突", next: "刷新后重试" },
  VALIDATION: { title: "请求内容不合要求", next: "按提示修改后重试" },
  UNKNOWN: { title: "请求失败", next: "稍后重试" },
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** 后端原文，用于「查看细节」；展示时优先用它，缺省才回退 title */
  readonly detail: string;

  constructor(code: ApiErrorCode, message?: string, status = 0, detail = "") {
    super(message || API_ERROR_TEXT[code].title);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }

  /** 固定「下一步」，与 message 一起呈现 */
  get next(): string {
    return API_ERROR_TEXT[this.code].next;
  }
}

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  0: "NETWORK",
  400: "VALIDATION",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION",
  423: "LOCK_BUSY",
};

/** 后端只给 {"error": "..."} 文本，按关键词回推 code */
export function codeFromPayload(message: string): ApiErrorCode | null {
  const m = message.toLowerCase();
  if (/锁|占用|busy|locked|lock/.test(m)) return "LOCK_BUSY";
  if (/索引|index|embedding|向量/.test(m)) return "INDEX_UNAVAILABLE";
  if (/版本|sha256|过期|stale|version/.test(m)) return "VERSION_CONFLICT";
  if (/不存在|未找到|not found|missing/.test(m)) return "NOT_FOUND";
  if (/冲突|已存在|conflict|duplicate/.test(m)) return "CONFLICT";
  if (/参数|校验|invalid|validation|required/.test(m)) return "VALIDATION";
  return null;
}

export function codeFromStatus(status: number): ApiErrorCode {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? "UNKNOWN" : "VALIDATION");
}

/** 把任意抛出物归一成 ApiError，UI 不必再判断类型 */
export function normalizeError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new ApiError("NETWORK", "请求已取消");
  }
  if (cause instanceof TypeError) {
    /* fetch 在网络不可达 / 服务未起时抛 TypeError */
    return new ApiError("NETWORK", "连不上后端服务", 0, String(cause.message ?? ""));
  }
  if (cause instanceof Error) return new ApiError("UNKNOWN", cause.message);
  return new ApiError("UNKNOWN", String(cause));
}

/** 单行呈现：message（下一步：next）。给 toast / 行内错误位使用 */
export function describeError(cause: unknown): string {
  const error = normalizeError(cause);
  const head = error.message || error.detail || API_ERROR_TEXT[error.code].title;
  return `${head}（${error.next}）`;
}
