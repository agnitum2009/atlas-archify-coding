# atlas-archify-coding (aac)

**Atlas + Archify + Coding** —— 图谱驱动研发（**ADD**, Atlas-Driven Development）的可执行内核。
零运行时依赖的 Node CLI（Node 18/20/22/24 均已验证），克隆即用：入口是 `bin/atlas-engine.mjs`，
安装后 `atlas-engine` 与 `aac` 是同一个命令的两个名字。

## 它解决什么

项目开工到中后期，**进度掌控会丢失**：谁在做什么、哪条声称有证据、哪笔账没销、图与码何时分叉，
全靠人记。aac 把这些变成**一份机器可校验的账本**：

- **三轴状态机**（真相 truth / 进度 progress / 账本 ledger）—— 状态怎么变由迁移表规定，非法跳转直接被拒；
- **证据锚**（`文件:行` + 该行内容哈希）—— 声称"已完成/已验证"就必须挂锚；那行代码一改，锚立刻被标成
  `drifted`（漂移），不用人盯；
- **图与账交叉核对**（`report` / `gate`）—— 架构图谱（archify spec）里的节点与账本逐条比，"图上有、
  账上还没销"这类不一致会被点名（该规则代号 A1）；
- **门禁执法**（`gate` = validate → deliver → visual-check 三闸串行；`doctor` = 环境与账本健康自检）；
- **经验池与轨迹**（`lessons` / `trace`）—— 踩过的坑和时间线是账本里的正式条目：可查询、可退役、可统计，
  不是散在聊天记录里的口头经验。

> **适用边界（请先读）**：aac 服务的是**已经开工、到中后期失去进度掌控**的项目。
> 从零起的新项目不是它的场景 —— 因此它不做脚手架式生成、不做代码补全、也不替你判断业务优先级。
> 如果你的痛点是"项目跑了一半没人说得清现在到底什么状态"，它是为这个写的。

## 60 秒上手

```bash
git clone https://github.com/agnitum2009/atlas-archify-coding.git && cd atlas-archify-coding
node bin/atlas-engine.mjs --help
node --test test/*.test.mjs            # 全部离线，用临时目录，不碰任何真实账本
```

**关于图形内核 archify**：`gate` 与 `report --spec` 用它做图的校验与交付。本仓**不含** archify ——
它是独立项目：<https://github.com/tt-a1i/archify>。装好后设 `ARCHIFY_BIN=/path/to/archify/bin/archify.mjs`
或放进 PATH。找不到时相关命令直接失败（fail-closed）并说明原因，**不会给你一份假装通过的结论**；
其余命令（账本、状态、证据、经验、轨迹）完全不需要 archify。

## 目录

- `specs/` —— 规范正本：`ADD-SPEC.md`（实体/关系/公理）· `command-contract.md`（命令契约与错误码附录 A）· `atlas-layout.md`（数据根版式）· `snapshot-policy.md`
- `lib/` + `bin/` —— 实现（零依赖 ESM）；`test/` —— 契约级回归测试（把已定的行为钉住，防改着改着跑偏）
- `docs/` —— `USAGE.md`（怎么用）· `QUICKSTART-NONCODER.md`（不写代码的人）· `DEFENSIVE.md`（防过拟合/防失真的十一条纪律）
- `scripts/` —— 门禁脚本（`verify-contract-freshness` 保证 --help/契约/错误码三向一致；`check-public-privacy` 保证公开面无内部残留）

## 质量与约束

- `npm test` 全绿；`verify-contract-freshness` 与 `check-public-privacy` 是每次提交的 CI 前置（不是建议，是门）。
- 命令数、可选参数数、`--help` 行数、规范与文档的单件长度都有**上限门禁**（超了就红）。理由很实在：
  **能力面一旦无约束增长，这个工具自己就变成了需要被掌控的东西** —— 而那正是它要解决的问题。
- 已知边界：它假设你在可信环境单机使用，不做加密/访问控制/多租户（详见 `SECURITY.md` 的信任模型）。
- 许可证 MIT；贡献前请读 `CONTRIBUTING.md`（能力增删走"五问"评审，不是谁想到就能加）。
