/* 设置页（U1 四入口之一）。
   本轮只呈现「当前真实生效的配置」：能读到的直接写，读不到的一律标注未接后端，
   不允许出现点了就声称已保存的开关（P9）。

   U1：提示词 / Skill 不再占一级导航，归入这里的「模板」——它属于任务模板的高级配置。
   当前页签写在 ?tab= 上，刷新与复制链接都能回到同一页签。 */

import { useRoute, setSearchParams } from "../app/router";
import { SkillsView } from "./SkillsView";
import { Segmented } from "./ui";

const ROWS: { label: string; value: string; hint: string }[] = [
  {
    label: "后端服务",
    value: "127.0.0.1:8765 · /api",
    hint: "应用通过这个地址与后端通信：取资料、全文检索、提取结果都走这里",
  },
  {
    label: "资料库根目录",
    value: "heli/.knowledge/<slug>",
    hint: "每个资料库一个目录，原文、解析正文、索引与记录都在里面",
  },
  {
    label: "模型",
    value: "heli-embed-v3（占位值）",
    hint: "后端尚未提供模型列表，这里先显示占位值，不可编辑",
  },
  {
    label: "检索",
    value: "目录 + 原文 + 全文检索（BM25 优先）",
    hint: "向量检索规划中，当前只提供全文检索",
  },
  {
    label: "模板（提示词 / Skill）",
    value: "见「模板」页签",
    hint: "提示词与 Skill 属于任务模板的高级配置，收在这里统一管理；卡片为内置示例，可新建、编辑并插入输入框",
  },
];

export function SettingsView() {
  const route = useRoute();
  const tab = route.search.get("tab") === "template" ? "template" : "overview";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas text-ink">
      <div className="border-b border-hairline px-24 py-18">
        <div className="mx-auto max-w-[1180px]">
          <div className="flex flex-wrap items-start justify-between gap-12">
            <div>
              <h1 className="text-[24px] font-semibold">设置</h1>
              <p className="mt-4 text-body text-stone">当前生效的配置与尚未接入的部分</p>
            </div>
            <Segmented
              value={tab}
              onChange={(next) => setSearchParams({ tab: next === "template" ? "template" : null })}
              options={[
                { value: "overview" as const, label: "概览", icon: "settings" },
                { value: "template" as const, label: "模板", icon: "command" },
              ]}
            />
          </div>
        </div>
      </div>

      {tab === "template" ? (
        <div className="min-h-0 flex-1">
          <SkillsView />
        </div>
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-24 py-22">
          <div className="mx-auto max-w-[720px] space-y-10">
            {ROWS.map((row) => (
              <div key={row.label} className="rounded-md border border-hairline bg-surface p-14">
                <div className="flex flex-wrap items-baseline justify-between gap-12">
                  <strong className="text-body">{row.label}</strong>
                  <span className="break-all text-body text-ink">{row.value}</span>
                </div>
                <p className="mt-6 text-meta text-stone">{row.hint}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
