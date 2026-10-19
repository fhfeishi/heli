import { useEffect, type ReactNode } from "react";
import { BrandMark, Icon, type IconName } from "./components/Icons";
import { navKeyOf } from "./app/nav";
import { Paths, navigate, useRoute } from "./app/router";
import { Button, EmptyState } from "./components/ui";
import { useWorkspace } from "./model/store";
import { KnowledgeView } from "./views/KnowledgeView";
import { LibraryView } from "./views/LibraryView";
import { ResearchListView, TaskDetailView } from "./views/ResearchView";
import { ArtifactsListView, ArtifactDetailView } from "./views/ArtifactsView";
import { SettingsView } from "./views/SettingsView";
import { SearchView } from "./views/SearchView";

const NAV: { key: "knowledge" | "search" | "research" | "artifacts" | "settings"; icon: IconName; label: string; to: string }[] = [
  { key: "knowledge", icon: "library", label: "资料库", to: Paths.knowledge() },
  { key: "search", icon: "search", label: "检索", to: Paths.search() },
  { key: "research", icon: "chat", label: "研究任务", to: Paths.research() },
  { key: "artifacts", icon: "reports", label: "成果", to: Paths.artifacts() },
  { key: "settings", icon: "settings", label: "设置", to: Paths.settings() },
];

function Rail({ active }: { active: string }) {
  return (
    <nav className="flex w-54 shrink-0 flex-col items-center gap-2 border-r border-hairline bg-surface-soft py-12">
      <div className="mb-10 grid size-30 place-items-center rounded-md bg-primary">
        <BrandMark size={18} />
      </div>
      {NAV.map((item) => {
        const on = active === item.key;
        return (
          <button
            key={item.key}
            type="button"
            title={item.label}
            onClick={() => navigate(item.to)}
            className={`relative grid size-34 place-items-center rounded-md transition-colors ${
              on ? "bg-canvas text-ink shadow-[0_1px_2px_rgba(15,15,15,0.06)]" : "text-steel hover:bg-surface hover:text-charcoal"
            }`}
          >
            {on ? <span className="absolute left-[-6px] h-16 w-[2.5px] rounded-r-pill bg-primary" /> : null}
            <Icon name={item.icon} size={17} strokeWidth={on ? 1.95 : 1.7} />
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const route = useRoute();
  const { error, setError, loading } = useWorkspace();
  const nav = navKeyOf(route);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [error, setError]);

  let body: ReactNode;
  switch (route.name) {
    case "knowledge":
      body = <KnowledgeView />;
      break;
    case "kb":
    case "doc":
      body = <LibraryView libraryId={route.slug} sourceId={route.sourceId} />;
      break;
    case "search":
      body = <SearchView />;
      break;
    case "research":
      body = <ResearchListView />;
      break;
    case "task":
      body = <TaskDetailView taskId={route.taskId} />;
      break;
    case "artifacts":
      body = <ArtifactsListView />;
      break;
    case "artifact":
      body = <ArtifactDetailView artifactId={route.artifactId} />;
      break;
    case "settings":
      body = <SettingsView />;
      break;
    default:
      body = (
        <div className="p-34">
          <EmptyState
            title="页面不存在"
            description={`地址：${route.href}`}
            action={<Button onClick={() => navigate(Paths.knowledge())}>回到资料库</Button>}
          />
        </div>
      );
  }

  return (
    <div className="font-app flex h-screen w-full overflow-hidden bg-canvas text-charcoal">
      <Rail active={nav} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {error ? (
          <div className="flex items-center gap-10 border-b border-hairline bg-danger-soft px-18 py-8 text-meta text-red">
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-micro underline">
              关闭
            </button>
          </div>
        ) : null}
        {loading ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] animate-pulse bg-primary" />
        ) : null}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{body}</main>
      </div>
    </div>
  );
}
