/* 库内：定位 → 选文件 → 读正文。三栏：分组/目录 → 文件 → 阅读器。
   定位方式按库自适应：
     有目录结构（多个目录）→ 目录树，跟文件系统一致；
     平层（全部在一个目录）→ 按文件名开头的年份分组，因为平层库摆目录树只会得到
     一个「全部」节点，等于没分组，而立项年份是这批资料真实的语义维度。 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icons";
import { Button, Chip, EmptyState, Field, SearchField, Highlight, inputCls } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { Paths, navigate, useRoute } from "../app/router";
import { api, type Hit, type Library, type Source } from "../model/api";
import { outlineOf, parseSourceName, splitFrontmatter, labelOf, visibleFields } from "../model/sourceMeta";
import { useWorkspace } from "../model/store";
import { describeError } from "../model/errors";

const STATUS_LABEL: Record<Source["status"], { text: string; tone: "mint" | "peach" | "gray" }> = {
  indexed: { text: "已索引", tone: "mint" },
  registered: { text: "仅登记", tone: "peach" },
  undecodable: { text: "无法解码", tone: "gray" },
};

/** 一个分组一次渲染太多行会卡；超过这个数裁剪并说明 */
const FILE_PAGE = 300;

interface DirNode {
  path: string;
  name: string;
  files: Source[];
  children: DirNode[];
  count: number;
}

function sizeText(size: number | null): string {
  if (!size) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function filePath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && rel.length ? rel : file.name;
}

/** 按路径分段建树；根用空 path 表示「全部」 */
function buildTree(sources: Source[]): DirNode {
  const root: DirNode = { path: "", name: "全部", files: [], children: [], count: sources.length };
  for (const source of sources) {
    const segments = source.path.split("/").filter(Boolean);
    if (segments.length <= 1) {
      root.files.push(source);
      continue;
    }
    let node = root;
    let prefix = "";
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let next = node.children.find((child) => child.name === segment);
      if (!next) {
        next = { path: prefix, name: segment, files: [], children: [], count: 0 };
        node.children.push(next);
      }
      node = next;
      node.count += 1;
    }
    node.files.push(source);
  }
  const sortNode = (node: DirNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    for (const child of node.children) sortNode(child);
  };
  sortNode(root);
  return root;
}

/** 平层库：从「2018_2021_...」这类文件名里取立项年份 */
function yearGroups(sources: Source[]): Map<string, Source[]> {
  const groups = new Map<string, Source[]>();
  for (const source of sources) {
    const name = source.path.split("/").pop() ?? source.path;
    const matched = /^(\d{4})/.exec(name);
    const key = matched ? `${matched[1]} 年` : "其他";
    const bucket = groups.get(key);
    if (bucket) bucket.push(source);
    else groups.set(key, [source]);
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")));
}

const MARKDOWN_EXT = /\.(md|markdown|rst)$/i;

/** 资料库阅读器：按内容形态与命中状态分派。
 *
 *  - 全文阅读且是 Markdown（md/markdown/rst）→ 用 <Markdown> 渲染排版正文；
 *  - 带命中定位（position != null）→ 保持纯文本 + 高亮，不破坏证据定位；
 *  - 其余格式（txt/json/csv/pdf 派生等）→ 纯文本，保留命中高亮。
 * 这样给 markdown 排版，又不在渲染后文本节点上做字符区间定位（定位会失配）。
 */
function TextReader({
  text,
  position,
  markdown,
  title,
}: {
  text: string;
  position: number | null;
  markdown: boolean;
  /** 标题条上已显示的项目名；用来去掉正文里重复的 H1 */
  title: string;
}) {
  const ref = useRef<HTMLPreElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    if (position == null || !ref.current) return;
    const ratio = text.length ? position / text.length : 0;
    ref.current.scrollTop = Math.max(0, ratio * ref.current.scrollHeight - 80);
  }, [position, text]);

  /* frontmatter 先拆出来：它是元数据，不是正文。原样铺在开头时，
     第一屏全是 `id: 3f98131e…`，真正的内容要往下滚才看得见。 */
  const { fields, body: rawBody } = useMemo(() => splitFrontmatter(text), [text]);
  /* 正文首行常是 `# <项目名>`，与上方标题条完全重复。
     只在那一个 H1 与标题文本相同时去掉，不碰其他结构。 */
  const body = useMemo(() => {
    const match = /^#\s+(.+?)\s*\n+/.exec(rawBody);
    return match && title && match[1].trim() === title.trim() ? rawBody.slice(match[0].length) : rawBody;
  }, [rawBody, title]);
  const meta = visibleFields(fields);
  /* 正文自己已经排了一张项目信息表时，顶部再摆一条就是同一份数据说两遍。
     不逐个字段比字符串（表格里的「30.0」与 frontmatter 的「30.0」很容易差一点），
     直接看正文里有没有那张表。 */
  const bodyCoversMeta = /^##\s*项目信息/m.test(rawBody);
  const outline = useMemo(() => outlineOf(body), [body]);

  const parts = useMemo(() => {
    if (position == null || position < 0 || position >= text.length) return null;
    return { before: text.slice(0, position), hit: text.slice(position, position + 80), after: text.slice(position + 80) };
  }, [position, text]);

  /* 命中定位优先：定位是字符区间，必须作用在原始文本上，不能被排版打乱 */
  if (markdown && position == null) {
    return (
      <div className="flex h-full min-h-0">
        <div ref={bodyRef} className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[720px] px-28 py-24">
            {/* 元信息收成一条可折叠的横条：默认只给一眼能用的几项 */}
            {meta.length && !bodyCoversMeta ? (
              <div className="mb-20 rounded-md border border-hairline bg-surface-soft">
                <button
                  type="button"
                  onClick={() => setShowMeta((on) => !on)}
                  aria-expanded={showMeta}
                  className="flex w-full items-center gap-8 px-12 py-9 text-left"
                >
                  <Icon name={showMeta ? "chevronDown" : "chevronRight"} size={11} className="shrink-0 text-stone" />
                  <span className="shrink-0 text-micro font-medium text-slate">项目信息</span>
                  <span className="min-w-0 flex-1 truncate text-micro text-steel">
                    {meta.slice(0, 3).map((field) => `${labelOf(field.key)} ${field.value}`).join("　")}
                  </span>
                </button>
                {showMeta ? (
                  <dl className="grid grid-cols-1 gap-x-20 gap-y-6 border-t border-hairline px-12 py-11 sm:grid-cols-2">
                    {meta.map((field) => (
                      <div key={field.key} className="flex min-w-0 gap-8 text-micro">
                        <dt className="w-88 shrink-0 text-stone">{labelOf(field.key)}</dt>
                        <dd className="min-w-0 break-all text-slate">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ) : null}
            <Markdown text={body} />
          </div>
        </div>

        {/* 大纲：长文档没有目录只能盲滚。只在真有两级以上标题时出现，不摆空侧栏 */}
        {outline.length > 1 ? (
          <aside className="hidden w-[200px] shrink-0 overflow-auto border-l border-hairline bg-surface-soft px-12 py-20 xl:block">
            <h3 className="mb-9 text-micro font-semibold tracking-[0.06em] text-stone">大纲</h3>
            <nav className="space-y-2">
              {outline.map((item, index) => (
                <button
                  key={`${item.index}-${index}`}
                  type="button"
                  title={item.text}
                  onClick={() => {
                    /* 按标题文本找渲染后的元素：Markdown 组件不暴露节点引用，
                       而按序号找会在同名标题上跳错。 */
                    const nodes = bodyRef.current?.querySelectorAll("h1,h2,h3");
                    if (!nodes) return;
                    const target = [...nodes].find((node) => node.textContent?.trim() === item.text);
                    target?.scrollIntoView({ block: "start", behavior: "smooth" });
                  }}
                  className={`block w-full truncate text-left text-micro leading-[1.6] text-steel transition-colors hover:text-ink ${
                    item.level === 1 ? "font-medium" : item.level === 2 ? "pl-8" : "pl-16 text-stone"
                  }`}
                >
                  {item.text}
                </button>
              ))}
            </nav>
          </aside>
        ) : null}
      </div>
    );
  }

  return (
    <pre ref={ref} className="h-full overflow-auto whitespace-pre-wrap px-24 py-20 text-body leading-[1.85] text-charcoal">
      {parts ? (
        <>
          {parts.before}
          <mark className="rounded-xs bg-tint-yellow px-2">{parts.hit}</mark>
          {parts.after}
        </>
      ) : (
        text
      )}
    </pre>
  );
}

export function LibraryView({ libraryId, sourceId }: { libraryId: string; sourceId: string }) {
  const { libraries, groups, reloadLibraries, setError } = useWorkspace();
  const [library, setLibrary] = useState<Library | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [text, setText] = useState<{ title: string; text: string; position: number | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [background, setBackground] = useState("");
  const [bgDraft, setBgDraft] = useState("");
  const [editingBg, setEditingBg] = useState(false);
  const [busy, setBusy] = useState(false);
  /* 导入进度：除计数外记住失败的每一份及其原因。
     之前只数「N 份失败」，用户无法知道是哪份、为什么——那等于没报错。 */
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    failed: { name: string; reason: string }[];
  } | null>(null);
  const [reparsing, setReparsing] = useState<string | null>(null);
  /* 多选：批量归档是本轮要补的基础操作。选中的 id 单独存，
     不放进 sources 里加 selected 字段——列表会刷新，把 UI 状态混进数据会漂。 */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmArchive, setConfirmArchive] = useState(false);
  /* 批量归档要读「点击那一刻的最新选择」，不依赖闭包捕获的 selected。
     注意：ref 只在 updater **外面**赋值。StrictMode 会故意双调用 updater，
     在里面写 ref 会赋值两次、状态错乱（实测表现是「选两份只归档一份」）。 */
  const selectedRef = useRef<Set<string>>(new Set());
  /* 重试解析的结果单独存：与「这份资料没有正文」的解释并存，
     否则两者抢同一个 message，结果永远看不到 */
  const [reparseNotice, setReparseNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "registered">("all");
  /** 当前定位：目录树节点的 path，或平层库的年份分组键；null = 全部 */
  const [group, setGroup] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(null);
  const requested = useRef<string | null>(null);

  const loadSources = useCallback(async () => {
    const data = await api.sources(libraryId);
    setSources(data.sources);
  }, [libraryId]);

  useEffect(() => {
    const found = libraries.find((item) => item.id === libraryId) ?? null;
    setLibrary(found);
    if (found) {
      setName(found.name);
      setDescription(found.description);
    }
    void loadSources().catch((cause) => setError(describeError(cause)));
    void api
      .background(libraryId)
      .then((data) => {
        setBackground(data.text);
        setBgDraft(data.text);
      })
      .catch(() => {
        setBackground("");
        setBgDraft("");
      });
  }, [libraries, libraryId, loadSources, setError]);

  /* 换库重置定位，避免上一个库的分组键带过来 */
  useEffect(() => {
    setGroup(null);
    setExpanded(new Set());
    setCurrentSourceId(null);
    requested.current = null;
    setText(null);
    setHits(null);
  }, [libraryId]);

  /* 定位方式：目录多于一个就摆目录树，否则按年份分组 */
  const dirCount = useMemo(() => {
    const set = new Set<string>();
    for (const source of sources) {
      const cut = source.path.lastIndexOf("/");
      set.add(cut > 0 ? source.path.slice(0, cut) : "");
    }
    return set.size;
  }, [sources]);

  const tree = useMemo(() => buildTree(sources), [sources]);
  const years = useMemo(() => yearGroups(sources), [sources]);
  const useTree = dirCount > 1;

  const files = useMemo(() => {
    const keep = (source: Source) => statusFilter === "all" || source.status !== "indexed";
    if (group === null) return sources.filter(keep);
    if (useTree) {
      const find = (node: DirNode): DirNode | null => {
        if (node.path === group) return node;
        for (const child of node.children) {
          const hit = find(child);
          if (hit) return hit;
        }
        return null;
      };
      return (find(tree)?.files ?? []).filter(keep);
    }
    return (years.get(group) ?? []).filter(keep);
  }, [sources, statusFilter, group, useTree, tree, years]);

  const registeredCount = sources.filter((source) => source.status !== "indexed").length;
  const currentIndex = files.findIndex((source) => source.id === currentSourceId);

  const openSource = useCallback(
    async (id: string, position: number | null = null) => {
      /* 先落定位再取正文：没有正文也是「选中了这份」，
         右侧要给状态与补救入口，而不是退回「选一份资料开始读」 */
      requested.current = id;
      setCurrentSourceId(id);
      try {
        const data = await api.sourceText(id);
        setText({ title: data.title, text: data.text, position });
        setMessage(null);
        navigate(Paths.doc(libraryId, id, position));
      } catch (cause) {
        setText(null);
        setMessage(describeError(cause));
        navigate(Paths.doc(libraryId, id, position));
      }
    },
    [libraryId],
  );

  /** 在当前分组内换上一份 / 下一份：读一批资料时不用回列表点 */
  const step = useCallback(
    (delta: number) => {
      if (currentIndex < 0) return;
      const next = files[currentIndex + delta];
      if (next) void openSource(next.id);
    },
    [currentIndex, files, openSource],
  );

  const route = useRoute();
  const hitParam = route.search.get("hit");
  useEffect(() => {
    if (!sourceId || requested.current === sourceId) return;
    const parsed = hitParam === null ? Number.NaN : Number(hitParam);
    void openSource(sourceId, Number.isFinite(parsed) ? parsed : null);
  }, [openSource, sourceId, hitParam]);

  /* 串行导入：后端单写锁，并发只会互相等。
     但每份的失败原因要单独留下——用户需要知道是哪一份、为什么没过。 */
  const onImportMany = async (picked: File[]) => {
    if (!picked.length) return;
    setBusy(true);
    setMessage(null);
    const failed: { name: string; reason: string }[] = [];
    let indexed = 0, registered = 0, unchanged = 0;
    setProgress({ done: 0, total: picked.length, failed });
    for (let index = 0; index < picked.length; index += 1) {
      setProgress({ done: index, total: picked.length, failed: [...failed] });
      const file = picked[index];
      try {
        const result = await api.importSource(libraryId, filePath(file), file);
        if (result.unchanged) unchanged += 1;
        else if (result.indexed) indexed += 1;
        else registered += 1;
      } catch (cause) {
        failed.push({ name: filePath(file), reason: describeError(cause) });
      }
    }
    setBusy(false);
    setProgress({ done: picked.length, total: picked.length, failed });
    const parts = [
      indexed ? `${indexed} 份进入索引` : "",
      registered ? `${registered} 份仅登记` : "",
      unchanged ? `${unchanged} 份内容未变` : "",
      failed.length ? `${failed.length} 份失败` : "",
    ].filter(Boolean);
    setMessage(`导入 ${picked.length} 份：${parts.join("，") || "没有变化"}`);
    await Promise.all([loadSources(), reloadLibraries()]);
  };

  /** 单份重试解析：把「仅登记」的资料就地补成可检索，不必去命令行跑 reparse */
  /** 批量归档：逐份调用，失败的单独报出来——不能因为一份失败就当全成 */
  const archiveSelected = async () => {
    const ids = [...selectedRef.current];
    if (!ids.length) return;
    setConfirmArchive(false);
    setBusy(true);
    const failed: { name: string; reason: string }[] = [];
    for (const id of ids) {
      try {
        await api.archiveSource(id);
      } catch (cause) {
        const source = sources.find((item) => item.id === id);
        failed.push({ name: source ? parseSourceName(source.path).title : id, reason: describeError(cause) });
      }
    }
    applySelection(new Set());
    setBusy(false);
    setProgress({ done: ids.length, total: ids.length, failed });
    setMessage(
      failed.length
        ? `归档 ${ids.length} 份：${ids.length - failed.length} 份成功，${failed.length} 份失败`
        : `已归档 ${ids.length} 份资料（可恢复）`,
    );
    await Promise.all([loadSources(), reloadLibraries()]);
  };

  /* 选择状态的唯一写入口：ref 与 state 一起改。
     全选、清空、单条勾选都走这里，避免两处不同步。 */
  const applySelection = (next: Set<string>) => {
    selectedRef.current = next;
    setSelected(next);
  };

  const toggleSelected = (id: string) => {
    const next = new Set(selectedRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applySelection(next);
  };

  const reparse = async (sourceId: string) => {
    setReparsing(sourceId);
    setReparseNotice(null);
    try {
      const result = await api.reparseSource(sourceId);
      setReparseNotice(
        result.indexed
          ? "已提取正文，现在可检索。"
          : "重试后仍没有可提取的文本（多为扫描件，需要外部解析器）。",
      );
      await Promise.all([loadSources(), reloadLibraries()]);
    } catch (cause) {
      setReparseNotice(describeError(cause));
    } finally {
      setReparsing(null);
    }
  };

  const saveBackground = async () => {
    try {
      const data = await api.setBackground(libraryId, bgDraft);
      setBackground(data.text);
      setEditingBg(false);
      setMessage(data.text.trim() ? "背景已保存" : "背景已清空");
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const onSearch = async () => {
    if (!query.trim()) return;
    try {
      const data = await api.search(query.trim(), `library:${libraryId}`, 20);
      setHits(data.hits);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const saveMeta = async () => {
    try {
      await api.updateLibrary(libraryId, { name: name.trim(), description });
      setEditing(false);
      await reloadLibraries();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  if (!library) {
    return (
      <div className="p-34">
        <EmptyState
          title="找不到这个资料库"
          description="它可能已被归档。回到列表确认。"
          action={<Button onClick={() => navigate(Paths.knowledge())}>返回资料库</Button>}
        />
      </div>
    );
  }

  const joined = groups.filter((item) => library.group_ids.includes(item.id));
  const currentSource = sources.find((source) => source.id === currentSourceId) ?? null;
  const currentDir = currentSource
    ? currentSource.path.slice(0, Math.max(0, currentSource.path.lastIndexOf("/")))
    : "";

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: DirNode, depth: number): ReactNode[] => {
    const rows: ReactNode[] = [];
    if (node.path) {
      const open = expanded.has(node.path);
      rows.push(
        <button
          key={node.path}
          type="button"
          title={node.path}
          onClick={() => {
            toggle(node.path);
            setGroup(node.path);
          }}
          className={`flex w-full items-center gap-6 rounded-sm py-6 pr-8 text-left transition-colors ${
            group === node.path ? "bg-surface-active font-medium text-ink" : "text-slate hover:bg-surface-hover"
          }`}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <Icon name={open ? "chevronDown" : "chevronRight"} size={11} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-meta">{node.name}</span>
          <span className="shrink-0 text-micro tabular-nums text-stone">{node.count}</span>
        </button>,
      );
      if (!open) return rows;
    }
    for (const child of node.children) rows.push(...renderNode(child, depth + 1));
    return rows;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-hairline px-24 py-14">
        <button
          type="button"
          onClick={() => navigate(Paths.knowledge())}
          className="font-app mb-6 flex items-center gap-4 text-micro text-stone hover:text-charcoal"
        >
          <Icon name="chevronLeft" size={12} /> 资料库
        </button>
        <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
          {/* 标题块给最小基宽：窄屏下按钮组整排换行，
              而不是把标题挤成每行两三个字（旧版 390px 下就是这个下场） */}
          <div className="min-w-0 flex-1 basis-[min(100%,260px)]">
            {editing ? (
              <div className="max-w-[560px]">
                <Field label="名称">
                  <input className={inputCls} value={name} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label="说明" hint="可选">
                  <textarea
                    className={inputCls}
                    rows={2}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
                <div className="flex gap-8">
                  <Button variant="primary" onClick={() => void saveMeta()}>保存</Button>
                  <Button variant="ghost" onClick={() => setEditing(false)}>取消</Button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-h2 font-semibold tracking-[-0.4px] text-ink">{library.name}</h1>
                <p className="mt-4 text-meta text-steel">{library.description || "还没有说明"}</p>
              </>
            )}

            {editingBg ? (
              <div className="mt-10 max-w-[620px]">
                <Field label="背景" hint="为什么建这个库、主要收集什么、有哪些已知缺口。可留空，随时补。">
                  <textarea
                    className={`${inputCls} min-h-[92px]`}
                    rows={4}
                    value={bgDraft}
                    onChange={(event) => setBgDraft(event.target.value)}
                    placeholder="例如：这个库收农业光合效率相关的项目材料、实验记录与论文，缺 2023 年以后的田间数据。"
                  />
                </Field>
                <div className="flex gap-8">
                  <Button variant="primary" onClick={() => void saveBackground()}>保存背景</Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBgDraft(background);
                      setEditingBg(false);
                    }}
                  >
                    取消
                  </Button>
                  {background ? (
                    <button
                      type="button"
                      onClick={() => setBgDraft("")}
                      className="font-app ml-auto rounded-sm px-8 py-4 text-micro text-stone hover:bg-danger-soft hover:text-red"
                    >
                      清空
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setEditingBg(true)} className="group mt-10 block max-w-[760px] text-left">
                <span className="flex items-center gap-4 text-micro text-stone">背景 <Icon name="edit" size={10} /></span>
                <p
                  className={`mt-4 line-clamp-2 whitespace-pre-wrap text-micro leading-[1.7] transition-colors ${
                    background ? "text-slate group-hover:text-charcoal" : "text-stone group-hover:text-slate"
                  }`}
                >
                  {background || "说明这个库是做什么的，帮助后续检索与提问（可留空，随时补）"}
                </p>
              </button>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-6">
              <Chip tone="sky">{sources.length} 份资料</Chip>
              <Chip tone="mint">已索引 {library.indexed_count}</Chip>
              <Chip tone="gray">{useTree ? `${dirCount} 个目录` : `${years.size} 个年份`}</Chip>
              {joined.map((item) => (
                <Chip key={item.id} tone="lav">{item.name}</Chip>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-8">
            {progress ? (
              <span className="text-micro tabular-nums text-steel">导入 {progress.done}/{progress.total}</span>
            ) : null}
            {!editing ? <Button icon="edit" onClick={() => setEditing(true)}>编辑说明</Button> : null}
            <label className={busy ? "opacity-50" : ""}>
              <span className="font-app inline-flex h-30 cursor-pointer items-center gap-6 rounded-sm border border-hairline-strong bg-canvas px-12 text-meta font-medium text-ink hover:bg-surface">
                <Icon name="upload" size={14} /> {busy ? "导入中…" : "导入资料"}
              </span>
              <input
                type="file"
                multiple
                className="hidden"
                disabled={busy}
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  if (picked.length) void onImportMany(picked);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </header>

      {/* 三栏是本页的主结构：定位 → 文件 → 阅读。
          窄屏放不下三栏，就按「选中什么看什么」收敛成一栏：
          选中资料后只显示阅读栏，返回按钮回到「定位 + 文件」。
          不缩小三栏硬塞——220/300px 的固定栏在 390px 屏上会把正文挤成一条缝。 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_300px_minmax(0,1fr)]">
        {/* ------------------------------------------------ 第一栏：定位 */}
        <aside
          className={`${currentSourceId ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col border-r bg-surface-soft transition-colors ${
            dragOver ? "border-primary ring-2 ring-primary ring-inset" : "border-hairline"
          }`}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const dropped = Array.from(event.dataTransfer.files);
            if (dropped.length) void onImportMany(dropped);
          }}
        >
          <div className="space-y-8 border-b border-hairline p-12">
            <SearchField value={query} onChange={setQuery} onEnter={() => void onSearch()} placeholder="库内检索，回车确认" />
            {hits ? (
              <div className="max-h-[24vh] space-y-6 overflow-auto">
                {hits.length === 0 ? <p className="text-micro text-stone">没有命中</p> : null}
                {hits.map((hit) => (
                  <button
                    key={`${hit.version_id}-${hit.position}`}
                    type="button"
                    onClick={() => void openSource(hit.source_id, hit.position)}
                    className="block w-full rounded-md border border-hairline bg-canvas p-8 text-left hover:border-hairline-strong"
                  >
                    <div className="truncate text-meta font-medium text-ink">{hit.title}</div>
                    <div className="mt-2 line-clamp-2 text-micro text-steel">
                      <Highlight text={hit.snippet} />
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-8">
            <button
              type="button"
              onClick={() => setGroup(null)}
              className={`mb-4 flex w-full items-center gap-6 rounded-sm px-8 py-6 text-left transition-colors ${
                group === null ? "bg-surface-active font-medium text-ink" : "text-slate hover:bg-surface-hover"
              }`}
            >
              <Icon name="grid" size={12} />
              <span className="min-w-0 flex-1 truncate text-meta">全部资料</span>
              <span className="text-micro tabular-nums text-stone">{sources.length}</span>
            </button>

            {sources.length === 0 ? (
              <p className="px-8 py-12 text-micro text-stone">还没有资料。点右上角「导入资料」，或把文件拖到这里。</p>
            ) : useTree ? (
              renderNode(tree, 0)
            ) : (
              [...years].map(([key, bucket]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setGroup(key)}
                  className={`flex w-full items-center gap-6 rounded-sm px-8 py-6 text-left transition-colors ${
                    group === key ? "bg-surface-active font-medium text-ink" : "text-slate hover:bg-surface-hover"
                  }`}
                >
                  <Icon name="doc" size={12} />
                  <span className="min-w-0 flex-1 truncate text-meta">{key}</span>
                  <span className="text-micro tabular-nums text-stone">{bucket.length}</span>
                </button>
              ))
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-hairline px-12 py-6">
            {(
              [
                { value: "all", label: `全部 ${sources.length}` },
                { value: "registered", label: `仅登记 ${registeredCount}` },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatusFilter(option.value)}
                className={`font-app rounded-pill px-9 py-3 text-micro transition-colors ${
                  statusFilter === option.value
                    ? "bg-surface-active font-medium text-ink"
                    : "text-stone hover:bg-surface hover:text-charcoal"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </aside>

        {/* ------------------------------------------------ 第二栏：文件 */}
        <aside className={`${currentSourceId ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col border-r border-hairline`}>
          <div className="flex items-center gap-6 border-b border-hairline px-12 py-10">
            {/* 全选：只覆盖当前显示的这批（超过 FILE_PAGE 时不会误选看不见的） */}
            <input
              type="checkbox"
              aria-label={selected.size === files.length && files.length > 0 ? "取消全选" : "全选"}
              checked={files.length > 0 && selected.size === files.length}
              onChange={() =>
                applySelection(
                  selected.size === files.length ? new Set() : new Set(files.map((item) => item.id)),
                )
              }
              className="size-14 shrink-0 accent-primary"
            />
            <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink">
              {selected.size > 0 ? `已选 ${selected.size}` : group === null ? "全部资料" : group}
            </span>
            <span className="shrink-0 text-micro tabular-nums text-stone">{files.length}</span>
          </div>

          {/* 批量操作：选中后才出现，不占平时版面 */}
          {selected.size > 0 ? (
            <div className="flex flex-wrap items-center gap-6 border-b border-hairline bg-surface-soft px-12 py-8">
              {confirmArchive ? (
                <>
                  {/* 侧栏只有 300px：一句长说明会把按钮挤到第二行，
                      所以只留关键信息，完整措辞放 title。 */}
                  <span
                    className="min-w-0 flex-1 text-micro text-slate"
                    title={`归档 ${selected.size} 份资料会退出检索，但不会被删除，可以恢复`}
                  >
                    归档 {selected.size} 份？可恢复
                  </span>
                  <Button size="sm" variant="danger" onClick={() => void archiveSelected()}>
                    确认
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(false)}>
                    取消
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-micro text-steel">已选 {selected.size} 份</span>
                  <button
                    type="button"
                    onClick={() => applySelection(new Set())}
                    className="font-app shrink-0 text-micro text-stone underline hover:text-charcoal"
                  >
                    清空
                  </button>
                  <Button size="sm" variant="outline" icon="trash" onClick={() => setConfirmArchive(true)}>
                    归档
                  </Button>
                </>
              )}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto py-6">
            {files.length === 0 ? (
              <p className="px-12 py-12 text-micro text-stone">这个分组下没有资料。</p>
            ) : (
              (files.length > FILE_PAGE ? files.slice(0, FILE_PAGE) : files).map((source) => {
                const label = STATUS_LABEL[source.status] ?? STATUS_LABEL.registered;
                /* 文件名是「年份_编号_负责人_项目名」，截断后只剩一串数字，
                   认不出是哪份。拆开：项目名占两行，元信息降为小字。 */
                const parsed = parseSourceName(source.path);
                const on = currentSourceId === source.id;
                const retrying = reparsing === source.id;
                return (
                  <div
                    key={source.id}
                    className={`group flex items-start gap-8 px-12 transition-colors ${
                      on ? "bg-primary-soft" : "hover:bg-surface"
                    }`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择 ${parsed.title}`}
                      checked={selected.has(source.id)}
                      onChange={() => toggleSelected(source.id)}
                      onClick={(event) => event.stopPropagation()}
                      className="mt-9 size-14 shrink-0 accent-primary"
                    />
                    <button
                      type="button"
                      onClick={() => void openSource(source.id)}
                      className="min-w-0 flex-1 py-7 text-left"
                    >
                      <div
                        className={`line-clamp-2 text-meta leading-[1.45] ${
                          on ? "font-medium text-ink" : "text-charcoal"
                        }`}
                      >
                        {parsed.title}
                      </div>
                      <div className="mt-4 flex items-center gap-6 text-micro text-stone">
                        {parsed.owner ? <span className="shrink-0">{parsed.owner}</span> : null}
                        {parsed.years ? (
                          <span className="min-w-0 truncate tabular-nums">{parsed.years}</span>
                        ) : null}
                        {source.status === "indexed" ? null : (
                          <span className="shrink-0">
                            <Chip tone={label.tone}>{label.text}</Chip>
                          </span>
                        )}
                        <span className="ml-auto shrink-0 tabular-nums">{sizeText(source.size)}</span>
                      </div>
                    </button>
                    {/* 仅登记的资料给一条就地修复路径：不必去命令行跑 reparse */}
                    {source.status === "registered" ? (
                      <button
                        type="button"
                        title="重试解析（补出正文就能检索）"
                        disabled={retrying}
                        onClick={() => void reparse(source.id)}
                        className="mt-6 shrink-0 rounded-sm px-6 py-4 text-micro text-stone opacity-0 transition-opacity hover:bg-canvas hover:text-primary focus-visible:opacity-100 disabled:opacity-60 group-hover:opacity-100"
                      >
                        {retrying ? "解析中…" : "重试解析"}
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
            {files.length > FILE_PAGE ? (
              <p className="px-12 py-10 text-micro text-stone">仅显示前 {FILE_PAGE} 份，用分组或检索缩小范围。</p>
            ) : null}
          </div>
        </aside>

        {/* ------------------------------------------------ 第三栏：阅读 */}
        <section className={`${currentSourceId ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`}>
          {/* 窄屏时回到列表：一栏布局下没有别的地方能返回上一级 */}
          {currentSourceId ? (
            <div className="border-b border-hairline-soft px-16 py-8 lg:hidden">
              <button
                type="button"
                onClick={() => {
                  setCurrentSourceId(null);
                  setText(null);
                  navigate(Paths.kb(libraryId));
                }}
                className="font-app flex items-center gap-4 text-micro text-steel hover:text-charcoal"
              >
                <Icon name="chevronLeft" size={12} /> 回到资料列表
              </button>
            </div>
          ) : null}
          {/* 没正文时说明就在面板里，顶部不再重复同一条 */}
          {message && text ? (
            <div className="border-b border-hairline-soft bg-surface-soft px-24 py-8 text-micro text-steel">{message}</div>
          ) : null}
          {/* 失败的每一份都要点名：只说「N 份失败」等于没报错 */}
          {progress?.failed.length ? (
            <div className="border-b border-danger-soft bg-danger-soft px-24 py-10 text-micro">
              <div className="mb-5 font-medium text-red">
                {progress.failed.length} 份导入失败
                {busy ? "（其余仍在继续）" : ""}
              </div>
              <ul className="space-y-3">
                {progress.failed.slice(0, 6).map((item) => (
                  <li key={item.name} className="break-all text-slate">
                    <span className="font-medium text-charcoal">{item.name}</span> —— {item.reason}
                  </li>
                ))}
              </ul>
              {progress.failed.length > 6 ? (
                <p className="mt-4 text-stone">另有 {progress.failed.length - 6} 份同类失败未列出。</p>
              ) : null}
              {!busy ? (
                <button
                  type="button"
                  onClick={() => setProgress(null)}
                  className="mt-6 text-micro text-slate underline"
                >
                  知道了
                </button>
              ) : null}
            </div>
          ) : null}
          {text ? (
            <>
              {/* 标题条：文件名是「年份_编号_负责人_项目名」，原样显示认不出是什么。
                  拆出干净项目名做标题，把年份/编号/负责人降为一行副信息。 */}
              {(() => {
                const parsed = parseSourceName(text.title);
                return (
                  <div className="flex items-start gap-10 border-b border-hairline px-24 py-12">
                    <Icon name="doc" size={15} className="mt-3 shrink-0 text-stone" />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-title font-semibold leading-[1.4] text-ink">{parsed.title}</h2>
                      <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-4 text-micro text-stone">
                        {parsed.years ? <span className="tabular-nums">{parsed.years}</span> : null}
                        {parsed.grantNo ? <span className="tabular-nums">编号 {parsed.grantNo}</span> : null}
                        {parsed.owner ? <span>{parsed.owner}</span> : null}
                        {currentDir ? <span className="truncate">{currentDir}</span> : null}
                        {currentIndex >= 0 ? (
                          <span className="tabular-nums">第 {currentIndex + 1} / {files.length} 份</span>
                        ) : null}
                        {text.position != null ? (
                          <Chip tone="sky">命中位置 {text.position}</Chip>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <Button size="sm" variant="quiet" onClick={() => step(-1)} disabled={currentIndex <= 0}>
                        上一篇
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => step(1)}
                        disabled={currentIndex < 0 || currentIndex >= files.length - 1}
                      >
                        下一篇
                      </Button>
                    </div>
                  </div>
                );
              })()}
              <div className="min-h-0 flex-1">
                <TextReader
                  text={text.text}
                  position={text.position}
                  markdown={currentSource?.kind === "text" && MARKDOWN_EXT.test(text.title)}
                  title={parseSourceName(text.title).title}
                />
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center p-34">
              {/* 选中的资料没有正文（扫描件、音视频、Office）：这不是错误，
                  该告诉用户它是什么状态、能做什么，而不是只报一句「没有可读正文」 */}
              {currentSource ? (
                <div className="w-full max-w-[520px] space-y-12">
                  <div className="rounded-lg border border-hairline bg-surface-soft px-20 py-18">
                    <div className="flex items-center gap-8">
                      <Icon name="doc" size={15} />
                      <h3 className="min-w-0 flex-1 truncate text-title font-semibold text-ink">
                        {currentSource.path.split("/").pop()}
                      </h3>
                      <Chip tone={STATUS_LABEL[currentSource.status]?.tone ?? "gray"}>
                        {STATUS_LABEL[currentSource.status]?.text ?? currentSource.status}
                      </Chip>
                    </div>
                    <p className="mt-8 text-micro leading-[1.7] text-steel">
                      {currentSource.status === "registered"
                        ? "这份资料已入库但还没有可读正文：扫描件需要文本层，音视频与 Office 需要外部解析。原件完整保存，不影响归档与归类。"
                        : "这份资料的原件无法解码成正文，原件仍可下载。"}
                    </p>
                    {currentSource.status === "registered" ? (
                      <div className="mt-10 flex flex-wrap items-center gap-8">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => void reparse(currentSource.id)}
                          disabled={reparsing === currentSource.id}
                        >
                          {reparsing === currentSource.id ? "解析中…" : "重试解析"}
                        </Button>
                        <span className="text-micro text-stone">
                          仍失败就用 MinerU 解析后跑 cli.py attach
                        </span>
                      </div>
                    ) : null}
                    {reparseNotice ? (
                      <p className={`mt-8 text-micro ${reparseNotice.includes("已提取") ? "text-on-tint-mint" : "text-slate"}`}>
                        {reparseNotice}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon="doc"
                  title={sources.length ? "选一份资料开始读" : "先导入一份资料"}
                  description="左侧按目录或年份定位，中间选文件，正文在这里显示并支持检索定位。"
                />
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
