/**
 * heli-web/app 的启动脚本（dev / build）。
 *
 * 直接走 Vite 的 JS API，而不是 `vite` CLI：
 * CLI 会先用 esbuild 打包配置文件，而 esbuild 在本机的 UNC 路径
 * （\\wsl.localhost\...）下无法解析 node_modules，会误判成外部模块。
 * 走 JS API 就不需要这一步。
 *
 *   node run-app.mjs dev      # 开发服务器
 *   node run-app.mjs build    # 生产构建到 app/dist
 */
import os from "node:os";
import path from "node:path";
import { build, createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/* 从 heli-web 根目录运行：node run-app.mjs dev|build */
const root = path.resolve(process.cwd(), "app");
const mode = process.argv[2] ?? "dev";

/* 项目在 9P(WSL) 挂载点上，.vite/deps_temp -> deps 的 rename 会 EPERM。
   把预打包缓存挪到本机临时目录（react 是 CJS，dev 下必须预打包，不能跳过）。 */
const cacheDir = path.join(os.tmpdir(), "heli-web-vite-cache");

/** @type {import('vite').InlineConfig} */
const config = {
  root,
  configFile: false,
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    /* 9P(WSL) 挂载点上 fs.watch 会报 EISDIR，本地预览直接关掉文件监听；
       改动后重启进程即可看到最新代码 */
    watch: null,
  },
  cacheDir,
  build: {
    outDir: "dist",
    /* safe-delete shim 对已存在的 dist 目录会 abort，这里不清空直接覆盖 */
    emptyOutDir: false,
  },
};

if (mode === "build") {
  await build(config);
  console.log("\n构建完成：app/dist");
} else {
  const server = await createServer(config);
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? "http://127.0.0.1:5173/";
  console.log("\nheli 工作台已启动：" + url);
  console.log("按 Ctrl + C 停止\n");
}
