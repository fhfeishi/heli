import { useEffect, useRef, useState } from "react";
import { Link, Paths, setSearchParams, useRoute } from "../app/router";
import { extractionApi, type ExtractionPlan, type PlanSchema } from "../api/extraction";
import { RECORD_SCOPE_LABEL, type ExtractScope } from "../types";
import { Breadcrumb } from "./Breadcrumb";
import { ImportedResults } from "./ImportedResults";
import { Button } from "./ui";

const initial = (): PlanSchema => ({
  name: "技术应用分析", record_scope: "document",
  instructions: "仅提取原文明示的信息。每个事实字段附原文证据及字符区间；未提及与处理失败分开表示。",
  fields: ["应用场景", "问题", "技术方法", "成果指标", "作者", "时间"].map(name =>
    ({ name, type: "string", hint: "", required: false, missing: "未提及" })),
});
const input = "w-full rounded border border-hairline bg-canvas px-8 py-6 text-body";

export function ExtractView() {
  const { slug, search } = useRoute();
  /* 当前编辑哪个方案只认 mount 时的 URL（§13.1）：刷新与复制他人链接都回到同一个方案。
     局限如实说明：方案选择进不了浏览器的前进/后退，只保证「按地址还原」。 */
  const initialPlan = useRef<string | null>(search.get("plan"));
  const [plans, setPlans] = useState<ExtractionPlan[]>([]);
  const [current, setCurrent] = useState<ExtractionPlan>();
  const [schema, setSchema] = useState<PlanSchema>(initial);
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [term, setTerm] = useState("");
  const dirty = JSON.stringify(schema) !== JSON.stringify(current?.schema ?? initial());
  useEffect(() => {
    let active = true;
    setLoaded(false); setPlans([]); setCurrent(undefined); setSchema(initial()); setAdvanced(false);
    if (slug) extractionApi.list(slug).then(result => {
      if (!active) return;
      setPlans(result.plans); setLoaded(true);
      const preferred = initialPlan.current;
      const chosen = result.plans.find(p => p.id === preferred) ?? (preferred === "new" ? undefined : result.plans[0]);
      if (chosen) { setCurrent(chosen); setSchema(chosen.schema); }
      /* URL 是选择的真源：地址里没写 plan 时把默认选中的方案写回去 */
      if (!preferred) setSearchParams({ plan: chosen?.id ?? "new" }, { replace: true });
    }).catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, [slug]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || advanced) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, advanced]);
  const updateField = (index: number, change: Partial<PlanSchema["fields"][number]>) =>
    setSchema(s => ({ ...s, fields: s.fields.map((field, i) => i === index ? { ...field, ...change } : field) }));
  async function save() {
    if (!slug) return;
    setBusy(true); setMessage("");
    try {
      const saved = await extractionApi.save(slug, schema, current);
      setCurrent(saved); setSchema(saved.schema);
      setPlans(p => [...p.filter(item => item.id !== saved.id), saved]);
      setSearchParams({ plan: saved.id }, { replace: true });
      setMessage("方案已保存到资料库，刷新后可继续编辑。");
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  function select(id: string) {
    if ((dirty || advanced) && !window.confirm("放弃未保存的编辑并切换方案？")) return;
    const plan = plans.find(p => p.id === id);
    setCurrent(plan); setSchema(plan?.schema ?? initial()); setAdvanced(false); setMessage("");
    setSearchParams({ plan: id || "new" });
  }
  return <div className="h-full overflow-y-auto p-24"><div className="mx-auto max-w-[1200px] space-y-18">
    <header className="space-y-8 border-b border-hairline pb-14">
      <Breadcrumb items={[{ label: "资料库", to: Paths.knowledge() }, ...(slug ? [{ label: slug, to: Paths.kb(slug) }] : []), { label: "信息提取" }]} />
      <div className="flex flex-wrap items-end justify-between gap-12">
        <div><h1 className="text-[24px] font-semibold">信息提取</h1>
          <p className="mt-6 text-body text-stone">定义可复用的提取方案，同一份资料可以用于多个目的。</p></div>
        {slug && <Link to={Paths.kb(slug)} className="shrink-0 text-meta text-primary" onClick={event => { if ((dirty || advanced) && !window.confirm("放弃未保存的编辑并返回资料库？")) event.preventDefault(); }}>返回资料库</Link>}
      </div>
    </header>
    <p role="status" className="rounded border border-hairline p-12 text-meta leading-[1.65]">方案与已有提取结果都保存在资料库里。自动提取运行尚未开放；需要核对原文时可以先检索全文。</p>
    {message && <p role="alert" className="text-meta leading-[1.65]">{message}</p>}
    {slug && <ImportedResults slug={slug} />}
    <section className="space-y-12 rounded border border-hairline p-16">
      <div className="flex items-end gap-12"><label className="flex-1">已保存的方案<select aria-label="已保存的方案" className={input} value={current?.id ?? ""} disabled={!loaded || busy} onChange={e => select(e.target.value)}><option value="">新建方案</option>{plans.map(p => <option key={p.id} value={p.id}>{p.schema.name}</option>)}</select></label>
        <Button disabled={!loaded || busy} onClick={() => select("")}>新建方案</Button></div>
      <p className="text-meta text-stone">{current ? `已保存 ${new Date(current.saved_at).toLocaleString()} · 历史版本 ${current.history.length}` : "尚未保存"}{dirty ? " · 有未保存修改" : ""}</p>
      <p className="text-micro text-stone">当前方案写在地址 ?plan= 上：复制当前地址给别人或直接刷新，都会回到这个方案。</p>
      <fieldset disabled={!loaded || busy || advanced} className="space-y-12">
        <label className="block">方案名称<input aria-label="方案名称" className={input} value={schema.name} onChange={e => setSchema({ ...schema, name: e.target.value })}/></label>
        <label className="block">一条记录代表什么<select aria-label="记录粒度" className={input} value={schema.record_scope} onChange={e => setSchema({ ...schema, record_scope: e.target.value as ExtractScope })}>{Object.entries(RECORD_SCOPE_LABEL).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
        <p className="text-meta text-stone">{RECORD_SCOPE_LABEL[schema.record_scope].help}</p>
        <label className="block">提取指令<textarea aria-label="提取指令" className={input} rows={3} value={schema.instructions} onChange={e => setSchema({ ...schema, instructions: e.target.value })}/></label>
        {schema.fields.map((field, i) => <div key={i} className="grid grid-cols-2 gap-8 rounded border border-hairline p-10 md:grid-cols-6">
          <label>字段名<input aria-label={`字段名 ${i + 1}`} className={input} value={field.name} onChange={e => updateField(i, { name: e.target.value })}/></label>
          <label>类型<select aria-label={`字段类型 ${i + 1}`} className={input} value={field.type} onChange={e => updateField(i, { type: e.target.value as typeof field.type })}>{["string", "number", "boolean", "string[]"].map((type, n) => <option key={type} value={type}>{["文本", "数字", "是 / 否", "文本列表"][n]}</option>)}</select></label>
          <label>说明<input aria-label={`字段说明 ${i + 1}`} className={input} value={field.hint} onChange={e => updateField(i, { hint: e.target.value })}/></label>
          <label>缺失表示<input aria-label={`缺失表示 ${i + 1}`} className={input} value={field.missing} onChange={e => updateField(i, { missing: e.target.value })}/></label>
          <label className="flex items-center gap-6"><input type="checkbox" checked={field.required} onChange={e => updateField(i, { required: e.target.checked })}/>必填</label>
          <Button onClick={() => setSchema({ ...schema, fields: schema.fields.filter((_, n) => n !== i) })}>删除字段 {i + 1}</Button>
        </div>)}
        <Button onClick={() => setSchema({ ...schema, fields: [...schema.fields, { name: "新字段", type: "string", hint: "", required: false, missing: "未提及" }] })}>添加字段</Button>
      </fieldset>
      <div className="flex gap-8"><Button disabled={!loaded || busy || advanced} onClick={() => { setJson(JSON.stringify(schema, null, 2)); setAdvanced(!advanced); }}>高级编辑</Button>
        <Button variant="primary" disabled={!loaded || busy || advanced} onClick={save}>{busy ? "保存中…" : "保存方案"}</Button></div>
      {advanced && <div className="space-y-8"><textarea aria-label="方案 JSON" className={`${input} font-mono`} rows={18} value={json} onChange={e => setJson(e.target.value)}/><Button onClick={async () => {
        if (!slug) return;
        setBusy(true);
        try { const saved = await extractionApi.save(slug, JSON.parse(json), current); setCurrent(saved); setSchema(saved.schema); setPlans(p => [...p.filter(item => item.id !== saved.id), saved]); setAdvanced(false); setMessage("方案已保存"); }
        catch (error) { setMessage(String(error)); } finally { setBusy(false); }
      }} disabled={busy}>保存高级编辑</Button><Button onClick={() => setAdvanced(false)}>放弃高级编辑</Button></div>}
    </section>
    <section className="space-y-12 rounded border border-hairline p-16"><h2 className="text-title font-semibold">继续搜索原文</h2><p className="text-meta">提取结果可能遗漏信息，可以继续核对完整正文。</p>
      <label className="block">在原文里检索<input aria-label="在原文里检索" className={input} value={term} onChange={e => setTerm(e.target.value)}/></label>
      {slug && term.trim() && <Link to={Paths.kb(slug, { ft: term.trim() })} className="text-primary">检索「{term.trim()}」</Link>}
    </section>
  </div></div>;
}
