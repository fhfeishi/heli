> `heli`  知识/资料管理与知识深度推理智能体系统
> `next`: 集成 工作台 + 生活台 + 知识台（资料库、静态/动态形式的知识管理、推理） [compass](https://github.com/AgriciDaniel/compass)

## 启动

```bash
bash launch.sh                 # 默认 8011，同时提供页面与 /api
PORT=18765 bash launch.sh      # 换端口
launch.cmd                     # Windows 入口（双击即可，自动转交 WSL）
```

脚本会选/建虚拟环境（缺省 `uv venv --seed --python 3.12`）、构建 `heli-web`，然后单端口启动。
后端需在 WSL 内运行（Windows 侧无法对 9P 上的 `_writer.lock` 加锁）；`bash launch.sh --help` 看全部开关。

## 资料库位置

资料不在项目内，固定在本机 `E:\local_db\.knowledge`（WSL 内 `/mnt/e/local_db/.knowledge`）。
代码不写死它，按 `--root` → 环境变量 `HELI_KNOWLEDGE`/`KNOWLEDGE_ROOT` → 项目根 `.env` 的顺序解析：

```bash
cp .env.example .env           # 首次：改里面的 KNOWLEDGE_ROOT
cd heli-src && python -m kbctl.config    # 看解析到哪、有几个库
```

`.env` 不进版本库。路径换算（`E:/…` ⇄ `/mnt/e/…`）由 `heli-src/kbctl/config.py` 自动做。
架构规则见 `E:\local_db\.knowledge\README.md`（权威版）；本项目的接法与数据接入流程见
[`.knowledge/README.md`](.knowledge/README.md)（派生版）§0。
