import { useEffect, useMemo, useRef, useState } from "react";
import { describeError } from "../api/errors";
import { knowledgeApi, type Document, type Library, type Outline, type SearchHit, type SearchResult, type SearchStatus, type SectionContent, type Tree } from "../api/knowledge";
import { Link, Paths, navigate, parseDocSearch, parseKbSearch, patchSearchParam, useRoute } from "../app/router";
import { Breadcrumb } from "./Breadcrumb";
import { searchIndexCommand } from "../lib/kbCommands";
import { copyToClipboard } from "../lib/markdown";
import { pushRecent, readRecent } from "../lib/recent";
import { useStore } from "../store";

function MarkdownText({ text, highlight }: { text: string; highlight?: { start: number; end: number } }) {
  /* 代码围栏里的伪标题不参与分节；命中区间按**原文字符位置**切三段，围栏内不高亮 */
  const parts: { code: boolean; language: string; text: string; start: number }[] = [];
  let code = false, language = "", markerChar = "", markerLength = 0;
  const buffer: string[] = [];
  let bufferStart = 0, position = 0;
  const flush = (until: number) => {
    if (buffer.length) parts.push({ code, language, text: buffer.join(""), start: bufferStart });
    buffer.length = 0;
    language = "";
    bufferStart = until;
  };
  for (const line of text.split(/(?<=\n)/)) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (code) {
      if (fence && fence[1][0] === markerChar && fence[1].length >= markerLength && !fence[2].trim()) {
        flush(position + line.length);
        code = false;
      } else buffer.push(line);
    } else if (fence) {
      flush(position);
      code = true;
      language = fence[2].trim();
      markerChar = fence[1][0];
      markerLength = fence[1].length;
      bufferStart = position + line.length;
    } else {
      if (!buffer.length) bufferStart = position;
      buffer.push(line);
    }
    position += line.length;
  }
  flush(position);
  return <div className="space-y-12 text-title leading-[1.75] text-ink">{parts.map((part, index) => part.code ?
    <div key={index} className="overflow-x-auto rounded-md border border-hairline bg-surface-soft p-14">
      {part.language && <div className="mb-8 text-meta text-stone">{part.language}</div>}
      <pre className="whitespace-pre text-[13px] leading-[1.6]"><code>{part.text}</code></pre>
    </div> : <pre key={index} className="whitespace-pre-wrap break-words font-app leading-[1.7]">{hitMark(part, highlight)}</pre>)}</div>;
}

/** 命中区间落在这一段里时切成三段，中间标出来并打上 data-hit 供滚动定位 */
function hitMark(part: { text: string; start: number }, highlight?: { start: number; end: number }) {
  if (!highlight) return part.text;
  const from = Math.max(0, highlight.start - part.start);
  const to = Math.min(part.text.length, highlight.end - part.start);
  if (to <= from) return part.text;
  return <>
    {part.text.slice(0, from)}
    <mark data-hit className="rounded-sm bg-primary-soft text-ink">{part.text.slice(from, to)}</mark>
    {part.text.slice(to)}
  </>;
}

interface DocList {
  total: number;
  items: Document[];
  nextOffset: number | null;
}

export function KnowledgeView() {
  const { inspectorOpen, openPreview, closeInspector } = useStore();
  /* 位置全部来自 URL：库与来源在路径上，章节 / 搜索 / 分页 / 章节序号 / sha / 滚动位置在 search 上 */
  const route = useRoute();
  const slug = route.slug;
  const sourceId = route.sourceId;
  const kb = useMemo(() => parseKbSearch(route.search), [route.search]);
  const doc = useMemo(() => parseDocSearch(route.search), [route.search]);

  /* 视图（资料 / 书架整理）是 URL 上的 ?view=（§1.1 把视图列为关键状态），不在组件里另存一份 */
  const [libraries, setLibraries] = useState<Library[] | null>(null);
  const [tree, setTree] = useState<Tree | null>(null);
  const [docs, setDocs] = useState<DocList | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [chapter, setChapter] = useState<SectionContent | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [staleSha, setStaleSha] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState("");
  const [renamingSection, setRenamingSection] = useState(false);
  const [qDraft, setQDraft] = useState(kb.q);
  const [ftDraft, setFtDraft] = useState(kb.ft);
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);
  /* 写操作（改名 / 改章节 / 改归属）成功后用它刷新文档列表 */
  const [docsVersion, setDocsVersion] = useState(0);

  const readingRequest = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef(0);
  const atRef = useRef(doc.at);
  atRef.current = doc.at;

  /* 在库内改动定位（章节 / 搜索 / 分页）时保留当前所在的页面（列表页或阅读页） */
  const listHref = (patch: Partial<{ section: string; q: string; ft: string; offset: number }>) => {
    const next = { section: kb.section || "", q: kb.q, ft: kb.ft, offset: kb.offset, view: kb.view, ...patch };
    if (route.name === "doc" && sourceId) {
      return Paths.doc(slug, sourceId, { ...next, chapter: doc.chapter, sha: outline?.sha256 ?? doc.sha, at: 0 });
    }
    return Paths.kb(slug, next);
  };

  /* 面包屑里的库名：回到文档列表，保留当前章节 / 搜索 / 分页 */
  const listOnlyHref = slug ? Paths.kb(slug, { section: kb.section, q: kb.q, ft: kb.ft, offset: kb.offset }) : Paths.knowledge();

  /* 最近阅读（最多 3 条）：空态里给出回得去的入口 */
  const [recent, setRecent] = useState<{ source_id: string; title: string }[]>([]);

  /* ------------------------------------------------------ 取数 ------ */

  useEffect(() => {
    let current = true;
    knowledgeApi.libraries()
      .then(({ libraries: items }) => { if (current) setLibraries(items); })
      .catch(cause => { if (current) setError(cause); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!slug) { setTree(null); return; }
    let current = true;
    setTree(null); setDocs(null); setError(null);
    knowledgeApi.tree(slug)
      .then(value => { if (current) setTree(value); })
      .catch(cause => { if (current) setError(cause); });
    return () => { current = false; };
  }, [slug]);

  /* offset 是「已加载到的条数」，刷新时按页补齐到该位置 */
  useEffect(() => {
    if (!slug || kb.ft) { setDocs(null); return; }
    let current = true;
    setDocs(null);
    const wanted = kb.offset;
    (async () => {
      try {
        const items: Document[] = [];
        let offset = 0;
        let next: number | null = 0;
        let total = 0;
        do {
          const page = await knowledgeApi.documents(slug, kb.section || null, kb.q, offset);
          if (!current) return;
          items.push(...page.documents);
          total = page.total;
          next = page.next_offset;
          offset = next ?? 0;
        } while (next !== null && items.length <= wanted);
        if (current) setDocs({ total, items, nextOffset: next });
      } catch (cause) { if (current) setError(cause); }
    })();
    return () => { current = false; };
  }, [slug, kb.section, kb.q, kb.offset, docsVersion]);

  useEffect(() => {
    if (!slug) { setSearchStatus(null); return; }
    let current = true;
    knowledgeApi.searchStatus(slug)
      .then(value => { if (current) setSearchStatus(value); })
      .catch(() => { if (current) setSearchStatus(null); });
    return () => { current = false; };
  }, [slug]);

  /* 全文检索：?ft= 是唯一入口，与标题过滤 ?q= 互不影响 */
  useEffect(() => {
    if (!slug || !kb.ft) { setSearch(null); return; }
    /* 索引未就绪是独立的一类失败（§6.4）：不发起检索，也不显示成「没有命中」 */
    if (searchStatus && !searchStatus.built) { setSearch(null); return; }
    let current = true;
    setSearch(null);
    knowledgeApi.search(slug, kb.ft, kb.section || null, 20, kb.offset)
      .then(value => { if (current) setSearch(value); })
      .catch(cause => { if (current) setError(cause); });
    return () => { current = false; };
  }, [slug, kb.ft, kb.section, kb.offset, searchStatus]);

  useEffect(() => {
    if (!slug || !sourceId) { setOutline(null); setChapter(null); return; }
    let current = true;
    const request = ++readingRequest.current;
    setOutline(null); setChapter(null); setStaleSha(false);
    knowledgeApi.outline(slug, sourceId)
      .then(value => { if (current && request === readingRequest.current) setOutline(value); })
      .catch(cause => { if (current && request === readingRequest.current) setError(cause); });
    return () => { current = false; };
  }, [slug, sourceId]);

  useEffect(() => {
    if (!slug || !sourceId || !outline) return;
    /* URL 上带着旧的 sha：说明原文已被改过，按最新版本打开并提示（§13.4） */
    if (doc.sha && doc.sha !== outline.sha256) setStaleSha(true);
    if (doc.sha !== outline.sha256) patchSearchParam("sha", outline.sha256);
    if (!outline.sections.length) return;
    let current = true;
    const request = ++readingRequest.current;
    const index = Math.min(doc.chapter, outline.sections.length - 1);
    setChapter(null);
    knowledgeApi.section(slug, sourceId, index, outline.sha256)
      .then(content => {
        if (!current || request !== readingRequest.current) return;
        setChapter(content);
        setChapterIndex(index);
      })
      .catch(cause => { if (current && request === readingRequest.current) setError(cause); });
    return () => { current = false; };
  }, [slug, sourceId, outline, doc.chapter, doc.sha]);

  /* 章节内容到位后，恢复到 URL 上记录的滚动位置 */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !chapter) return;
    element.scrollTop = atRef.current;
  }, [chapter]);

  /* 检索命中：章节渲染完成后把高亮滚到视野中间 */
  useEffect(() => {
    if (!chapter || !doc.hit) return;
    const element = scrollRef.current?.querySelector("[data-hit]");
    element?.scrollIntoView({ block: "center" });
  }, [chapter, doc.hit]);

  /* 打开过的文档记下来供空态回看；只在本地，后端没有这份数据 */
  useEffect(() => {
    if (!slug) { setRecent([]); return; }
    if (!sourceId) { setRecent(readRecent(slug)); return; }
    const title = tree?.documents.find(item => item.source_id === sourceId)?.title ?? outline?.title ?? sourceId;
    pushRecent(slug, { source_id: sourceId, title });
    setRecent(readRecent(slug));
  }, [slug, sourceId, tree, outline]);

  /* 搜索词：输入框是瞬态，落 URL 用防抖 + replace，不污染历史 */
  useEffect(() => { setQDraft(kb.q); }, [kb.q]);
  useEffect(() => { setFtDraft(kb.ft); }, [kb.ft]);
  useEffect(() => {
    if (!slug || qDraft === kb.q) return;
    const timer = window.setTimeout(() => {
      navigate(listHref({ q: qDraft, offset: 0 }), { replace: true });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [qDraft, slug, kb.q]);
  useEffect(() => {
    if (!slug || ftDraft === kb.ft) return;
    const timer = window.setTimeout(() => {
      navigate(listHref({ ft: ftDraft, offset: 0 }), { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [ftDraft, slug, kb.ft]);

  /* ------------------------------------------------------ 导航 ------ */

  const openDocument = (item: Document) => {
    navigate(Paths.doc(slug, item.source_id, { section: kb.section, q: kb.q, offset: kb.offset }));
  };

  /* 检索命中 → 直接打开所属章节并带上字符位置，阅读页据此高亮定位 */
  const openHit = (hit: SearchHit) => {
    navigate(Paths.doc(slug, hit.source_id, {
      section: kb.section, q: kb.q, ft: kb.ft, offset: kb.offset,
      chapter: hit.section_index, sha: hit.sha256, at: 0, hit: hit.char_start,
    }));
  };

  const openChapter = (index: number) => {
    navigate(Paths.doc(slug, sourceId, {
      section: kb.section, q: kb.q, ft: kb.ft, offset: kb.offset,
      chapter: index, sha: outline?.sha256 ?? doc.sha, at: 0,
    }));
  };

  const mutate = async (operation: () => Promise<unknown>) => {
    if (!slug) return false;
    setBusy(true); setError(null);
    try {
      await operation();
      const value = await knowledgeApi.tree(slug);
      setTree(value);
      setDocsVersion(v => v + 1);
      return true;
    } catch (cause) { setError(cause); return false; }
    finally { setBusy(false); }
  };

  /* -------------------------------------------------- 派生视图 ------ */

  const sectionRows = useMemo(() => {
    if (!tree) return [];
    const children = new Map<string | null, Tree["sections"]>();
    for (const item of tree.sections) children.set(item.parent_id, [...(children.get(item.parent_id) ?? []), item]);
    const output: { section: Tree["sections"][number]; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const item of children.get(parent) ?? []) { output.push({ section: item, depth }); walk(item.section_id, depth + 1); }
    };
    walk(null, 0);
    return output;
  }, [tree]);

  const selectedSection = tree?.sections.find(item => item.section_id === kb.section);
  const currentDoc = tree?.documents.find(item => item.source_id === sourceId) ?? null;
  const active = tree?.documents.filter(item => item.online).length ?? 0;
  const placed = tree ? new Set(tree.placements.map(item => item.source_id)).size : 0;

  /* 索引未就绪时检索请求不发（§6.4），界面上单独给一类说明 */
  const indexUnready = !!searchStatus && !searchStatus.built;

  /* 命中的字符位置换算到当前章节内部（章节文本是完整原文的切片） */
  const hitRange = useMemo(() => {
    if (!chapter || !doc.hit || !kb.ft || staleSha) return null;
    const start = doc.hit - chapter.section.char_start;
    if (start < 0 || start >= chapter.text.length) return null;
    return { start, end: Math.min(chapter.text.length, start + kb.ft.length) };
  }, [chapter, doc.hit, kb.ft, staleSha]);

  /* ------------------------------------------------------ 渲染 ------ */

  if (route.name === "knowledge") {
    return <div className="scrollbar-thin h-full overflow-y-auto bg-canvas px-24 py-22 text-ink">
      <div className="mx-auto max-w-[1440px] space-y-18">
        <div className="border-b border-hairline pb-18">
          <h1 className="text-[24px] font-semibold">资料库</h1>
          <p className="mt-4 text-body text-stone">选择一个资料库进入目录、原文与检索</p>
        </div>
        {error ? <ErrorBanner cause={error} /> : null}
        {!libraries && !error && <p className="text-stone">正在读取资料库…</p>}
        {libraries && libraries.length === 0 && <p className="text-stone">暂无资料库</p>}
        <div className="grid gap-12 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-3">
          {libraries?.map(item => <Link key={item.slug} to={Paths.kb(item.slug)}
            className="rounded-md border border-hairline bg-surface p-16 hover:border-primary">
            <div className="text-title font-medium">{item.name}</div>
            <div className="mt-4 break-all text-meta text-stone" title={item.slug}>{item.slug}</div>
          </Link>)}
        </div>
      </div>
    </div>;
  }

  return <div className="scrollbar-thin h-full overflow-y-auto bg-canvas px-24 py-22 text-ink">
    <div className="mx-auto max-w-[1440px] space-y-14">
      {/* 库内 chrome 只留一行：库名（可点回列表）· 统计 · 库级动作。
          与列表页重复的大标题、12 个库的标签云、视图切换条已删除（审核第一批第 1 条 / U3） */}
      {slug ? <div className="flex flex-wrap items-center justify-between gap-12 border-b border-hairline pb-12">
        <div className="min-w-0">
          <Breadcrumb items={[
            { label: "资料库", to: Paths.knowledge() },
            ...(tree ? [{ label: tree.name, to: listOnlyHref }] : []),
          ]} />
          {tree ? <p className="mt-4 text-meta text-stone">{active} 篇原文 · {placed} 篇已归入章节 · {searchStatus?.documents ?? 0} 篇已建全文索引</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-8">
          <Link to={Paths.extract(slug)} className="rounded-md border border-hairline px-12 py-6 text-meta hover:bg-surface">信息提取</Link>
          <Link to={Paths.jobs(slug)} className="rounded-md border border-hairline px-12 py-6 text-meta hover:bg-surface">处理记录</Link>
          <button type="button" onClick={() => inspectorOpen ? closeInspector() : openPreview({ kind: "library", slug })} className={`rounded-md border px-12 py-6 text-meta ${inspectorOpen ? "border-primary bg-primary/10 text-primary" : "border-hairline hover:bg-surface"}`}>{inspectorOpen ? "收起概览" : "库概览"}</button>
        </div>
      </div> : null}
      {error ? <ErrorBanner cause={error} /> : null}
      {slug && !tree && !error && <p className="text-stone">正在读取资料库…</p>}
      {tree && <>
        {searchStatus && !searchStatus.built && <p className="rounded-md border border-hairline bg-surface p-10 text-meta text-stone">当前库尚未构建全文索引，目录与原文阅读不受影响。</p>}
        <div className="grid min-h-[580px] gap-12 min-[700px]:grid-cols-[240px_340px_minmax(0,1fr)]">
          <aside className="max-h-[72vh] overflow-y-auto rounded-md border border-hairline bg-surface p-10">
            <div className="mb-10 flex items-center justify-between"><strong className="text-body">目录</strong><button type="button" disabled={busy} className="text-meta text-primary" onClick={() => { setSectionDraft(""); setAddingSection(true); }}>新建</button></div>
            {addingSection && <form className="mb-10 space-y-5" onSubmit={event => { event.preventDefault(); if (sectionDraft.trim()) void mutate(() => knowledgeApi.editSection(slug!, sectionDraft.trim(), undefined, kb.section || "root")).then(ok => { if (ok) setAddingSection(false); }); }}>
              <input aria-label="新章节名称" autoFocus value={sectionDraft} onChange={event => setSectionDraft(event.target.value)} className="w-full rounded border border-hairline px-7 py-5 text-body" placeholder="章节名称" />
              <div className="flex gap-8"><button type="submit" disabled={busy} className="text-meta text-primary">保存</button><button type="button" onClick={() => setAddingSection(false)} className="text-meta text-stone">取消</button></div>
            </form>}
            <button type="button" onClick={() => navigate(listHref({ section: "", offset: 0 }))} className={`w-full rounded px-8 py-6 text-left text-body ${!kb.section ? "bg-primary/10 text-primary" : "hover:bg-canvas"}`}>全部文档</button>
            <div className="mt-5 space-y-1">{sectionRows.map(({ section, depth }) => <button key={section.section_id} type="button" onClick={() => navigate(listHref({ section: section.section_id, offset: 0 }))} style={{ paddingLeft: 8 + depth * 14 }} className={`w-full truncate rounded py-5 pr-6 text-left text-body ${kb.section === section.section_id ? "bg-primary/10 text-primary" : "hover:bg-canvas"}`} title={section.title}>{section.title}</button>)}</div>
            {selectedSection && (renamingSection ? <form className="mt-14 space-y-5" onSubmit={event => { event.preventDefault(); if (sectionDraft.trim()) void mutate(() => knowledgeApi.editSection(slug!, sectionDraft.trim(), selectedSection.section_id)).then(ok => { if (ok) setRenamingSection(false); }); }}>
              <input aria-label="章节新名称" autoFocus value={sectionDraft} onChange={event => setSectionDraft(event.target.value)} className="w-full rounded border border-hairline px-7 py-5 text-body" />
              <div className="flex gap-8"><button type="submit" disabled={busy} className="text-meta text-primary">保存</button><button type="button" onClick={() => setRenamingSection(false)} className="text-meta text-stone">取消</button></div>
            </form> : <button type="button" disabled={busy} className="mt-14 text-meta text-stone hover:text-primary" onClick={() => { setSectionDraft(selectedSection.title); setRenamingSection(true); }}>重命名“{selectedSection.title}”</button>)}
          </aside>
          <section className="max-h-[72vh] overflow-y-auto rounded-md border border-hairline bg-surface p-10">
            <div className="mb-10"><input aria-label="搜索文档" value={qDraft} onChange={event => setQDraft(event.target.value)} placeholder="搜索标题或路径" className="w-full rounded border border-hairline bg-transparent px-8 py-6 text-body outline-none focus:border-primary" /></div>
            <div className="mb-10"><input aria-label="全文检索" value={ftDraft} onChange={event => setFtDraft(event.target.value)} placeholder="全文检索（BM25）" className="w-full rounded border border-hairline bg-transparent px-8 py-6 text-body outline-none focus:border-primary" /></div>
            <div className="mb-7 text-meta text-stone">{searchStatus ? (searchStatus.built ? `全文索引 ${searchStatus.documents} 篇${searchStatus.built_at ? ` · ${searchStatus.built_at.slice(0, 19).replace("T", " ")}` : ""}` : "全文索引尚未构建，目录与原文阅读不受影响") : " "}</div>
            {kb.ft ? null : <div className="mb-7 text-meta text-stone">{docs ? `${docs.total} 篇文档${kb.section ? " · 当前章节及子章节" : " · 全库"}` : "正在读取…"}</div>}
            {!kb.ft && docs && docs.total === 0 ? <div className="mb-9 rounded border border-hairline bg-canvas p-10 text-meta text-stone">
              <div>当前范围没有匹配{kb.q ? `：搜索「${kb.q}」` : ""} · {kb.section ? "当前章节及子章节" : "全库"}</div>
              <div className="mt-7 flex flex-wrap gap-10">
                {kb.section ? <button type="button" onClick={() => navigate(listHref({ section: "", offset: 0 }))} className="text-primary">扩大到全库</button> : null}
                {kb.q ? <button type="button" onClick={() => navigate(listHref({ q: "", offset: 0 }))} className="text-primary">清空搜索词</button> : null}
              </div>
            </div> : null}
            {kb.ft ? null : <div className="space-y-1">{docs?.items.map(item => <button type="button" key={item.source_id} title={item.path} onClick={() => openDocument(item)} className={`w-full rounded px-8 py-7 text-left hover:bg-canvas ${sourceId === item.source_id ? "bg-primary/10" : ""}`}><div className="truncate text-body">{item.title}</div></button>)}</div>}
            {!kb.ft && docs?.nextOffset != null && <button type="button" className="mt-12 w-full rounded border border-hairline py-7 text-body" onClick={() => navigate(listHref({ offset: docs.items.length }))}>加载更多</button>}

            {kb.ft ? <>
              {indexUnready ? <div className="mb-9 rounded border border-hairline bg-canvas p-10 text-meta text-stone">
                <div>全文索引未就绪：检索用不了，目录与原文阅读不受影响。索引要由后端构建。</div>
                <button type="button" onClick={() => void copyToClipboard(searchIndexCommand(slug))} className="mt-7 rounded-md border border-hairline px-10 py-5 text-micro hover:bg-surface">复制建索引命令</button>
              </div> : null}
              {indexUnready ? null : <div className="mb-8 text-meta text-stone">{search ? `命中 ${search.total} 篇 · ${search.ranked_by === "bm25" ? "BM25 排序" : "子串匹配（词太短，trigram 无法匹配）"} · 范围：${kb.section ? "当前章节及子章节" : "全库"}` : "正在检索…"}</div>}
              {search && search.total === 0 && !indexUnready ? <div className="mb-9 rounded border border-hairline bg-canvas p-10 text-meta text-stone">
                <div>全文没有命中「{kb.ft}」</div>
                <div className="mt-7 flex flex-wrap gap-10">
                  {kb.section ? <button type="button" onClick={() => navigate(listHref({ section: "", offset: 0 }))} className="text-primary">扩大到全库</button> : null}
                  <button type="button" onClick={() => setFtDraft("")} className="text-primary">清空检索词</button>
                </div>
              </div> : null}
              <div className="space-y-6">{search?.hits.map(hit => <button type="button" key={hit.source_id} aria-label={`命中 ${hit.title}`} onClick={() => openHit(hit)} className="block w-full rounded border border-hairline bg-canvas px-9 py-8 text-left hover:border-primary">
                <div className="truncate text-body font-medium text-ink">{hit.title}</div>
                <div className="mt-2 truncate text-micro text-stone" title={hit.path}>{hit.path}</div>
                {hit.snippets.slice(0, 1).map((snippet, index) => <p key={index} className="mt-4 text-meta leading-[1.6] text-steel">{snippet.text.slice(0, Math.max(0, snippet.hit_start))}<mark className="rounded-sm bg-primary-soft text-ink">{snippet.text.slice(Math.max(0, snippet.hit_start), snippet.hit_end)}</mark>{snippet.text.slice(snippet.hit_end)}</p>)}
                <div className="mt-3 text-micro text-stone">第 {hit.char_start.toLocaleString()} 字符 · 得分 {hit.score}</div>
              </button>)}</div>
              {search?.next_offset != null ? <button type="button" aria-label="加载更多命中" className="mt-12 w-full rounded border border-hairline py-7 text-body" onClick={() => navigate(listHref({ offset: search.next_offset as number }))}>加载更多命中（已显示 {kb.offset + search.hits.length} / {search.total}）</button> : null}
            </> : null}
          </section>
          <article ref={scrollRef} onScroll={event => {
            const top = event.currentTarget.scrollTop;
            window.clearTimeout(scrollTimer.current);
            scrollTimer.current = window.setTimeout(() => patchSearchParam("at", top), 180);
          }} className="max-h-[72vh] min-w-0 overflow-y-auto rounded-md border border-hairline bg-surface p-16">
            {/* 阅读列宽收到 760px 居中：长行舒适宽度约 65–75 字符（审核第一批第 2 条） */}
            <div className="mx-auto h-full max-w-[760px]">
            {!sourceId ? <div className="grid h-full place-items-center text-center">
              <div className="max-w-[360px]">
                <p className="text-title text-ink">选择一篇文档开始阅读</p>
                <p className="mt-8 text-meta leading-[1.7] text-stone">左栏按章节筛选，中栏可搜标题或全文。</p>
                {recent.length ? <div className="mt-16 text-left">
                  <div className="mb-6 text-micro text-stone">最近阅读</div>
                  <div className="space-y-1">{recent.map(item => <button key={item.source_id} type="button" aria-label={`继续阅读 ${item.title}`} onClick={() => navigate(Paths.doc(slug, item.source_id, { section: kb.section, q: kb.q, ft: kb.ft, offset: kb.offset }))} className="block w-full truncate rounded px-8 py-6 text-left text-body text-primary hover:bg-canvas">{item.title}</button>)}</div>
                </div> : null}
              </div>
            </div> : null}
            {sourceId && <>
              <div className="mb-14 border-b border-hairline pb-12">
                <div className="flex items-start justify-between gap-10">
                  <h3 className="min-w-0 text-h3 font-semibold">{currentDoc?.title ?? outline?.title ?? "正在读取…"}</h3>
                  <a className="shrink-0 text-micro text-primary" href={`/api/libraries/${encodeURIComponent(slug)}/documents/${encodeURIComponent(sourceId)}/original`} target="_blank" rel="noreferrer">打开原始文件</a>
                </div>
                {staleSha && <p className="mt-8 text-micro text-stone">链接记录的原文版本已变化，已按最新版本打开（新旧内容不能混读）。</p>}
                {selectedSection && currentDoc && <button type="button" disabled={busy} className="mt-8 text-meta text-primary" onClick={() => {
                  const exists = tree.placements.some(item => item.section_id === kb.section && item.source_id === currentDoc.source_id);
                  void mutate(() => knowledgeApi.place(slug!, currentDoc.source_id, kb.section, exists));
                }}>{tree.placements.some(item => item.section_id === kb.section && item.source_id === currentDoc.source_id) ? "从当前章节移除" : "加入当前章节"}</button>}
              </div>
              {outline && <p className="mb-10 text-micro text-stone">{outline.content_kind === "parsed" ? "当前阅读导入的解析正文，字符定位基于这份解析文本。" : "当前阅读原文。"}</p>}
              {outline ? <div className="mb-14 flex flex-wrap items-center gap-8 border-b border-hairline pb-12">
                <select id="document-chapter" aria-label="章节" value={chapterIndex} onChange={event => openChapter(Number(event.target.value))} className="max-w-[380px] truncate rounded-pill border border-hairline bg-canvas px-12 py-6 text-meta">{outline.sections.map(item => <option key={item.index} value={item.index}>{"　".repeat(Math.max(0, item.level - 1))}{item.title}</option>)}</select>
                <span className="text-micro text-stone">第 {chapterIndex + 1} / {outline.sections.length} 章</span>
                <div className="ml-auto flex items-center gap-8">
                  <button type="button" disabled={chapterIndex === 0} aria-label="上一章" onClick={() => openChapter(chapterIndex - 1)} className="rounded-pill border border-hairline px-10 py-5 text-micro text-primary disabled:text-stone">上一章</button>
                  <button type="button" disabled={chapterIndex >= outline.sections.length - 1} aria-label="下一章" onClick={() => openChapter(chapterIndex + 1)} className="rounded-pill border border-hairline px-10 py-5 text-micro text-primary disabled:text-stone">下一章</button>
                </div>
              </div> : null}
              {chapter ? <div><p className="mb-10 text-micro text-stone">完整章节 · {chapter.text.length.toLocaleString()} 字符{hitRange ? ` · 已定位到检索命中（第 ${doc.hit.toLocaleString()} 字符）` : ""}</p><MarkdownText text={chapter.text} highlight={hitRange ?? undefined} /></div> : <p className="text-body text-stone">正在读取章节…</p>}
            </>}
            </div>
          </article>
        </div>
      </>}
    </div>
  </div>;
}

/** 错误位：固定带「下一步」，索引不可用时明确告知阅读不受影响 */
function ErrorBanner({ cause }: { cause: unknown }) {
  return <div role="alert" className="rounded-md border border-rose/30 bg-rose/5 p-12 text-body text-rose">{describeError(cause)}</div>;
}
