/* 库内：定位 → 选文件 → 读正文。三栏：分组/目录 → 文件 → 阅读器。
   定位方式按库自适应：
     有目录结构（多个目录）→ 目录树，跟文件系统一致；
     平层（全部在一个目录）→ 按文件名开头的年份分组，因为平层库摆目录树只会得到
     一个「全部」节点，等于没分组，而立项年份是这批资料真实的语义维度。 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icons";
import { Button, Chip, EmptyState, Field, SearchField, inputCls } from "../components/ui";
import { Paths, navigate, useRoute } from "../app/router";
import { api, type Hit, type Library, type Source } from "../model/api";
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

function TextReader({ text, position }: { text: string; position: number | null }) {
  const ref = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (position == null || !ref.current) return;
    const ratio = text.length ? position / text.length : 0;
    ref.current.scrollTop = Math.max(0, ratio * ref.current.scrollHeight - 80);
  }, [position, text]);

  const parts = useMemo(() => {
    if (position == null || position < 0 || position >= text.length) return null;
    return { before: text.slice(0, position), hit: text.slice(position, position + 80), after: text.slice(position + 80) };
  }, [position, text]);

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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
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
      try {
        const data = await api.sourceText(id);
        requested.current = id;
        setCurrentSourceId(id);
        setText({ title: data.title, text: data.text, position });
        setMessage(null);
        navigate(Paths.doc(libraryId, id, position));
      } catch (cause) {
        setText(null);
        setMessage(describeError(cause));
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

  /* 串行导入：后端单写锁，并发只会互相等 */
  const onImportMany = async (picked: File[]) => {
    if (!picked.length) return;
    setBusy(true);
    setMessage(null);
    let indexed = 0, registered = 0, unchanged = 0, failed = 0;
    for (let index = 0; index < picked.length; index += 1) {
      setProgress({ done: index, total: picked.length });
      try {
        const result = await api.importSource(libraryId, filePath(picked[index]), picked[index]);
        if (result.unchanged) unchanged += 1;
        else if (result.indexed) indexed += 1;
        else registered += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    setProgress(null);
    const parts = [
      indexed ? `${indexed} 份进入索引` : "",
      registered ? `${registered} 份仅登记` : "",
      unchanged ? `${unchanged} 份内容未变` : "",
      failed ? `${failed} 份失败` : "",
    ].filter(Boolean);
    setMessage(`导入 ${picked.length} 份：${parts.join("，") || "没有变化"}`);
    await Promise.all([loadSources(), reloadLibraries()]);
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
        <div className="flex flex-wrap items-start gap-10">
          <div className="min-w-0 flex-1">
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

      <div className="grid min-h-0 flex-1 grid-cols-[220px_300px_minmax(0,1fr)]">
        {/* ------------------------------------------------ 第一栏：定位 */}
        <aside
          className={`flex min-h-0 flex-col border-r bg-surface-soft transition-colors ${
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
                      {hit.snippet.replace(/<</g, "").replace(/>>/g, "")}
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
        <aside className="flex min-h-0 flex-col border-r border-hairline">
          <div className="flex items-center gap-6 border-b border-hairline px-12 py-10">
            <Icon name="folder" size={13} />
            <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink">
              {group === null ? "全部资料" : group}
            </span>
            <span className="shrink-0 text-micro tabular-nums text-stone">{files.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-6">
            {files.length === 0 ? (
              <p className="px-12 py-12 text-micro text-stone">这个分组下没有资料。</p>
            ) : (
              (files.length > FILE_PAGE ? files.slice(0, FILE_PAGE) : files).map((source) => {
                const label = STATUS_LABEL[source.status] ?? STATUS_LABEL.registered;
                const title = source.path.split("/").pop() ?? source.path;
                const on = currentSourceId === source.id;
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => void openSource(source.id)}
                    className={`block w-full px-12 py-7 text-left transition-colors ${
                      on ? "bg-primary-soft" : "hover:bg-surface"
                    }`}
                  >
                    <div className={`truncate text-meta ${on ? "font-medium text-ink" : "text-charcoal"}`}>
                      {title}
                    </div>
                    <div className="mt-2 flex items-center gap-6">
                      {source.status === "indexed" ? null : <Chip tone={label.tone}>{label.text}</Chip>}
                      <span className="text-micro text-stone">{sizeText(source.size)}</span>
                    </div>
                  </button>
                );
              })
            )}
            {files.length > FILE_PAGE ? (
              <p className="px-12 py-10 text-micro text-stone">仅显示前 {FILE_PAGE} 份，用分组或检索缩小范围。</p>
            ) : null}
          </div>
        </aside>

        {/* ------------------------------------------------ 第三栏：阅读 */}
        <section className="flex min-h-0 flex-col">
          {message ? (
            <div className="border-b border-hairline-soft bg-surface-soft px-24 py-8 text-micro text-steel">{message}</div>
          ) : null}
          {text ? (
            <>
              <div className="flex items-center gap-8 border-b border-hairline px-24 py-12">
                <Icon name="doc" size={15} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-title font-semibold text-ink">{text.title}</h2>
                  <p className="mt-2 truncate text-micro text-stone">
                    {currentDir ? `${currentDir} / ` : ""}
                    {currentIndex >= 0 ? `第 ${currentIndex + 1} / ${files.length} 份` : ""}
                    {text.position == null ? " · 全文" : ` · 命中位置 ${text.position}`}
                  </p>
                </div>
                <div className="flex items-center gap-4">
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
              <div className="min-h-0 flex-1">
                <TextReader text={text.text} position={text.position} />
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center p-34">
              <EmptyState
                icon="doc"
                title={sources.length ? "选一份资料开始读" : "先导入一份资料"}
                description="左侧按目录或年份定位，中间选文件，正文在这里显示并支持检索定位。"
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
