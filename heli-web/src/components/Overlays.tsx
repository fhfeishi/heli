import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { Icon, type IconName } from "./Icons";
import { Button, Chip, Field, Menu, Segmented, VDivider, inputCls, textareaCls } from "./ui";
import { downloadDoc, openDocInNewTab } from "../lib/docExport";
import {
  ARTIFACT_STATUS_LABEL,
  REPORT_TYPE_LABEL,
  type AnswerBlock,
  type ArtifactStatus,
  type Citation,
  type KnowledgeDocument,
  type PromptCard,
  type ReportType,
  type TaskTemplate,
  type ToastState,
} from "../types";

/* -------------------------------------------------------- 外壳 ------ */

function Drawer({
  title,
  subtitle,
  icon = "settings",
  width = 460,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  width?: number;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[var(--z-drawer)] flex justify-end">
      <div
        className="absolute inset-0 bg-scrim"
        onClick={onClose}
        aria-hidden
      />
      <div
        style={{ width }}
        className="relative flex h-full max-w-[92vw] flex-col border-l border-hairline bg-canvas shadow-overlay"
      >
        <div className="flex items-start gap-10 border-b border-hairline px-18 py-14">
          <span className="mt-1 grid size-26 shrink-0 place-items-center rounded-md bg-surface text-steel">
            <Icon name={icon} size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold tracking-[-0.2px] text-ink">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-3 text-meta leading-[1.55] text-stone">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-26 shrink-0 place-items-center rounded-sm text-stone hover:bg-surface"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-18 py-16">
          {children}
        </div>

        {footer ? (
          <div className="flex items-center justify-end gap-8 border-t border-hairline px-18 py-13">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- 入口 ------ */

export function Overlays() {
  const { drawer, confirm, closeConfirm, toast } = useStore();
  if (!drawer)
    return (
      <>
        {confirm ? <ConfirmDialog state={confirm} onClose={closeConfirm} /> : null}
        <Toast toast={toast} />
      </>
    );

  return (
    <>
      {drawer.kind === "new-kb" ? <NewKbDrawer /> : null}
      {drawer.kind === "kb-settings" ? <KbSettingsDrawer kbId={drawer.kbId} /> : null}
      {drawer.kind === "import" ? <ImportDrawer kbId={drawer.kbId} /> : null}
      {drawer.kind === "doc" ? <DocDrawer doc={drawer.doc} kbId={drawer.kbId} /> : null}
      {drawer.kind === "citation" ? <CitationDrawer citation={drawer.citation} /> : null}
      {drawer.kind === "task-editor" ? <TaskEditorDrawer taskId={drawer.taskId} /> : null}
      {drawer.kind === "prompt-editor" ? (
        <PromptEditorDrawer promptId={drawer.promptId} presetKind={drawer.presetKind} />
      ) : null}
      {drawer.kind === "artifact-editor" ? <ArtifactEditorDrawer artifactId={drawer.artifactId} /> : null}
      {confirm ? <ConfirmDialog state={confirm} onClose={closeConfirm} /> : null}
      <Toast toast={toast} />
    </>
  );
}

function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-26 left-1/2 z-[var(--z-toast)] -translate-x-1/2"
    >
      <div className="flex items-center gap-8 rounded-card bg-ink px-14 py-9 text-meta text-canvas shadow-overlay">
        <Icon name="check" size={13} strokeWidth={2.4} />
        {toast.message}
        {toast.action ? (
          <button
            type="button"
            onClick={toast.action.onSelect}
            className="font-app pointer-events-auto ml-2 font-medium text-canvas underline underline-offset-2 transition-colors hover:text-primary-soft"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ConfirmDialog({
  state,
  onClose,
}: {
  state: NonNullable<ReturnType<typeof useStore>["confirm"]>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[var(--z-confirm)] grid place-items-center">
      <div className="absolute inset-0 bg-scrim" onClick={onClose} aria-hidden />
      <div className="relative w-[400px] max-w-[92vw] rounded-lg border border-hairline bg-canvas p-20 shadow-overlay">
        <h3 className="text-title font-semibold tracking-[-0.2px] text-ink">
          {state.title}
        </h3>
        <p className="mt-8 text-meta leading-[1.65] text-steel">{state.message}</p>
        <div className="mt-18 flex items-center justify-end gap-8">
          {state.alt ? (
            <Button onClick={() => {
              state.alt?.onSelect();
              onClose();
            }}>
              {state.alt.label}
            </Button>
          ) : null}
          <Button onClick={onClose}>取消</Button>
          <Button
            variant={state.danger ? "danger" : "primary"}
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
          >
            {state.confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- 新建知识库 ------ */

const CHUNK_STRATEGIES = [
  "语义切分 · 800 字 / 片段，重叠 15%",
  "语义切分 · 800 字 / 片段",
  "按标题层级切分",
  "固定长度 · 512 tokens",
  "固定长度 · 1024 tokens",
];

function NewKbDrawer() {
  const { closeDrawer, createKb, openKbPage, showToast } = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [tags, setTags] = useState("");
  const [chunkStrategy, setChunkStrategy] = useState(CHUNK_STRATEGIES[0]);

  const finalSlug = slug.trim() || name.trim() || "new-kb";

  return (
    <Drawer
      title="新建知识库"
      subtitle={`会在本地创建 heli/.knowledge/${finalSlug} 目录树`}
      icon="library"
      onClose={closeDrawer}
      footer={
        <>
          <Button onClick={closeDrawer}>取消</Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={() => {
              const id = createKb({ name, description, slug, tags, chunkStrategy });
              closeDrawer();
              openKbPage(id);
            }}
          >
            创建并进入
          </Button>
        </>
      }
    >
      <Field label="名称">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：固态电池产业研究"
          className={inputCls}
          autoFocus
        />
      </Field>

      <Field label="用途说明" hint="越具体，检索与重排越准">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="这个库覆盖什么范围、偏哪类材料、用来回答什么问题"
          className={textareaCls}
        />
      </Field>

      <Field label="本地目录名" hint={`目录名 heli/.knowledge/${finalSlug} · 建库接口未提供，当前仅本地预览`}>
        <div className="flex items-center gap-8">
          <span className="shrink-0 font-code text-meta text-stone">.knowledge/</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={name.trim() || "new-kb"}
            className={inputCls}
          />
        </div>
      </Field>

      <Field label="标签" hint="空格或逗号分隔，最多 3 个">
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="产业研究 新能源"
          className={inputCls}
        />
      </Field>

      <Field label="切分策略">
        <div className="flex flex-col gap-6">
          {CHUNK_STRATEGIES.map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-9 rounded-md border px-11 py-9 text-meta transition-colors ${
                chunkStrategy === s
                  ? "border-primary bg-primary-soft-2 text-charcoal"
                  : "border-hairline text-slate hover:bg-surface"
              }`}
            >
              <input
                type="radio"
                checked={chunkStrategy === s}
                onChange={() => setChunkStrategy(s)}
                className="accent-primary"
              />
              {s}
            </label>
          ))}
        </div>
      </Field>

      <p className="text-micro leading-[1.6] text-stone">
        创建后会自动建好 raw / parsed / vector 三个子目录与 kb.db 元数据库，
        随后上传的源文件按顺序进入解析流水线。
      </p>

      <div className="mt-6">
        <Button
          size="sm"
          onClick={() => showToast("真实环境在此调用 apiCreateKb 建库")}
          icon="external"
        >
          查看接口契约
        </Button>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------ 库设置 ------ */

function KbSettingsDrawer({ kbId }: { kbId: string }) {
  const { knowledgeBases, updateKb, deleteKb, closeDrawer, askConfirm } = useStore();
  const kb = knowledgeBases.find((k) => k.id === kbId);
  const [name, setName] = useState(kb?.name ?? "");
  const [description, setDescription] = useState(kb?.description ?? "");
  const [chunkStrategy, setChunkStrategy] = useState(kb?.chunkStrategy ?? CHUNK_STRATEGIES[0]);

  if (!kb) return null;

  return (
    <Drawer
      title="知识库设置"
      subtitle={kb.storage.root}
      icon="settings"
      onClose={closeDrawer}
      footer={
        <>
          <Button
            variant="danger"
            icon="trash"
            onClick={() =>
              askConfirm({
                title: "删除知识库",
                message: `「${kb.name}」与本地目录 ${kb.storage.root} 会被移除。`,
                confirmText: "删除",
                danger: true,
                onConfirm: () => {
                  deleteKb(kb.id);
                  closeDrawer();
                },
              })
            }
          >
            删除库
          </Button>
          <span className="flex-1" />
          <Button onClick={closeDrawer}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              updateKb(kb.id, { name, description, chunkStrategy });
              closeDrawer();
            }}
          >
            保存
          </Button>
        </>
      }
    >
      <Field label="名称">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="用途说明">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={textareaCls}
        />
      </Field>
      <Field label="切分策略" hint="变更后会触发全库重建索引">
        <div className="flex flex-col gap-6">
          {CHUNK_STRATEGIES.map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-9 rounded-md border px-11 py-9 text-meta transition-colors ${
                chunkStrategy === s
                  ? "border-primary bg-primary-soft-2"
                  : "border-hairline text-slate hover:bg-surface"
              }`}
            >
              <input
                type="radio"
                checked={chunkStrategy === s}
                onChange={() => setChunkStrategy(s)}
                className="accent-primary"
              />
              {s}
            </label>
          ))}
        </div>
      </Field>

      <div className="rounded-card bg-surface-soft px-12 py-10">
        <div className="text-micro font-semibold tracking-[0.4px] text-stone uppercase">
          落盘结构
        </div>
        {[
          ["source", kb.storage.source],
          ["parsed", kb.storage.parsed],
          ["vectordb", kb.storage.vectordb],
          ["db", kb.storage.db],
        ].map(([k, v]) => (
          <div key={k} className="mt-5 break-all font-code text-micro text-slate">
            {v}
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap gap-8 text-micro">
        <span className="rounded-sm bg-surface px-9 py-5 text-steel">
          Embedding：{kb.embeddingModel}
        </span>
        <span className="rounded-sm bg-surface px-9 py-5 text-steel">
          负责人：{kb.owner}
        </span>
        <span className="rounded-sm bg-surface px-9 py-5 text-steel">
          {kb.docs} 篇 · {kb.size}
        </span>
      </div>
    </Drawer>
  );
}

/* -------------------------------------------------------- 导入 ------ */

function ImportDrawer({ kbId }: { kbId?: string }) {
  const { knowledgeBases, updateKb, closeDrawer, showToast } = useStore();
  const [target, setTarget] = useState<string>(kbId ?? knowledgeBases[0]?.id ?? "");
  const [mode, setMode] = useState<"file" | "web" | "folder">("file");
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState("");
  const [picked, setPicked] = useState<{ name: string; size: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const kb = knowledgeBases.find((k) => k.id === target);

  const append = (docs: KnowledgeDocument[]) => {
    if (!kb) return;
    updateKb(kb.id, { files: [...kb.files, ...docs], docs: kb.docs + docs.length });
  };

  const submit = () => {
    if (!kb) {
      showToast("请先选择知识库");
      return;
    }
    if (mode === "file") {
      if (!picked.length) {
        showToast("还没有选择文件");
        return;
      }
      append(
        picked.map((p, i) => ({
          id: "f-" + Date.now().toString(36) + i,
          name: p.name,
          format: (p.name.split(".").pop()?.toUpperCase() ?? "TXT") as KnowledgeDocument["format"],
          size: p.size,
          pages: "待解析",
          score: 0,
          updatedAt: new Date().toISOString().slice(0, 10),
          origin: "file",
          status: "parsing",
          chunks: 0,
          source: "本地上传",
          path: "source/" + p.name,
          preview: [{ heading: "等待解析", paragraphs: ["文件已进入解析队列，完成后可预览原文。"] }],
        })),
      );
    } else if (mode === "web") {
      if (!url.trim()) {
        showToast("请填写网页地址");
        return;
      }
      append([
        {
          id: "w-" + Date.now().toString(36),
          name: url.replace(/^https?:\/\//, "").slice(0, 48) || "网页快照",
          format: "WEB",
          size: "—",
          pages: "快照",
          score: 0,
          updatedAt: new Date().toISOString().slice(0, 10),
          origin: "web",
          status: "parsing",
          chunks: 0,
          source: url,
          path: "source/web/" + Date.now().toString(36) + ".html",
          preview: [{ heading: "网页快照", paragraphs: ["抓取完成后会写入解析层并建立向量索引。"] }],
        },
      ]);
    } else {
      if (!folder.trim()) {
        showToast("请填写文件夹路径");
        return;
      }
      append([
        {
          id: "d-" + Date.now().toString(36),
          name: folder.split(/[\\/]/).filter(Boolean).pop() ?? folder,
          format: "TXT",
          size: "—",
          pages: "批量",
          score: 0,
          updatedAt: new Date().toISOString().slice(0, 10),
          origin: "folder",
          status: "parsing",
          chunks: 0,
          source: folder,
          path: "source/" + (folder.split(/[\\/]/).filter(Boolean).pop() ?? folder),
          preview: [{ heading: "文件夹增量同步", paragraphs: ["会按修改时间做增量同步，重复文件自动跳过。"] }],
        },
      ]);
    }
    showToast("已加入解析队列");
    closeDrawer();
  };

  return (
    <Drawer
      title="导入资料"
      subtitle="源文件进入 raw/ 后依次解析、切片、写入向量库"
      icon="upload"
      onClose={closeDrawer}
      footer={
        <>
          <Button onClick={closeDrawer}>取消</Button>
          <Button variant="primary" icon="upload" onClick={submit}>
            开始导入
          </Button>
        </>
      }
    >
      <Field label="导入到">
        <div className="flex flex-col gap-6">
          {knowledgeBases.map((k) => (
            <label
              key={k.id}
              className={`flex cursor-pointer items-center gap-9 rounded-md border px-11 py-9 text-meta transition-colors ${
                target === k.id
                  ? "border-primary bg-primary-soft-2"
                  : "border-hairline text-slate hover:bg-surface"
              }`}
            >
              <input
                type="radio"
                checked={target === k.id}
                onChange={() => setTarget(k.id)}
                className="accent-primary"
              />
              <span className="size-7 rounded-full" style={{ background: k.tint }} />
              <span className="min-w-0 flex-1 truncate">{k.name}</span>
              <span className="text-micro text-stone">{k.docs} 篇</span>
            </label>
          ))}
        </div>
      </Field>

      <div className="mb-14">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "file" as const, label: "本地文件", icon: "doc" },
            { value: "web" as const, label: "网页", icon: "globe" },
            { value: "folder" as const, label: "文件夹", icon: "folder" },
          ]}
        />
      </div>

      {mode === "file" ? (
        <>
          <div
            onClick={() => fileRef.current?.click()}
            className="flex cursor-pointer flex-col items-center gap-8 rounded-lg border border-dashed border-hairline-strong bg-surface-soft px-18 py-26 text-center transition-colors hover:bg-surface"
          >
            <Icon name="upload" size={20} className="text-steel" />
            <span className="text-body font-medium text-charcoal">
              点击选择文件
            </span>
            <span className="text-micro text-stone">
              支持 PDF / DOCX / PPT / XLSX / MD / TXT，可多选
            </span>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []).map((f) => ({
                  name: f.name,
                  size: (f.size / 1024 / 1024).toFixed(1) + " MB",
                }));
                setPicked(list);
              }}
            />
          </div>
          {picked.length ? (
            <div className="mt-10 flex flex-col gap-5">
              {picked.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-8 rounded-md bg-surface-soft px-11 py-8 text-meta"
                >
                  <Icon name="doc" size={13} className="text-stone" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-micro text-stone">{p.size}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {mode === "web" ? (
        <Field label="网页地址" hint="会抓取正文并保存快照">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/report"
            className={inputCls}
          />
        </Field>
      ) : null}

      {mode === "folder" ? (
        <Field label="文件夹路径" hint="按修改时间做增量同步">
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="/data/research/2024"
            className={inputCls}
          />
        </Field>
      ) : null}

      <p className="text-micro leading-[1.6] text-stone">
        真实环境由 apiImportFiles() 上传到服务端，服务端解析完成后回写分片数、页数与正文层。
      </p>
    </Drawer>
  );
}

/* ------------------------------------------------------ 文档抽屉 ------ */

function DocDrawer({ doc, kbId }: { doc: KnowledgeDocument; kbId?: string }) {
  const { closeDrawer, showToast, knowledgeBases } = useStore();
  const kb = knowledgeBases.find((k) => k.id === kbId);

  return (
    <Drawer
      title={doc.name}
      subtitle={`${doc.format} · ${doc.size} · ${doc.pages} · ${doc.chunks} 个分片`}
      icon="doc"
      width={720}
      onClose={closeDrawer}
      footer={
        <>
          {kb ? <Chip tone="gray">{kb.name}</Chip> : null}
          <span className="flex-1" />
          <Button
            icon="external"
            onClick={() => {
              const ok = openDocInNewTab(doc);
              showToast(ok ? "已在新窗口打开" : "浏览器拦截了新窗口");
            }}
          >
            新窗口
          </Button>
          <Button variant="primary" icon="download" onClick={() => downloadDoc(doc)}>
            下载副本
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-14">
        {doc.preview.map((page, i) => (
          <article key={i} className="rounded-lg border border-hairline px-18 py-15">
            <div className="flex items-center justify-between border-b border-hairline-soft pb-8 text-micro text-stone">
              <span>{doc.name}</span>
              <span className="tabular-nums">
                第 {i + 1} / {doc.preview.length} 页
              </span>
            </div>
            <h3 className="mt-12 text-title font-semibold text-ink">
              {page.heading}
            </h3>
            {page.paragraphs.map((p, j) => (
              <p key={j} className="mt-9 text-body leading-[1.82] text-charcoal">
                {p}
              </p>
            ))}
          </article>
        ))}
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------ 引用抽屉 ------ */

function CitationDrawer({ citation }: { citation: Citation }) {
  const { closeDrawer, knowledgeBases, openPreview } = useStore();
  const kb = knowledgeBases.find((k) => k.id === citation.kbId);
  const sourceDoc = kb?.files.find((f) => f.name === citation.docName);

  return (
    <Drawer
      title={citation.docName}
      subtitle={`引用 ${citation.index} · ${citation.page} · 相关度 ${citation.score}`}
      icon="book"
      width={520}
      onClose={closeDrawer}
      footer={
        <>
          <Button onClick={closeDrawer}>关闭</Button>
          {sourceDoc ? (
            <Button
              variant="primary"
              icon="doc"
              onClick={() => {
                closeDrawer();
                openPreview({ kind: "doc", doc: sourceDoc, kbId: kb?.id });
              }}
            >
              打开原文
            </Button>
          ) : null}
        </>
      }
    >
      <blockquote className="rounded-card border-l-[3px] border-primary bg-surface-soft px-14 py-12 text-body leading-[1.75] text-charcoal">
        {citation.snippet}
      </blockquote>
      {kb ? (
        <div className="mt-14 flex items-center gap-8 text-meta text-steel">
          <span className="size-7 rounded-full" style={{ background: kb.tint }} />
          来自知识库「{kb.name}」
        </div>
      ) : null}
    </Drawer>
  );
}

/* ---------------------------------------------------- 任务编辑器 ------ */

function TaskEditorDrawer({ taskId }: { taskId?: string }) {
  const { tasks, saveTask, closeDrawer, knowledgeBases, reportTemplates } = useStore();
  const existing = tasks.find((t) => t.id === taskId) ?? null;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [background, setBackground] = useState(existing?.background ?? "");
  const [details, setDetails] = useState((existing?.details ?? [""]).join("\n"));
  const [type, setType] = useState<ReportType>(existing?.output.type ?? "data");
  const [templateId, setTemplateId] = useState(() => {
    /* 已有任务：按 ReportTemplate.id 命中；找不到则回退到该形态的第一个模板 */
    if (existing) {
      const hit = reportTemplates.find((t) => t.id === existing.output.templateId);
      if (hit) return hit.id;
      return reportTemplates.find((t) => t.type === existing.output.type)?.id ?? "";
    }
    return reportTemplates.find((t) => t.type === "data")?.id ?? "";
  });
  const [hint, setHint] = useState(existing?.output.hint ?? "");
  const [category, setCategory] = useState(existing?.category ?? "自定义");
  const [suggestKbIds, setSuggestKbIds] = useState<string[]>(existing?.suggestKbIds ?? []);

  const templatesOfType = useMemo(
    () => reportTemplates.filter((t) => t.type === type),
    [reportTemplates, type],
  );

  const submit = () => {
    const task: TaskTemplate = {
      id: existing?.id ?? "t-" + Date.now().toString(36),
      title: title.trim() || "未命名任务",
      description: description.trim(),
      background: background.trim(),
      details: details
        .split("\n")
        .map((d) => d.trim())
        .filter(Boolean),
      output: { type, templateId, hint: hint.trim() },
      tint: existing?.tint ?? "var(--tint-lavender)",
      fg: existing?.fg ?? "var(--on-tint-lavender)",
      icon: existing?.icon ?? "custom",
      prompt: [background.trim(), details.trim()].filter(Boolean).join("\n"),
      suggestKbIds,
      category: category.trim() || "自定义",
      builtin: existing?.builtin ?? false,
      usage: existing?.usage ?? 0,
    };
    saveTask(task);
    closeDrawer();
  };

  return (
    <Drawer
      title={existing ? "编辑任务" : "自定义任务"}
      subtitle="写清背景、要求与期望产出，heli 会按它组织检索与成稿"
      icon="tasks"
      width={520}
      onClose={closeDrawer}
      footer={
        <>
          <Button onClick={closeDrawer}>取消</Button>
          <Button variant="primary" onClick={submit}>
            保存任务
          </Button>
        </>
      }
    >
      <Field label="任务名称">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：产线兼容性研判"
          className={inputCls}
          autoFocus
        />
      </Field>
      <Field label="一句话说明">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="卡片上展示的摘要"
          className={inputCls}
        />
      </Field>
      <Field label="任务背景">
        <textarea
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          placeholder="为什么要做这件事、边界是什么、用于什么决策"
          className={textareaCls}
        />
      </Field>
      <Field label="任务要求" hint="每行一条">
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={"按时间梳理关键节点\n区分已验证与实验阶段\n给出可量化收益"}
          className={`${textareaCls} min-h-[110px]`}
        />
      </Field>

      <div className="mb-14 rounded-card border border-hairline bg-surface-soft px-13 py-12">
        <div className="text-micro font-semibold tracking-[0.5px] text-stone uppercase">
          任务得到的结果
        </div>
        <div className="mt-9 flex flex-wrap gap-6">
          {(Object.keys(REPORT_TYPE_LABEL) as ReportType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setType(t);
                setTemplateId(reportTemplates.find((x) => x.type === t)?.id ?? "");
              }}
              className={`font-app rounded-sm px-10 py-5 text-meta transition-colors ${
                type === t
                  ? "bg-primary-soft font-medium text-primary"
                  : "text-steel hover:bg-surface"
              }`}
            >
              {REPORT_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="mt-11">
          <div className="mb-6 text-meta font-semibold text-slate">使用模板</div>
          <div className="flex flex-col gap-5">
            {templatesOfType.map((t) => (
              <label
                key={t.id}
                className={`flex cursor-pointer items-start gap-9 rounded-md border px-11 py-8 text-meta transition-colors ${
                  templateId === t.id
                    ? "border-primary bg-primary-soft-2"
                    : "border-hairline text-slate hover:bg-surface"
                }`}
              >
                <input
                  type="radio"
                  checked={templateId === t.id}
                  onChange={() => setTemplateId(t.id)}
                  className="mt-3 accent-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-charcoal">{t.name}</span>
                  <span className="mt-2 block text-micro text-stone">
                    {t.summary}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-11">
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="对结果的补充要求，例如：含数据表与引注"
            className={inputCls}
          />
        </div>
      </div>

      <Field label="分类">
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="产业研究"
          className={inputCls}
        />
      </Field>

      <Field label="推荐知识库">
        <div className="flex flex-col gap-5">
          {knowledgeBases.map((kb) => {
            const on = suggestKbIds.includes(kb.id);
            return (
              <label
                key={kb.id}
                className={`flex cursor-pointer items-center gap-9 rounded-md border px-11 py-8 text-meta transition-colors ${
                  on
                    ? "border-primary bg-primary-soft-2"
                    : "border-hairline text-slate hover:bg-surface"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setSuggestKbIds((cur) =>
                      on ? cur.filter((x) => x !== kb.id) : [...cur, kb.id],
                    )
                  }
                  className="accent-primary"
                />
                <span className="size-7 rounded-full" style={{ background: kb.tint }} />
                {kb.name}
              </label>
            );
          })}
        </div>
      </Field>
    </Drawer>
  );
}

/* ------------------------------------------------ 提示词编辑器 ------ */

function PromptEditorDrawer({
  promptId,
  presetKind,
}: {
  promptId?: string;
  presetKind?: "prompt" | "skill";
}) {
  const { prompts, savePrompt, closeDrawer } = useStore();
  const existing = prompts.find((p) => p.id === promptId) ?? null;

  const [kind, setKind] = useState<"prompt" | "skill">(existing?.kind ?? presetKind ?? "prompt");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [tags, setTags] = useState((existing?.tags ?? []).map((t) => t.label).join(" "));
  const [steps, setSteps] = useState((existing?.steps ?? []).join("\n"));

  const submit = () => {
    const card: PromptCard = {
      id: existing?.id ?? "p-" + Date.now().toString(36),
      kind,
      title: title.trim() || "未命名",
      summary: summary.trim(),
      content: content.trim(),
      tags: tags
        .split(/[\s,，、]+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((label, i) => ({
          label,
          tone: (["mint", "sky", "lav", "peach", "rose"] as const)[i % 5],
        })),
      tint: existing?.tint ?? (kind === "skill" ? "var(--tint-lavender)" : "var(--tint-mint)"),
      fg: existing?.fg ?? (kind === "skill" ? "var(--on-tint-lavender)" : "var(--on-tint-mint)"),
      builtin: existing?.builtin ?? false,
      usage: existing?.usage ?? 0,
      updatedAt: new Date().toISOString().slice(0, 10),
      steps: kind === "skill" ? steps.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
    };
    savePrompt(card);
    closeDrawer();
  };

  return (
    <Drawer
      title={existing ? "编辑卡片" : kind === "skill" ? "新建 Skill" : "新建提示词"}
      subtitle={
        kind === "skill"
          ? "Skill 带固定执行步骤，挂载后按步骤推进检索与成稿"
          : "提示词是一段可直接复用的提问骨架"
      }
      icon="command"
      width={520}
      onClose={closeDrawer}
      footer={
        <>
          <Button onClick={closeDrawer}>取消</Button>
          <Button variant="primary" onClick={submit}>
            保存
          </Button>
        </>
      }
    >
      <div className="mb-14">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "prompt" as const, label: "提示词", icon: "sparkles" },
            { value: "skill" as const, label: "Skill", icon: "command" },
          ]}
        />
      </div>

      <Field label="名称">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：跨库一致性核查"
          className={inputCls}
          autoFocus
        />
      </Field>
      <Field label="摘要">
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="卡片上展示的一句话说明"
          className={inputCls}
        />
      </Field>
      <Field label="完整内容" hint="插入输入框或作为系统提示">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={"你是…\n请基于所选知识库完成…\n输出要求：…"}
          className={`${textareaCls} min-h-[150px] font-code text-meta`}
        />
      </Field>

      {kind === "skill" ? (
        <Field label="执行步骤" hint="每行一步，挂载后按顺序执行">
          <textarea
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={"检索两个库的相关片段\n对齐口径，列出差异\n给出采信建议"}
            className={`${textareaCls} min-h-[96px]`}
          />
        </Field>
      ) : null}

      <Field label="标签" hint="空格分隔，最多 3 个">
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="核查 跨库"
          className={inputCls}
        />
      </Field>
    </Drawer>
  );
}

/* -------------------------------------------------- 成果编辑器 ------ */

function ArtifactEditorDrawer({ artifactId }: { artifactId: string }) {
  const {
    artifacts,
    saveArtifact,
    closeDrawer,
    knowledgeBases,
    registerArtifactDraft,
    askConfirm,
  } = useStore();
  const artifact = artifacts.find((a) => a.id === artifactId);

  /* table / report 等复杂块不序列化为文本，用 [[block:N]] 占位并原样保留 */
  const preservedRef = useRef<AnswerBlock[]>([]);
  const [title, setTitle] = useState(artifact?.title ?? "");
  const [type, setType] = useState<ReportType>(artifact?.type ?? "text");
  const [status, setStatus] = useState<ArtifactStatus>(artifact?.status ?? "draft");
  const [kbIds, setKbIds] = useState<string[]>(artifact?.kbIds ?? []);
  const [body, setBody] = useState(() => {
    const preserved: AnswerBlock[] = [];
    const text = (artifact?.blocks ?? [])
      .map((b) => {
        if (b.kind === "h") return "## " + b.text;
        if (b.kind === "p") return b.text;
        if (b.kind === "list") return b.items.map((i) => "- " + i).join("\n");
        preserved.push(b);
        return "[[block:" + (preserved.length - 1) + "]]";
      })
      .filter(Boolean)
      .join("\n\n");
    preservedRef.current = preserved;
    return text;
  });
  const initialBodyRef = useRef(body);
  /* 保存函数放 ref：登记给 store 的回调要始终拿到最新表单值 */
  const saveRef = useRef<() => void>(() => undefined);

  if (!artifact) return null;

  /* U8：显式保存。改动只有点了「保存」才生效，界面上如实标出未保存状态 */
  const dirty =
    title !== artifact.title ||
    type !== artifact.type ||
    status !== artifact.status ||
    kbIds.join(",") !== artifact.kbIds.join(",") ||
    body !== initialBodyRef.current;

  useEffect(() => {
    registerArtifactDraft(dirty ? () => saveRef.current() : null);
    /* 编辑器关掉即视为这次编辑结束，未保存的改动不再拦截别处 */
    return () => registerArtifactDraft(null);
  }, [dirty, registerArtifactDraft]);

  const save = () => {
    const preserved = preservedRef.current;
    const used = new Set<number>();
    const blocks: AnswerBlock[] = [];
    body.split(/\n{2,}/).forEach((chunk) => {
      const text = chunk.trim();
      if (!text) return;
      /* [[block:N]] 占位行：还原对应的表格 / 附件块 */
      const placeholder = text.match(/^\[\[block:(\d+)\]\]$/);
      if (placeholder) {
        const n = Number(placeholder[1]);
        const kept = preserved[n];
        if (kept && !used.has(n)) {
          used.add(n);
          blocks.push(kept);
          return;
        }
      }
      if (text.startsWith("## ")) {
        blocks.push({ kind: "h", text: text.slice(3) });
      } else if (text.split("\n").every((l) => l.startsWith("- "))) {
        blocks.push({
          kind: "list",
          items: text.split("\n").map((l) => l.slice(2)),
        });
      } else {
        blocks.push({ kind: "p", text });
      }
    });
    /* 占位行被删掉时，对应复杂块移到文末，永不丢块 */
    preserved.forEach((b, n) => {
      if (!used.has(n)) blocks.push(b);
    });
    saveArtifact(artifact.id, {
      title: title.trim() || "未命名成果",
      type,
      status,
      kbIds,
      blocks,
      updatedAt: "刚刚",
    });
    /* 保存后基线随之更新，dirty 归零 */
    initialBodyRef.current = body;
  };
  saveRef.current = save;

  const submit = () => {
    save();
    closeDrawer();
  };

  const discard = () => {
    registerArtifactDraft(null);
    closeDrawer();
  };

  const requestClose = () => {
    if (!dirty) {
      discard();
      return;
    }
    askConfirm({
      title: "这份成果还没保存",
      message: "关闭会丢掉这次修改。",
      confirmText: "保存并关闭",
      onConfirm: submit,
      alt: { label: "放弃修改", onSelect: discard },
    });
  };

  return (
    <Drawer
      title="编辑成果"
      subtitle={`来源：${artifact.taskTitle ?? artifact.origin}`}
      icon="edit"
      width={560}
      onClose={requestClose}
      footer={
        <>
          {dirty ? (
            <span className="mr-auto self-center text-micro text-stone">未保存</span>
          ) : null}
          <Button onClick={requestClose}>取消</Button>
          <Button variant="primary" onClick={submit}>
            保存
          </Button>
        </>
      }
    >
      <Field label="标题">
        <input
          aria-label="成果标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputCls}
          autoFocus
        />
      </Field>

      <div className="mb-14 flex flex-wrap items-end gap-12">
        <div className="min-w-[180px] flex-1">
          <div className="mb-6 text-meta font-semibold text-slate">形态</div>
          <Menu
            side="down"
            align="left"
            width={220}
            items={(Object.keys(REPORT_TYPE_LABEL) as ReportType[]).map((t) => ({
              label: REPORT_TYPE_LABEL[t],
              icon: t === type ? "check" : "reports",
              onSelect: () => setType(t),
            }))}
            trigger={(_open, toggle) => (
              <button
                type="button"
                onClick={toggle}
                className="font-app flex h-34 w-full items-center justify-between rounded-md border border-hairline-strong px-11 text-body text-ink"
              >
                {REPORT_TYPE_LABEL[type]}
                <Icon name="chevronDown" size={13} />
              </button>
            )}
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <div className="mb-6 text-meta font-semibold text-slate">状态</div>
          <div className="flex flex-wrap gap-5">
            {(Object.keys(ARTIFACT_STATUS_LABEL) as ArtifactStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`font-app rounded-sm px-10 py-6 text-meta transition-colors ${
                  status === s
                    ? "bg-primary-soft font-medium text-primary"
                    : "text-steel hover:bg-surface"
                }`}
              >
                {ARTIFACT_STATUS_LABEL[s].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Field
        label="正文"
        hint="空行分段，## 开头为小标题，- 开头为列表；[[block:N]] 是表格/附件占位行，删除后对应内容会移到文末"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={`${textareaCls} min-h-[240px] text-body leading-[1.75]`}
        />
      </Field>

      <Field label="关联知识库" hint="用于成果溯源，可随时调整">
        <div className="flex flex-col gap-5">
          {knowledgeBases.map((kb) => {
            const on = kbIds.includes(kb.id);
            return (
              <label
                key={kb.id}
                className={`flex cursor-pointer items-center gap-9 rounded-md border px-11 py-8 text-meta transition-colors ${
                  on
                    ? "border-primary bg-primary-soft-2"
                    : "border-hairline text-slate hover:bg-surface"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setKbIds((cur) =>
                      on ? cur.filter((x) => x !== kb.id) : [...cur, kb.id],
                    )
                  }
                  className="accent-primary"
                />
                <span className="size-7 rounded-full" style={{ background: kb.tint }} />
                {kb.name}
              </label>
            );
          })}
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-8 text-micro text-stone">
        <span>引用 {artifact.citationCount} 处</span>
        <VDivider />
        <span>关联知识库 {kbIds.length} 个</span>
        <VDivider />
        <span>{artifact.updatedAt}</span>
      </div>
    </Drawer>
  );
}
