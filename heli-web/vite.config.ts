import os from "node:os";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * 只有「从 Windows 侧访问 WSL 目录」时才需要绕开 9P 挂载点的两个已知问题：
 *   1. fs.watch 对目录报 EISDIR → 关掉文件监听（改完代码重启 dev server）
 *   2. 预打包 deps_temp -> deps 的 rename 报 EPERM → 把缓存挪到系统临时目录
 * 直接在 WSL 内部开发/构建时不走 9P，保持 Vite 默认行为（热更新 + 构建前清空 dist）。
 */
const fromWindows = process.platform === "win32";

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8765" },
    ...(fromWindows ? { watch: null } : {}),
  },

  ...(fromWindows ? { cacheDir: path.join(os.tmpdir(), "heli-web-vite-cache") } : {}),

  build: {
    outDir: "dist",
    emptyOutDir: !fromWindows,
  },
});
