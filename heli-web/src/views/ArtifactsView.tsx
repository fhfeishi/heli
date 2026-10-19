/* 成果：列表 + 详情（正文、修订、引用、导出）。 */
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icons";
import { Button, Chip, EmptyState, Field, ViewHeader, inputCls } from "../components/ui";
import { Paths, navigate } from "../app/router";
import { api, type Artifact } from "../model/api";
import { useWorkspace } from "../model/store";
import { describeError } from "../model/errors";

const KIND_LABEL: Record<string, string> = {
  report: "报告",
  note: "笔记",
  comparison: "对比",
  review: "审查",
  evidence_pack: "证据包",
};

export function ArtifactsListView() {
  const { artifacts, reloadArtifacts, setError } = useWorkspace();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!title.trim()) return;
    try {
      const artifact = await api.createArtifact({ title: title.trim() });
      setTitle("");
      setCreating(false);
      await reloadArtifacts();
      navigate(Paths.artifact(artifact.id));
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  return (
    <div className="h-full overflow-auto pb-40">
      <ViewHeader
        title="成果"
        description="成果是人工资产：每次保存生成一条修订，历史版本可回溯；导出的是当前保存版本。"
        stats={`${artifacts.length} 份`}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            新建成果
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-[1180px] px-34">
        {creating ? (
          <div className="mt-16 rounded-lg border border-hairline bg-surface-soft p-16">
            <Field label="标题">
              <input
                autoFocus
                className={inputCls}
                value={title}
                placeholder="例如：光合效率证据整理"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
              />
            </Field>
            <div className="flex gap-8">
              <Button variant="primary" onClick={() => void create()} disabled={!title.trim()}>保存</Button>
              <Button variant="ghost" onClick={() => setCreating(false)}>取消</Button>
            </div>
          </div>
        ) : null}

        {artifacts.length === 0 && !creating ? (
          <div className="mt-24">
            <EmptyState icon="reports" title="还没有成果" description="可以从任务运行产生证据包，也可以直接新建。" />
          </div>
        ) : (
          <div className="mt-20 divide-y divide-hairline-soft rounded-lg border border-hairline">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => navigate(Paths.artifact(artifact.id))}
                className="flex w-full items-center gap-12 bg-canvas px-16 py-14 text-left hover:bg-surface-soft"
              >
                <Icon name="reports" size={15} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{artifact.title}</span>
                  <span className="mt-2 block text-micro text-steel">
                    {KIND_LABEL[artifact.kind] ?? artifact.kind} · v{artifact.revision} · {artifact.status}
                  </span>
                </span>
                <span className="text-micro text-stone">{artifact.updated_at?.slice(0, 16).replace("T", " ")}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ArtifactDetailView({ artifactId }: { artifactId: string }) {
  const { reloadArtifacts, setError } = useWorkspace();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const data = await api.artifact(artifactId);
    setArtifact(data);
    setDraft(data.body_md);
    setDirty(false);
  }, [artifactId]);

  useEffect(() => {
    void load().catch((cause) => setError(describeError(cause)));
  }, [load, setError]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.updateArtifact(artifactId, { body_md: draft });
      setArtifact(next);
      setDirty(false);
      await reloadArtifacts();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  const exportMd = async () => {
    try {
      const text = await api.exportMarkdown(artifactId);
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${artifact?.title ?? "artifact"}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  if (!artifact) {
    return (
      <div className="p-34">
        <EmptyState icon="reports" title="找不到这份成果" action={<Button onClick={() => navigate(Paths.artifacts())}>返回列表</Button>} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-hairline px-24 py-14">
        <button
          type="button"
          onClick={() => navigate(Paths.artifacts())}
          className="font-app mb-6 flex items-center gap-4 text-micro text-stone hover:text-charcoal"
        >
          <Icon name="chevronLeft" size={12} /> 成果
        </button>
        <div className="flex flex-wrap items-center gap-10">
          <h1 className="min-w-0 flex-1 truncate text-h3 font-semibold text-ink">{artifact.title}</h1>
          <Chip tone="lav">{KIND_LABEL[artifact.kind] ?? artifact.kind}</Chip>
          <Chip tone="gray">v{artifact.revision}</Chip>
          <Chip tone={artifact.status === "done" ? "mint" : artifact.status === "review" ? "peach" : "gray"}>
            {artifact.status}
          </Chip>
          {dirty ? <span className="text-micro text-orange">有未保存修改</span> : null}
          <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
            保存新修订
          </Button>
          <Button icon="download" onClick={() => void exportMd()}>导出 Markdown</Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-0 flex-col p-16">
          <textarea
            className={`${inputCls} min-h-0 flex-1 resize-none font-mono text-meta leading-[1.75]`}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setDirty(true); }}
          />
          <p className="mt-6 text-micro text-stone">正文以 Markdown 保存。保存后生成新修订，旧版本保留。</p>
        </div>

        <aside className="min-h-0 overflow-auto border-l border-hairline bg-surface-soft p-14">
          <h3 className="mb-8 text-micro font-semibold tracking-[0.08em] text-stone">引用 {artifact.citations.length}</h3>
          {artifact.citations.length === 0 ? <p className="text-micro text-stone">没有引用</p> : null}
          <div className="space-y-8">
            {artifact.citations.map((citation) => (
              <div key={`${citation.index}-${citation.version_id}`} className="rounded-md border border-hairline bg-canvas p-9">
                <div className="text-meta font-medium text-ink">{citation.index}. {citation.title}</div>
                <div className="mt-2 text-micro text-steel">
                  {citation.position == null ? "未定位到逐字位置" : `第 ${citation.position} 字符处`}
                </div>
                <p className="mt-4 line-clamp-3 text-micro leading-[1.6] text-stone">{citation.quote}</p>
              </div>
            ))}
          </div>

          <h3 className="mb-8 mt-18 text-micro font-semibold tracking-[0.08em] text-stone">修订</h3>
          <div className="flex flex-wrap gap-6">
            {artifact.revisions.map((revision) => (
              <span
                key={revision}
                className={`rounded-pill px-8 py-3 text-micro ${
                  revision === artifact.revision ? "bg-primary-soft text-primary" : "bg-canvas text-stone"
                }`}
              >
                v{revision}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
