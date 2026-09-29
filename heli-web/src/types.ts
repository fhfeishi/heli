/* ==================================================================
   heli · 知识管理 / 研究推理工作台 —— 数据模型
   类型以「前端原型可独立运行」为目标定义；
   与后端对接时，把 src/api 中的同名接口换成真实请求即可。
   ================================================================== */

/** 一级导航四入口（U1）：对话并入研究任务；提示词 / Skill 归入模板高级配置 */
export type NavKey = "knowledge" | "research" | "artifacts" | "settings";

export type Tone = "mint" | "peach" | "lav" | "sky" | "rose" | "gray";

export interface Tag {
  label: string;
  tone: Tone;
}

/* ------------------------------------------------------- 知识库 ------ */

/**
 * 知识库在本地的落盘结构（命名以 .knowledge/README.md 的术语表为准，
 * 废止 raw/、vector/ 与库根 kb.db 三个旧名）：
 *   heli/.knowledge/<slug>/
 *     |- source/    原始层，不可变（PDF / DOCX / 网页快照 / 表格 ...）
 *     |- parsed/    解析层，可重建
 *     |- vectordb/  向量层，可重建但贵
 *     └- datadb/    元数据层，不可重建
 *          └- kb.db
 */
export interface KbStorage {
  root: string;
  source: string;
  parsed: string;
  vectordb: string;
  db: string;
}

export type KbStatus = "ready" | "parsing" | "error" | "empty";

/* --------------------------------------------------- 书架分层 ------ */

/** 知识库列表页的两种浏览视图 */
export type KbView = "shelf" | "card";

/**
 * 排序口径：manual = 手工顺序（拖拽写入的真源序）。
 * 其余三项是「一次性重排动作」的口径标记，仅用于菜单展示，
 * 不参与渲染派生 —— 渲染永远只看 ungroupedOrder 与 KbGroup.kbIds。
 */
export type KbSortKey = "manual" | "updated" | "name" | "size";

/**
 * 领域色相族：顶层分组（领域）拥有一个色相，书脊底色与路径文字随领域着色。
 * neutral 不参与自动分配——它只表示「未分层」。
 */
export type DomainHue = "sky" | "peach" | "mint" | "lavender" | "neutral";

/**
 * 书架的一层（分组）。`kbIds` 是层内顺序的唯一真源；
 * 未分层 = 不在任何层的 kbIds 里，其顺序由 store 的 ungroupedOrder 承担。
 *
 * v2：分层由扁平列表升级为树（领域 → 子组）：
 * - `parentId` 为 null 表示顶层领域，子组指向父领域 id
 * - `childIds` 是子组顺序；只有叶子组（childIds 为空）持有书
 * - `hue` 取代旧 color：书脊底色由所属领域的色相族派生，建组时分配、稳定不随成员变
 *
 * 分组只是视图，结构操作永不触碰 KnowledgeBase 实体，因此一切可快照撤销。
 */
export interface KbGroup {
  id: string;
  name: string;
  kbIds: string[];
  collapsed: boolean;
  /** null = 顶层领域 */
  parentId: string | null;
  /** 子组顺序（树深上限见 KB_TREE_MAX_DEPTH） */
  childIds: string[];
  hue: DomainHue;
}

/**
 * 镜像：同一本书在第二个组里的引用边。
 * 镜像不复制实体，只是一条「此处也陈列」的指针；本体删除时镜像一并消失。
 */
export interface KbMirror {
  kbId: string;
  /** 镜像所在的组（≠ 本体所在组） */
  groupId: string;
}

/** 树深上限：领域(1) → 子组(2) → 书(3)。建子组时校验，越界拒绝并说明理由。 */
export const KB_TREE_MAX_DEPTH = 3;

/**
 * 撤销栈条目：结构操作前压入的整体快照。
 * groups / ungroupedOrder / mirrors 必须一起快照、一起恢复，否则撤销后结构错乱。
 */
export interface KbHistoryEntry {
  label: string;
  groups: KbGroup[];
  ungroupedOrder: string[];
  mirrors: KbMirror[];
}

/** 书脊 / 卡片上的状态点颜色（形状统一为圆点，语义靠颜色 + title/aria-label） */
export const KB_STATUS_COLOR: Record<KbStatus, string> = {
  ready: "var(--green)",
  parsing: "var(--link)",
  error: "var(--red)",
  empty: "var(--stone)",
};

/** Toast 右侧的操作按钮（如「撤销」） */
export interface ToastAction {
  label: string;
  onSelect: () => void;
}

export interface ToastState {
  message: string;
  action?: ToastAction;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  /** 用途说明：决定检索与重排的口径，越具体越准 */
  description: string;
  initial: string;
  /** 背景色 token，例如 "var(--tint-mint)" */
  tint: string;
  fg: string;
  docs: number;
  size: string;
  updatedAt: string;
  tags: Tag[];
  /** 0-100 解析进度，100 表示已就绪 */
  readyPct: number;
  restricted?: boolean;
  pinned?: boolean;
  /** 本地目录名，落盘为 heli/.knowledge/<slug> */
  slug: string;
  status: KbStatus;
  storage: KbStorage;
  embeddingModel: string;
  chunkStrategy: string;
  /** 库内源文件 */
  files: KnowledgeDocument[];
  owner: string;
  lastChatAt?: string;
}

export const KB_STATUS_LABEL: Record<KbStatus, { label: string; tone: Tone }> = {
  ready: { label: "已就绪", tone: "mint" },
  parsing: { label: "解析中", tone: "sky" },
  error: { label: "解析异常", tone: "rose" },
  empty: { label: "空库", tone: "gray" },
};

/** 文档预览页：每个元素是一「页」 */
export interface DocPage {
  heading: string;
  paragraphs: string[];
}

export type FileOrigin = "file" | "web" | "folder";
export type FileStatus = "parsed" | "parsing" | "failed";

export interface KnowledgeDocument {
  id: string;
  name: string;
  format: "PDF" | "DOCX" | "WEB" | "XLSX" | "MD" | "TXT" | "PPT";
  size: string;
  pages: string;
  score: number;
  updatedAt: string;
  /** 预览用的正文内容（真实环境由解析服务回传） */
  preview: DocPage[];
  origin: FileOrigin;
  status: FileStatus;
  /** 切分出的片段数 */
  chunks: number;
  /** 原始来源：本地路径 / 网页 URL / 抓取时间 */
  source: string;
  /** 相对知识库根目录的落盘位置 */
  path: string;
}

/* --------------------------------------------------- 任务模板 ------ */

export type TaskIcon =
  | "trend"
  | "history"
  | "forecast"
  | "checklist"
  | "competitors"
  | "custom";

/** 产出的报告形态，每种形态挂一套模板库 */
export type ReportType =
  | "text"
  | "rich"
  | "data"
  | "compare"
  | "kb-analysis"
  | "kb-summary";

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  text: "文本报告",
  rich: "图文编排报告",
  data: "数据分析报告",
  compare: "对比分析报告",
  "kb-analysis": "知识库分析报告",
  "kb-summary": "知识汇总报告",
};

export interface ReportTemplate {
  id: string;
  type: ReportType;
  name: string;
  summary: string;
  /** 模板纲要，用于预览 */
  outline: string[];
  tint: string;
  fg: string;
  builtin: boolean;
  usage: number;
}

export interface TaskTemplate {
  id: string;
  title: string;
  /** 一句话说明 */
  description: string;
  /** 任务背景 */
  background: string;
  /** 任务要求 / 执行细节（逐条） */
  details: string[];
  /** 任务得到的结果 */
  output: {
    type: ReportType;
    templateId: string;
    hint: string;
  };
  tint: string;
  fg: string;
  icon: TaskIcon;
  /** 点击「使用」后填入输入框的完整任务背景 */
  prompt: string;
  /** 推荐搭配的知识库 id */
  suggestKbIds: string[];
  category: string;
  builtin: boolean;
  usage: number;
}

/* --------------------------------------------------------- 成果 ------ */

export type ArtifactStatus = "done" | "generating" | "draft" | "review";

export const ARTIFACT_STATUS_LABEL: Record<
  ArtifactStatus,
  { label: string; tone: Tone }
> = {
  done: { label: "已完成", tone: "mint" },
  generating: { label: "生成中", tone: "lav" },
  draft: { label: "草稿", tone: "gray" },
  review: { label: "待复核", tone: "peach" },
};

export interface Artifact {
  id: string;
  title: string;
  type: ReportType;
  status: ArtifactStatus;
  /** 生成中时的进度 0-100 */
  progress?: number;
  /** 来源任务 */
  taskId?: string;
  taskTitle?: string;
  /** 相关知识库 */
  kbIds: string[];
  /** 相关知识记录（引用） */
  citationCount: number;
  /** 关联会话 */
  sessionId?: string;
  origin: string;
  meta: string[];
  updatedAt: string;
  /** 正文，用于右侧面板预览与编辑 */
  blocks: AnswerBlock[];
  citations?: Citation[];
  metrics?: MessageMetrics;
}

/* ------------------------------------------------- 提示词 / Skill --- */

export interface PromptCard {
  id: string;
  kind: "prompt" | "skill";
  title: string;
  summary: string;
  /** 完整内容，插入到输入框或作为系统提示 */
  content: string;
  tags: Tag[];
  tint: string;
  fg: string;
  builtin: boolean;
  usage: number;
  updatedAt: string;
  /** Skill 的执行步骤约定 */
  steps?: string[];
}

/* ------------------------------------------------------ 会话 -------- */

export interface SessionItem {
  id: string;
  title: string;
  updatedAt?: string;
  messageCount?: number;
  pinned?: boolean;
  kbIds?: string[];
}

export interface SessionGroup {
  label: string;
  items: SessionItem[];
}

/* ------------------------------------------------------ 对话 -------- */

export interface Citation {
  index: number;
  docName: string;
  page: string;
  score: number;
  snippet: string;
  /** 来源知识库 id，便于溯源到库内文件 */
  kbId?: string;
}

export type StepStatus = "done" | "running" | "pending";

export interface TraceStep {
  title: string;
  meta: string;
  status: StepStatus;
  /** 该步骤耗时（毫秒）；尚未结束时为 undefined */
  durationMs?: number;
}

/** 单条回答的运行时开销 */
export interface MessageMetrics {
  /** 首 token 延迟 */
  firstTokenMs: number;
  /** 推理 / 思考总时长 */
  thinkingMs: number;
  /** 从发出到回答结束 */
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
}

/** 助手回答由结构化块组成，便于渲染与后续替换为真实流式数据 */
export type AnswerBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "report"; fileName: string; meta: string[] };

/** 重新生成前保存的一版回答快照 */
export interface AnswerVersion {
  blocks?: AnswerBlock[];
  citations?: Citation[];
  metrics?: MessageMetrics;
  trace?: { summary: string; steps: TraceStep[] };
  stopped?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  time: string;
  /** 用户消息正文 */
  text?: string;
  /** 助手的分析过程 */
  trace?: { summary: string; steps: TraceStep[] };
  blocks?: AnswerBlock[];
  citations?: Citation[];
  /** 该条回答的开销统计；生成中为空 */
  metrics?: MessageMetrics;
  /** 用户对这条回答的反馈 */
  feedback?: "up" | "down" | null;
  /** 该回答挂载的任务 / 使用的模型 */
  taskId?: string;
  model?: string;
  /** 生成被用户手动停止 */
  stopped?: boolean;
  /** 重新生成的历史版本快照，最新版本即消息本体 */
  versions?: AnswerVersion[];
  /** 正在查看的历史版本下标；null / undefined 表示看最新版 */
  viewVersion?: number | null;
}

/* -------------------------------------------------- 模型 / 预览 ----- */

export interface ModelOption {
  id: string;
  name: string;
  vendor: string;
  context: string;
  /** 擅长场景 */
  good: string;
  /** 相对成本，1 为基准 */
  cost: number;
}

/** 右侧窗口可预览的对象 */
export type PreviewTarget =
  | { kind: "doc"; doc: KnowledgeDocument; kbId?: string }
  | { kind: "artifact"; artifactId: string }
  | { kind: "template"; template: ReportTemplate }
  | { kind: "kb"; kbId: string }
  | { kind: "citation"; citation: Citation }
  | { kind: "task"; taskId: string }
  | { kind: "prompt"; promptId: string }
  /** 资料库并排常驻面板（U6）：库概览与处理记录，按 slug 寻址 */
  | { kind: "library"; slug: string }
  | null;

/* ------------------------------------------------ 信息提取（S2） ------ */

/** 一条提取记录代表什么。U9：方案必须显式声明，默认 document */
export type ExtractScope = "document" | "segment" | "entity";

export const RECORD_SCOPE_LABEL: Record<ExtractScope, { label: string; help: string }> = {
  document: { label: "整篇文档", help: "一条记录 = 一篇文档，用 source_id 定位" },
  segment: {
    label: "章节 / 实验",
    help: "一条记录 = 文档内某个章节或实验，用 source_id + 章节或字符区间定位",
  },
  entity: {
    label: "技术 / 方法实体",
    help: "一条记录 = 文档内某个技术或方法，用 source_id + 字符区间定位",
  },
};

/* ------------------------------------------------------ 抽屉 -------- */

export type DrawerView =
  | { kind: "new-kb" }
  | { kind: "kb-settings"; kbId: string }
  | { kind: "citation"; citation: Citation }
  | { kind: "doc"; doc: KnowledgeDocument; kbId?: string }
  | { kind: "task-editor"; taskId?: string }
  | { kind: "prompt-editor"; promptId?: string; presetKind?: "prompt" | "skill" }
  | { kind: "artifact-editor"; artifactId: string }
  | { kind: "import"; kbId?: string }
  | null;

/** 删除 / 危险操作的二次确认 */
export interface ConfirmState {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => void;

  /** 第三种选择（例如「放弃修改」），用于不能二选一的场合（U8） */
  alt?: { label: string; onSelect: () => void };
}
