import { useEffect, useRef, useState } from "react";
import { importedResultsApi, type ImportedPage, type ImportedDetail, type EvidenceCheck } from "../api/extraction";
import { Link, Paths, setSearchParams, useRoute } from "../app/router";
import { Button } from "./ui";

export function ImportedResults({ slug }: { slug: string }) {
  const search = useRoute().search;
  /* 选中的结果与核对来源写在 ?result= / ?src= 上：点进原文再按返回，能回到同一份结果、同一来源。
     只在 mount 时读地址（刷新与分享走这条路径），筛选词与分页仍留在本地，
     不假装它们也能被地址还原。 */
  const initialResult = useRef<string | null>(search.get("result"));
  const initialSource = useRef<string | null>(search.get("src"));
  const route = useRoute();
  const selectedResult = route.search.get("result") ?? "";
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ImportedPage>();
  const [detail, setDetail] = useState<ImportedDetail>();
  const [check, setCheck] = useState<EvidenceCheck>();
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const evidencePanel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (check) evidencePanel.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [check]);
  useEffect(() => {
    let active = true; setPage(undefined);
    const timer = setTimeout(() => importedResultsApi.list(slug, query, offset).then(value => {
      if (active) { setPage(value); setError(""); }
    }).catch(e => { if (active) setError(String(e)); }), 200);
    return () => { active = false; clearTimeout(timer); };
  }, [slug, query, offset]);
  useEffect(() => { request.current++; setDetail(undefined); setCheck(undefined); setSourceId(""); setOffset(0); setQuery(""); }, [slug]);
  /* 地址上带着结果就恢复：刷新、别人发的链接、从原文页返回都走这里 */
  useEffect(() => { if (initialResult.current) void open(initialResult.current); }, []);
  useEffect(() => { if (selectedResult) void open(selectedResult); }, [slug, selectedResult]);
  async function open(id: string) {
    const token = ++request.current; setBusy(true); setDetail(undefined); setCheck(undefined); setError("");
    /* push 一条历史：从原文页按返回能回到这个结果 */
    setSearchParams({ result: id, src: null });
    try {
      const value = await importedResultsApi.detail(slug, id);
      if (token === request.current) {
        setDetail(value);
        const preferred = initialSource.current;
        setSourceId(preferred && value.sources.some(s => s.source_id === preferred) ? preferred : value.sources[0]?.source_id ?? "");
      }
    }
    catch (e) { if (token === request.current) setError(String(e)); }
    finally { if (token === request.current) setBusy(false); }
  }
  async function verify(facet: number, item: number, evidence: number) {
    if (!detail) return;
    const token = ++request.current; setBusy(true); setCheck(undefined); setError("");
    try { const value = await importedResultsApi.evidence(slug, detail.id, sourceId, facet, item, evidence); if (token === request.current) setCheck(value); }
    catch (e) { if (token === request.current) setError(String(e)); }
    finally { if (token === request.current) setBusy(false); }
  }
  const names = new Map(detail?.result.facets.flatMap(f => (f.items ?? []).map(i => [i.id, i.name] as const)));
  return <section className="space-y-12 rounded border border-hairline p-16">
    <h2 className="text-title font-semibold">已有提取结果</h2>
    <p className="text-meta leading-[1.65] text-stone">读取你放入资料库的提取文件。本行代表一篇来源文档的导入结果，内部保留场景、问题、技术、成果条目及关系。方案编辑不会改写这些文件。</p>
    <input aria-label="筛选提取结果" placeholder="搜索来源名称或提取内容" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} className="w-full rounded border border-hairline bg-canvas p-8"/>
    {error && <p role="alert" className="text-meta text-rose">{error}</p>}
    {!page ? <p>正在读取结果…</p> : <>
      <p className="text-meta">共 {page.total} 份结果{page.total ? ` · 当前 ${offset + 1}–${offset + page.results.length}` : ""}</p>
      {page.warnings.map(w => <p key={w.file} className="text-meta text-stone">未载入 {w.file}：{w.error}</p>)}
      <div className="space-y-6">{page.results.map(row => <button key={row.id} onClick={() => setSearchParams({ result: row.id })} className="block w-full rounded border border-hairline p-10 text-left hover:border-primary">
        <span className="block text-body">{row.sources.map(s => s.title).join(" / ") || `未关联来源 · ${row.doc_id}`}</span>
        <span className="text-meta text-stone">文档级导入结果 · {row.facet_count} 个维度 · {row.process?.status ?? "未声明处理状态"}（导入记录）</span>
      </button>)}</div>
      <div className="flex gap-8"><Button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页结果</Button><Button disabled={page.next_offset === null} onClick={() => setOffset(page.next_offset!)}>下一页结果</Button></div>
      {!page.total && <p className="text-meta">当前没有匹配的导入结果。</p>}
    </>}
    {busy && <p role="status">正在读取与核对…</p>}
    {detail && <div className="space-y-12 border-t border-hairline pt-16">
      <div className="flex items-center justify-between gap-10"><h3 className="text-title">结果详情</h3><button type="button" aria-label="关闭结果详情" className="text-primary" onClick={() => { request.current++; setDetail(undefined); setCheck(undefined); setSourceId(""); setSearchParams({ result: null, src: null }); }}>关闭</button></div>
      <p className="text-meta text-stone">版本 {detail.result.version} · {detail.result.generated_at} · {detail.result.model}</p>
      {!detail.sources.length && <p className="text-meta text-rose">未找到哈希相同的原文，无法认定来源或核验证据。请核对源文件是否齐全或已更新。</p>}
      {detail.sources.some(s => s.stale) && <p className="text-meta text-rose">原文已变化：结果待更新，不能按旧位置定位。</p>}
      {detail.sources.length > 0 && <label className="block text-meta">核对来源<select aria-label="核对来源" value={sourceId} onChange={e => { request.current++; setBusy(false); setSourceId(e.target.value); setCheck(undefined); setSearchParams({ src: e.target.value }, { replace: true }); }} className="mt-6 block w-full rounded border border-hairline bg-canvas p-8">{detail.sources.map(s => <option key={s.source_id} value={s.source_id}>{s.path}</option>)}</select></label>}
      {sourceId && <Link to={Paths.doc(slug, sourceId)} className="text-primary">阅读来源正文</Link>}
      {detail.result.facets.map((facet, fi) => <section key={fi} className="space-y-8 rounded bg-surface p-12">
        <h4 className="text-title font-semibold">{facet.key}</h4>
        {facet.state !== "has" && <p className="text-meta">{["missing", "absent", "not_mentioned", "none"].includes(facet.state) ? "未提及" : ["failed", "error"].includes(facet.state) ? "提取失败" : `导入状态：${facet.state}`}</p>}
        {(facet.items ?? []).map((item, ii) => <div key={item.id ?? ii} className="space-y-6 border-t border-hairline pt-8">
          <strong className="text-body">{item.name}</strong><p className="text-meta leading-[1.7]">{item.desc}</p>{item.status && <p className="text-meta">{item.status}</p>}
          {(item.evidence ?? []).map((evidence, ei) => <div key={ei} className="rounded border border-hairline p-8">
            <blockquote className="text-meta leading-[1.7]">{evidence.quote}</blockquote>
            <p className="my-6 text-micro text-stone">导入定位：{evidence.locator?.basis ?? "未声明"}{evidence.locator?.page != null ? ` · 第 ${evidence.locator.page} 页` : ""} · 尚待核对</p>
            <Button size="sm" disabled={!sourceId || busy} onClick={() => verify(fi, ii, ei)}>核对证据 {fi + 1}.{ii + 1}.{ei + 1}</Button>
          </div>)}
        </div>)}
      </section>)}
      {!!detail.result.relations?.length && <div><h4 className="text-title">条目关系（导入记录）</h4>{detail.result.relations.map((r, i) => <p key={i} className="mt-6 text-meta leading-[1.7]">{names.get(r.from.item_id) ?? r.from.item_id} → {names.get(r.to.item_id) ?? r.to.item_id}（{r.basis}）</p>)}</div>}
    </div>}
    {check && <div ref={evidencePanel} role="status" className="space-y-8 rounded border border-primary p-12">
      <h3 className="text-title">证据核对</h3>
      {check.verified ? <><p className="text-meta">已在阅读正文唯一匹配，字符 {check.char_start}–{check.char_end}。这表示摘录位置已匹配，不代表提取结论已人工审核。</p><pre className="whitespace-pre-wrap font-app text-meta leading-[1.7]">{check.text}</pre><Link className="text-primary" to={Paths.doc(slug, check.source_id, { sha: check.sha256, chapter: check.section_index, hit: check.char_start, ft: check.quote })}>打开正文并高亮证据</Link></> : <p className="text-meta leading-[1.7]">{check.reason}</p>}
    </div>}
  </section>;
}
