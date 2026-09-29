/* ==================================================================
   执行（run）接口（§7.2 / U7）
   ------------------------------------------------------------------
   执行状态是后端事实，前端只是观察者：切换页面 = 卸载订阅，不等于取消任务。
   停止必须走后端真实取消，界面区分「已发出」与「已确认」，不得点了就算停。

   后端当前还没有 /api/runs，调用会失败；失败由 errors.ts 归一成 ApiError，
   界面显示「未获后端确认」而不是假装停了。
   ================================================================== */

import { apiRequest } from "./client";

export interface RunCancelResult {
  run_id: string;
  status: "canceled" | "canceling";
}

export const runsApi = {
  /** POST /api/runs/:id/cancel —— 请求后端真正停掉这次运行 */
  cancel: (runId: string) =>
    apiRequest<RunCancelResult>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  /** GET /api/runs/:id —— 重新订阅时取实际进度与已产生的内容 */
  status: (runId: string) => apiRequest<RunCancelResult>(`/runs/${encodeURIComponent(runId)}`),
};
