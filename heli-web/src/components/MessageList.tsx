import { useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { Chip, ToolButton } from "./ui";
import { copyToClipboard, fmtNum, fmtSec } from "../lib/markdown";
import { downloadMarkdown, downloadWord, messageToMarkdownFull } from "../lib/export";
import { CITATIONS } from "../data/mock";
import type { AnswerBlock, ChatMessage } from "../types";

/* --------------------------------------------------- 引用角标 ------ */

/** `[[3]]` 渲染成可点击的角标，点开看原文片段 */
function RichText({ text }: { text: string }) {
  const { openCitation } = useStore();
  const parts = text.split(/(\[\[\d+\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[\[(\d+)\]\]$/);
        if (!m) return <span key={i}>{part}</span>;
        const index = Number(m[1]);
        const hit = CITATIONS.find((c) => c.index === index);
        return (
          <button
            key={i}
            type="button"
            onClick={() => (hit ? openCitation(hit) : undefined)}
            title={hit ? `${hit.docName} · ${hit.page}` : "引用"}
            className="mx-1 inline-flex h-15 min-w-15 translate-y-[-3px] items-center justify-center rounded-pill bg-primary-soft px-3 align-baseline font-code text-micro font-semibold text-primary transition-colors hover:bg-primary hover:text-white"
          >
            {index}
          </button>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------ 块渲染 ------ */

function BlockView({ block }: { block: AnswerBlock }) {
  const { showToast } = useStore();

  switch (block.kind) {
    case "h":
      return (
        <h3 className="mt-18 mb-8 text-title font-semibold tracking-[-0.2px] text-ink first:mt-0">
          {block.text}
        </h3>
      );
    case "p":
      return (
        <p className="text-body leading-[1.78] text-charcoal">
          <RichText text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul className="flex flex-col gap-8">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-9 text-body leading-[1.72] text-charcoal">
              <span className="mt-7 size-5 shrink-0 rounded-full bg-stone" />
              <span className="min-w-0 flex-1">
                <RichText text={item} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="scrollbar-thin overflow-x-auto rounded-card border border-hairline">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-soft">
                {block.columns.map((c) => (
                  <th
                    key={c}
                    className="px-12 py-9 text-left text-micro font-semibold tracking-[0.3px] text-slate uppercase"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-hairline">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-12 py-9 text-meta leading-[1.6] text-charcoal"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "report":
      return (
        <div
          className="flex items-center gap-11 rounded-card border border-hairline bg-surface-soft px-13 py-11 cursor-pointer transition-colors hover:bg-surface"
          onClick={() => showToast("真实环境在此打开服务端生成的 docx")}
        >
          <span className="grid size-32 shrink-0 place-items-center rounded-md bg-tint-lavender text-[#4a2a8f]">
            <Icon name="reports" size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-body font-medium text-ink">
              {block.fileName}
            </div>
            <div className="mt-2 flex flex-wrap gap-7 text-micro text-stone">
              {block.meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>
          <Icon name="chevronRight" size={14} className="text-stone" />
        </div>
      );
  }
}

/** 供右侧窗口复用：渲染一组结构化回答块 */
export function AnswerBlocks({ blocks }: { blocks: AnswerBlock[] }) {
  return (
    <div className="flex flex-col gap-11">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------ 思考过程 ------ */

function TraceView({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  if (!message.trace) return null;

  return (
    <div className="rounded-card border border-hairline bg-surface-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-app flex w-full items-center gap-8 px-12 py-9 text-left"
      >
        <Icon name="sparkles" size={14} className="text-primary" />
        <span className="flex-1 text-meta font-medium text-slate">
          {message.trace.summary}
        </span>
        <span className="text-micro text-stone">{open ? "收起" : "查看步骤"}</span>
        <Icon
          name="chevronDown"
          size={13}
          className={`text-stone transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <ol className="border-t border-hairline px-12 py-10">
          {message.trace.steps.map((s, i) => (
            <li key={i} className="flex gap-10 py-6">
              <span className="mt-2 grid size-16 shrink-0 place-items-center">
                {s.status === "done" ? (
                  <Icon name="check" size={12} strokeWidth={2.4} className="text-green" />
                ) : s.status === "running" ? (
                  <span className="size-6 animate-caret rounded-full bg-primary" />
                ) : (
                  <span className="size-6 rounded-full bg-hairline-strong" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-meta text-charcoal">{s.title}</div>
                <div className="mt-2 text-micro text-stone">{s.meta}</div>
              </div>
              {s.durationMs ? (
                <span className="shrink-0 text-micro tabular-nums text-stone">
                  {fmtSec(s.durationMs)}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------- 引用 ------ */

function CitationsView({ message }: { message: ChatMessage }) {
  const { openCitation, openPreview, knowledgeBases } = useStore();
  const [open, setOpen] = useState(false);
  if (!message.citations?.length) return null;
  const list = open ? message.citations : message.citations.slice(0, 3);

  return (
    <div className="rounded-card border border-hairline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-app flex w-full items-center gap-8 px-12 py-9 text-left"
      >
        <Icon name="book" size={14} className="text-steel" />
        <span className="flex-1 text-meta font-medium text-slate">
          引用的知识 · {message.citations.length} 处
        </span>
        <span className="text-micro text-stone">{open ? "收起" : "展开"}</span>
      </button>
      <div className="border-t border-hairline">
        {list.map((c) => {
          const kb = knowledgeBases.find((k) => k.id === c.kbId);
          return (
            <div
              key={c.index}
              className="flex cursor-pointer items-start gap-10 px-12 py-9 transition-colors hover:bg-surface-soft"
              onClick={() => openCitation(c)}
            >
              <span className="mt-1 grid size-17 shrink-0 place-items-center rounded-pill bg-primary-soft font-code text-micro font-semibold text-primary">
                {c.index}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-7">
                  <span className="truncate text-meta text-charcoal">{c.docName}</span>
                  <span className="text-micro text-stone">{c.page}</span>
                  <span className="text-micro tabular-nums text-stone">
                    相关度 {c.score}
                  </span>
                  {kb ? <Chip tone="gray">{kb.name}</Chip> : null}
                </div>
                <p className="mt-3 line-clamp-2 text-micro leading-[1.55] text-steel">
                  {c.snippet}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openPreview({ kind: "citation", citation: c });
                }}
                title="在右侧窗口查看"
                className="grid size-24 shrink-0 place-items-center rounded-xs text-stone hover:bg-surface"
              >
                <Icon name="panel" size={13} />
              </button>
            </div>
          );
        })}
        {!open && message.citations.length > 3 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-app w-full px-12 py-7 text-left text-micro text-primary hover:bg-surface-soft"
          >
            展开其余 {message.citations.length - 3} 处
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- 指标 ------ */

function MetricsView({ message }: { message: ChatMessage }) {
  if (!message.metrics) return null;
  const m = message.metrics;
  const total = m.inputTokens + m.outputTokens;
  return (
    <div className="flex flex-wrap items-center gap-x-14 gap-y-6 border-t border-hairline pt-10 text-micro tabular-nums text-stone">
      <span className="flex items-center gap-5">
        <Icon name="clock" size={11.5} />
        首 token {fmtSec(m.firstTokenMs)}
      </span>
      <span>思考 {fmtSec(m.thinkingMs)}</span>
      <span>总计 {fmtSec(m.totalMs)}</span>
      <span className="flex items-center gap-5">
        <Icon name="layers" size={11.5} />
        {fmtNum(total)} tokens
      </span>
      <span className="text-muted">
        入 {fmtNum(m.inputTokens)} / 出 {fmtNum(m.outputTokens)}
      </span>
      {message.model ? (
        <span className="ml-auto flex items-center gap-5">
          <Icon name="sparkles" size={11.5} />
          {message.model}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------- 回答操作条 ------ */

function AnswerToolbar({ message }: { message: ChatMessage }) {
  const { regenerate, setFeedback, showToast, streaming, startEdit } = useStore();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copyToClipboard(messageToMarkdownFull(message));
    setCopied(ok);
    showToast(ok ? "已复制为 Markdown" : "复制失败，请手动选择文本");
    window.setTimeout(() => setCopied(false), 1600);
  };

  const title = message.blocks?.find((b) => b.kind === "h")?.text ?? "heli 回答";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToolButton
        icon={copied ? "check" : "copy"}
        label={copied ? "已复制" : "复制"}
        onClick={() => void onCopy()}
        title="复制为 Markdown"
      />
      <ToolButton
        icon="download"
        label="Markdown"
        onClick={() => {
          downloadMarkdown(title, messageToMarkdownFull(message));
          showToast("已下载 Markdown");
        }}
        title="下载为 .md"
      />
      <ToolButton
        icon="download"
        label="Word"
        onClick={() => {
          downloadWord(title, message.blocks ?? [], message.citations);
          showToast("已下载 Word（.doc）");
        }}
        title="下载为 Word"
      />
      <span className="mx-4 h-16 w-px bg-hairline" />
      <ToolButton
        icon="refresh"
        label="重新生成"
        onClick={() => regenerate(message.id)}
        disabled={streaming}
        title="重新生成这条回答"
      />
      <ToolButton icon="edit" onClick={() => startEdit(message)} title="载入到输入框继续改" />
      <span className="mx-4 h-16 w-px bg-hairline" />
      <ToolButton
        icon="thumbsUp"
        active={message.feedback === "up"}
        onClick={() => setFeedback(message.id, "up")}
        title="有帮助"
      />
      <ToolButton
        icon="thumbsDown"
        active={message.feedback === "down"}
        onClick={() => setFeedback(message.id, "down")}
        title="需要改进"
      />
    </div>
  );
}

/* ------------------------------------------------------ 单条消息 ------ */

function MessageItem({ message }: { message: ChatMessage }) {
  const { startEdit, regenerate, setViewVersion } = useStore();

  if (message.role === "user") {
    return (
      <div className="group flex justify-end">
        <div className="max-w-[78%]">
          <div className="rounded-lg rounded-br-xs bg-surface-sink px-14 py-11 text-body leading-[1.72] text-charcoal">
            {message.text}
          </div>
          <div className="mt-5 flex items-center justify-end gap-6 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="text-micro text-stone">{message.time}</span>
            <button
              type="button"
              onClick={() => startEdit(message)}
              className="font-app flex items-center gap-4 text-micro text-steel hover:text-charcoal"
            >
              <Icon name="edit" size={11} />
              编辑
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* 版本切换：查看历史版本时，块 / 引用 / 指标 / 思考过程都来自快照 */
  const versions = message.versions ?? [];
  const viewIdx = message.viewVersion ?? null;
  const snap =
    viewIdx !== null && viewIdx >= 0 && viewIdx < versions.length ? versions[viewIdx] : null;
  const viewingHistory = snap !== null;
  const shown: ChatMessage = snap
    ? {
        ...message,
        trace: snap.trace,
        blocks: snap.blocks,
        citations: snap.citations,
        metrics: snap.metrics,
        stopped: snap.stopped,
      }
    : message;

  const pending = !shown.blocks?.length;

  /* 已停止提示：点击即可重新生成 */
  const stoppedHint = (
    <button
      type="button"
      onClick={() => regenerate(message.id)}
      title="重新生成这条回答"
      className="font-app flex w-fit items-center gap-6 text-meta text-stone transition-colors hover:text-charcoal"
    >
      <Icon name="refresh" size={12} />
      已停止生成 · 可重新生成
    </button>
  );

  return (
    <div className="flex flex-col gap-12">
      <div className="flex items-center gap-7">
        <span className="grid size-20 place-items-center rounded-sm bg-primary">
          <Icon name="sparkles" size={12} className="text-white" />
        </span>
        <span className="text-meta font-medium text-slate">heli</span>
        <span className="text-micro text-stone">{message.time}</span>
        {versions.length ? (
          <span className="ml-2 flex items-center gap-3">
            <button
              type="button"
              disabled={viewIdx === 0}
              onClick={() =>
                setViewVersion(message.id, viewIdx !== null ? viewIdx - 1 : versions.length - 1)
              }
              title="上一版"
              className="grid size-18 place-items-center rounded-xs text-stone transition-colors hover:bg-surface hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Icon name="chevronLeft" size={12} />
            </button>
            <span className="text-micro tabular-nums text-stone">
              {(viewIdx ?? versions.length) + 1}/{versions.length + 1}
            </span>
            <button
              type="button"
              disabled={viewIdx === null}
              onClick={() =>
                setViewVersion(
                  message.id,
                  viewIdx !== null && viewIdx + 1 < versions.length ? viewIdx + 1 : null,
                )
              }
              title="下一版"
              className="grid size-18 place-items-center rounded-xs text-stone transition-colors hover:bg-surface hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Icon name="chevronRight" size={12} />
            </button>
          </span>
        ) : null}
      </div>

      {shown.trace ? <TraceView message={shown} /> : null}

      {pending ? (
        shown.stopped ? (
          stoppedHint
        ) : (
          <div className="flex items-center gap-8 text-body text-steel">
            <span className="size-6 animate-caret rounded-full bg-primary" />
            正在检索与推理…
          </div>
        )
      ) : (
        <div className="flex flex-col gap-11">
          {shown.blocks?.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
          {shown.stopped ? stoppedHint : null}
        </div>
      )}

      {!pending ? (
        <>
          <CitationsView message={shown} />
          {viewingHistory ? (
            <div className="flex items-center gap-9 text-meta text-stone">
              <span>正在查看历史版本</span>
              <button
                type="button"
                onClick={() => setViewVersion(message.id, null)}
                className="font-app text-primary hover:underline"
              >
                回到最新
              </button>
            </div>
          ) : (
            <AnswerToolbar message={shown} />
          )}
          <MetricsView message={shown} />
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------- 列表 ------ */

export function MessageList({ thread }: { thread: ChatMessage[] }) {
  if (!thread.length) return <EmptyThread />;
  return (
    <div className="flex flex-col gap-26">
      {thread.map((m) => (
        <MessageItem key={m.id} message={m} />
      ))}
    </div>
  );
}

function EmptyThread() {
  const { tasks, runTask, knowledgeBases, chatWithKb, prompts, applyPrompt } = useStore();

  return (
    <div className="flex flex-col items-center pt-[8vh] text-center">
      <span className="grid size-46 place-items-center rounded-lg bg-primary text-white">
        <Icon name="sparkles" size={22} />
      </span>
      <h2 className="mt-16 text-h2 font-semibold tracking-[-0.5px] text-ink">
        想研究点什么？
      </h2>
      <p className="mt-7 max-w-[520px] text-body leading-[1.65] text-steel">
        选中知识库、挑一个任务或直接提问。heli 会先检索库内资料，必要时联网补充，
        再把结论整理成可以导出 Word 的报告。
      </p>

      <div className="mt-22 grid w-full max-w-[720px] grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-10 text-left">
        {tasks.slice(0, 3).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => runTask(t)}
            className="rounded-card border border-hairline bg-canvas p-13 transition-colors hover:border-hairline-strong hover:bg-surface-soft"
          >
            <div className="flex items-center gap-7">
              <span
                className="grid size-24 place-items-center rounded-sm"
                style={{ background: t.tint, color: t.fg }}
              >
                <Icon name={t.icon === "custom" ? "sparkles" : t.icon} size={13} />
              </span>
              <span className="text-body font-medium text-ink">{t.title}</span>
            </div>
            <p className="mt-7 line-clamp-2 text-micro leading-[1.55] text-stone">
              {t.description}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-16 flex flex-wrap items-center justify-center gap-7">
        <span className="text-micro text-stone">或直接与知识库对话</span>
        {knowledgeBases.slice(0, 4).map((kb) => (
          <button
            key={kb.id}
            type="button"
            onClick={() => chatWithKb(kb.id)}
            className="font-app inline-flex items-center gap-6 rounded-md border border-hairline px-10 py-6 text-meta text-slate transition-colors hover:bg-surface"
          >
            <span className="size-6 rounded-full" style={{ background: kb.tint }} />
            {kb.name}
          </button>
        ))}
      </div>

      {prompts.filter((p) => p.kind === "skill").length ? (
        <div className="mt-14 flex flex-wrap items-center justify-center gap-7">
          <span className="text-micro text-stone">可用 Skill</span>
          {prompts
            .filter((p) => p.kind === "skill")
            .slice(0, 3)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPrompt(p)}
                className="font-app inline-flex items-center gap-6 rounded-md bg-surface px-10 py-6 text-meta text-slate transition-colors hover:bg-surface-sink"
              >
                <Icon name="command" size={12} />
                {p.title}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
