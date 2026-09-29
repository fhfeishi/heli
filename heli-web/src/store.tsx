import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { navKeyOf } from "./app/nav";
import { decodePanel, encodePanel } from "./app/panel";
import { normalizeError } from "./api/errors";
import { runsApi } from "./api/runs";
import { loadKbView, saveKbView } from "./lib/kbViewStore";
import { Paths, navigate, setSearchParams, useRoute } from "./app/router";
import {
  ARTIFACTS,
  KNOWLEDGE_BASES,
  MODELS,
  PROMPT_CARDS,
  REPORT_TEMPLATES,
  SEED_THREAD,
  SESSION_GROUPS,
  TASK_TEMPLATES,
} from "./data/mock";
import type {
  AnswerVersion,
  Artifact,
  ChatMessage,
  Citation,
  ConfirmState,
  DrawerView,
  KbGroup,
  KbHistoryEntry,
  KbMirror,
  KbSortKey,
  KbView,
  KnowledgeBase,
  KnowledgeDocument,
  MessageMetrics,
  ModelOption,
  NavKey,
  PreviewTarget,
  PromptCard,
  ReportTemplate,
  SessionGroup,
  TaskTemplate,
  ToastAction,
  ToastState,
  TraceStep,
} from "./types";
import { KB_TREE_MAX_DEPTH } from "./types";
import { hueAt, migrateKbGroups, type LegacyKbGroup } from "./lib/kbLayout";
import { splitKbName } from "./lib/kbName";

/* ------------------------------------------------------------------
   模拟一次「Agent 正在思考」的过程。
   接真实后端时，把这里换成服务端推送的阶段事件（SSE / WebSocket），
   逐步写入 trace.steps；其余状态机不需要改动。
   ------------------------------------------------------------------ */
const PENDING_STEPS: Omit<TraceStep, "status" | "durationMs">[] = [
  { title: "解析任务意图，拆解为 3 个子问题", meta: "技术发展 · 成果与收益 · 后续影响" },
  { title: "检索所选知识库 · 召回并重排候选片段", meta: "等待解析完成" },
  { title: "抽取结构化数据（表格 / 时间线）", meta: "等待检索结果" },
  { title: "交叉验证并消解冲突口径", meta: "等待抽取结果" },
];

const STEP_DURATIONS = [1240, 3620, 2080, 1440];

/** 推进到第 n 步时的步骤快照：前 n-1 步已完成并带耗时，第 n 步进行中 */
function stepsUpTo(n: number): TraceStep[] {
  return PENDING_STEPS.slice(0, n).map((s, i) => {
    const finished = i < n - 1;
    return {
      ...s,
      status: finished ? ("done" as const) : ("running" as const),
      durationMs: finished ? STEP_DURATIONS[i] : undefined,
    };
  });
}

function finishedSteps(): TraceStep[] {
  return PENDING_STEPS.map((s, i) => ({
    ...s,
    status: "done" as const,
    durationMs: STEP_DURATIONS[i],
  }));
}

const uid = () => Math.random().toString(36).slice(2, 10);
const nowTime = () =>
  new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** 空会话的共享空数组，避免每次渲染生成新引用 */
const EMPTY_THREAD: ChatMessage[] = [];

/** 由提问长度与检索范围推出可信的开销数字（演示用；接后端后换成真实计数） */
function deriveMetrics(question: string, kbCount: number, withWeb: boolean): MessageMetrics {
  const firstTokenMs = 860 + Math.round(question.length * 2.2);
  const thinkingMs = STEP_DURATIONS.reduce((a, b) => a + b, 0) + kbCount * 320;
  return {
    firstTokenMs,
    thinkingMs,
    totalMs: firstTokenMs + thinkingMs + (withWeb ? 2260 : 1180),
    inputTokens: 980 + kbCount * 240 + Math.round(question.length * 0.9),
    outputTokens: 380 + Math.round(question.length * 1.4),
  };
}

const TINTS = [
  { tint: "var(--tint-mint)", fg: "var(--on-tint-mint)" },
  { tint: "var(--tint-sky)", fg: "var(--on-tint-sky)" },
  { tint: "var(--tint-lavender)", fg: "var(--on-tint-lavender)" },
  { tint: "var(--tint-peach)", fg: "var(--on-tint-peach)" },
  { tint: "var(--tint-rose)", fg: "var(--on-tint-rose)" },
];

/** 旧版层色：只作为 migrateKbGroups 的输入。v2 起建层分配的是色相族（DomainHue），
    具体色值由 globals.css 的领域色相 token 决定，这里不再存色值。 */
const LEGACY_GROUP_COLORS = [
  "var(--tint-mint)",
  "var(--tint-sky)",
  "var(--tint-lavender)",
  "var(--tint-peach)",
  "var(--tint-rose)",
  "var(--tint-yellow)",
];

/** 初始分层沿用旧形状（扁平 + color），启动时统一迁移成 树 + hue */
const LEGACY_KB_GROUPS: LegacyKbGroup[] = [
  {
    id: "g-nsfc",
    name: "自然科学基金",
    kbIds: ["kb-nsfc-materials"],
    collapsed: false,
    color: LEGACY_GROUP_COLORS[0],
    parentId: null,
    childIds: ["g-nsfc-live"],
  },
  {
    id: "g-nsfc-live",
    name: "在研项目",
    kbIds: ["kb-nsfc-ai-med", "kb-nsfc-ai-fin"],
    collapsed: false,
    color: LEGACY_GROUP_COLORS[1],
    parentId: "g-nsfc",
    childIds: [],
  },
];

/** 演示用镜像：《车企固态装车路线图》本体在未分层，此处在「自然科学基金」层再陈列一次。
    （UI 入口属 P2；先有数据才能验证渲染与撤销） */
const LEGACY_KB_MIRRORS: KbMirror[] = [{ kbId: "kb-oem", groupId: "g-nsfc" }];

/** 组在树中的深度：1 = 领域，2 = 子组。书的层级是 3，因此子组下不能再建子组。 */
const groupDepth = (groups: KbGroup[], g: KbGroup): number => {
  let d = 1;
  let cur = g;
  while (cur.parentId) {
    const p = groups.find((x) => x.id === cur.parentId);
    if (!p) break;
    d += 1;
    cur = p;
  }
  return d;
};

interface EditingState {
  id: string;
  role: "user" | "assistant";
}

export interface KbDraft {
  name: string;
  description: string;
  slug: string;
  tags: string;
  chunkStrategy: string;
}

interface StoreValue {
  /* 导航与布局 */
  nav: NavKey;
  setNav: (n: NavKey) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  panelQuery: string;
  setPanelQuery: (v: string) => void;

  /* 会话 */
  sessionGroups: SessionGroup[];
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  /** 打开某个会话：同时把 /research/session/<id> 写进地址栏 */
  openSession: (id: string) => void;
  newChat: () => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  togglePinSession: (id: string) => void;

  /* 知识库 */
  knowledgeBases: KnowledgeBase[];
  selectedKbIds: string[];
  toggleKb: (id: string) => void;
  setSelectedKbIds: (ids: string[]) => void;
  clearSelectedKbs: () => void;
  createKb: (draft: KbDraft) => string;
  updateKb: (id: string, patch: Partial<KnowledgeBase>) => void;
  deleteKb: (id: string) => void;
  togglePinKb: (id: string) => void;
  removeKbFile: (kbId: string, fileId: string) => void;
  reparseKbFile: (kbId: string, fileId: string) => void;
  /** 知识库内页：null 表示列表页 */
  activeKbId: string | null;
  openKbPage: (id: string) => void;
  closeKbPage: () => void;
  /** 与整个知识库对话 */
  chatWithKb: (id: string) => void;
  kbView: KbView;
  setKbView: (v: KbView) => void;
  /** 排序口径：manual 为手工顺序；其余三项仅为菜单展示标记，不参与渲染派生 */
  kbSort: KbSortKey;
  /** 一次性重排：重写 ungroupedOrder 与各层 kbIds，压一次撤销快照 */
  applyKbSort: (key: KbSortKey) => void;
  /** 未分层区顺序的唯一真源 */
  ungroupedOrder: string[];
  /** 批量选择（书架 / 卡片两视图共享，切换视图保留） */
  kbSelection: string[];
  toggleKbSelection: (id: string, additive?: boolean) => void;
  clearKbSelection: () => void;

  /* 书架分层（分组只是视图，全部可撤销） */
  kbGroups: KbGroup[];
  /** 镜像引用边：同一本书在第二个组里再陈列一次，不复制实体 */
  kbMirrors: KbMirror[];
  /** U5：组织视图只落本地，后端提供落盘接口前恒为 true */
  kbViewLocal: boolean;
  kbViewSavedAt: string | null;
  createGroup: (name: string) => string;
  /** 在领域下建子组（书盒）；树深越界时拒绝 */
  createChildGroup: (parentId: string, name: string) => string;
  addMirror: (kbId: string, groupId: string) => void;
  /** 批量建立镜像：一次快照 */
  addMirrors: (kbIds: string[], groupId: string) => void;
  removeMirror: (kbId: string, groupId: string) => void;
  /** 拖动子组：改挂到另一个领域，或在同级里调到 toIndex 位 */
  moveGroup: (groupId: string, toParentId: string, toIndex?: number) => void;
  renameGroup: (id: string, name: string) => void;
  dissolveGroup: (id: string) => void;
  moveKb: (kbId: string, toGroupId: string | null, toIndex?: number) => void;
  moveMany: (kbIds: string[], toGroupId: string | null, toIndex?: number) => void;
  mergeKbs: (aId: string, bId: string, name: string) => string;
  mergeMany: (kbIds: string[], name: string) => string;
  /** 建层 + 放入，单次快照 */
  groupKbs: (kbIds: string[], name: string) => string;
  /** 拆分出口：批量移回未分层 */
  ungroupMany: (kbIds: string[], toIndex?: number) => void;
  reorderGroup: (from: number, to: number) => void;
  reorderKb: (groupId: string, from: number, to: number) => void;
  reorderUngrouped: (from: number, to: number) => void;
  /** 折叠不是结构操作，不压撤销快照 */
  toggleCollapsed: (id: string) => void;
  undoKb: () => void;

  /* 任务模板 */
  tasks: TaskTemplate[];
  reportTemplates: ReportTemplate[];
  saveTask: (task: TaskTemplate) => void;
  deleteTask: (id: string) => void;
  runTask: (task: TaskTemplate) => void;

  /* 成果 */
  artifacts: Artifact[];
  saveArtifact: (id: string, patch: Partial<Artifact>) => void;
  deleteArtifact: (id: string) => void;
  createArtifact: () => string;

  /* 提示词 / Skill */
  prompts: PromptCard[];
  savePrompt: (card: PromptCard) => void;
  deletePrompt: (id: string) => void;
  applyPrompt: (card: PromptCard) => void;

  /* 右侧预览面板 */
  inspectorOpen: boolean;
  /** 链接里有 ?panel= 但内容还原不出来（内存对象刷新后无法重建） */
  panelUnresolved: boolean;
  /** §8.1：固定后，后续点击不自动覆盖，只登记为待替换 */
  panelPinned: boolean;
  panelPending: PreviewTarget;
  togglePanelPin: () => void;
  replacePanel: () => void;
  dismissPanelPending: () => void;
  inspectorWidth: number;
  preview: PreviewTarget;
  openPreview: (target: NonNullable<PreviewTarget>) => void;
  closeInspector: () => void;
  toggleInspector: () => void;
  setInspectorWidth: (w: number) => void;

  /* 抽屉与弹窗 */
  drawer: DrawerView;
  openNewKb: () => void;
  openKbSettings: (kbId: string) => void;
  openCitation: (c: Citation) => void;
  openDocDrawer: (doc: KnowledgeDocument, kbId?: string) => void;
  openTaskEditor: (taskId?: string) => void;
  openPromptEditor: (promptId?: string, presetKind?: "prompt" | "skill") => void;
  openArtifactEditor: (artifactId: string) => void;
  openImport: (kbId?: string) => void;
  closeDrawer: () => void;
  confirm: ConfirmState | null;
  askConfirm: (c: ConfirmState) => void;
  /** U8：成果编辑器把「怎么保存」登记进来；非空表示有未保存修改 */
  registerArtifactDraft: (save: (() => void) | null) => void;
  closeConfirm: () => void;

  /* 对话 */
  thread: ChatMessage[];
  streaming: boolean;
  send: (text: string) => void;
  regenerate: (assistantId: string) => void;
  stopStreaming: () => void;
  /** U7：idle / requested（已发出）/ confirmed（后端已确认）/ unconfirmed（未获确认） */
  stopPhase: "idle" | "requested" | "confirmed" | "unconfirmed";
  /** 未获确认时重试取消 */
  retryStop: () => void;
  setViewVersion: (messageId: string, index: number | null) => void;
  setFeedback: (messageId: string, value: "up" | "down") => void;
  editing: EditingState | null;
  startEdit: (message: ChatMessage) => void;
  cancelEdit: () => void;
  draft: string;
  setDraft: (v: string) => void;
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;

  /* 检索与模型 */
  webEnabled: boolean;
  toggleWeb: () => void;
  autoMode: boolean;
  toggleAutoMode: () => void;
  model: string;
  setModel: (m: string) => void;
  models: ModelOption[];

  toast: ToastState | null;
  showToast: (message: string, action?: ToastAction) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

/** 一级入口 → 路径（U1）。nav 本身由 URL 派生，这里只给出落点 */
const NAV_PATH: Record<NavKey, string> = {
  knowledge: Paths.knowledge(),
  research: Paths.research(),
  artifacts: Paths.artifacts(),
  settings: Paths.settings(),
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const route = useRoute();
  const [nav, setNavState] = useState<NavKey>(navKeyOf(route));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelQuery, setPanelQuery] = useState("");

  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>(SESSION_GROUPS);
  const [activeSessionId, setActiveSessionId] = useState("s1");
  /* U1：会话进 URL。点会话 = 导航；地址栏里有会话 = 以地址栏为准 */
  const openSession = useCallback((id: string) => {
    setActiveSessionId(id);
    navigate(Paths.session(id));
  }, []);
  useEffect(() => {
    if (route.name === "session" && route.sessionId && route.sessionId !== activeSessionId)
      setActiveSessionId(route.sessionId);
  }, [activeSessionId, route.name, route.sessionId]);

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>(KNOWLEDGE_BASES);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>(["kb-solid-state", "kb-whitepaper"]);
  const [activeKbId, setActiveKbId] = useState<string | null>(null);
  const [kbView, setKbView] = useState<KbView>("shelf");
  /* 旧扁平分层在此统一升级为树（parentId / childIds / hue） */
  const storedView = useMemo(() => loadKbView(), []);
  const [kbGroups, setKbGroups] = useState<KbGroup[]>(
    () => storedView?.groups ?? migrateKbGroups(LEGACY_KB_GROUPS),
  );
  const [ungroupedOrder, setUngroupedOrder] = useState<string[]>(() => {
    if (storedView) return storedView.ungroupedOrder;
    const grouped = new Set(LEGACY_KB_GROUPS.flatMap((g) => g.kbIds ?? []));
    return KNOWLEDGE_BASES.map((k) => k.id).filter((id) => !grouped.has(id));
  });
  const [kbMirrors, setKbMirrors] = useState<KbMirror[]>(
    storedView?.mirrors ?? LEGACY_KB_MIRRORS,
  );
  /* U5：结构一变就写本地，并记下时间，界面据此显示「本地仅 · 何时保存」 */
  const [kbViewSavedAt, setKbViewSavedAt] = useState<string | null>(
    storedView?.savedAt || null,
  );
  useEffect(() => {
    setKbViewSavedAt(saveKbView({ groups: kbGroups, ungroupedOrder, mirrors: kbMirrors }));
  }, [kbGroups, ungroupedOrder, kbMirrors]);
  const [kbHistory, setKbHistory] = useState<KbHistoryEntry[]>([]);
  const [kbSort, setKbSort] = useState<KbSortKey>("manual");
  const [kbSelection, setKbSelection] = useState<string[]>([]);

  const [tasks, setTasks] = useState<TaskTemplate[]>(TASK_TEMPLATES);
  const [artifacts, setArtifacts] = useState<Artifact[]>(ARTIFACTS);
  const [prompts, setPrompts] = useState<PromptCard[]>(PROMPT_CARDS);

  /* §8.3：面板开关与可寻址的内容都在 URL 上（?panel=），刷新与复制链接都能恢复。
     内存里的 preview 只服务于无法寻址的对象（源文件预览 / 引用详情 / 模板）。 */
  const panelParam = route.search.get("panel");
  const inspectorOpen = panelParam !== null && panelParam !== "";
  const [inspectorWidth, setInspectorWidth] = useState(432);
  const [preview, setPreview] = useState<PreviewTarget>(null);
  /* URL 能解析出来的以 URL 为准；解析不出来才退回内存对象 */
  const effectivePreview = decodePanel(panelParam) ?? preview;
  const panelUnresolved = inspectorOpen && effectivePreview === null;
  /* §8.1：固定写在 URL 上（?pin=1），刷新与复制链接都保留 */
  const panelPinned = route.search.get("pin") === "1";
  const [panelPending, setPanelPending] = useState<PreviewTarget>(null);

  const [drawer, setDrawer] = useState<DrawerView>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  /* 有未保存成果时，替换面板内容的动作先问一次（§8.1 / U8） */
  const [pendingArtifactSave, setPendingArtifactSave] = useState<(() => void) | null>(null);

  /* 会话消息按 sessionId 分桶存储；thread 是当前会话的派生视图 */
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({ s1: SEED_THREAD });
  const [streaming, setStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  /* U7：停止的三种可见状态，界面据此区分「已发出」与「已确认」 */
  const [stopPhase, setStopPhase] = useState<
    "idle" | "requested" | "confirmed" | "unconfirmed"
  >("idle");
  /* 最近一次停止的目标，供重试使用 */
  const lastStop = useRef<{ messageId: string; runId: string } | null>(null);
  const cancelRef = useRef<(messageId: string, runId: string) => void>(
    () => undefined,
  );
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [draft, setDraft] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const [webEnabled, setWebEnabled] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  const [model, setModel] = useState("heli-reason");
  const [toast, setToast] = useState<ToastState | null>(null);

  /* 进行中的生成定时器，key 为 assistant 消息 id，用于按消息定位并停止 */
  const timers = useRef<Map<string, number>>(new Map());
  /* 当前运行 id（§7.2：执行所有权在后端，前端只记标识） */
  const runIdRef = useRef<string | null>(null);
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearInterval(t));
  }, []);

  /* ?panel= 能解析出目标时同步进内存：链接里换了目标，内存也要跟着换 */
  useEffect(() => {
    const decoded = decodePanel(panelParam);
    if (decoded) setPreview(decoded);
  }, [panelParam]);

  /* 当前会话的消息列表（派生），组件侧接口保持不变 */
  const thread = threads[activeSessionId] ?? EMPTY_THREAD;

  /* 按 sessionId 更新某个会话的消息列表 */
  const updateThread = useCallback(
    (sessionId: string, fn: (cur: ChatMessage[]) => ChatMessage[]) => {
      setThreads((cur) => ({ ...cur, [sessionId]: fn(cur[sessionId] ?? EMPTY_THREAD) }));
    },
    [],
  );

  const showToast = useCallback((message: string, action?: ToastAction) => {
    const next: ToastState = { message, action };
    setToast(next);
    /* 带操作按钮的 toast 多留一会儿，给用户点「撤销」的时间 */
    window.setTimeout(
      () => setToast((cur) => (cur === next ? null : cur)),
      action ? 4200 : 2200,
    );
  }, []);

  /* 一级导航由 URL 派生：路由变了，nav 跟着变（U1 / P2）。
     未知地址不参与派生——它不属于任何一级入口，保持上一个位置的高亮，
     免得把「没有这个页面」显示成「停在某一级」 */
  useEffect(() => {
    if (route.name === "unknown") return;
    setNavState(navKeyOf(route));
  }, [route.name]);

  const setNav = useCallback((n: NavKey) => {
    setActiveKbId(null);
    navigate(NAV_PATH[n]);
  }, []);

  const toggleSidebar = useCallback(() => setSidebarCollapsed((v) => !v), []);

  /* ---------------------------------------------------------- 会话 */

  const mapSessions = useCallback(
    (fn: (item: SessionGroup["items"][number]) => SessionGroup["items"][number] | null) => {
      setSessionGroups((groups) =>
        groups
          .map((g) => ({
            ...g,
            items: g.items.map(fn).filter((x): x is NonNullable<typeof x> => x !== null),
          }))
          .filter((g) => g.items.length > 0),
      );
    },
    [],
  );

  const newChat = useCallback(() => {
    const id = uid();
    setSessionGroups((groups) => {
      const first = groups[0];
      const rest = groups.slice(1);
      return [
        {
          ...first,
          items: [{ id, title: "新对话", updatedAt: "刚刚", messageCount: 0 }, ...first.items],
        },
        ...rest,
      ];
    });
    setActiveSessionId(id);
    navigate(Paths.session(id));
    setThreads((cur) => ({ ...cur, [id]: [] }));
    setDraft("");
    setEditing(null);
    setActiveTaskId(null);
    setNavState("research");
    showToast("已创建新对话");
  }, [showToast]);

  const renameSession = useCallback(
    (id: string, title: string) => {
      mapSessions((s) => (s.id === id ? { ...s, title } : s));
      showToast("会话已重命名");
    },
    [mapSessions, showToast],
  );

  const deleteSession = useCallback(
    (id: string) => {
      mapSessions((s) => (s.id === id ? null : s));
      setThreads((cur) => {
        if (!(id in cur)) return cur;
        const next = { ...cur };
        delete next[id];
        return next;
      });
      if (id === activeSessionId) {
        const remaining = sessionGroups
          .map((g) => ({ ...g, items: g.items.filter((s) => s.id !== id) }))
          .filter((g) => g.items.length > 0);
        const first = remaining[0]?.items[0];
        if (first) {
          /* 还有会话：激活第一组第一项 */
          setActiveSessionId(first.id);
          openSession(first.id);
        } else {
          /* 一个会话都没有了：静默新建一个空会话并激活 */
          const nid = uid();
          setSessionGroups([
            {
              label: "今天",
              items: [{ id: nid, title: "新对话", updatedAt: "刚刚", messageCount: 0 }],
            },
          ]);
          setThreads((cur) => ({ ...cur, [nid]: [] }));
          setActiveSessionId(nid);
          navigate(Paths.session(nid));
        }
        setEditing(null);
      }
      showToast("会话已删除");
    },
    [activeSessionId, mapSessions, openSession, sessionGroups, showToast],
  );

  const togglePinSession = useCallback(
    (id: string) => {
      let pinned = false;
      mapSessions((s) => {
        if (s.id !== id) return s;
        pinned = !s.pinned;
        return { ...s, pinned };
      });
      showToast(pinned ? "已置顶" : "已取消置顶");
    },
    [mapSessions, showToast],
  );

  /* -------------------------------------------------------- 知识库 */

  const toggleKb = useCallback((id: string) => {
    setSelectedKbIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  const clearSelectedKbs = useCallback(() => setSelectedKbIds([]), []);

  const createKb = useCallback(
    (input: KbDraft) => {
      const id = "kb-" + uid();
      const slug = input.slug.trim() || input.name.trim() || id;
      const tone = TINTS[knowledgeBases.length % TINTS.length];
      const kb: KnowledgeBase = {
        id,
        name: input.name.trim() || "未命名知识库",
        description: input.description.trim(),
        initial: (input.name.trim() || "?").slice(0, 1),
        tint: tone.tint,
        fg: tone.fg,
        docs: 0,
        size: "0 MB",
        updatedAt: "刚刚",
        tags: input.tags
          .split(/[\s/、,，]+/)
          .filter(Boolean)
          .slice(0, 3)
          .map((label, i) => ({
            label,
            tone: (["mint", "sky", "lav", "peach", "rose"] as const)[i % 5],
          })),
        readyPct: 0,
        slug,
        status: "empty",
        storage: {
          root: "heli/.knowledge/" + slug,
          source: "heli/.knowledge/" + slug + "/source",
          parsed: "heli/.knowledge/" + slug + "/parsed",
          vectordb: "heli/.knowledge/" + slug + "/vectordb",
          db: "heli/.knowledge/" + slug + "/datadb/kb.db",
        },
        embeddingModel: "heli-embed-v3",
        chunkStrategy: input.chunkStrategy,
        files: [],
        owner: "陈默",
      };
      setKnowledgeBases((cur) => [kb, ...cur]);
      commitUngrouped([id, ...ungroupedOrderRef.current]);
      showToast("已创建「" + kb.name + "」· 本地预览，未写入磁盘");
      return id;
    },
    [knowledgeBases.length, showToast],
  );

  const updateKb = useCallback(
    (id: string, patch: Partial<KnowledgeBase>) => {
      setKnowledgeBases((cur) => cur.map((k) => (k.id === id ? { ...k, ...patch } : k)));
      showToast("知识库已更新 · 本地预览，未写入后端");
    },
    [showToast],
  );

  const deleteKb = useCallback(
    (id: string) => {
      setKnowledgeBases((cur) => cur.filter((k) => k.id !== id));
      setSelectedKbIds((cur) => cur.filter((x) => x !== id));
      setKbSelection((cur) => cur.filter((x) => x !== id));
      setActiveKbId((cur) => (cur === id ? null : cur));
      /* 同步清理结构真源：从各层与未分层序中剔除（实体删除不进撤销栈） */
      commitGroups(
        kbGroupsRef.current
          .map((g) => ({ ...g, kbIds: g.kbIds.filter((x) => x !== id) }))
          .filter((g) => g.kbIds.length > 0 || g.childIds.length > 0),
      );
      commitUngrouped(ungroupedOrderRef.current.filter((x) => x !== id));
      /* 本体没了，镜像一并消失（只是引用边，不涉及实体双写） */
      const droppedMirrors = kbMirrorsRef.current.filter((m) => m.kbId === id).length;
      commitMirrors(kbMirrorsRef.current.filter((m) => m.kbId !== id));
      showToast(
        droppedMirrors > 0
          ? "知识库已删除 · " + droppedMirrors + " 处镜像一并移除 · 仅本地视图"
          : "知识库已删除 · 仅本地视图，磁盘目录未处理",
      );
    },
    [showToast],
  );

  const togglePinKb = useCallback((id: string) => {
    setKnowledgeBases((cur) => cur.map((k) => (k.id === id ? { ...k, pinned: !k.pinned } : k)));
  }, []);

  const removeKbFile = useCallback(
    (kbId: string, fileId: string) => {
      setKnowledgeBases((cur) =>
        cur.map((k) =>
          k.id === kbId
            ? {
                ...k,
                files: k.files.filter((f) => f.id !== fileId),
                docs: Math.max(0, k.docs - 1),
              }
            : k,
        ),
      );
      showToast("已从知识库移除 · 本地预览，索引未更新");
    },
    [showToast],
  );

  const reparseKbFile = useCallback(
    (kbId: string, fileId: string) => {
      setKnowledgeBases((cur) =>
        cur.map((k) =>
          k.id === kbId
            ? {
                ...k,
                files: k.files.map((f) => (f.id === fileId ? { ...f, status: "parsing" } : f)),
              }
            : k,
        ),
      );
      showToast("已标记重新解析 · 本地预览，未写入后端");
      window.setTimeout(() => {
        setKnowledgeBases((cur) =>
          cur.map((k) =>
            k.id === kbId
              ? {
                  ...k,
                  files: k.files.map((f) =>
                    f.id === fileId ? { ...f, status: "parsed", chunks: f.chunks || 120 } : f,
                  ),
                }
              : k,
          ),
        );
      }, 1800);
    },
    [showToast],
  );

  const openKbPage = useCallback((id: string) => {
    setNavState("knowledge");
    setActiveKbId(id);
  }, []);

  const closeKbPage = useCallback(() => setActiveKbId(null), []);

  const chatWithKb = useCallback(
    (id: string) => {
      setSelectedKbIds([id]);
      setNavState("research");
      setActiveKbId(null);
      const kb = knowledgeBases.find((k) => k.id === id);
      setDraft("基于《" + (kb?.name ?? "知识库") + "》提问：");
      showToast("已切换到「" + (kb?.name ?? "知识库") + "」，开始与之对话");
    },
    [knowledgeBases, showToast],
  );

  /* ---------------------------------------------------- 书架分层 */
  /* 分组只是视图：结构操作只改 kbGroups 与 ungroupedOrder，KnowledgeBase 实体不动。
     所有结构操作先把 {groups, ungroupedOrder} 整体压入撤销栈（上限 20），撤销 = 恢复快照。
     StrictMode 下 updater 不得有副作用，因此用 ref 镜像读当前值、
     提交时同步写 ref，保证连续动作读到的永远是最新状态。 */

  const kbGroupsRef = useRef(kbGroups);
  const ungroupedOrderRef = useRef(ungroupedOrder);
  const kbMirrorsRef = useRef(kbMirrors);
  const kbHistoryRef = useRef(kbHistory);

  const commitGroups = useCallback((next: KbGroup[]) => {
    kbGroupsRef.current = next;
    setKbGroups(next);
  }, []);

  const commitUngrouped = useCallback((next: string[]) => {
    ungroupedOrderRef.current = next;
    setUngroupedOrder(next);
  }, []);

  const commitMirrors = useCallback((next: KbMirror[]) => {
    kbMirrorsRef.current = next;
    setKbMirrors(next);
  }, []);

  const commitHistory = useCallback((next: KbHistoryEntry[]) => {
    kbHistoryRef.current = next;
    setKbHistory(next);
  }, []);

  const undoKb = useCallback(() => {
    const stack = kbHistoryRef.current;
    const last = stack[stack.length - 1];
    if (!last) {
      showToast("没有可撤销的操作");
      return;
    }
    commitHistory(stack.slice(0, -1));
    commitGroups(last.groups);
    commitUngrouped(last.ungroupedOrder);
    commitMirrors(last.mirrors ?? []);
    showToast("已撤销：" + last.label);
  }, [commitGroups, commitHistory, commitMirrors, commitUngrouped, showToast]);

  /** 结构操作统一入口：压快照 → 变更 → 按设计文档 §6 微文案 toast（带撤销） */
  const mutateStructure = useCallback(
    (
      label: string,
      nextGroups: KbGroup[],
      nextUngrouped: string[],
      toastMessage: string | null,
      nextMirrors?: KbMirror[],
    ) => {
      commitHistory([
        ...kbHistoryRef.current.slice(-19),
        {
          label,
          groups: kbGroupsRef.current,
          ungroupedOrder: ungroupedOrderRef.current,
          mirrors: kbMirrorsRef.current,
        },
      ]);
      commitGroups(nextGroups);
      commitUngrouped(nextUngrouped);
      commitMirrors(nextMirrors ?? kbMirrorsRef.current);
      if (toastMessage) showToast(toastMessage, { label: "撤销", onSelect: undoKb });
    },
    [commitGroups, commitHistory, commitMirrors, commitUngrouped, showToast, undoKb],
  );

  const createGroup = useCallback(
    (name: string) => {
      const group: KbGroup = {
        id: "g-" + uid(),
        name: name.trim() || "新分层",
        kbIds: [],
        collapsed: false,
        parentId: null,
        childIds: [],
        hue: hueAt(kbGroupsRef.current.length),
      };
      mutateStructure(
        "新建分层「" + group.name + "」",
        [...kbGroupsRef.current, group],
        ungroupedOrderRef.current,
        null,
      );
      return group.id;
    },
    [mutateStructure],
  );

  const renameGroup = useCallback(
    (id: string, name: string) => {
      const cur = kbGroupsRef.current;
      const group = cur.find((g) => g.id === id);
      const next = name.trim();
      if (!group || !next || group.name === next) return;
      mutateStructure(
        "将「" + group.name + "」重命名为「" + next + "」",
        cur.map((g) => (g.id === id ? { ...g, name: next } : g)),
        ungroupedOrderRef.current,
        "已重命名为「" + next + "」",
      );
    },
    [mutateStructure],
  );

  const dissolveGroup = useCallback(
    (id: string) => {
      const cur = kbGroupsRef.current;
      const group = cur.find((g) => g.id === id);
      if (!group) return;
      /* 解散 = 整棵子树的书回到未分层（保持相对顺序），组全部移除，组上的镜像一并撤下 */
      const doomed = new Set<string>();
      const walk = (gid: string) => {
        if (doomed.has(gid)) return;
        doomed.add(gid);
        cur.find((x) => x.id === gid)?.childIds.forEach(walk);
      };
      walk(id);
      const backToShelf = cur
        .filter((g) => doomed.has(g.id))
        .flatMap((g) => g.kbIds);
      const next = cur
        .filter((g) => !doomed.has(g.id))
        .map((g) => ({ ...g, childIds: g.childIds.filter((c) => !doomed.has(c)) }));
      mutateStructure(
        "解散「" + group.name + "」",
        next,
        [...ungroupedOrderRef.current, ...backToShelf],
        "「" + group.name + "」已解散，书都还在",
        kbMirrorsRef.current.filter((m) => !doomed.has(m.groupId)),
      );
    },
    [mutateStructure],
  );

  const moveKb = useCallback(
    (kbId: string, toGroupId: string | null, toIndex?: number) => {
      const cur = kbGroupsRef.current;
      const kb = knowledgeBases.find((k) => k.id === kbId);
      const sub = kb ? splitKbName(kb.name).sub : "这本书";
      const fromGroup = cur.find((g) => g.kbIds.includes(kbId)) ?? null;
      const toGroup = toGroupId ? (cur.find((g) => g.id === toGroupId) ?? null) : null;
      if (toGroupId && !toGroup) return;
      if (fromGroup?.id === toGroup?.id && toIndex === undefined) return;

      let next = cur.map((g) => ({ ...g, kbIds: g.kbIds.filter((id) => id !== kbId) }));
      let nextUngrouped = ungroupedOrderRef.current.filter((id) => id !== kbId);
      let label: string;
      let toastMessage: string | null;
      if (toGroup) {
        const gi = next.findIndex((g) => g.id === toGroup.id);
        const ids = [...next[gi].kbIds];
        const at =
          toIndex === undefined ? ids.length : Math.max(0, Math.min(toIndex, ids.length));
        ids.splice(at, 0, kbId);
        next[gi] = { ...next[gi], kbIds: ids };
        label = "将《" + sub + "》放入「" + toGroup.name + "」";
        toastMessage =
          fromGroup?.id === toGroup.id ? null : "已放入「" + toGroup.name + "」";
      } else {
        const at =
          toIndex === undefined
            ? nextUngrouped.length
            : Math.max(0, Math.min(toIndex, nextUngrouped.length));
        nextUngrouped = [...nextUngrouped];
        nextUngrouped.splice(at, 0, kbId);
        label = fromGroup
          ? "将《" + sub + "》移出「" + fromGroup.name + "」"
          : "移动《" + sub + "》";
        toastMessage = fromGroup ? "《" + sub + "》已移出，恢复独立陈列" : null;
      }
      /* 层空自动移除（层剩 1 本不自动拆，只处理真正空了的来源层；有子组的层不撤） */
      const emptied =
        fromGroup && fromGroup.id !== toGroup?.id
          ? next.find(
              (g) =>
                g.id === fromGroup.id && g.kbIds.length === 0 && g.childIds.length === 0,
            )
          : undefined;
      if (emptied) {
        next = next.filter((g) => g.id !== emptied.id);
        toastMessage = "「" + emptied.name + "」已空，这层就撤了";
      }
      /* 本体进到某层后，该层上这本书的镜像就多余了 */
      const nextMirrors = toGroup
        ? kbMirrorsRef.current.filter(
            (m) => !(m.kbId === kbId && m.groupId === toGroup.id),
          )
        : undefined;
      mutateStructure(label, next, nextUngrouped, toastMessage, nextMirrors);
    },
    [knowledgeBases, mutateStructure],
  );

  const moveMany = useCallback(
    (kbIds: string[], toGroupId: string | null, toIndex?: number) => {
      if (!kbIds.length) return;
      const cur = kbGroupsRef.current;
      const toGroup = toGroupId ? (cur.find((g) => g.id === toGroupId) ?? null) : null;
      if (toGroupId && !toGroup) return;
      const fromGroupIds = new Set(
        cur.filter((g) => g.kbIds.some((id) => kbIds.includes(id))).map((g) => g.id),
      );
      const drop = new Set(kbIds);
      let next = cur.map((g) => ({ ...g, kbIds: g.kbIds.filter((id) => !drop.has(id)) }));
      let nextUngrouped = ungroupedOrderRef.current.filter((id) => !drop.has(id));
      let label: string;
      let toastMessage: string | null;
      if (toGroup) {
        const gi = next.findIndex((g) => g.id === toGroup.id);
        const ids = [...next[gi].kbIds];
        const at =
          toIndex === undefined ? ids.length : Math.max(0, Math.min(toIndex, ids.length));
        ids.splice(at, 0, ...kbIds);
        next[gi] = { ...next[gi], kbIds: ids };
        label = "将 " + kbIds.length + " 个知识库放入「" + toGroup.name + "」";
        toastMessage = "已把 " + kbIds.length + " 个知识库放入「" + toGroup.name + "」";
      } else {
        const at =
          toIndex === undefined
            ? nextUngrouped.length
            : Math.max(0, Math.min(toIndex, nextUngrouped.length));
        nextUngrouped = [...nextUngrouped];
        nextUngrouped.splice(at, 0, ...kbIds);
        label = "将 " + kbIds.length + " 个知识库移出分层";
        toastMessage = kbIds.length + " 个知识库已移出，恢复独立陈列";
      }
      /* 被掏空的来源层自动撤层 */
      const emptiedNames: string[] = [];
      next = next.filter((g) => {
        if (
          g.kbIds.length === 0 &&
          g.childIds.length === 0 &&
          fromGroupIds.has(g.id) &&
          g.id !== toGroup?.id
        ) {
          emptiedNames.push(g.name);
          return false;
        }
        return true;
      });
      if (emptiedNames.length) toastMessage = "「" + emptiedNames[0] + "」已空，这层就撤了";
      const nextMirrors = toGroup
        ? kbMirrorsRef.current.filter(
            (m) => !(drop.has(m.kbId) && m.groupId === toGroup.id),
          )
        : undefined;
      mutateStructure(label, next, nextUngrouped, toastMessage, nextMirrors);
    },
    [mutateStructure],
  );

  /** 合并为一层：插入位置 = 选中列表中第一个有归属的项所在层位；全未分组 → 末尾 */
  const mergeMany = useCallback(
    (kbIds: string[], name: string) => {
      const unique = [...new Set(kbIds)];
      if (unique.length < 2) return "";
      const cur = kbGroupsRef.current;
      let at = cur.length;
      for (const id of unique) {
        const gi = cur.findIndex((g) => g.kbIds.includes(id));
        if (gi >= 0) {
          at = gi;
          break;
        }
      }
      const drop = new Set(unique);
      let next = cur
        .map((g) => ({ ...g, kbIds: g.kbIds.filter((id) => !drop.has(id)) }))
        .filter((g) => g.kbIds.length > 0 || g.childIds.length > 0);
      const nextUngrouped = ungroupedOrderRef.current.filter((id) => !drop.has(id));
      const group: KbGroup = {
        id: "g-" + uid(),
        name: name.trim() || "新分层",
        kbIds: unique,
        collapsed: false,
        parentId: null,
        childIds: [],
        hue: hueAt(next.length),
      };
      at = Math.min(at, next.length);
      next = [...next.slice(0, at), group, ...next.slice(at)];
      mutateStructure(
        "合并为「" + group.name + "」",
        next,
        nextUngrouped,
        "「" + group.name + "」立好了，" + unique.length + " 本书已上架",
      );
      return group.id;
    },
    [mutateStructure],
  );

  /** 两书合并是 mergeMany 的便捷封装，不重复实现 */
  const mergeKbs = useCallback(
    (aId: string, bId: string, name: string) => {
      if (aId === bId) return "";
      return mergeMany([aId, bId], name);
    },
    [mergeMany],
  );

  /** 建层 + 放入，单次快照（批量条「新建分组并放入」） */
  const groupKbs = useCallback(
    (kbIds: string[], name: string) => {
      const unique = [...new Set(kbIds)];
      if (!unique.length) return "";
      const drop = new Set(unique);
      const next = kbGroupsRef.current
        .map((g) => ({ ...g, kbIds: g.kbIds.filter((id) => !drop.has(id)) }))
        .filter((g) => g.kbIds.length > 0 || g.childIds.length > 0);
      const nextUngrouped = ungroupedOrderRef.current.filter((id) => !drop.has(id));
      const group: KbGroup = {
        id: "g-" + uid(),
        name: name.trim() || "新分层",
        kbIds: unique,
        collapsed: false,
        parentId: null,
        childIds: [],
        hue: hueAt(next.length),
      };
      mutateStructure(
        "新建分层「" + group.name + "」",
        [...next, group],
        nextUngrouped,
        "「" + group.name + "」立好了，" + unique.length + " 本书已上架",
      );
      return group.id;
    },
    [mutateStructure],
  );

  /** 拆分出口：批量移回未分层（保持给定顺序），被掏空的层自动撤掉 */
  const ungroupMany = useCallback(
    (kbIds: string[], toIndex?: number) => {
      const unique = [...new Set(kbIds)];
      if (!unique.length) return;
      const drop = new Set(unique);
      const next = kbGroupsRef.current
        .map((g) => ({ ...g, kbIds: g.kbIds.filter((id) => !drop.has(id)) }))
        .filter((g) => g.kbIds.length > 0 || g.childIds.length > 0);
      const base = ungroupedOrderRef.current.filter((id) => !drop.has(id));
      const at =
        toIndex === undefined ? base.length : Math.max(0, Math.min(toIndex, base.length));
      const nextUngrouped = [...base];
      nextUngrouped.splice(at, 0, ...unique);
      mutateStructure(
        "将 " + unique.length + " 个知识库移出分层",
        next,
        nextUngrouped,
        unique.length + " 个知识库已移出，恢复独立陈列",
      );
    },
    [mutateStructure],
  );

  /** 在领域下建子组（书盒）。树深上限领域 → 子组 → 书，越界拒绝并说明理由 */
  const createChildGroup = useCallback(
    (parentId: string, name: string) => {
      const cur = kbGroupsRef.current;
      const parent = cur.find((g) => g.id === parentId);
      if (!parent) return "";
      if (groupDepth(cur, parent) + 1 > KB_TREE_MAX_DEPTH - 1) {
        showToast("子组下不能再建子组（领域 → 子组 → 书，最多三层）");
        return "";
      }
      const child: KbGroup = {
        id: "g-" + uid(),
        name: name.trim() || "新子组",
        kbIds: [],
        collapsed: false,
        parentId: parent.id,
        childIds: [],
        hue: parent.hue,
      };
      mutateStructure(
        "在「" + parent.name + "」下新建子组「" + child.name + "」",
        [
          ...cur.map((g) =>
            g.id === parent.id ? { ...g, childIds: [...g.childIds, child.id] } : g,
          ),
          child,
        ],
        ungroupedOrderRef.current,
        "「" + child.name + "」已立进「" + parent.name + "」",
      );
      return child.id;
    },
    [mutateStructure, showToast],
  );

  /** 建立镜像：把选中的书引用到另一个组。本体不动，只多一条引用边。
      批量走一次快照，避免 N 本书压 N 次撤销。 */
  const addMirrors = useCallback(
    (kbIds: string[], groupId: string) => {
      const cur = kbGroupsRef.current;
      const group = cur.find((g) => g.id === groupId);
      if (!group) return;
      const picked = [...new Set(kbIds)].filter((id) => {
        if (!knowledgeBases.some((k) => k.id === id)) return false;
        /* 本体已在这层、或这里已有镜像 —— 都不重复建 */
        if (cur.some((g) => g.id === groupId && g.kbIds.includes(id))) return false;
        return !kbMirrorsRef.current.some((m) => m.kbId === id && m.groupId === groupId);
      });
      if (!picked.length) {
        showToast("选中的书已经在「" + group.name + "」里了");
        return;
      }
      mutateStructure(
        "在「" + group.name + "」引用 " + picked.length + " 本书",
        cur,
        ungroupedOrderRef.current,
        picked.length + " 本书在「" + group.name + "」又出现了一次，本体仍在原处",
        [...kbMirrorsRef.current, ...picked.map((kbId) => ({ kbId, groupId }))],
      );
    },
    [knowledgeBases, mutateStructure, showToast],
  );

  /** 单本镜像：批量入口的便捷封装 */
  const addMirror = useCallback(
    (kbId: string, groupId: string) => addMirrors([kbId], groupId),
    [addMirrors],
  );

  /** 拖动子组（书盒）：同级调序，或改挂到另一个领域。树深上限不变，越界拒绝。 */
  const moveGroup = useCallback(
    (groupId: string, toParentId: string, toIndex?: number) => {
      const cur = kbGroupsRef.current;
      const group = cur.find((g) => g.id === groupId);
      const toParent = cur.find((g) => g.id === toParentId);
      if (!group || !toParent || group.id === toParentId) return;
      if (toParent.parentId) {
        showToast("子组下不能再放子组（领域 → 子组 → 书，最多三层）");
        return;
      }
      if (group.childIds.length > 0 && toParent.parentId) return;
      const sameLevel = group.parentId === toParentId;
      if (sameLevel && toIndex === undefined) return;

      let next = cur.map((g) =>
        group.parentId && g.id === group.parentId
          ? { ...g, childIds: g.childIds.filter((c) => c !== groupId) }
          : g,
      );
      const siblings = (
        next.find((g) => g.id === toParentId)?.childIds ?? []
      ).filter((c) => c !== groupId);
      const at =
        toIndex === undefined
          ? siblings.length
          : Math.max(0, Math.min(toIndex, siblings.length));
      siblings.splice(at, 0, groupId);
      next = next.map((g) =>
        g.id === toParentId
          ? { ...g, childIds: siblings }
          : g.id === groupId
            ? { ...g, parentId: toParentId, hue: toParent.hue }
            : g,
      );
      mutateStructure(
        sameLevel
          ? "调整子组「" + group.name + "」的顺序"
          : "把子组「" + group.name + "」移到「" + toParent.name + "」下",
        next,
        ungroupedOrderRef.current,
        sameLevel ? null : "「" + group.name + "」已移到「" + toParent.name + "」下",
      );
    },
    [mutateStructure, showToast],
  );

  /** 撤下镜像：只删引用边，本体不受影响 */
  const removeMirror = useCallback(
    (kbId: string, groupId: string) => {
      const cur = kbMirrorsRef.current;
      if (!cur.some((m) => m.kbId === kbId && m.groupId === groupId)) return;
      const kb = knowledgeBases.find((k) => k.id === kbId);
      const sub = kb ? splitKbName(kb.name).sub : "这本书";
      mutateStructure(
        "撤下《" + sub + "》的镜像",
        kbGroupsRef.current,
        ungroupedOrderRef.current,
        "镜像已撤下，本体不受影响",
        cur.filter((m) => !(m.kbId === kbId && m.groupId === groupId)),
      );
    },
    [knowledgeBases, mutateStructure],
  );

  const reorderGroup = useCallback(
    (from: number, to: number) => {
      const cur = kbGroupsRef.current;
      if (from === to || from < 0 || to < 0 || from >= cur.length || to >= cur.length)
        return;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      mutateStructure(
        "调整分层「" + moved.name + "」的顺序",
        next,
        ungroupedOrderRef.current,
        null,
      );
    },
    [mutateStructure],
  );

  const reorderKb = useCallback(
    (groupId: string, from: number, to: number) => {
      const cur = kbGroupsRef.current;
      const group = cur.find((g) => g.id === groupId);
      if (
        !group ||
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= group.kbIds.length ||
        to >= group.kbIds.length
      )
        return;
      const ids = [...group.kbIds];
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      mutateStructure(
        "调整「" + group.name + "」内书序",
        cur.map((g) => (g.id === groupId ? { ...g, kbIds: ids } : g)),
        ungroupedOrderRef.current,
        null,
      );
    },
    [mutateStructure],
  );

  const reorderUngrouped = useCallback(
    (from: number, to: number) => {
      const cur = ungroupedOrderRef.current;
      if (from === to || from < 0 || to < 0 || from >= cur.length || to >= cur.length)
        return;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      mutateStructure("调整未分层书序", kbGroupsRef.current, next, null);
    },
    [mutateStructure],
  );

  /** 一次性重排：重写 ungroupedOrder 与各层 kbIds，压一次快照；之后仍可被拖拽覆盖 */
  const applyKbSort = useCallback(
    (key: KbSortKey) => {
      setKbSort(key);
      if (key === "manual") return;
      const byId = new Map(knowledgeBases.map((k) => [k.id, k]));
      const cmp =
        key === "name"
          ? (a: string, b: string) =>
              (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? "", "zh-CN")
          : key === "size"
            ? (a: string, b: string) =>
                parseFloat(byId.get(b)?.size ?? "0") - parseFloat(byId.get(a)?.size ?? "0")
            : (a: string, b: string) =>
                (byId.get(a)?.updatedAt ?? "").localeCompare(
                  byId.get(b)?.updatedAt ?? "",
                  "zh-CN",
                );
      const label =
        key === "name" ? "按名称排序" : key === "size" ? "按容量排序" : "按更新时间排序";
      mutateStructure(
        label,
        kbGroupsRef.current.map((g) => ({ ...g, kbIds: [...g.kbIds].sort(cmp) })),
        [...ungroupedOrderRef.current].sort(cmp),
        "已" + label + "（仍可拖拽调整）",
      );
    },
    [knowledgeBases, mutateStructure],
  );

  const toggleKbSelection = useCallback((id: string, additive = false) => {
    setKbSelection((cur) => {
      if (additive) return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return cur.length === 1 && cur[0] === id ? [] : [id];
    });
  }, []);

  const clearKbSelection = useCallback(() => setKbSelection([]), []);

  /** 折叠不是结构操作：不压快照，不进撤销栈 */
  const toggleCollapsed = useCallback(
    (id: string) => {
      commitGroups(
        kbGroupsRef.current.map((g) =>
          g.id === id ? { ...g, collapsed: !g.collapsed } : g,
        ),
      );
    },
    [commitGroups],
  );

  /* ------------------------------------------------------ 任务模板 */

  const saveTask = useCallback(
    (task: TaskTemplate) => {
      setTasks((cur) => {
        const idx = cur.findIndex((t) => t.id === task.id);
        return idx >= 0 ? cur.map((t) => (t.id === task.id ? task : t)) : [...cur, task];
      });
      showToast("任务模板已保存 · 本地预览，未写入后端");
    },
    [showToast],
  );

  const deleteTask = useCallback(
    (id: string) => {
      setTasks((cur) => cur.filter((t) => t.id !== id));
      showToast("任务模板已删除 · 本地预览，未写入后端");
    },
    [showToast],
  );

  const runTask = useCallback(
    (task: TaskTemplate) => {
      setDraft(task.prompt);
      setActiveTaskId(task.id);
      if (task.suggestKbIds.length) setSelectedKbIds(task.suggestKbIds);
      if (task.id === "t-forecast") setWebEnabled(true);
      setNavState("research");
      showToast("已载入「" + task.title + "」任务背景");
    },
    [showToast],
  );

  /* ---------------------------------------------------------- 成果 */

  const saveArtifact = useCallback(
    (id: string, patch: Partial<Artifact>) => {
      setArtifacts((cur) => cur.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      showToast("成果已保存 · 本地预览，未写入后端");
    },
    [showToast],
  );

  const deleteArtifact = useCallback(
    (id: string) => {
      setArtifacts((cur) => cur.filter((a) => a.id !== id));
      setPreview((cur) => (cur?.kind === "artifact" && cur.artifactId === id ? null : cur));
      showToast("成果已删除 · 本地预览，未写入后端");
    },
    [showToast],
  );

  const createArtifact = useCallback(() => {
    const id = "a-" + uid();
    setArtifacts((cur) => [
      {
        id,
        title: "未命名成果",
        type: "text",
        status: "draft",
        /* 手动新建不自动绑定当前检索库，关联知识库在编辑器里自行勾选 */
        kbIds: [],
        citationCount: 0,
        origin: "手动新建",
        meta: ["草稿"],
        updatedAt: "刚刚",
        blocks: [{ kind: "p", text: "在这里开始写，或让 heli 基于已选知识库生成一版。" }],
      },
      ...cur,
    ]);
    showToast("已新建空白成果");
    return id;
  }, [showToast]);

  /* -------------------------------------------------- 提示词 / Skill */

  const savePrompt = useCallback(
    (card: PromptCard) => {
      setPrompts((cur) => {
        const idx = cur.findIndex((p) => p.id === card.id);
        return idx >= 0 ? cur.map((p) => (p.id === card.id ? card : p)) : [card, ...cur];
      });
      showToast(card.kind === "skill" ? "Skill 已保存 · 本地预览，未写入后端" : "提示词已保存 · 本地预览，未写入后端");
    },
    [showToast],
  );

  const deletePrompt = useCallback(
    (id: string) => {
      setPrompts((cur) => cur.filter((p) => p.id !== id));
      showToast("已删除 · 本地预览，未写入后端");
    },
    [showToast],
  );

  const applyPrompt = useCallback(
    (card: PromptCard) => {
      setDraft((cur) => (cur ? cur + "\n\n" + card.content : card.content));
      setNavState("research");
      setPrompts((cur) => cur.map((p) => (p.id === card.id ? { ...p, usage: p.usage + 1 } : p)));
      showToast(
        card.kind === "skill"
          ? "已挂载 Skill「" + card.title + "」"
          : "已插入提示词「" + card.title + "」",
      );
    },
    [showToast],
  );

  /* ------------------------------------------------------ 右侧面板 */

  /* 未保存的成果正在编辑时，替换面板内容前先让用户保存或放弃（U8） */
  const guardUnsavedArtifact = useCallback(
    (proceed: () => void) => {
      if (!pendingArtifactSave) {
        proceed();
        return;
      }
      setConfirm({
        title: "这份成果还没保存",
        message: "继续操作会替换正在编辑的内容。可以先保存，也可以放弃这次修改。",
        confirmText: "保存并继续",
        onConfirm: () => {
          const save = pendingArtifactSave;
          setPendingArtifactSave(() => null);
          save();
          proceed();
        },
        alt: {
          label: "放弃修改",
          onSelect: () => {
            setPendingArtifactSave(() => null);
            proceed();
          },
        },
      });
    },
    [pendingArtifactSave],
  );

  const openPreview = useCallback(
    (target: NonNullable<PreviewTarget>) => {
      guardUnsavedArtifact(() => {
        /* 固定中的面板不自动覆盖：先登记，等用户明确点「替换」（§8.1） */
        if (panelPinned && inspectorOpen) {
          setPanelPending(target);
          return;
        }
        setPreview(target);
        setSearchParams({ panel: encodePanel(target) });
      });
    },
    [guardUnsavedArtifact, inspectorOpen, panelPinned],
  );

  const togglePanelPin = useCallback(() => {
    setSearchParams({ pin: panelPinned ? null : "1" });
    if (panelPinned) setPanelPending(null);
    showToast(
      panelPinned
        ? "已取消固定：之后的点击会替换面板内容"
        : "已固定：之后的点击不再自动覆盖，需要时点「替换」",
    );
  }, [panelPinned, showToast]);

  const replacePanel = useCallback(() => {
    const target = panelPending;
    if (!target) return;
    setPanelPending(null);
    setPreview(target);
    setSearchParams({ panel: encodePanel(target) });
  }, [panelPending]);

  const dismissPanelPending = useCallback(() => setPanelPending(null), []);

  /* 关闭时一并解除固定，避免「面板看不见却仍在吞掉点击」 */
  const closeInspector = useCallback(() => {
    setPanelPending(null);
    setSearchParams({ panel: null, pin: null });
  }, []);
  const toggleInspector = useCallback(() => {
    if (inspectorOpen) {
      setSearchParams({ panel: null });
      return;
    }
    /* 没有目标时只开面板（例如资料库的库概览还没指定内容） */
    setSearchParams({ panel: preview ? encodePanel(preview) : "panel" });
  }, [inspectorOpen, preview]);
  const setWidth = useCallback((w: number) => setInspectorWidth(Math.min(760, Math.max(340, w))), []);

  /* ------------------------------------------------------ 抽屉弹窗 */

  const openNewKb = useCallback(() => setDrawer({ kind: "new-kb" }), []);
  const openKbSettings = useCallback((kbId: string) => setDrawer({ kind: "kb-settings", kbId }), []);
  const openCitation = useCallback(
    (citation: Citation) =>
      guardUnsavedArtifact(() => setDrawer({ kind: "citation", citation })),
    [guardUnsavedArtifact],
  );
  const openDocDrawer = useCallback(
    (doc: KnowledgeDocument, kbId?: string) => setDrawer({ kind: "doc", doc, kbId }),
    [],
  );
  const openTaskEditor = useCallback(
    (taskId?: string) => setDrawer({ kind: "task-editor", taskId }),
    [],
  );
  const openPromptEditor = useCallback(
    (promptId?: string, presetKind?: "prompt" | "skill") =>
      setDrawer({ kind: "prompt-editor", promptId, presetKind }),
    [],
  );
  const openArtifactEditor = useCallback(
    (artifactId: string) => setDrawer({ kind: "artifact-editor", artifactId }),
    [],
  );
  const openImport = useCallback((kbId?: string) => setDrawer({ kind: "import", kbId }), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const askConfirm = useCallback((c: ConfirmState) => setConfirm(c), []);
  /* 存的是函数，必须包一层，否则会被当成 setState 的更新函数 */
  const registerArtifactDraft = useCallback(
    (save: (() => void) | null) => setPendingArtifactSave(() => save),
    [],
  );
  const closeConfirm = useCallback(() => setConfirm(null), []);

  /* ---------------------------------------------------------- 对话 */

  const runAssistant = useCallback(
    (
      base: ChatMessage[],
      question: string,
      taskId?: string | null,
      versions?: AnswerVersion[],
    ) => {
      /* 捕获调用时的会话：用户中途切换会话，生成仍落回原会话 */
      const sessionId = activeSessionId;
      setStreaming(true);

      const assistantId = uid();
      /* 运行 id 与消息同生：停止时用它与后端对齐（后端就绪后换成真实 runId） */
      runIdRef.current = assistantId;
      setStopPhase("idle");
      setStreamingId(assistantId);
      updateThread(sessionId, () => [
        ...base,
        {
          id: assistantId,
          role: "assistant",
          time: nowTime(),
          model,
          taskId: taskId ?? undefined,
          versions: versions?.length ? versions : undefined,
          trace: { summary: "思考中 · 1/" + PENDING_STEPS.length + " 步", steps: stepsUpTo(1) },
        },
      ]);

      let revealed = 1;
      const timer = window.setInterval(() => {
        revealed += 1;

        if (revealed < PENDING_STEPS.length) {
          updateThread(sessionId, (cur) =>
            cur.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    trace: {
                      summary: "思考中 · " + revealed + "/" + PENDING_STEPS.length + " 步",
                      steps: stepsUpTo(revealed),
                    },
                  }
                : m,
            ),
          );
          return;
        }

        window.clearInterval(timer);
        timers.current.delete(assistantId);
        const metrics = deriveMetrics(question, selectedKbIds.length, webEnabled);
        const blocks = [
          {
            kind: "p" as const,
            text: "已经在所选知识库中完成了检索与重排。下面按「发展脉络 → 成果与收益 → 后续影响」三段组织结论，每处判断都标出了来源编号。",
          },
          { kind: "h" as const, text: "需要确认的一点" },
          {
            kind: "list" as const,
            items: [
              "这个问题的口径在两份材料间存在差异：产业报告偏保守，白皮书更激进。我按白皮书 2024 版口径统一，并在正文保留了差异说明。",
              "如果你希望严格限定在某一年份区间或某条技术路线，告诉我范围，我可以重跑一次检索。",
            ],
          },
          { kind: "report" as const, fileName: "分析报告.docx", meta: ["草稿", "可导出 Word"] },
        ];

        updateThread(sessionId, (cur) =>
          cur.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  trace: {
                    summary:
                      PENDING_STEPS.length +
                      " 步 · 共 " +
                      (metrics.thinkingMs / 1000).toFixed(1) +
                      "s",
                    steps: finishedSteps(),
                  },
                  blocks,
                  citations: SEED_THREAD[1].citations,
                  metrics,
                  feedback: null,
                }
              : m,
          ),
        );
        setStreaming(false);
        setStreamingId(null);

        /* 同步会话列表里的消息数与更新时间 */
        setSessionGroups((groups) =>
          groups.map((g) => ({
            ...g,
            items: g.items.map((s) =>
              s.id === sessionId
                ? { ...s, messageCount: base.length + 1, updatedAt: nowTime() }
                : s,
            ),
          })),
        );

        /* 会话产生的产出沉淀为成果，可在成果板块继续编辑与导出 */
        const artifactId = "a-" + uid();
        setArtifacts((cur) => [
          {
            id: artifactId,
            title: question.slice(0, 28) || "未命名成果",
            type: "data",
            status: "done",
            taskId: taskId ?? undefined,
            kbIds: selectedKbIds,
            citationCount: 5,
            sessionId,
            origin: "来自当前会话",
            meta: ["自动生成", "引注 5 处"],
            updatedAt: "刚刚",
            blocks,
            citations: SEED_THREAD[1].citations,
            metrics,
          },
          ...cur,
        ]);

        if (autoMode) {
          setPreview({ kind: "artifact", artifactId });
          setSearchParams({ panel: encodePanel({ kind: "artifact", artifactId }) });
        }
      }, 620);

      timers.current.set(assistantId, timer);
    },
    [activeSessionId, autoMode, model, selectedKbIds, updateThread, webEnabled],
  );

  const send = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || streaming) return;

      setDraft("");
      const cutAt = editing ? thread.findIndex((m) => m.id === editing.id) : -1;
      const base = cutAt >= 0 ? thread.slice(0, cutAt) : thread;
      const wasEditing = Boolean(editing);
      setEditing(null);

      /* 首次发问时用问题前 18 字自动命名会话 */
      mapSessions((s) =>
        s.id === activeSessionId && s.title === "新对话"
          ? { ...s, title: value.slice(0, 18) }
          : s,
      );

      runAssistant(
        [...base, { id: uid(), role: "user", time: nowTime(), text: value }],
        value,
        activeTaskId,
      );

      if (wasEditing) showToast("已从编辑处重新生成");
    },
    [activeSessionId, activeTaskId, editing, mapSessions, runAssistant, showToast, streaming, thread],
  );

  const regenerate = useCallback(
    (assistantId: string) => {
      if (streaming) return;
      const idx = thread.findIndex((m) => m.id === assistantId);
      const question = idx > 0 ? thread[idx - 1] : undefined;
      if (!question?.text) {
        showToast("找不到对应的提问，无法重新生成");
        return;
      }
      setEditing(null);
      const prev = thread[idx];
      /* 把当前回答快照压入版本栈，重新生成后可来回翻看 */
      const prevVersions: AnswerVersion[] = [
        ...(prev?.versions ?? []),
        {
          blocks: prev?.blocks,
          citations: prev?.citations,
          metrics: prev?.metrics,
          trace: prev?.trace,
          stopped: prev?.stopped,
        },
      ];
      runAssistant(thread.slice(0, idx), question.text, prev?.taskId ?? activeTaskId, prevVersions);
      showToast("正在重新生成");
    },
    [activeTaskId, runAssistant, showToast, streaming, thread],
  );

  /* 把某条消息标成已停止，并改写阶段摘要（U7 的两个语义写在这里） */
  const markStopped = useCallback((messageId: string, summary: string) => {
    /* 生成中的消息可能在非当前会话（用户中途切换过），全量找一遍 */
    setThreads((cur) => {
      const next: Record<string, ChatMessage[]> = { ...cur };
      for (const sid of Object.keys(next)) {
        if (next[sid].some((m) => m.id === messageId)) {
          next[sid] = next[sid].map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  stopped: true,
                  trace: m.trace ? { ...m.trace, summary } : m.trace,
                }
              : m,
          );
        }
      }
      return next;
    });
  }, []);

  /* 请求后端取消一次运行；成功才算真的停了（U7） */
  const cancelRun = useCallback(
    (messageId: string, runId: string) => {
      setStopPhase("requested");
      markStopped(messageId, "停止请求已发出，等待后端确认");
      runsApi
        .cancel(runId)
        .then(() => {
          setStopPhase("confirmed");
          markStopped(messageId, "已停止 · 后端已确认");
        })
        .catch((cause: unknown) => {
          const error = normalizeError(cause);
          setStopPhase("unconfirmed");
          markStopped(messageId, "已停止 · 后端未确认");
          showToast(`停止请求未获后端确认：${error.message}。${error.next}`, {
            label: "重试取消",
            onSelect: () => {
              const target = lastStop.current;
              if (target) cancelRef.current(target.messageId, target.runId);
            },
          });
        });
    },
    [markStopped, showToast],
  );
  cancelRef.current = cancelRun;

  const retryStop = useCallback(() => {
    const target = lastStop.current;
    if (target) cancelRef.current(target.messageId, target.runId);
  }, []);

  /* 停止：先停本地渲染，再请求后端取消；切换页面不会走到这里（§7.2） */
  const stopStreaming = useCallback(() => {
    const id = streamingId;
    if (!id) return;
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearInterval(timer);
      timers.current.delete(id);
    }
    setStreaming(false);
    setStreamingId(null);
    const runId = runIdRef.current ?? id;
    lastStop.current = { messageId: id, runId };
    cancelRef.current(id, runId);
  }, [streamingId]);

  /* 切换查看某条回答的历史版本；index 为 null 回到最新版 */
  const setViewVersion = useCallback(
    (messageId: string, index: number | null) => {
      updateThread(activeSessionId, (cur) =>
        cur.map((m) => (m.id === messageId ? { ...m, viewVersion: index } : m)),
      );
    },
    [activeSessionId, updateThread],
  );

  const setFeedback = useCallback(
    (messageId: string, value: "up" | "down") => {
      updateThread(activeSessionId, (cur) =>
        cur.map((m) =>
          m.id === messageId ? { ...m, feedback: m.feedback === value ? null : value } : m,
        ),
      );
      showToast(value === "up" ? "已记录（本地）：回答有帮助" : "已记录（本地）：需要改进，会用于检索策略调优");
    },
    [activeSessionId, showToast, updateThread],
  );

  const startEdit = useCallback(
    (message: ChatMessage) => {
      if (streaming) {
        showToast("正在生成中，请稍后再编辑");
        return;
      }
      setEditing({ id: message.id, role: message.role });
      if (message.role === "user") {
        setDraft(message.text ?? "");
      } else {
        setDraft(
          (message.blocks ?? [])
            .map((b) =>
              b.kind === "h"
                ? "## " + b.text
                : b.kind === "p"
                  ? b.text.replace(/\[\[(\d+)\]\]/g, "[$1]")
                  : "",
            )
            .filter(Boolean)
            .join("\n\n"),
        );
      }
      setNavState("research");
      showToast(
        message.role === "user"
          ? "编辑后发送，将从这条消息重新生成回答"
          : "已载入输入框，改完可作为新提问发送",
      );
    },
    [showToast, streaming],
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft("");
  }, []);

  const toggleWeb = useCallback(() => setWebEnabled((v) => !v), []);
  const toggleAutoMode = useCallback(() => setAutoMode((v) => !v), []);

  const value = useMemo<StoreValue>(
    () => ({
      nav,
      setNav,
      sidebarCollapsed,
      toggleSidebar,
      panelQuery,
      setPanelQuery,

      sessionGroups,
      activeSessionId,
      setActiveSessionId,
      openSession,
      newChat,
      renameSession,
      deleteSession,
      togglePinSession,

      knowledgeBases,
      selectedKbIds,
      toggleKb,
      setSelectedKbIds,
      clearSelectedKbs,
      createKb,
      updateKb,
      deleteKb,
      togglePinKb,
      removeKbFile,
      reparseKbFile,
      activeKbId,
      openKbPage,
      closeKbPage,
      chatWithKb,
      kbView,
      setKbView,
      kbSort,
      applyKbSort,
      ungroupedOrder,
      kbSelection,
      toggleKbSelection,
      clearKbSelection,
      kbGroups,
      kbMirrors,
      kbViewLocal: true,
      kbViewSavedAt,
      createGroup,
      createChildGroup,
      addMirror,
      addMirrors,
      removeMirror,
      moveGroup,
      renameGroup,
      dissolveGroup,
      moveKb,
      moveMany,
      mergeKbs,
      mergeMany,
      groupKbs,
      ungroupMany,
      reorderGroup,
      reorderKb,
      reorderUngrouped,
      toggleCollapsed,
      undoKb,

      tasks,
      reportTemplates: REPORT_TEMPLATES,
      saveTask,
      deleteTask,
      runTask,

      artifacts,
      saveArtifact,
      deleteArtifact,
      createArtifact,

      prompts,
      savePrompt,
      deletePrompt,
      applyPrompt,

      inspectorOpen,
      panelUnresolved,
      panelPinned,
      panelPending,
      inspectorWidth,
      preview: effectivePreview,
      openPreview,
      closeInspector,
      toggleInspector,
      togglePanelPin,
      replacePanel,
      dismissPanelPending,
      setInspectorWidth: setWidth,

      drawer,
      openNewKb,
      openKbSettings,
      openCitation,
      openDocDrawer,
      openTaskEditor,
      openPromptEditor,
      openArtifactEditor,
      openImport,
      closeDrawer,
      confirm,
      askConfirm,
      registerArtifactDraft,
      closeConfirm,

      thread,
      streaming,
      send,
      regenerate,
      stopStreaming,
      stopPhase,
      retryStop,
      setViewVersion,
      setFeedback,
      editing,
      startEdit,
      cancelEdit,
      draft,
      setDraft,
      activeTaskId,
      setActiveTaskId,

      webEnabled,
      toggleWeb,
      autoMode,
      toggleAutoMode,
      model,
      setModel,
      models: MODELS,

      toast,
      showToast,
    }),
    [
      nav,
      setNav,
      sidebarCollapsed,
      toggleSidebar,
      panelQuery,
      sessionGroups,
      activeSessionId,
      newChat,
      renameSession,
      deleteSession,
      togglePinSession,
      knowledgeBases,
      selectedKbIds,
      toggleKb,
      clearSelectedKbs,
      createKb,
      updateKb,
      deleteKb,
      togglePinKb,
      removeKbFile,
      reparseKbFile,
      activeKbId,
      openKbPage,
      closeKbPage,
      chatWithKb,
      kbView,
      kbSort,
      applyKbSort,
      ungroupedOrder,
      kbSelection,
      toggleKbSelection,
      clearKbSelection,
      kbGroups,
      kbMirrors,
      kbViewSavedAt,
      createGroup,
      createChildGroup,
      addMirror,
      addMirrors,
      removeMirror,
      moveGroup,
      renameGroup,
      dissolveGroup,
      moveKb,
      moveMany,
      mergeKbs,
      mergeMany,
      groupKbs,
      ungroupMany,
      reorderGroup,
      reorderKb,
      reorderUngrouped,
      toggleCollapsed,
      undoKb,
      tasks,
      saveTask,
      deleteTask,
      runTask,
      artifacts,
      saveArtifact,
      deleteArtifact,
      createArtifact,
      prompts,
      savePrompt,
      deletePrompt,
      applyPrompt,
      inspectorOpen,
      panelUnresolved,
      panelPinned,
      panelPending,
      inspectorWidth,
      preview,
      effectivePreview,
      openPreview,
      closeInspector,
      toggleInspector,
      togglePanelPin,
      replacePanel,
      dismissPanelPending,
      setWidth,
      drawer,
      openNewKb,
      openKbSettings,
      openCitation,
      openDocDrawer,
      openTaskEditor,
      openPromptEditor,
      openArtifactEditor,
      openImport,
      closeDrawer,
      confirm,
      askConfirm,
      registerArtifactDraft,
      closeConfirm,
      thread,
      streaming,
      send,
      regenerate,
      stopStreaming,
      stopPhase,
      retryStop,
      setViewVersion,
      setFeedback,
      editing,
      startEdit,
      cancelEdit,
      draft,
      activeTaskId,
      webEnabled,
      toggleWeb,
      autoMode,
      toggleAutoMode,
      model,
      toast,
      showToast,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore 必须在 <StoreProvider> 内部使用");
  return ctx;
}
