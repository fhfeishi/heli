/* ==================================================================
   证据面板：把「这条结论出自哪段原文」摊开给人看
   ------------------------------------------------------------------
   产品的定位是「以证据连接成果」。成果页的引用列表原先是一排静态卡片：
   写着第 63 字符处，却点不开、看不到上下文，等于只给了坐标没给地图。

   这里按引用记录的 version_id 取**当时那一版**正文（不是最新版），
   把命中位置前后的原文摊开并高亮。来源下线或文件缺失时明确说明，
   不退回最新版冒充「当时的内容」。
   ================================================================== */
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { Chip } from "./ui";
import { api, type Citation } from "../model/api";
import { describeError } from "../model/errors";

/** 命中位置前后各取多少字符：够读完整一句话，又不至于把面板灌满 */
const CONTEXT_BEFORE = 320;
const CONTEXT_AFTER = 720;

interface Loaded {
  title: string;
  text: string;
  position: number | null;
  quote: string;
  missing: boolean;
}

export function EvidencePanel({
  citation,
  onClose,
}: {
  citation: Citation;
  onClose: () => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hitRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    api
      .sourceText(citation.source_id, citation.version_id)
      .then((result) => {
        if (!alive) return;
        setData({
          title: result.title,
          text: result.text,
          position: citation.position,
          quote: citation.quote,
          missing: false,
        });
      })
      .catch((cause) => {
        if (!alive) return;
        /* 正文取不到（来源下线、原件缺失、该版本没派生正文）不是崩溃，
           是要如实说明的一种状态：引用仍然成立，只是现在打不开。 */
        setError(describeError(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [citation.source_id, citation.version_id, citation.position, citation.quote]);

  /* 命中处可能在几千字之后：面板打开就停在第 1 行，等于还是没看到证据。
     渲染完把高亮那块滚进视野，居中而不是顶到上边，上下文才都在。 */
  useEffect(() => {
    if (!data || loading) return;
    hitRef.current?.scrollIntoView({ block: "center" });
  }, [data, loading]);

  /* 定位不到逐字位置时退回引用里保存的摘录，不让面板空着。
     quote 是引用时存下的摘录（可能从文档开头截），position 是命中位置，
     两者不同源——所以高亮长度不能拿 quote.length 当，要按 position 往后取一段。 */
  const span = (() => {
    if (!data) return null;
    const { text, position, quote } = data;
    if (position == null || position < 0 || position >= text.length) {
      return { before: "", hit: quote, after: "", located: false };
    }
    /* 命中词的右边界：从 position 起向后找，取到该行行尾或 120 字为止。
       按行取最接近「这一段话」的直觉，也不会把整份文档都染黄。 */
    const rest = text.slice(position, position + 240);
    const lineEnd = rest.indexOf("\n");
    const hitLen = lineEnd > 0 ? lineEnd : Math.min(rest.length, 120);
    const hitEnd = position + Math.max(hitLen, 1);
    const start = Math.max(0, position - CONTEXT_BEFORE);
    const end = Math.min(text.length, hitEnd + CONTEXT_AFTER);
    return {
      before: (start > 0 ? "…" : "") + text.slice(start, position),
      hit: text.slice(position, hitEnd),
      after: text.slice(hitEnd, end) + (end < text.length ? "…" : ""),
      located: true,
    };
  })();

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-soft">
      <header className="flex items-start gap-8 border-b border-hairline px-14 py-12">
        <span className="mt-2 grid size-22 shrink-0 place-items-center rounded-xs bg-primary-soft text-micro font-semibold tabular-nums text-primary">
          {citation.index}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-meta font-medium text-ink">{citation.title}</h3>
          <p className="mt-3 text-micro text-stone">
            {citation.position == null ? "未定位到逐字位置" : `第 ${citation.position} 字符处`}
            {span?.located === false ? " · 以下为引用时保存的摘录" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭证据"
          className="grid size-24 shrink-0 place-items-center rounded-sm text-stone transition-colors hover:bg-canvas hover:text-charcoal"
        >
          <Icon name="close" size={12} strokeWidth={2.2} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-16 py-14">
        {loading ? <p className="text-micro text-stone">正在取当时的正文…</p> : null}

        {error ? (
          <div className="rounded-md border border-hairline bg-canvas px-12 py-11">
            <div className="flex items-center gap-6">
              <Chip tone="gray">来源不可用</Chip>
            </div>
            <p className="mt-7 text-micro leading-[1.7] text-slate">{error}</p>
            <p className="mt-6 text-micro leading-[1.7] text-stone">
              引用记录本身仍然有效：它保存了当时的版本与摘录。原件恢复后可以再打开。
            </p>
            {citation.quote ? (
              <blockquote className="mt-10 border-l-2 border-hairline-strong pl-11 text-micro leading-[1.8] text-slate">
                {citation.quote}
              </blockquote>
            ) : null}
          </div>
        ) : null}

        {span ? (
          <>
            <pre className="whitespace-pre-wrap font-reading text-body leading-[1.85] text-charcoal">
              {span.before}
              <mark
                ref={(node) => {
                  hitRef.current = node;
                }}
                className="rounded-xs bg-tint-yellow px-2 text-ink [box-decoration-break:clone]"
              >
                {span.hit}
              </mark>
              {span.after}
            </pre>
            {!span.located ? (
              <p className="mt-10 text-micro leading-[1.7] text-stone">
                这条引用当时没能定位到逐字位置（多为摘要式引用），上面是引用时保存的摘录。
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="border-t border-hairline px-14 py-10">
        <p className="text-micro leading-[1.6] text-stone">
          显示的是引用当时使用的版本，不是最新版——原文改过也不影响这条结论的出处。
        </p>
      </footer>
    </div>
  );
}
