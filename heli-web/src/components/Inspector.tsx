import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useStore } from "../store";
import { describeError } from "../api/errors";
import { knowledgeApi, type SearchStatus, type Tree } from "../api/knowledge";
import { Icon, type IconName } from "./Icons";
import { Button, Chip, EmptyState, ToolButton } from "./ui";
import { AnswerBlocks } from "./MessageList";
import { downloadDoc, openDocInNewTab } from "../lib/docExport";
import { artifactToMarkdown, downloadMarkdown, downloadWord } from "../lib/export";
import { copyToClipboard } from "../lib/markdown";
import { searchIndexCommand } from "../lib/kbCommands";
import { Link, Paths } from "../app/router";
import {
  ARTIFACT_STATUS_LABEL,
  REPORT_TYPE_LABEL,
  type Citation,
  type KnowledgeDocument,
  type PreviewTarget,
  type ReportTemplate,
} from "../types";

const KIND_LABEL: Record<string, { label: string; icon: IconName }> = {
  doc: { label: "源文件预览", icon: "doc" },
  artifact: { label: "成果预览", icon: "reports" },
  template: { label: "报告模板预览", icon: "layers" },
  kb: { label: "知识库预览", icon: "library" },
  citation: { label: "引用详情", icon: "book" },
  task: { label: "任务详情", icon: "tasks" },
  prompt: { label: "提示词 / Skill", icon: "command" },
  library: { label: "库概览与处理记录", icon: "library" },
};

/**
 * mode 由模块决定（U6 / §8.2）：
 * · docked：资料库——并排常驻，目录 / 列表 / 原文 / 证据要同时可见
 * · overlay：对话与研究任务——浮层，注意力留在问题与回答上
 * · cover：窄屏——允许用面板替换主视图，避免五列内容挤在一起
 */
export function Inspector({ mode }: { mode: "docked" | "overlay" | "cover" }) {
  const {
    inspectorOpen,
    inspectorWidth,
    setInspectorWidth,
    closeInspector,
    preview,
    panelUnresolved,
    panelPinned,
    panelPending,
    toggleInspector,
    togglePanelPin,
    replacePanel,
    dismissPanelPending,
  } = useStore();

  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMove = useCallback(
    (e: MouseEvent) => {
      setInspectorWidth(startW.current + (startX.current - e.clientX));
    },
    [setInspectorWidth],
  );

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, onMove]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && inspectorOpen) closeInspector();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeInspector, inspectorOpen]);

  const meta = preview ? KIND_LABEL[preview.kind] : null;

  return (
    <div
      data-panel-mode={mode}
      className={[
        "flex flex-col overflow-hidden border-l border-hairline bg-canvas transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        mode === "docked"
          ? "shrink-0"
          : "absolute right-0 top-0 z-[70] h-full shadow-[0_18px_48px_-18px_rgba(15,15,15,0.26)]",
        inspectorOpen ? "" : "w-0 border-l-0",
      ].join(" ")}
      style={{ width: !inspectorOpen ? 0 : mode === "cover" ? "100%" : inspectorWidth }}
    >
      {dragging ? <div className="fixed inset-0 z-[200] cursor-col-resize" /> : null}
      <div
        onMouseDown={(e) => {
          startX.current = e.clientX;
          startW.current = inspectorWidth;
          setDragging(true);
        }}
        title="拖动调整宽度"
        className="absolute left-0 top-0 z-[60] hidden h-full w-4 cursor-col-resize hover:bg-primary-soft lg:block"
      />

      {/* 头部 */}
      <div className="flex items-center gap-8 border-b border-hairline px-14 py-11">
        <Icon name={meta?.icon ?? "panel"} size={14} className="text-steel" />
        <span className="text-meta font-semibold tracking-[0.3px] text-stone uppercase">
          {meta?.label ?? "预览"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ToolButton
            icon="pin"
            active={panelPinned}
            onClick={togglePanelPin}
            title={panelPinned ? "已固定：点击取消固定" : "固定这个内容，之后的点击不自动覆盖"}
          />
          <ToolButton icon="close" onClick={closeInspector} title="关闭（Esc）" />
        </div>
      </div>

      {/* 固定期间有新内容被点开：不自动覆盖，交给用户决定（§8.1） */}
      {panelPending ? (
        <div className="border-b border-hairline bg-surface-soft px-14 py-10">
          <p className="text-meta text-stone">
            面板已固定，刚点开的内容没有替换掉当前内容。
          </p>
          <div className="mt-8 flex gap-8">
            <Button size="sm" variant="primary" icon="refresh" onClick={replacePanel}>
              替换
            </Button>
            <Button size="sm" onClick={dismissPanelPending}>
              保留当前
            </Button>
          </div>
        </div>
      ) : null}

      {/* 内容 */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-16 py-14">
        {preview ? (
          <PreviewBody target={preview} />
        ) : panelUnresolved ? (
          <EmptyPreview unresolved onClose={closeInspector} />
        ) : (
          <EmptyPreview onClose={toggleInspector} />
        )}
      </div>
    </div>
  );
}

function EmptyPreview({ onClose, unresolved }: { onClose: () => void; unresolved?: boolean }) {
  return (
    <div className="pt-[10%]">
      <EmptyState
        icon="panel"
        title={unresolved ? "这个链接指向的面板内容没有保留" : "右侧窗口还没有内容"}
        description={
          unresolved
            ? "面板开关写在了链接里，但当时打开的是内存中的对象（源文件预览 / 引用详情 / 模板），刷新后无法还原。关闭它不影响主区内容。"
            : "点击任意知识库文件、报告模板、成果或引用，都会在这里打开预览。"
        }
      />
      <div className="mt-12 flex justify-center">
        <Button size="sm" onClick={onClose}>
          收起窗口
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ 内容分发 ------ */

function PreviewBody({ target }: { target: NonNullable<PreviewTarget> }) {
  switch (target.kind) {
    case "doc":
      return <DocPreview doc={target.doc} />;
    case "artifact":
      return <ArtifactPreview artifactId={target.artifactId} />;
    case "template":
      return <TemplatePreview template={target.template} />;
    case "kb":
      return <KbPreview kbId={target.kbId} />;
    case "citation":
      return <CitationPreview citation={target.citation} />;
    case "task":
      return <TaskPreview taskId={target.taskId} />;
    case "prompt":
      return <PromptPreview promptId={target.promptId} />;
    case "library":
      return <LibraryPreview slug={target.slug} />;
  }
}

/* ------------------------------------------------------ 源文件 ------ */

function DocPreview({ doc }: { doc: KnowledgeDocument }) {
  const { showToast } = useStore();
  return (
    <div className="flex flex-col gap-14">
      <div>
        <h2 className="text-title font-semibold leading-[1.45] tracking-[-0.2px] text-ink">
          {doc.name}
        </h2>
        <div className="mt-7 flex flex-wrap items-center gap-6">
          <Chip tone="sky">{doc.format}</Chip>
          <span className="text-micro text-stone">{doc.size}</span>
          <span className="text-micro text-stone">{doc.pages}</span>
          <span className="text-micro text-stone">{doc.chunks} 个分片</span>
        </div>
      </div>

      <div className="flex gap-7">
        <Button
          size="sm"
          icon="external"
          onClick={() => {
            const ok = openDocInNewTab(doc);
            showToast(ok ? "已在新窗口打开" : "浏览器拦截了新窗口，请允许弹出窗口");
          }}
        >
          新窗口查看
        </Button>
        <Button size="sm" icon="download" onClick={() => downloadDoc(doc)}>
          下载副本
        </Button>
      </div>

      <div className="rounded-card bg-surface-soft px-11 py-9">
        <div className="text-micro font-semibold tracking-[0.4px] text-stone uppercase">
          来源
        </div>
        <div className="mt-4 break-all font-code text-micro text-slate">
          {doc.source}
        </div>
        <div className="mt-6 text-micro font-semibold tracking-[0.4px] text-stone uppercase">
          落盘位置
        </div>
        <div className="mt-4 break-all font-code text-micro text-slate">
          {doc.path}
        </div>
      </div>

      <div className="flex flex-col gap-14">
        {doc.preview.map((page, i) => (
          <article
            key={i}
            className="rounded-card border border-hairline px-15 py-13"
          >
            <div className="flex items-center justify-between border-b border-hairline-soft pb-8 text-micro text-stone">
              <span>{doc.name}</span>
              <span className="tabular-nums">
                第 {i + 1} / {doc.preview.length} 页
              </span>
            </div>
            <h3 className="mt-11 text-body font-semibold text-ink">
              {page.heading}
            </h3>
            {page.paragraphs.map((p, j) => (
              <p key={j} className="mt-8 text-meta leading-[1.78] text-charcoal">
                {p}
              </p>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- 成果 ------ */

function ArtifactPreview({ artifactId }: { artifactId: string }) {
  const { artifacts, openArtifactEditor, showToast, knowledgeBases } = useStore();
  const artifact = artifacts.find((a) => a.id === artifactId);

  if (!artifact) {
    return <EmptyState icon="reports" title="成果已被删除" description="它可能在别处被移除了。" />;
  }

  const st = ARTIFACT_STATUS_LABEL[artifact.status];

  return (
    <div className="flex flex-col gap-14">
      <div>
        <h2 className="text-title font-semibold leading-[1.45] tracking-[-0.2px] text-ink">
          {artifact.title}
        </h2>
        <div className="mt-7 flex flex-wrap items-center gap-6">
          <Chip tone={st.tone}>{st.label}</Chip>
          <Chip tone="gray">{REPORT_TYPE_LABEL[artifact.type]}</Chip>
          <span className="text-micro text-stone">{artifact.updatedAt}</span>
        </div>
      </div>

      <div className="rounded-card bg-surface-soft px-11 py-9 text-micro text-slate">
        <div>
          <span className="text-stone">任务背景：</span>
          {artifact.taskTitle ?? artifact.origin}
        </div>
        <div className="mt-4">
          <span className="text-stone">知识库：</span>
          {artifact.kbIds.length
            ? knowledgeBases
                .filter((k) => artifact.kbIds.includes(k.id))
                .map((k) => k.name)
                .join("、")
            : "未绑定"}
        </div>
        <div className="mt-4">
          <span className="text-stone">知识记录：</span>引用 {artifact.citationCount} 处
        </div>
      </div>

      <div className="flex flex-wrap gap-7">
        <Button size="sm" icon="edit" onClick={() => openArtifactEditor(artifact.id)}>
          编辑
        </Button>
        <Button
          size="sm"
          icon="download"
          onClick={() => {
            downloadMarkdown(artifact.title, artifactToMarkdown(artifact));
            showToast("已导出 Markdown");
          }}
        >
          Markdown
        </Button>
        <Button
          size="sm"
          icon="download"
          onClick={() => {
            downloadWord(artifact.title, artifact.blocks, artifact.citations);
            showToast("已导出 Word");
          }}
        >
          Word
        </Button>
      </div>

      <div className="border-t border-hairline pt-12">
        <AnswerBlocks blocks={artifact.blocks} />
      </div>

      {artifact.citations?.length ? (
        <div className="border-t border-hairline pt-12">
          <div className="mb-8 text-micro font-semibold tracking-[0.4px] text-stone uppercase">
            引用来源
          </div>
          <ol className="flex flex-col gap-7">
            {artifact.citations.map((c) => (
              <li key={c.index} className="flex gap-8 text-micro text-slate">
                <span className="shrink-0 tabular-nums text-stone">[{c.index}]</span>
                {c.docName} {c.page}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------- 模板 ------ */

function TemplatePreview({ template }: { template: ReportTemplate }) {
  return (
    <div className="flex flex-col gap-14">
      <div>
        <h2 className="text-title font-semibold tracking-[-0.2px] text-ink">
          {template.name}
        </h2>
        <div className="mt-6 flex flex-wrap items-center gap-6">
          <Chip tone="gray">{REPORT_TYPE_LABEL[template.type]}</Chip>
          {template.builtin ? <Chip tone="mint">内置</Chip> : <Chip tone="peach">自建</Chip>}
          <span className="text-micro text-stone">已使用 {template.usage} 次</span>
        </div>
        <p className="mt-9 text-meta leading-[1.65] text-steel">
          {template.summary}
        </p>
      </div>

      <Section title="章节骨架">
        <ol className="flex flex-col gap-7">
          {template.outline.map((o, i) => (
            <li
              key={o}
              className="flex gap-9 rounded-md bg-surface-soft px-11 py-8 text-meta text-charcoal"
            >
              <span className="shrink-0 tabular-nums text-stone">{i + 1}</span>
              {o}
            </li>
          ))}
        </ol>
      </Section>

      <p className="text-micro leading-[1.6] text-stone">
        模板决定章节顺序、图表密度与引注方式。在任务模板里选择产出形态后，可指定用哪一份模板成稿。
      </p>
    </div>
  );
}

/* -------------------------------------------------------- 知识库 ------ */

function KbPreview({ kbId }: { kbId: string }) {
  const { knowledgeBases, openKbPage, chatWithKb, openPreview } = useStore();
  const kb = knowledgeBases.find((k) => k.id === kbId);
  if (!kb) return <EmptyState icon="library" title="知识库不存在" />;

  return (
    <div className="flex flex-col gap-14">
      <div className="flex items-start gap-10">
        <span
          className="grid size-36 shrink-0 place-items-center rounded-card text-title font-semibold"
          style={{ background: kb.tint, color: kb.fg }}
        >
          {kb.initial}
        </span>
        <div className="min-w-0">
          <h2 className="text-title font-semibold tracking-[-0.2px] text-ink">
            {kb.name}
          </h2>
          <p className="mt-4 text-meta leading-[1.6] text-steel">
            {kb.description}
          </p>
        </div>
      </div>

      <div className="flex gap-7">
        <Button size="sm" icon="folder" onClick={() => openKbPage(kb.id)}>
          查看源文件
        </Button>
        <Button size="sm" icon="chat" onClick={() => chatWithKb(kb.id)}>
          与库对话
        </Button>
      </div>

      <div className="rounded-card bg-surface-soft px-11 py-9 text-micro text-slate">
        <div>
          <span className="text-stone">落盘：</span>
          <span className="font-code">{kb.storage.root}</span>
        </div>
        <div className="mt-4">
          <span className="text-stone">切分：</span>
          {kb.chunkStrategy}
        </div>
        <div className="mt-4">
          <span className="text-stone">容量：</span>
          {kb.docs} 篇 · {kb.size}
        </div>
      </div>

      <div className="border-t border-hairline pt-12">
        <div className="mb-8 text-micro font-semibold tracking-[0.4px] text-stone uppercase">
          源文件
        </div>
        <div className="flex flex-col gap-4">
          {kb.files.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-label={`源文件 ${f.name}`}
              onClick={() => openPreview({ kind: "doc", doc: f, kbId: kb.id })}
              className="flex items-center gap-8 rounded-sm px-7 py-6 text-left transition-colors hover:bg-surface"
            >
              <Icon name="doc" size={13} className="text-stone" />
              <span className="min-w-0 flex-1 truncate text-meta text-charcoal">
                {f.name}
              </span>
              <span className="shrink-0 text-micro text-stone">{f.size}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- 引用 ------ */

function CitationPreview({ citation }: { citation: Citation }) {
  const { knowledgeBases, openPreview, showToast } = useStore();
  const kb = knowledgeBases.find((k) => k.id === citation.kbId);
  const sourceDoc = kb?.files.find((f) => f.name === citation.docName);

  return (
    <div className="flex flex-col gap-14">
      <div>
        <div className="flex items-center gap-8">
          <span className="grid size-22 place-items-center rounded-xs bg-primary-soft font-code text-micro font-semibold text-primary">
            {citation.index}
          </span>
          <h2 className="min-w-0 flex-1 text-title font-semibold tracking-[-0.2px] text-ink">
            {citation.docName}
          </h2>
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-7">
          <span className="text-micro text-stone">{citation.page}</span>
          <span className="text-micro tabular-nums text-stone">
            相关度 {citation.score}
          </span>
          {kb ? <Chip tone="gray">{kb.name}</Chip> : null}
        </div>
      </div>

      <blockquote className="rounded-card border-l-[3px] border-primary bg-surface-soft px-13 py-11 text-meta leading-[1.72] text-charcoal">
        {citation.snippet}
      </blockquote>

      <div className="flex flex-wrap gap-7">
        {sourceDoc ? (
          <Button
            size="sm"
            icon="doc"
            onClick={() => openPreview({ kind: "doc", doc: sourceDoc, kbId: kb?.id })}
          >
            打开原文
          </Button>
        ) : null}
        <Button
          size="sm"
          icon="copy"
          onClick={() => {
            void copyToClipboard(citation.snippet).then((ok) =>
              showToast(ok ? "已复制片段" : "复制失败"),
            );
          }}
        >
          复制片段
        </Button>
      </div>

      {sourceDoc ? (
        <div className="rounded-card bg-surface-soft px-11 py-9">
          <div className="text-micro font-semibold tracking-[0.4px] text-stone uppercase">
            落盘位置
          </div>
          <div className="mt-4 break-all font-code text-micro text-slate">
            {sourceDoc.path}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------- 任务 ------ */

function TaskPreview({ taskId }: { taskId: string }) {
  const { tasks, runTask, openTaskEditor, knowledgeBases, reportTemplates } = useStore();
  const task = tasks.find((t) => t.id === taskId);
  const outputTemplate = reportTemplates.find((t) => t.id === task?.output.templateId);
  if (!task) return <EmptyState icon="tasks" title="任务已被删除" />;

  return (
    <div className="flex flex-col gap-14">
      <div>
        <h2 className="text-title font-semibold tracking-[-0.2px] text-ink">
          {task.title}
        </h2>
        <div className="mt-6 flex flex-wrap items-center gap-6">
          <Chip tone="lav">{REPORT_TYPE_LABEL[task.output.type]}</Chip>
          <Chip tone="gray">{task.category}</Chip>
          <span className="text-micro text-stone">已使用 {task.usage} 次</span>
        </div>
        <p className="mt-9 text-meta leading-[1.65] text-steel">
          {task.description}
        </p>
      </div>

      <div className="flex gap-7">
        <Button variant="primary" size="sm" icon="play" onClick={() => runTask(task)}>
          用这个任务开始
        </Button>
        <Button size="sm" icon="edit" onClick={() => openTaskEditor(task.id)}>
          编辑
        </Button>
      </div>

      <Section title="任务背景">
        <p className="text-meta leading-[1.68] text-slate">{task.background}</p>
      </Section>

      <Section title="任务要求">
        <ul className="flex flex-col gap-6">
          {task.details.map((d, i) => (
            <li key={i} className="flex gap-8 text-meta leading-[1.6] text-slate">
              <span className="mt-3 text-primary">
                <Icon name="check" size={11} strokeWidth={2.4} />
              </span>
              {d}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="任务得到的结果">
        <div className="flex flex-wrap items-center gap-6">
          <Chip tone="lav">{REPORT_TYPE_LABEL[task.output.type]}</Chip>
          {outputTemplate ? (
            <span className="text-meta text-charcoal">{outputTemplate.name}</span>
          ) : (
            <Chip tone="gray">模板已删除</Chip>
          )}
        </div>
        <p className="mt-6 text-meta leading-[1.6] text-stone">
          {task.output.hint}
        </p>
      </Section>

      {task.suggestKbIds.length ? (
        <Section title="推荐知识库">
          <div className="flex flex-wrap gap-6">
            {knowledgeBases
              .filter((k) => task.suggestKbIds.includes(k.id))
              .map((k) => (
                <span
                  key={k.id}
                  className="inline-flex items-center gap-6 rounded-sm bg-surface px-9 py-4 text-micro text-slate"
                >
                  <span className="size-6 rounded-full" style={{ background: k.tint }} />
                  {k.name}
                </span>
              ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------- 提示词 ------ */

function PromptPreview({ promptId }: { promptId: string }) {
  const { prompts, applyPrompt, openPromptEditor } = useStore();
  const card = prompts.find((p) => p.id === promptId);
  if (!card) return <EmptyState icon="command" title="卡片已被删除" />;

  return (
    <div className="flex flex-col gap-14">
      <div>
        <h2 className="text-title font-semibold tracking-[-0.2px] text-ink">
          {card.title}
        </h2>
        <div className="mt-6 flex flex-wrap items-center gap-6">
          <Chip tone={card.kind === "skill" ? "lav" : "mint"}>
            {card.kind === "skill" ? "Skill" : "提示词"}
          </Chip>
          {card.tags.map((t) => (
            <Chip key={t.label} tone={t.tone}>
              {t.label}
            </Chip>
          ))}
        </div>
        <p className="mt-9 text-meta leading-[1.65] text-steel">{card.summary}</p>
      </div>

      <div className="flex gap-7">
        <Button
          variant="primary"
          size="sm"
          icon={card.kind === "skill" ? "command" : "send"}
          onClick={() => applyPrompt(card)}
        >
          {card.kind === "skill" ? "挂载到对话" : "插入输入框"}
        </Button>
        <Button size="sm" icon="edit" onClick={() => openPromptEditor(card.id)}>
          编辑
        </Button>
      </div>

      {card.steps?.length ? (
        <Section title="执行步骤">
          <ol className="flex flex-col gap-6">
            {card.steps.map((s, i) => (
              <li key={s} className="flex gap-8 text-meta text-slate">
                <span className="shrink-0 tabular-nums text-stone">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section title="完整内容">
        <pre className="scrollbar-thin overflow-x-auto rounded-card bg-surface-soft px-12 py-11 font-code text-micro leading-[1.7] whitespace-pre-wrap text-charcoal">
          {card.content}
        </pre>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------ 小组件 ------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-hairline pt-12">
      <div className="mb-8 text-micro font-semibold tracking-[0.4px] text-stone uppercase">
        {title}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------ 库概览 ------ */

/** 资料库并排常驻面板的落点：库统计 + 处理记录（§4.4）。后端未接的部分如实标注 */
function LibraryPreview({ slug }: { slug: string }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [index, setIndex] = useState<SearchStatus | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let current = true;
    setTree(null);
    setError(null);
    knowledgeApi
      .tree(slug)
      .then((value) => { if (current) setTree(value); })
      .catch((cause) => { if (current) setError(cause); });
    return () => { current = false; };
  }, [slug]);

  /* 索引构建是四类处理记录里唯一已有真实数据源的一类，其余如实说明后端未接 */
  useEffect(() => {
    let current = true;
    setIndex(null);
    knowledgeApi
      .searchStatus(slug)
      .then((value) => { if (current) setIndex(value); })
      .catch(() => { if (current) setIndex(null); });
    return () => { current = false; };
  }, [slug]);

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-rose/30 bg-rose/5 p-12 text-body text-rose">
        {describeError(error)}
      </div>
    );
  }
  if (!tree) return <p className="text-body text-stone">正在读取资料库…</p>;

  const active = tree.documents.filter((d) => d.online).length;
  const placed = new Set(tree.placements.map((p) => p.source_id)).size;
  const indexed = tree.documents.filter((d) => d.active_version_id).length;
  const facts: [string, string][] = [
    ["原文", String(active)],
    ["已归入章节", String(placed)],
    ["已有索引版本", String(indexed)],
    ["章节", String(tree.sections.length)],
    ["全文索引", index ? (index.built ? `${index.documents} 篇` : "未构建") : "读取中"],
  ];
  const builtAt = index?.built_at ? index.built_at.slice(0, 19).replace("T", " ") : "";

  return (
    <div className="flex flex-col gap-14">
      <div>
        <h2 className="text-title font-semibold leading-[1.45] tracking-[-0.2px] text-ink">
          {tree.name}
        </h2>
        <p className="mt-6 break-all text-meta text-stone">{slug}</p>
        <LibraryRename slug={slug} name={tree.name} onRenamed={setTree} />
      </div>

      <div className="grid grid-cols-2 gap-8">
        {facts.map(([label, value]) => (
          <div key={label} className="rounded-card bg-surface-soft px-12 py-10">
            <div className="text-micro text-stone">{label}</div>
            <div className="mt-3 text-title font-semibold tabular-nums text-ink">{value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-card border border-hairline bg-surface-soft p-12 text-meta leading-[1.65] text-slate">
        <div className="mb-8 text-micro font-semibold tracking-[0.4px] text-stone uppercase">
          处理记录
        </div>
        <ul className="space-y-6">
          <li>
            索引构建 ·{" "}
            {!index
              ? "正在读取…"
              : index.built
                ? `已完成（${index.documents} 篇${builtAt ? ` · ${builtAt}` : ""}）`
                : "未构建：全文检索不可用，目录与原文阅读不受影响"}
          </li>
          {index && !index.built ? (
            <li>
              下一步：需要先构建索引。
              <button
                type="button"
                onClick={() => void copyToClipboard(searchIndexCommand(slug))}
                className="mt-6 rounded-sm border border-hairline px-10 py-5 text-micro text-primary"
              >
                复制建索引命令
              </button>
            </li>
          ) : null}
        </ul>
        <p className="mt-10">
          导入、解析、提取三类任务的执行记录由后端提供；当前后端未接，这里不显示进度，也不假装已完成。
        </p>
        <Link to={Paths.jobs(slug)} className="mt-10 inline-block text-primary">
          打开处理记录页
        </Link>
      </div>
    </div>
  );
}

/** 库重命名：从库页顶部收进「库概览」，不再占 chrome（审核第一批第 1 条） */
function LibraryRename({
  slug,
  name,
  onRenamed,
}: {
  slug: string;
  name: string;
  onRenamed: (tree: Tree) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await knowledgeApi.rename(slug, draft.trim());
      onRenamed(await knowledgeApi.tree(slug));
      setEditing(false);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        className="mt-8 text-micro text-primary"
      >
        重命名资料库
      </button>
    );
  }

  return (
    <form className="mt-8 flex flex-wrap items-center gap-6" onSubmit={submit}>
      <input
        aria-label="资料库新名称"
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="min-w-0 flex-1 rounded-sm border border-hairline bg-canvas px-8 py-5 text-meta"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-sm bg-primary px-10 py-5 text-micro text-white"
      >
        保存
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-micro text-stone">
        取消
      </button>
      {error ? (
        <p role="alert" className="w-full text-micro text-rose">
          {describeError(error)}
        </p>
      ) : null}
    </form>
  );
}
