> `heli`  知识/资料管理与知识深度推理智能体系统
> `next`: 集成 工作台 + 生活台 + 知识台（资料库、静态/动态形式的知识管理、推理） [compass](https://github.com/AgriciDaniel/compass)

## 启动

```bash
bash launch.sh                 # 默认 8788，同时提供页面与 /api
PORT=18765 bash launch.sh      # 换端口
launch.cmd                     # Windows 入口（双击即可，自动转交 WSL）
```

脚本会选/建虚拟环境（缺省 `uv venv --seed --python 3.12`）、构建 `heli-web`，然后单端口启动。
后端需在 WSL 内运行（Windows 侧无法对 9P 上的文件加锁）；`bash launch.sh --help` 看全部开关。

## 架构（v4）

按 [.logsdev/library-platform-top-level-design.md](.logsdev/library-platform-top-level-design.md) 实现：
**一个应用、一份关系真源、五个业务模块**。

```
前端 heli-web/          资料库 / 研究任务 / 成果 / 设置
后端 heli-src/          catalog · content · retrieval · tasks · artifacts
                        + storage / models / config / routes / app / cli / pipeline
数据根（位置见下）      heli.db（关系真源）+ sources/（原件）+ derived/ + artifacts/
审计 datapipe/runs/     每次批量处理的输入、规则、计数与跳过原因
```

三个产品对象是**资料、任务、成果**；分组是普通成员关系（一个库可同时属于多个组，不复制内容）；
背景是组或库的属性；提取与审查是任务类型，不是独立平台。

```bash
python heli-src/app.py --port 8788 --web heli-web/dist        # 页面 + API
python heli-src/cli.py --data heli-data info                # 规模与状态
python heli-src/cli.py --data heli-data import --from /mnt/e/local_db/.knowledge  # 一次性导入旧库原件
python heli-src/cli.py --data heli-data reparse             # 给「仅登记」的资料补做解析
python heli-src/cli.py attach --library <库ID> --dir <MinerU 输出目录>  # 把外部解析的正文挂回原资料
python heli-src/cli.py --data heli-data search "关键词"     # 命令行检索
```

- 数据根解析顺序：`--data` > 环境变量 `HELI_DATA` > 项目根 `.env` > `<项目根>/heli-data`；
  `python heli-src/config.py` 会显示解析结果与来源。本项目 `.env` 指向 `E:\local_db\.knowledge\.heli`
  ——与资料库同盘便于一起备份，放在 `.heli/` 子目录避免与库目录混在一起。
- 页面 `http://127.0.0.1:8788/`；不给 `--web` 时只提供 API，`/` 返回接口索引。
- PDF 装了 `pypdf` 就抽文本层（扫描件仍只登记）。
- 模型通道走 DeepSeek（OpenAI 兼容，key 放项目根 `.env`）：研究 / 提取 / 审查三类运行都按
  「只依据检索摘录作答」出结论。正文里的引用序号会被逐条核查、提取的逐字段引文会回查原文，
  编造的当场标出；没配 key 时退回「证据包草稿」，正文首行标明「未接模型」。
- 原件按内容哈希存放，改内容不覆盖旧版本；PDF/音视频首期只登记，不产生乱码正文。
- **扫描件另走外部解析器**：`attach` 把 MinerU（或任何 OCR/版面分析工具）产出的 `.md`
  按文件名挂回原 PDF 的正文位——不新建资料、不新建版本，路径/分类/引用都不动，原件哈希也不变。
  匹配规则：递归找 `.md`，同名 stem 优先 `auto/` 下那份；默认只补不可检索的资料，
  已能检索的要加 `--all` 才覆盖。`--dry-run` 先看匹配结果；`--source <id> --file <md>` 挂单份。
  批量挂载会写审计到 `datapipe/runs/<run_id>.json`（匹配/跳过/无主 md/仍缺 md 的计数）。

## 资料库位置

资料不在项目内，固定在本机 `E:\local_db\.knowledge`（WSL 内 `/mnt/e/local_db/.knowledge`）。
代码不写死它，按 `--root` → 环境变量 `HELI_KNOWLEDGE`/`KNOWLEDGE_ROOT` → 项目根 `.env` 的顺序解析：

```bash
cp .env.example .env           # 首次：改里面的 KNOWLEDGE_ROOT
python heli-src/config.py                # 看解析到哪
```

`.env` 不进版本库。旧库只作为导入来源读取，不移动、不改写源端。
架构规则见 `E:\local_db\.knowledge\README.md`（权威版）；本项目的接法见 [.knowledge/README.md](.knowledge/README.md)。

## 脚本与环境限制

Windows 侧对 `Z:`（WSL 9P 挂载）**能读、能写新文件、能覆盖，但不能删除或改名**。
`wsl.exe` 限制已解除，删除直接在 WSL 内 `rm`；环境脚本见 [scripts/](scripts/README.md)：

```cmd
scripts\doctor.cmd        # 诊断 Z: 映射与写操作能力
scripts\mount-wsl.cmd     # 建立/修复 Z: 映射
scripts\enable-wsl.cmd    # 从程序黑名单移除 wsl.exe（需重启）
```

原因与解除方式见 [scripts/README.md](scripts/README.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `heli-src/` | 当前后端（唯一写入路径，目录即源码根） |
| `tests/` | 端到端测试，与 `heli-src/` 同级 |
| `datapipe/` | 数据管道审计：`runs/<run_id>.json` |
| `heli-web/src/` | 前端：`model/`（API 与共享状态）+ `views/`（四入口）+ `app/`（自研路由）+ `components/ui.tsx` 设计系统 |
| `.logsdev/` | 上层设计、决定与执行记录 |
| `.agents/` | 工程规则（开发 / 规划 / 验证 / 写作） |
| `scripts/` | 本机环境脚本（清理、自检） |
| `heli-apps/` | 桌面端（Tauri）计划，未开始 |
