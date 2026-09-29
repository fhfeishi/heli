import { BrandMark, Icon, type IconName } from "./Icons";
import { Paths, navigate } from "../app/router";
import { useStore } from "../store";
import type { NavKey } from "../types";

/** U1：四个一级入口。对话并入研究任务，提示词 / Skill 归入模板高级配置 */
const NAV: { key: NavKey; icon: IconName; label: string; to: string }[] = [
  { key: "knowledge", icon: "library", label: "资料库", to: Paths.knowledge() },
  { key: "research", icon: "chat", label: "研究任务", to: Paths.research() },
  { key: "artifacts", icon: "reports", label: "成果", to: Paths.artifacts() },
  { key: "settings", icon: "settings", label: "设置", to: Paths.settings() },
];

/** 最左侧图标导航栏：只负责切换板块，宽度恒定，不随侧栏折叠变化 */
export function IconRail() {
  const { nav, sidebarCollapsed, toggleSidebar } = useStore();

  return (
    <nav className="flex w-54 shrink-0 flex-col items-center gap-2 border-r border-hairline bg-surface-soft py-12">
      <div className="mb-10 grid size-30 place-items-center rounded-md bg-primary">
        <BrandMark size={18} />
      </div>

      {NAV.map((item) => {
        const active = nav === item.key;
        return (
          <button
            key={item.key}
            type="button"
            title={item.label}
            onClick={() => navigate(item.to)}
            className={`group relative grid size-34 place-items-center rounded-md transition-colors ${
              active
                ? "bg-canvas text-ink shadow-[0_1px_2px_rgba(15,15,15,0.06)]"
                : "text-steel hover:bg-surface hover:text-charcoal"
            }`}
          >
            {active ? (
              <span className="absolute left-[-6px] h-16 w-[2.5px] rounded-r-pill bg-primary" />
            ) : null}
            <Icon name={item.icon} size={17} strokeWidth={active ? 1.95 : 1.7} />
          </button>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          type="button"
          title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          onClick={toggleSidebar}
          className="grid size-34 place-items-center rounded-md text-steel transition-colors hover:bg-surface hover:text-charcoal"
        >
          <Icon name={sidebarCollapsed ? "chevronRight" : "chevronLeft"} size={17} />
        </button>
      </div>
    </nav>
  );
}
