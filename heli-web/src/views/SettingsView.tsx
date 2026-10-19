/* 设置：只读展示当前数据根、模型通道与规模；不在这里伪造可编辑项。 */
import { Icon } from "../components/Icons";
import { Chip, ViewHeader } from "../components/ui";
import { useWorkspace } from "../model/store";

const ROWS = [
  ["模型通道", "未接模型：研究任务产出检索证据包，正文首行标明「未接模型」"],
  ["检索", "SQLite FTS5（trigram），中文按子串命中；不足 3 字回退 LIKE"],
  ["版本", "来源版本按内容哈希保留；成果每次保存生成一条修订"],
  ["旧数据", "既有 .knowledge 目录用 heli import 一次性导入原件；不移动、不改写源端"],
];

export function SettingsView() {
  const { health, libraries, groups, tasks, artifacts } = useWorkspace();

  return (
    <div className="h-full overflow-auto pb-40">
      <ViewHeader title="设置" description="本地单机：没有多用户、没有云同步；这里只显示事实，不提供假开关。" />
      <div className="mx-auto w-full max-w-[900px] space-y-14 px-34 pt-16">
        <section className="rounded-lg border border-hairline bg-surface-soft p-16">
          <h2 className="mb-10 text-title font-semibold text-ink">运行环境</h2>
          <dl className="space-y-8 text-meta">
            <div className="flex gap-10">
              <dt className="w-80 shrink-0 text-steel">数据根</dt>
              <dd className="min-w-0 break-all text-charcoal">{health?.data_root ?? "读取中…"}</dd>
            </div>
            <div className="flex gap-10">
              <dt className="w-80 shrink-0 text-steel">模型通道</dt>
              <dd className="text-charcoal">
                <Chip tone={health?.model_channel === "none" ? "gray" : "mint"}>
                  {health?.model_channel ?? "unknown"}
                </Chip>
              </dd>
            </div>
            <div className="flex gap-10">
              <dt className="w-80 shrink-0 text-steel">规模</dt>
              <dd className="text-charcoal">
                {libraries.length} 个库 · {groups.length} 个组 · {tasks.length} 个任务 · {artifacts.length} 份成果
              </dd>
            </div>
            <div className="flex gap-10">
              <dt className="w-80 shrink-0 text-steel">schema</dt>
              <dd className="text-charcoal">{health?.schema_version ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-hairline p-16">
          <h2 className="mb-10 text-title font-semibold text-ink">当前口径</h2>
          <ul className="space-y-8">
            {ROWS.map(([label, text]) => (
              <li key={label} className="flex gap-10 text-meta">
                <Icon name="check" size={13} />
                <span className="min-w-0">
                  <b className="font-semibold text-ink">{label}</b>
                  <span className="ml-6 text-steel">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
