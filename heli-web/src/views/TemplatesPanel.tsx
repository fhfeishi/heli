/* ==================================================================
   模板管理：五类模板的增删改
   ------------------------------------------------------------------
   U1 裁决把「提示词 / Skill」收进模板的高级配置，不设一级入口；
   模板是运行时的结构约束（research 的章节、extract 的字段、review 的
   检查项、report 的大纲、background 的引导），所以放在设置里。

   每类模板的 body 形状由后端 templates.validate_body 定义，前端按同一
   形状编辑；提交后以后端返回为准，不在前端猜校验结果。
   ================================================================== */
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icons";
import { Button, Chip, Field, inputCls, textareaCls } from "../components/ui";
import { api, type Template } from "../model/api";
import { useWorkspace } from "../model/store";
import { describeError } from "../model/errors";

type Kind = Template["kind"];

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: "research", label: "研究", hint: "要求模型按这些章节组织结论" },
  { value: "extract", label: "提取", hint: "从资料里按字段抽出结构化信息" },
  { value: "review", label: "审查", hint: "逐项给出判定、依据与严重度" },
  { value: "report", label: "报告", hint: "成果正文的大纲与必需内容" },
  { value: "background", label: "背景", hint: "引导用户把库的背景写清楚" },
];

const KIND_LABEL: Record<Kind, string> = {
  research: "研究",
  extract: "提取",
  review: "审查",
  report: "报告",
  background: "背景",
};

const KIND_TONE: Record<Kind, "mint" | "peach" | "lav" | "sky" | "gray"> = {
  research: "mint",
  extract: "peach",
  review: "sky",
  report: "lav",
  background: "gray",
};

/** 把 body 摊成可编辑的文本：每行一条，比让人手写 JSON 可靠得多 */
function bodyToText(kind: Kind, body: Record<string, unknown>): string {
  const list = (key: string) => ((body[key] as string[] | undefined) ?? []).join("\n");
  if (kind === "research") return list("sections");
  if (kind === "report") return `${list("outline")}\n---\n${list("required")}`;
  if (kind === "background") return list("prompts");
  if (kind === "extract") {
    const fields = (body.fields as { name: string; desc?: string; granularity?: string }[]) ?? [];
    const rows = fields.map((f) => `${f.name} | ${f.desc ?? ""} | ${f.granularity ?? "文档"}`);
    return `${rows.join("\n")}\n---\n${String(body.missing_policy ?? "留空并说明")}`;
  }
  const checks = (body.checks as { item: string; basis?: string; severity?: string }[]) ?? [];
  return checks.map((c) => `${c.item} | ${c.basis ?? ""} | ${c.severity ?? "minor"}`).join("\n");
}

/** 反向：把编辑区的文本还原成 body。格式不对就原样抛错，不静默修正 */
function textToBody(kind: Kind, text: string): Record<string, unknown> {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (kind === "research") return { sections: lines };
  if (kind === "background") return { prompts: lines };
  if (kind === "report") {
    const cut = lines.indexOf("---");
    const outline = cut < 0 ? lines : lines.slice(0, cut);
    const required = cut < 0 ? [] : lines.slice(cut + 1);
    return { outline, required };
  }
  if (kind === "extract") {
    const cut = lines.indexOf("---");
    const fieldLines = cut < 0 ? lines : lines.slice(0, cut);
    const missing = cut < 0 ? "留空并说明" : lines.slice(cut + 1).join(" ") || "留空并说明";
    const fields = fieldLines.map((line) => {
      const [name, desc = "", granularity = "文档"] = line.split("|").map((part) => part.trim());
      return { name, desc, granularity: granularity || "文档" };
    });
    return { fields, missing_policy: missing };
  }
  const checks = lines.map((line) => {
    const [item, basis = "", severity = "minor"] = line.split("|").map((part) => part.trim());
    return { item, basis, severity: severity || "minor" };
  });
  return { checks };
}

/** 编辑区的格式说明：每类结构不同，写清楚才不用猜 */
const FORMAT_HINT: Record<Kind, string> = {
  research: "每行一个章节名。模型会按这些章节组织结论。",
  extract: "每行一个字段：字段名 | 说明 | 粒度。另起一行写 --- 后跟缺失处理。",
  review: "每行一个检查项：检查项 | 依据 | 严重度（minor / major / blocker）。",
  report: "--- 之前每行一个大纲条目，之后每行一项必需内容。",
  background: "每行一个引导问题，帮用户把库的背景写清楚。",
};

export function TemplatesPanel() {
  const { setError } = useWorkspace();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [kind, setKind] = useState<Kind>("research");
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.templates();
      setTemplates(data.templates);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [setError]);

  useEffect(() => {
    void load();
  }, [load]);

  const beginEdit = (template: Template) => {
    setEditing(template);
    setCreating(false);
    setName(template.name);
    setText(bodyToText(template.kind, template.body));
    setConfirmDelete(null);
  };

  const beginCreate = () => {
    setCreating(true);
    setEditing(null);
    setName("");
    setText("");
    setConfirmDelete(null);
  };

  const cancel = () => {
    setEditing(null);
    setCreating(false);
    setName("");
    setText("");
  };

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body = textToBody(editing?.kind ?? kind, text);
      if (editing) {
        await api.updateTemplate(editing.id, { name: name.trim(), body });
      } else {
        await api.createTemplate({ kind, name: name.trim(), body });
      }
      await load();
      cancel();
    } catch (cause) {
      /* 后端的校验错误原样呈现（如「extract 模板至少要定义一个字段」），
         前端不自己造一套规则，避免两处规则漂移 */
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (template: Template) => {
    try {
      await api.deleteTemplate(template.id);
      setConfirmDelete(null);
      if (editing?.id === template.id) cancel();
      await load();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const shown = templates.filter((item) => item.kind === kind);
  const formKind: Kind = editing?.kind ?? kind;

  return (
    <section className="rounded-lg border border-hairline bg-surface-soft p-16">
      <div className="flex flex-wrap items-center gap-10">
        <h2 className="text-title font-semibold text-ink">模板</h2>
        <span className="text-micro text-stone">
          运行时的结构约束；改模板不影响已建运行（运行会冻结当时的版本）
        </span>
        <Button size="sm" variant="primary" icon="plus" className="ml-auto" onClick={beginCreate}>
          新建模板
        </Button>
      </div>

      {/* 五类模板各自校验，先选类再看列表，避免一屏混着五种结构 */}
      <div className="mt-12 flex flex-wrap gap-5">
        {KINDS.map((item) => {
          const count = templates.filter((tpl) => tpl.kind === item.value).length;
          const on = kind === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setKind(item.value);
                cancel();
              }}
              className={`font-app rounded-pill px-10 py-5 text-micro transition-colors ${
                on ? "bg-primary text-on-primary" : "bg-canvas text-slate hover:bg-surface"
              }`}
            >
              {item.label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-8 text-micro text-steel">
        {KINDS.find((item) => item.value === kind)?.hint}
      </p>

      {creating || editing ? (
        <div className="mt-14 rounded-md border border-hairline bg-canvas p-14">
          <div className="flex flex-wrap items-center gap-8">
            <Chip tone={KIND_TONE[formKind]}>{KIND_LABEL[formKind]}</Chip>
            <span className="text-micro text-stone">
              {editing ? `v${editing.version} · 保存后版本号会递增` : "新模板"}
            </span>
          </div>
          <Field label="名称">
            <input
              autoFocus
              className={inputCls}
              value={name}
              placeholder="例如：技术路线梳理"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="内容" hint={FORMAT_HINT[formKind]}>
            <textarea
              className={`${textareaCls} min-h-[180px] font-mono text-meta leading-[1.7]`}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-8">
            <Button variant="primary" onClick={() => void submit()} disabled={busy || !name.trim()}>
              {busy ? "保存中…" : editing ? "保存" : "创建"}
            </Button>
            <Button variant="ghost" onClick={cancel}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p className="mt-14 rounded-md border border-dashed border-hairline px-14 py-16 text-center text-meta text-stone">
          还没有{KIND_LABEL[kind]}模板。
        </p>
      ) : (
        <div className="mt-14 overflow-hidden rounded-md border border-hairline bg-canvas">
          {shown.map((template) => (
            <div
              key={template.id}
              className="flex flex-wrap items-center gap-x-10 gap-y-6 border-b border-hairline-soft px-14 py-11 last:border-0"
            >
              <div className="min-w-0 flex-1 basis-[min(100%,260px)]">
                <div className="flex items-center gap-6">
                  <span className="truncate text-body font-medium text-ink">{template.name}</span>
                  <span className="shrink-0 text-micro tabular-nums text-stone">v{template.version}</span>
                </div>
                <p className="mt-3 truncate text-micro text-steel">
                  {summarize(template)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-5">
                <Button size="sm" variant="ghost" onClick={() => beginEdit(template)}>
                  编辑
                </Button>
                {confirmDelete === template.id ? (
                  <>
                    <Button size="sm" variant="danger" onClick={() => void remove(template)}>
                      确认删除
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                      取消
                    </Button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label="删除模板"
                    onClick={() => setConfirmDelete(template.id)}
                    className="grid size-26 place-items-center rounded-sm text-stone transition-colors hover:bg-danger-soft hover:text-red"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** 列表上只给一句能认出来的摘要，不铺全文 */
function summarize(template: Template): string {
  const body = template.body as Record<string, unknown>;
  const join = (key: string) => ((body[key] as string[] | undefined) ?? []).join("、");
  if (template.kind === "research") return join("sections") || "（无章节）";
  if (template.kind === "report") return join("outline") || "（无大纲）";
  if (template.kind === "background") return join("prompts") || "（无引导）";
  if (template.kind === "extract") {
    const fields = (body.fields as { name: string }[]) ?? [];
    return fields.map((f) => f.name).join("、") || "（无字段）";
  }
  const checks = (body.checks as { item: string }[]) ?? [];
  return checks.map((c) => c.item).join("、") || "（无检查项）";
}
