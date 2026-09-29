/* ==================================================================
   未知路由的处理
   ------------------------------------------------------------------
   此前未知地址（`route.name === "unknown"`）被当成「会话」渲染成对话页，
   用户打开一个过期或拼错的链接看不到任何提示，只会看到一个空对话——
   这是把「没找到」伪装成「正常页面」。这里明确说出来，并给回得去的入口。
   ================================================================== */

import { Link, Paths, useRoute } from "../app/router";
import { copyToClipboard } from "../lib/markdown";
import { useStore } from "../store";
import { Button } from "./ui";

export function NotFoundView() {
  const route = useRoute();
  const { showToast } = useStore();

  const copy = async () => {
    const ok = await copyToClipboard(window.location.href);
    showToast(ok ? "地址已复制，可发给别人核对" : "复制失败：请手动从地址栏复制");
  };

  return (
    <div className="scrollbar-thin h-full overflow-y-auto bg-canvas px-24 py-22 text-ink">
      <div className="mx-auto max-w-[720px] space-y-16">
        <div>
          <h1 className="text-[24px] font-semibold">这个地址没有对应的页面</h1>
          <p className="mt-6 text-body text-stone">
            链接可能过期、被改动过，或者少了一段路径。这里没有猜测你想去哪，也没有拿别的页面顶替。
          </p>
        </div>
        <div className="rounded-md border border-hairline bg-surface p-12">
          <div className="text-micro text-stone">当前地址</div>
          <div className="mt-4 break-all text-meta text-steel">{route.href || "/"}</div>
        </div>
        <div className="flex flex-wrap items-center gap-10">
          <Link to={Paths.research()} className="text-body text-primary">
            回研究任务
          </Link>
          <Link to={Paths.knowledge()} className="text-body text-primary">
            资料库列表
          </Link>
          <Button size="sm" onClick={copy}>
            复制当前地址
          </Button>
        </div>
      </div>
    </div>
  );
}
