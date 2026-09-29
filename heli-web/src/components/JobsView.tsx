/* 当前文件与索引状态，以及资料同步入口；外部处理不伪造成运行历史。 */

import { useEffect, useState } from "react";
import { describeError } from "../api/errors";
import { knowledgeApi, type ContentStatus, type SearchStatus } from "../api/knowledge";
import { Link, Paths, useRoute } from "../app/router";
import { copyToClipboard } from "../lib/markdown";
import { searchIndexCommand } from "../lib/kbCommands";
import { Breadcrumb } from "./Breadcrumb";
import { useStore } from "../store";
import { Button, Chip } from "./ui";

interface Row {
  key: string;
  title: string;
  what: string;
}

/** 四类任务的固定清单：顺序即 §4.4 的列举顺序 */
const TASKS: Row[] = [
  { key: "import", title: "导入", what: "登记资料库中的源文件" },
  { key: "parse", title: "解析", what: "读取已导入的解析正文" },
  { key: "index", title: "索引构建", what: "构建全文检索索引，影响「全文检索」能否使用" },
  { key: "extract", title: "提取", what: "查看按场景、问题、技术和成果整理的结果" },
];

export function JobsView() {
  const route = useRoute();
  const slug = route.slug;
  const { showToast } = useStore();
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [content, setContent] = useState<ContentStatus>();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!slug) return;
    let current = true;
    setStatus(null);
    setContent(undefined);
    knowledgeApi.contentStatus(slug).then(value => { if (current) setContent(value); }).catch(cause => { if (current) setError(cause); });
    setError(null);
    knowledgeApi
      .searchStatus(slug)
      .then((value) => { if (current) setStatus(value); })
      .catch((cause) => { if (current) setError(cause); });
    return () => { current = false; };
  }, [slug]);

  const copyRebuild = async () => {
    const ok = await copyToClipboard(searchIndexCommand(slug));
    showToast(ok ? "重建索引命令已复制：粘贴到 WSL 里的 heli-src 目录执行" : "复制失败：请手动选中命令复制");
  };

  if (!slug) {
    return (
      <div className="scrollbar-thin h-full overflow-y-auto bg-canvas px-24 py-22">
        <p className="text-body text-stone">没有指定资料库。</p>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin h-full overflow-y-auto bg-canvas px-24 py-22 text-ink">
      <div className="mx-auto max-w-[1180px] space-y-18">
        <div className="flex flex-wrap items-end justify-between gap-12 border-b border-hairline pb-14">
          <div>
            <Breadcrumb items={[
              { label: "资料库", to: Paths.knowledge() },
              { label: slug, to: Paths.kb(slug) },
              { label: "处理记录" },
            ]} />
            <h1 className="mt-6 text-[24px] font-semibold">处理记录</h1>
            <p className="mt-4 text-body text-stone">
              导入、解析、索引构建、提取四类任务的执行情况集中在这里。
            </p>
          </div>
          <Link to={Paths.extract(slug)} className="shrink-0 text-meta text-primary">
            信息提取
          </Link>
        </div>

        <div
          role="status"
          className="rounded-md border border-hairline bg-surface p-12 text-meta leading-[1.65] text-slate"
        >
          这里只列出本应用能确认的资料与索引状态；此前由外部工具产生的文件不计入执行记录。
        </div>

        <section className="space-y-10 rounded border border-hairline p-16">
          <h2 className="text-title font-semibold">当前资料</h2>
          {content && <p className="text-body leading-[1.7]">{content.sources} 篇原文 · {content.pdf_sources} 篇 PDF · {content.parsed_documents} 篇已登记解析正文 · {content.imported_results} 份导入提取结果 · {content.unmatched_results} 份未关联来源</p>}
          <p className="text-meta leading-[1.7] text-stone">向当前库添加或更新文件后，同步资料会重新登记原文、解析正文并重建 BM25 索引。已有提取结果按原文件读取。</p>
          <Button disabled={syncing} onClick={async () => {
            setSyncing(true); setError(null);
            try { const result = await knowledgeApi.refresh(slug); setContent(result.content); setStatus(await knowledgeApi.searchStatus(slug)); showToast(`资料已同步，${result.index.indexed} 篇进入全文索引${result.index.unparsed.length ? `，${result.index.unparsed.length} 篇缺少可读正文` : ""}`); }
            catch (cause) { setError(cause); }
            finally { setSyncing(false); }
          }}>{syncing ? "正在同步资料…" : "同步资料与全文索引"}</Button>
          {content?.warnings.map(w => <p className="text-meta text-stone" key={w.file}>未作为结果载入 {w.file}：{w.error}</p>)}
        </section>

        {error ? (
          <div role="alert" className="rounded-md border border-rose/30 bg-rose/5 p-12 text-body text-rose">
            {describeError(error)}
          </div>
        ) : null}

        <div className="space-y-12">
          {TASKS.map((task) => (
            <section key={task.key} className="rounded-md border border-hairline bg-canvas p-16">
              <div className="flex flex-wrap items-center justify-between gap-10">
                <h2 className="text-title font-semibold">{task.title}</h2>
                {task.key === "index" ? (
                  !status ? (
                    <Chip tone="gray">读取中</Chip>
                  ) : status.built ? (
                    <Chip tone="mint">已构建</Chip>
                  ) : (
                    <Chip tone="peach">未构建</Chip>
                  )
                ) : (
                  <Chip tone="gray">暂无执行历史</Chip>
                )}
              </div>
              <p className="mt-6 text-meta text-stone">{task.what}</p>

              {task.key === "index" ? (
                <IndexBlock status={status} onCopy={copyRebuild} command={searchIndexCommand(slug)} />
              ) : (
                <p className="mt-12 rounded-sm bg-surface-soft px-10 py-8 text-meta text-slate">
                  尚无此类执行历史。已导入文件数量见上方“当前资料”。
                </p>
              )}
            </section>
          ))}
        </div>

        <section className="rounded-md border border-hairline bg-canvas p-16">
          <h2 className="text-title font-semibold">库级锁忙</h2>
          <p className="mt-8 text-meta leading-[1.65] text-steel">
            资料库正被其他操作占用时，请稍后重试同步。当前无法显示占用者。
          </p>
        </section>
      </div>
    </div>
  );
}

/** 索引构建块：真实状态 + 真实下一步（命令，不是「点了就成功」的按钮） */
function IndexBlock({
  status,
  command,
  onCopy,
}: {
  status: SearchStatus | null;
  command: string;
  onCopy: () => void;
}) {
  if (!status) return <p className="mt-12 text-meta text-stone">正在读取索引状态…</p>;

  if (!status.built) {
    return (
      <div className="mt-12 rounded-sm border border-hairline bg-surface p-12">
        <p className="text-body text-ink">全文索引未构建：全文检索不可用，目录与原文阅读不受影响。</p>
        <p className="mt-8 text-meta text-steel">下一步（在库目录执行，会先清后写，耗时约 5 秒 / 千余篇）：</p>
        <pre className="mt-6 overflow-x-auto rounded-sm bg-canvas px-10 py-8 text-meta">{command}</pre>
        <div className="mt-10">
          <Button size="sm" onClick={onCopy}>
            复制命令
          </Button>
        </div>
      </div>
    );
  }

  const facts: [string, string][] = [
    ["已入索引", `${status.documents} 篇`],
    ["字符数", status.chars ? status.chars.toLocaleString() : "—"],
    ["构建时间", status.built_at ? status.built_at.slice(0, 19).replace("T", " ") : "—"],
    ["引擎", status.engine],
  ];

  return (
    <div className="mt-12 space-y-10">
      <div className="grid gap-8 min-[560px]:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="rounded-card bg-surface-soft px-12 py-10">
            <div className="text-micro text-stone">{label}</div>
            <div className="mt-3 text-title font-semibold tabular-nums text-ink">{value}</div>
          </div>
        ))}
      </div>
      <p className="break-all text-micro text-stone" title="索引位置">
        {status.path ?? "后端未返回索引位置"}
      </p>
      <div className="rounded-sm border border-hairline bg-surface p-12">
        <p className="text-meta text-steel">
          需要重建时（换了原文或想重来）执行下面命令：同一个库重建是「先清后写」，
          不会出现新旧索引混在一起。
        </p>
        <pre className="mt-6 overflow-x-auto rounded-sm bg-canvas px-10 py-8 text-meta">{command}</pre>
        <div className="mt-10">
          <Button size="sm" onClick={onCopy}>
            复制命令
          </Button>
        </div>
      </div>
    </div>
  );
}
