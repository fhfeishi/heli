# Fusion 编排（纸条协作）

不共享聊天记录，只传文件。一轮 = 三张纸条。

## 角色

见 [roles.md](roles.md)。

## 一轮怎么跑

1. **统筹（brief）** 根据 goal 拆本轮范围、步骤、验收标准 → 写 `rounds/<id>/01-brief.md`
2. **verifier** 审 brief：是否可执行、有无明显漏洞 → 建议写回 brief（同一文件修订，或记在 testreport 的「方案审核」段）
3. **engineer** 只按 brief 实施 → 写 `02-worklog.md`；关键节点可请 verifier 测
4. **verifier** 按验收标准测 → 写 `03-testreport.md`
5. **结论**
   - 过 → 收工或开下一轮 `rounds/<id+1>/`
   - 打回干活 → engineer 据报告改，更新 worklog
   - 上层设计冲突 / 验收本身不对 → **停**，统筹改 brief（步骤 + 验收），再从第 3 步 loop

## 目录

```
.fusion/
  README.md
  roles.md
  templates/          # 空白模板，开新轮时复制
  rounds/001/         # 当前练习轮
  _bak-*/             # 规范前原文备份
```

## 写法约定

- 用二级标题分段，方便模型按段读
- 验收标准必须能判真假（少写「合适」「自然」）
- 本轮步骤必须可执行；产品愿景放「背景 goal」，不要和本轮步骤混写
- 角色常驻说明只放 `roles.md`，不要每轮复制

## 浏览器验收（基础）

UI / 交互检查优先用本机 **ego-browser**（接管用户 Chromium Space，复用登录），不要默认用无头浏览器或纯静态猜测。Verifier 需要截图、键盘、390px 布局时，在报告里写清用了 ego-browser 的操作与证据路径。
