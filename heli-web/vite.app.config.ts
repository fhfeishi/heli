import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * heli-web/app 的构建配置。
 * 放在项目根目录是因为插件（react / tailwind）要从根目录的 node_modules 解析；
 * 代码本体在 app/ 下，root 指向 app。
 *
 *   cd heli-web/app && node ../node_modules/vite/bin/vite.js --config ../vite.app.config.ts
 */
const appRoot = fileURLToPath(new URL("./app", import.meta.url));

export default defineConfig({
  root: appRoot,
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
