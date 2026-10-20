/* ==================================================================
   工作区状态：只放「多个视图都要用」的列表与错误位。
   详情（资料正文、检索结果、运行进度）留在各视图自己的状态里，
   避免再造一个两千行的全局 store。
   ================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type Artifact, type Group, type Health, type Library, type Run, type Task } from "./api";

/* 列表页只需要摘要，但必须带「最新运行状态 + 产出数」，否则看不出跑完没有 */
type TaskSummary = Omit<Task, "messages" | "runs" | "artifacts"> & {
  last_run?: { id: string; kind: string; status: Run["status"]; finished_at: string | null } | null;
  artifact_count?: number;
};
type ArtifactSummary = Omit<Artifact, "body_md" | "citations">;

interface WorkspaceValue {
  health: Health | null;
  libraries: Library[];
  groups: Group[];
  tasks: TaskSummary[];
  artifacts: ArtifactSummary[];
  loading: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  refresh: () => Promise<void>;
  reloadLibraries: () => Promise<void>;
  reloadGroups: () => Promise<void>;
  reloadTasks: () => Promise<void>;
  reloadArtifacts: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadLibraries = useCallback(async () => {
    const data = await api.libraries();
    setLibraries(data.libraries);
  }, []);
  const reloadGroups = useCallback(async () => {
    const data = await api.groups();
    setGroups(data.groups);
  }, []);
  const reloadTasks = useCallback(async () => {
    const data = await api.tasks();
    setTasks(data.tasks);
  }, []);
  const reloadArtifacts = useCallback(async () => {
    const data = await api.artifacts();
    setArtifacts(data.artifacts);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextHealth, libs, grps, tsk, art] = await Promise.all([
        api.health(),
        api.libraries(),
        api.groups(),
        api.tasks(),
        api.artifacts(),
      ]);
      setHealth(nextHealth);
      setLibraries(libs.libraries);
      setGroups(grps.groups);
      setTasks(tsk.tasks);
      setArtifacts(art.artifacts);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      health, libraries, groups, tasks, artifacts, loading, error, setError,
      refresh, reloadLibraries, reloadGroups, reloadTasks, reloadArtifacts,
    }),
    [health, libraries, groups, tasks, artifacts, loading, error,
     refresh, reloadLibraries, reloadGroups, reloadTasks, reloadArtifacts],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace 必须在 WorkspaceProvider 内使用");
  return value;
}
