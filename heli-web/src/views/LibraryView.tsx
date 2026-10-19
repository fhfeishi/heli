/* 库内：背景、导入（多选/拖拽）、资料列表、正文阅读、库内检索。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icons";
import { Button, Chip, EmptyState, Field, SearchField, inputCls } from "../components/ui";
import { Paths, navigate, useRoute } from "../app/router";
import { api, type Hit, type Library, type Source } from "../model/api";
import { useWorkspace } from "../model/store";
import { describeError } from "../model/errors";

/** 一屏内先渲染这么多；再往下要点一下才展开 */
const SOURCE_PAGE = 200;

const STATUS_LABEL: Record<Source["status"], { text: string; tone: "mint" | "peach" | "gray" }> = {
  indexed: { text: "已索引", tone: "mint" },
  registered: { text: "仅登记", tone: "peach" },
  undecodable: { text: "无法解码", tone: "gray" },
};

function sizeText(size: number | null): string {
  if (!size) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 目录选择时浏览器会给相对路径；普通多选只有文件名 */
function filePath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && rel.length ? rel : file.name;
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
  /* 背景：为什么建这个库、收集什么、有哪些缺口。允许留空，不设完成度门槛。 */
  const [background, setBackground] = useState("");
  const [bgDraft, setBgDraft] = useState("");
  const [editingBg, setEditingBg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /* 大库（几百份）先渲染前一段，滚动列表不该成为切库时的卡顿来源 */
  const [showAllSources, setShowAllSources] = useState(false);
  /* 记录「已经为哪个 source 取过正文」，避免 URL 变化时用无位置的结果覆盖命中定位 */
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
        /* 背景读取失败不影响阅读与检索，静默降级为空 */
        setBackground("");
        setBgDraft("");
      });
  }, [libraries, libraryId, loadSources, setError]);

  const openSource = useCallback(
    async (id: string, position: number | null = null) => {
      try {
        const data = await api.sourceText(id);
        requested.current = id;
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

  /* 全局检索会带 ?hit=<字符位置> 进来，直接定位到命中处 */
  const route = useRoute();
  const hitParam = route.search.get("hit");
  useEffect(() => {
    if (!sourceId || requested.current === sourceId) return;
    const parsed = hitParam === null ? Number.NaN : Number(hitParam);
    void openSource(sourceId, Number.isFinite(parsed) ? parsed : null);
  }, [openSource, sourceId, hitParam]);

  /* 串行导入：后端是单写锁，并发发起只会互相等待，串行反而更快也更容易报准进度 */
  const onImportMany = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setMessage(null);
    let indexed = 0;
    let registered = 0;
    let unchanged = 0;
    let failed = 0;

    for (let index = 0; index < files.length; index += 1) {
      setProgress({ done: index, total: files.length });
      try {
        const result = await api.importSource(libraryId, filePath(files[index]), files[index]);
        if (result.unchanged) unchanged += 1;
        else if (result.indexed) indexed += 1;
        else registered += 1;
      } catch {
        failed += 1;
      }
    }
    setProgress({ done: files.length, total: files.length });
    setBusy(false);
    setProgress(null);

    const parts = [
      indexed ? `${indexed} 份进入索引` : "",
      registered ? `${registered} 份仅登记` : "",
      unchanged ? `${unchanged} 份内容未变` : "",
      failed ? `${failed} 份失败` : "",
    ].filter(Boolean);
    setMessage(`导入 ${files.length} 份：${parts.join("，") || "没有变化"}`);
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

  const joined = groups.filter((group) => library.group_ids.includes(group.id));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-hairline px-24 py-16">
        <button
          type="button"
          onClick={() => navigate(Paths.knowledge())}
          className="font-app mb-8 flex items-center gap-4 text-micro text-stone hover:text-charcoal"
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
              <button
                type="button"
                onClick={() => setEditingBg(true)}
                className="group mt-10 block max-w-[760px] text-left"
              >
                <span className="flex items-center gap-4 text-micro text-stone">
                  背景
                  <Icon name="edit" size={10} />
                </span>
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
              {joined.map((group) => (
                <Chip key={group.id} tone="lav">{group.name}</Chip>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-8">
            {progress ? (
              <span className="text-micro tabular-nums text-steel">
                导入 {progress.done}/{progress.total}
              </span>
            ) : null}
            {!editing ? <Button icon="edit" onClick={() => setEditing(true)}>编辑说明</Button> : null}
            <label className={`${busy ? "opacity-50" : ""}`}>
              <span className="font-app inline-flex h-30 cursor-pointer items-center gap-6 rounded-sm border border-hairline-strong bg-canvas px-12 text-meta font-medium text-ink hover:bg-surface">
                <Icon name="upload" size={14} /> {busy ? "导入中…" : "导入资料"}
              </span>
              <input
                type="file"
                multiple
                className="hidden"
                disabled={busy}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length) void onImportMany(files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)]">
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
            const files = Array.from(event.dataTransfer.files);
            if (files.length) void onImportMany(files);
          }}
        >
          <div className="space-y-8 p-12">
            <SearchField value={query} onChange={setQuery} onEnter={() => void onSearch()} placeholder="在本题库内检索" />
            <Button size="sm" className="w-full justify-center" onClick={() => void onSearch()} disabled={!query.trim()}>
              检索
            </Button>
            {hits ? (
              <div className="max-h-[26vh] space-y-6 overflow-auto">
                {hits.length === 0 ? <p className="text-micro text-stone">没有命中</p> : null}
                {hits.map((hit) => (
                  <button
                    key={`${hit.version_id}-${hit.position}`}
                    type="button"
                    onClick={() => void openSource(hit.source_id, hit.position)}
                    className="block w-full rounded-md border border-hairline bg-canvas p-8 text-left hover:border-hairline-strong"
                  >
                    <div className="truncate text-meta font-medium text-ink">{hit.title}</div>
                    <div className="mt-2 line-clamp-2 text-micro text-steel">{hit.snippet.replace(/<</g, "").replace(/>>/g, "")}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto border-t border-hairline px-8 py-8">
            {sources.length === 0 ? (
              <p className="px-8 py-12 text-micro text-stone">
                还没有资料。点右上角「导入资料」，或把文件拖到这里（支持多选与整目录）。
              </p>
            ) : null}
            {(showAllSources ? sources : sources.slice(0, SOURCE_PAGE)).map((source) => {
              const label = STATUS_LABEL[source.status] ?? STATUS_LABEL.registered;
              return (
                <div
                  key={source.id}
                  className={`group flex items-center gap-8 rounded-md px-8 py-7 ${
                    text?.title === source.title ? "bg-primary-soft" : "hover:bg-surface"
                  }`}
                >
                  <button type="button" onClick={() => void openSource(source.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-meta text-ink">{source.path}</div>
                    <div className="mt-2 flex items-center gap-6">
                      <Chip tone={label.tone}>{label.text}</Chip>
                      <span className="text-micro text-stone">{sizeText(source.size)}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    title="归档这份资料"
                    onClick={async () => {
                      try {
                        await api.archiveSource(source.id);
                        await Promise.all([loadSources(), reloadLibraries()]);
                      } catch (cause) {
                        setError(describeError(cause));
                      }
                    }}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              );
            })}
            {sources.length > SOURCE_PAGE && !showAllSources ? (
              <button
                type="button"
                onClick={() => setShowAllSources(true)}
                className="font-app mt-6 w-full rounded-md border border-dashed border-hairline px-8 py-10 text-micro text-steel hover:border-hairline-strong hover:text-charcoal"
              >
                还有 {sources.length - SOURCE_PAGE} 份，显示全部
              </button>
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {message ? (
            <div className="border-b border-hairline-soft bg-surface-soft px-24 py-8 text-micro text-steel">{message}</div>
          ) : null}
          {text ? (
            <>
              <div className="flex items-center gap-8 border-b border-hairline px-24 py-12">
                <Icon name="doc" size={15} />
                <h2 className="min-w-0 flex-1 truncate text-title font-semibold text-ink">{text.title}</h2>
                <span className="text-micro text-stone">
                  {text.position == null ? "全文" : `命中位置 ${text.position}`}
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <TextReader text={text.text} position={text.position} />
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center p-34">
              <EmptyState
                icon="doc"
                title={sources.length ? "选择左侧一份资料" : "先导入一份资料"}
                description="文本类会显示正文并支持检索定位；PDF 与音视频首期只登记原件。"
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
