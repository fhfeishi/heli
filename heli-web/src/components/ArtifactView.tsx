import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { Button, Chip, EmptyState, Menu, Progress, ToolButton, ViewHeader } from "./ui";
import { ARTIFACT_STATUS_LABEL, REPORT_TYPE_LABEL, type Artifact, type ArtifactStatus } from "../types";
import { artifactToMarkdown, downloadMarkdown, downloadWord } from "../lib/export";

const FILTERS: { value: ArtifactStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "done", label: "已完成" },
  { value: "generating", label: "生成中" },
  { value: "review", label: "待复核" },
  { value: "draft", label: "草稿" },
];

export function ArtifactView() {
  const {
    artifacts,
    openPreview,
    openArtifactEditor,
    deleteArtifact,
    createArtifact,
    askConfirm,
    showToast,
    knowledgeBases,
  } = useStore();

  const [filter, setFilter] = useState<ArtifactStatus | "all">("all");
  const list = useMemo(
    () => artifacts.filter((a) => filter === "all" || a.status === filter),
    [artifacts, filter],
  );

  const counts = useMemo(
    () => ({
      all: artifacts.length,
      done: artifacts.filter((a) => a.status === "done").length,
      generating: artifacts.filter((a) => a.status === "generating").length,
      review: artifacts.filter((a) => a.status === "review").length,
      draft: artifacts.filter((a) => a.status === "draft").length,
    }),
    [artifacts],
  );

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <ViewHeader
        breadcrumb={
          <div className="mb-6 flex items-center gap-6 text-meta text-stone">
            <Icon name="reports" size={13} />
            <span>成果</span>
            <Icon name="chevronRight" size={11} />
            <span className="text-steel">全部产出</span>
          </div>
        }
        title="成果"
        description="报告只是成果的一种形态。这里保留每一次产出的来龙去脉：它从哪个任务来、用了哪些知识库、引用了哪些记录，都可以继续修改与再导出。"
        actions={
          <>
            <Button
              variant="primary"
              icon="plus"
              onClick={() => openArtifactEditor(createArtifact())}
            >
              新建成果
            </Button>
          </>
        }
        stats={`${counts.all} 份 · 已完成 ${counts.done} · 生成中 ${counts.generating}`}
      />

      <div className="mx-auto w-full max-w-[1180px] px-34 pt-18 pb-44">
        <div className="flex flex-wrap gap-6 border-b border-hairline pb-14">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`font-app rounded-sm px-10 py-5 text-meta transition-colors ${
                filter === f.value
                  ? "bg-primary-soft font-medium text-primary"
                  : "text-steel hover:bg-surface"
              }`}
            >
              {f.label}
              <span className="ml-5 tabular-nums opacity-60">{counts[f.value]}</span>
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <div className="pt-22">
            <EmptyState
              icon="reports"
              title="这里还没有成果"
              description="在对话里跑一次任务，产出会自动沉淀到这里；也可以新建一份空白成果自己写。"
              action={
                <div className="mt-6">
                  <Button
                    variant="primary"
                    icon="plus"
                    onClick={() => openArtifactEditor(createArtifact())}
                  >
                    新建成果
                  </Button>
                </div>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-14 pt-18">
            {list.map((a) => (
              <ArtifactCard
                key={a.id}
                artifact={a}
                kbNames={knowledgeBases.filter((k) => a.kbIds.includes(k.id)).map((k) => k.name)}
                onPreview={() => openPreview({ kind: "artifact", artifactId: a.id })}
                onEdit={() => openArtifactEditor(a.id)}
                onDelete={() =>
                  askConfirm({
                    title: "删除成果",
                    message: `「${a.title}」将被移除，引用记录仍保留在原始会话中。`,
                    confirmText: "删除",
                    danger: true,
                    onConfirm: () => deleteArtifact(a.id),
                  })
                }
                onExportMd={() => {
                  downloadMarkdown(a.title, artifactToMarkdown(a));
                  showToast("已导出 Markdown");
                }}
                onExportDoc={() => {
                  downloadWord(a.title, a.blocks, a.citations);
                  showToast("已导出 Word");
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactCard({
  artifact,
  kbNames,
  onPreview,
  onEdit,
  onDelete,
  onExportMd,
  onExportDoc,
}: {
  artifact: Artifact;
  kbNames: string[];
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onExportMd: () => void;
  onExportDoc: () => void;
}) {
  const st = ARTIFACT_STATUS_LABEL[artifact.status];
  const previewText = artifact.blocks.find((b) => b.kind === "p")?.text ?? "";

  return (
    <div className="group flex flex-col rounded-lg border border-hairline bg-canvas p-16 transition-[border-color,box-shadow] hover:border-hairline-strong hover:shadow-[0_6px_20px_-10px_rgba(15,15,15,0.16)]">
      <div className="flex items-start gap-10">
        <span className="grid size-34 shrink-0 place-items-center rounded-card bg-tint-lavender text-[#4a2a8f]">
          <Icon name="reports" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-title font-semibold tracking-[-0.2px] text-ink">
            {artifact.title}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-6">
            <Chip tone={st.tone}>{st.label}</Chip>
            <Chip tone="gray">{REPORT_TYPE_LABEL[artifact.type]}</Chip>
            {artifact.meta.slice(0, 2).map((m) => (
              <span key={m} className="text-micro text-stone">
                {m}
              </span>
            ))}
          </div>
        </div>
        <Menu
          side="down"
          align="right"
          width={188}
          items={[
            { label: "右侧预览", icon: "panel", onSelect: onPreview },
            { label: "编辑内容", icon: "edit", onSelect: onEdit },
            { label: "导出 Markdown", icon: "download", onSelect: onExportMd },
            { label: "导出 Word", icon: "download", onSelect: onExportDoc },
            { label: "删除成果", icon: "trash", danger: true, onSelect: onDelete },
          ]}
          trigger={(_open, toggle) => (
            <button
              type="button"
              onClick={toggle}
              className="grid size-24 shrink-0 place-items-center rounded-sm text-stone opacity-0 transition-opacity hover:bg-surface group-hover:opacity-100"
            >
              <Icon name="dots" size={15} />
            </button>
          )}
        />
      </div>

      {artifact.status === "generating" ? (
        <div className="mt-12">
          <div className="flex items-center justify-between text-micro text-steel">
            <span className="flex items-center gap-6">
              <Icon name="refresh" size={12} />
              正在生成
            </span>
            <span className="tabular-nums">{artifact.progress ?? 0}%</span>
          </div>
          <div className="mt-7">
            <Progress value={artifact.progress ?? 0} />
          </div>
        </div>
      ) : null}

      <p className="mt-12 line-clamp-3 text-meta leading-[1.62] text-steel">
        {previewText.replace(/\[\[(\d+)\]\]/g, "[$1]")}
      </p>

      {/* 来源链路 */}
      <div className="mt-12 flex flex-col gap-7 rounded-card bg-surface-soft px-12 py-10">
        <div className="flex items-start gap-8 text-micro">
          <span className="mt-1 shrink-0 text-stone">任务背景</span>
          <span className="min-w-0 flex-1 text-slate">
            {artifact.taskTitle ?? artifact.origin}
          </span>
        </div>
        <div className="flex items-start gap-8 text-micro">
          <span className="mt-1 shrink-0 text-stone">知识库</span>
          <span className="flex min-w-0 flex-1 flex-wrap gap-5">
            {kbNames.length ? (
              kbNames.map((n) => (
                <span
                  key={n}
                  className="rounded-xs bg-canvas px-7 py-2 text-micro text-slate"
                >
                  {n}
                </span>
              ))
            ) : (
              <span className="text-stone">未绑定</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-8 text-micro">
          <span className="shrink-0 text-stone">知识记录</span>
          <span className="text-slate">引用 {artifact.citationCount} 处</span>
          <span className="ml-auto shrink-0 text-stone">{artifact.updatedAt}</span>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-8 pt-13">
        <Button variant="primary" icon="eye" onClick={onPreview} className="flex-1 justify-center">
          打开预览
        </Button>
        <ToolButton icon="edit" onClick={onEdit} title="编辑" />
        <ToolButton icon="download" onClick={onExportDoc} title="导出 Word" />
      </div>
    </div>
  );
}
