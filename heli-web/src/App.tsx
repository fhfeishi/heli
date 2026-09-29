import { useEffect, useState } from "react";
import { useRoute } from "./app/router";
import { ArtifactView } from "./components/ArtifactView";
import { ChatView } from "./components/ChatView";
import { ExtractView } from "./components/ExtractView";
import { IconRail } from "./components/IconRail";
import { Inspector } from "./components/Inspector";
import { JobsView } from "./components/JobsView";
import { KnowledgeView } from "./components/KnowledgeView";
import { NotFoundView } from "./components/NotFoundView";
import { Overlays } from "./components/Overlays";
import { ResearchHomeView } from "./components/ResearchHomeView";
import { SettingsView } from "./components/SettingsView";
import { SidePanel } from "./components/SidePanel";
import { TaskView } from "./components/TaskView";
import { useStore } from "./store";

/** 窄屏：不再同时挤进导航、目录、列表、正文和面板，改为面板整屏替换主视图（U6 / §8.2） */
function useNarrow(threshold = 1180): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < threshold);
  useEffect(() => {
    const onChange = () => setNarrow(window.innerWidth < threshold);
    window.addEventListener("resize", onChange);
    onChange();
    return () => window.removeEventListener("resize", onChange);
  }, [threshold]);
  return narrow;
}

export default function App() {
  const route = useRoute();
  const { nav } = useStore();
  const narrow = useNarrow();

  const kbWorkspace =
    route.name === "knowledge" ||
    route.name === "kb" ||
    route.name === "doc";
  /* 处理记录页属于资料库一级，但不复用 KnowledgeView 的三栏布局 */
  const knowledge = kbWorkspace || route.name === "jobs" || route.name === "extract";
  const session = route.name === "session";
  const workspace = nav === "research" || nav === "artifacts";

  /* U6：资料库并排常驻（目录 + 列表 + 原文 + 证据要同时可见），
     对话与研究成果用浮层（注意力留在问题与回答上），窄屏一律整屏切换 */
  const panelMode: "docked" | "overlay" | "cover" = narrow
    ? "cover"
    : knowledge
      ? "docked"
      : "overlay";

  return (
    <div className="font-app flex h-screen w-full overflow-hidden bg-canvas text-charcoal">
      <IconRail />
      {workspace ? <SidePanel /> : null}

      {/* 主区与右侧窗口放在同一个定位容器里：
          并排模式是兄弟节点，浮层与整屏模式叠在主区之上 */}
      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {kbWorkspace ? <KnowledgeView /> : null}
          {route.name === "extract" ? <ExtractView /> : null}
          {route.name === "jobs" ? <JobsView /> : null}
          {route.name === "research" ? <ResearchHomeView /> : null}
          {session ? <ChatView /> : null}
          {route.name === "task" ? <TaskView /> : null}
          {route.name === "artifacts" || route.name === "artifact" ? (
            <ArtifactView />
          ) : null}
          {route.name === "settings" ? <SettingsView /> : null}
          {route.name === "unknown" ? <NotFoundView /> : null}
        </main>

        {route.name !== "settings" ? <Inspector mode={panelMode} /> : null}
      </div>

      <Overlays />
    </div>
  );
}
