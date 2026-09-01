# atlas-archify-coding (aac)

**Atlas + Archify + Coding** —— 图谱驱动研发（**ADD**, Atlas-Driven Development）的可执行内核。
零运行时依赖的 Node CLI；仓库路径 `bin/atlas-engine.mjs`，安装后 `atlas-engine` 与 `aac` 两个命令等价。

## 它解决什么

项目开工到中后期，**进度掌控会丢失**：谁在做什么、哪条声称有证据、哪笔账没销、图与码何时分叉，
全靠人记。aac 把这些变成**一份机器可校验的账本**：

- **三轴状态机**（真相 truth / 进度 progress / 账本 ledger）—— 状态迁移过表校验，非法迁移直接拒；
- **证据锚**（`文件:行` + 行内容哈希）—— 声称对齐实相的节点必须有锚；行变了锚就 `drifted`，不靠自觉；
- **图账交叉对账**（`report`/`gate`）—— 架构图谱（archify spec）与账本逐条核，A1 公理机器执法；
- **门禁执法**（`gate` = validate → deliver → visual-check 三闸串行；`doctor` = 环境与账本健康自检）；
- **经验池与轨迹**（`lessons`/`trace`）—— 教训与时间线是账本一等数据，不是聊天记录。

> 本体边界（重要）：aac 服务**已开工、中后期失去掌控**的项目。从零起项目不是它的场景 ——
> 这决定了它不做什么（不做脚手架式生成、不做代码补全、不替人判断业务优先级）。

## 60 秒上手

```bash
git clone https://github.com/agnitum2009/atlas-archify-coding.git && cd atlas-archify-coding
node bin/atlas-engine.mjs --help
node --test test/*.test.mjs            # 全部离线，用临时目录，不碰任何真实账本
```

需要图形内核（archify）时设 `ARCHIFY_BIN=/path/to/archify.mjs`（`gate`/`report --spec` 依赖它；
不可用时相关命令 fail-closed，绝不伪装成功）。

## 目录

- `specs/` —— 规范正本：`ADD-SPEC.md`（实体/关系/公理）· `command-contract.md`（命令契约与错误码附录 A）· `atlas-layout.md`（数据根版式）· `snapshot-policy.md`
- `lib/` + `bin/` —— 实现（零依赖 ESM）；`test/` —— 契约级回归钉
- `docs/` —— `USAGE.md`（怎么用）· `QUICKSTART-NONCODER.md`（不写代码的人）· `DEFENSIVE.md`（防过拟合/防失真的十一条纪律）
- `scripts/` —— 门禁脚本（`verify-contract-freshness` 保证 --help/契约/错误码三向一致；`check-public-privacy` 保证公开面无内部残留）

## 质量与约束

- `npm test` 全绿；`node scripts/verify-contract-freshness.mjs` 与 `node scripts/check-public-privacy.mjs .` 是每次提交的 CI 前置。
- 命令数、旗标数、`--help` 行数、specs/docs 单件行数都有**机器硬顶**（超顶即红），因为能力面一旦无约束增长，
  工具就会从"帮人掌控进度"变成"需要被掌控的东西"。
- 许可证 MIT；贡献前请读 `CONTRIBUTING.md`（能力增删走"五问"评审，不是谁想到就能加）。
