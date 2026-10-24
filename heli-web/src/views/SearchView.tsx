/* 全局检索：跨资料库搜索，命中直接定位到原文的字符位置。 */
import { useEffect, useMemo, useState } from "react";
import { Button, Chip, EmptyState, SearchField, ViewHeader, Highlight } from "../components/ui";
import { Paths, navigate, useRoute } from "../app/router";
import { api, type Hit, type SearchPlan } from "../model/api";
import { useWorkspace } from "../model/store";
import { describeError } from "../model/errors";

const PLACEHOLDERS = ["技术路线", "人工智能", "知识图谱", "实验方法", "研究进展"];

export function SearchView() {
  const route = useRoute();
  const { libraries, setError } = useWorkspace();
  const initialQuery = route.search.get("q") ?? "";
  const initialScope = route.search.get("scope") ?? "all";

  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState(initialScope);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ranFor, setRanFor] = useState<string>("");
  /* 自然语言检索时后端返回的解析结果：把「我理解成了什么」摊开给用户看。
     规则兜底（source=rule）时要明说，否则用户以为系统懂了。 */
  const [plan, setPlan] = useState<SearchPlan | null>(null);

  const libraryName = useMemo(() => {
    const map = new Map(libraries.map((library) => [library.id, library.name]));
    return (id: string) => map.get(id) ?? "未知资料库";
  }, [libraries]);

  const run = async (text: string, scopeValue: string) => {
    const keyword = text.trim();
    if (!keyword) return;
    setBusy(true);
    try {
      const data = await api.search(keyword, scopeValue, 50);
      setHits(data.hits);
      setRanFor(keyword);
      setPlan(null);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  /* 带 ?q= 直接进来自动检索一次；之后由按钮 / Enter 触发，避免输入时刷请求 */
  useEffect(() => {
    if (initialQuery.trim()) void run(initialQuery, initialScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const keyword = query.trim();
    if (!keyword) return;
    navigate(Paths.search(keyword, scope), { replace: true });
    void run(keyword, scope);
  };

  /* 自然语言检索：后端把「2020-2025 年医学方向」拆成年份区间 + 关键词再查 */
  const ask = async () => {
    const text = query.trim();
    if (!text) return;
    setBusy(true);
    try {
      const data = await api.searchPlan(text, scope, 50);
      setHits(data.hits);
      setRanFor(text);
      setPlan(data.plan);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel = (libraryId: string) =>
    libraryId === "all" ? "全部资料库" : `仅在「${libraryName(libraryId.replace(/^library:/, ""))}」`;

  return (
    <div className="h-full overflow-auto pb-40">
      <ViewHeader
        title="检索"
        description="跨资料库检索，结果定位到原文的命中位置；引用回到当时使用的内容。"
        stats={hits ? `${hits.length} 条结果` : "输入关键词开始"}
      />

      <div className="mx-auto w-full max-w-[1180px] px-34">
        <div className="mt-18 flex flex-wrap items-center gap-8">
          <SearchField
            value={query}
            onChange={setQuery}
            onEnter={submit}
            placeholder="搜索全部资料，例如：技术路线"
            className="min-w-[320px] flex-1"
          />
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              if (query.trim()) void run(query, event.target.value);
            }}
            className="font-app h-34 rounded-md border border-hairline bg-canvas px-9 text-meta text-slate outline-none focus:border-primary"
          >
            <option value="all">全部资料库</option>
            {libraries.map((library) => (
              <option key={library.id} value={`library:${library.id}`}>
                {library.name}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={submit} disabled={!query.trim() || busy}>
            {busy ? "检索中…" : "检索"}
          </Button>
          <Button variant="quiet" icon="sparkles" onClick={() => void ask()} disabled={!query.trim() || busy}>
            问一句
          </Button>
        </div>

        {/* 解析结果：把「我理解成了什么」摊开。
            规则兜底时必须明说——否则用户以为系统听懂了。 */}
        {plan ? (
          <div className="mt-12 rounded-md border border-hairline bg-surface-soft px-12 py-10 text-micro">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
              <span className="text-stone">理解成</span>
              {plan.year_from || plan.year_to ? (
                <Chip tone="sky">
                  {plan.year_from ?? "…"}–{plan.year_to ?? "…"} 年
                </Chip>
              ) : (
                <Chip tone="gray">不限年份</Chip>
              )}
              {plan.keywords.map((word) => (
                <Chip key={word} tone="lav">{word}</Chip>
              ))}
              <span className="ml-auto text-stone">
                {plan.source === "model" ? "由模型拆解" : "规则拆解（可能没理解你的意思）"}
              </span>
            </div>
            {plan.source === "rule" ? (
              <p className="mt-7 text-steel">
                未配置模型或模型不可用，这里只按年份和字面词拆分。可以说得更具体些，或直接改用「检索」。
              </p>
            ) : null}
          </div>
        ) : null}

        {hits === null && !busy ? (
          <div className="mt-26">
            <EmptyState
              title="输入关键词开始检索"
              description="中文按子串匹配；两字词会回退到模糊匹配。检索范围可以限定到单个资料库。"
              action={
                <div className="flex flex-wrap justify-center gap-6">
                  {PLACEHOLDERS.map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() => {
                        setQuery(word);
                        navigate(Paths.search(word, scope), { replace: true });
                        void run(word, scope);
                      }}
                      className="font-app rounded-pill bg-surface px-10 py-5 text-meta text-slate hover:bg-primary-soft hover:text-primary"
                    >
                      {word}
                    </button>
                  ))}
                </div>
              }
            />
          </div>
        ) : null}

        {hits !== null ? (
          <div className="mt-18">
            <div className="mb-8 flex items-center gap-8 text-micro text-stone">
              <span>
                「{ranFor}」· {scopeLabel(scope)}
              </span>
              <span className="ml-auto tabular-nums">{hits.length} 条</span>
            </div>

            {hits.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline px-14 py-16 text-center text-meta text-stone">
                没有命中。换个词，或把范围切到「全部资料库」再试。
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-hairline bg-canvas">
                {hits.map((hit, index) => (
                  <button
                    key={`${hit.version_id}-${hit.position}-${index}`}
                    type="button"
                    onClick={() => navigate(Paths.doc(hit.library_id, hit.source_id, hit.position))}
                    className="block w-full border-b border-hairline-soft px-14 py-12 text-left transition-colors last:border-0 hover:bg-surface-soft"
                  >
                    <div className="flex min-w-0 items-center gap-8">
                      <span className="truncate text-body font-medium text-ink">{hit.title}</span>
                      <Chip tone="sky">{libraryName(hit.library_id)}</Chip>
                      <span className="ml-auto shrink-0 text-micro tabular-nums text-stone">
                        {hit.position == null ? "全文" : `位置 ${hit.position}`}
                      </span>
                    </div>
                    <p className="mt-6 line-clamp-2 whitespace-pre-wrap text-meta leading-[1.7] text-slate">
                      <Highlight text={hit.snippet} />
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
