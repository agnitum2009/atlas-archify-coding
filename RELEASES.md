# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.25.1] - 2026-09-27

最后活动视图（真实项目试跑发现：回答「现在到底什么状态」最有用的是各节点最后一次活动，而非首现——f-xui 14 个模块中 9 个
首现于同一整体导入提交、排不出先后，但按最后活动一眼可见核心模块自 2021-08 起未再改动）。纯回溯，不作停滞/待办判断。

### Added

- `trace order` 回执增 `recency`（M 级）：每节点 `{ node, lastSeq, lastAt, touches, commitsSince, level }`，按最后活动从新到旧；
  touches = 触及该节点的提交数，commitsSince = 其最后改动后仓库又产生的提交数。始终按全史计算（`--since` 不得滤掉长期未动的节点），
  `--node` 聚焦时只留该节点，`--brief` 截为 `{ count, top≤10 }`，无锚定节点 = `{ status: 'no-anchored-nodes' }`。纯增字段，非破坏。

### 实证附记

npm test 612 项 611 通过 0 失败 1 异机跳过；sync-generated --check / release-version / size-budgets 通过。真实项目效果测试交由远端 umax 机器执行（负责人安排），本机只做实现与夹具单测。

## [0.25.0] - 2026-09-27

纠正 trace order 的「后来抽出」判定（真实项目试跑发现）。0.24.0 把「B 依赖了比自己晚出现的 A」这一事实直接解读为「A 自 B 抽出」
并标 M 级——atlas-engine 本仓试跑 60 条中至少 20 条（33%）实为「B 后来才接入新模块 A」，违背证据分级（解读冒充事实）。

### Breaking

- (b) `facts.extractedLater` 移除，改为 `facts.dependsOnNewer`（M 级事实：B 依赖比自己晚出现的 A），每条附可观测事实
  `wiredAtCreation`（A 首现的提交是否同时改动了 B 中 import A 的文件）。迁移：读 extractedLater 的调用方改读 dependsOnNewer；
  需要「抽出」判断的改读 `nominations.extractionCandidates`。
- (b) `nominations` 改为逐列表给状态：`{ readBeforeWrite: [...] | { status: 'no-data' }, extractionCandidates: [...], note }`。
  0.24.0 无会话事件时整个 nominations 为 `{ status: 'no-data' }`；现改读 `nominations.readBeforeWrite.status`。

### Added

- `nominations.extractionCandidates`（I 级提名）：wiredAtCreation 为真的 dependsOnNewer 条目，「A 自 B 抽出」只提名不裁决。

### 实证附记

npm test 610 项 609 通过 0 失败 1 异机跳过；sync-generated --check / release-version / size-budgets 通过。atlas-engine 本仓试跑重跑：dependsOnNewer 60 条，其中 wiredAtCreation=true 42 条（进 I 级 extractionCandidates），18 条「B 后来才接入 A」不再被称为抽出。f-xui（Go）试跑另记：9/14 模块首现于整体导入提交、Go import 未解析、共改稀疏——见后续批候选。

## [0.24.0] - 2026-09-27

轨迹回溯（设计 docs/superpowers/specs/2026-09-27-trajectory-precedence-design.md）。回应初衷「轨迹随会话消失」与开放项
「轨迹自动捕获未做」：回溯已发生开发中**节点之间谁先谁后、谁建于谁之上**，并显化无主改动。只回溯不规划——不排期、不预测、
不估算、不判优先级；只读派生，不写任何状态轴。

### Added

- `trace import --source <规整事件 JSONL>`：只追加至 `<atlas>/data/<项目>/trajectory.jsonl`，source+session+eventId 幂等去重。
  内核只认规整事件格式（schemaVersion 1），harness 中立。
- `trace order [--node] [--since] [--brief]`：git 提交序（非日期）× 节点证据锚归属 → `facts`（M 级：order / builtOn /
  extractedLater / importSameCommit / coChange）与 `nominations`（I 级提名：会话读后写，批量提及按 1/n 降权）分组输出；
  `unowned` 列出被改动却无节点锚定的文件；空态分辨 `no-data` / `no-anchored-nodes`；重命名历史前移到最终路径。
- 整分支审阅修复：`--since` 不再改变先后分类（首现按全史，窗口只收窄输出——修复前窗口内先改 B 后改 A 会被错判为「A 自 B 抽出」的 M 级事实）；
  import 读 HEAD 版本并去注释（修复前注释里的 import 与未提交改动都会产生 M 级 builtOn）；回执增 `anchorsSkipped` 披露被跳过的相对锚 /
  git 形态锚及因此无从归属的节点（DEFENSIVE §9：无对象可查不得静默）。
- `scripts/trajectory-from-claude-code.mjs`：Claude Code 会话 JSONL → 规整事件（本批唯一转换器，公开投影收录）。
- 错误码 5 个：trajectory_source_unreadable / trajectory_bad_event / trajectory_no_atlas / project_source_missing /
  project_source_not_git。旗标 `source`、`brief` 作用域扩至 trace（唯一旗标仍 50/50，命令仍 10/11）。

### 设计依据与记录不做

- 探针（atlas-engine 本仓，丢弃式）：git 提取 13 ms、产出约 2.2k token；会话轨迹提取 96 ms、产出约 1.1k token，直接读原始
  日志约 265 万 token——会话轨迹必须本地投影。移植外部 harness 的事件模型，不复制其代码。
- 不做：其他 harness 转换器、先后关系注入图谱（compile）、手工 trace add 事件迁移——留后续批。

### 实证附记

npm test 609 项 608 通过 0 失败 1 异机跳过（含审阅修复 4 例）；sync-generated --check / release-version / size-budgets 通过，deploy-injection 异机跳过；export-public --selfcheck 134 文件（+6）幂等、隐私零命中。--help 49 行（help 行数门禁 <50：import 与 order 合为一行，不提门禁）。冒烟：init 空账本对本仓 trace order → exit 0、157 提交、order.status=no-anchored-nodes、unowned 186——空态分辨生效。

## [0.23.1] - 2026-09-27

减法批三（commands.mjs 拆分，设计 docs/superpowers/specs/2026-09-27-split-commands-design.md）。纯内部重构：命令、旗标、
错误码、回执、退出码、`--help` 均不变。

### Changed

- `lib/commands.mjs` 1,425 行 → 注册表 + 帮助文本（≤150 行）；10 个命令实现平铺拆到 `lib/cmd-<族>.mjs`（`lib/` 不建子目录：
  公开投影与内核计数只枚举一层）。函数体由一次性确定性变换脚本逐字搬运。
- `runState`（673 行，全仓最大函数）拆为 `stateContext`（前奏：参数/纠错入口/侧车/项目门/席位门）+ `STATE_SUBCOMMANDS`
  分发表（`hasOwnProperty` 查表，原型链名不命中）+ 11 个子命令函数（最长 `stateSet` ≤120 行）。
- 新增 `test/cmd-helpers.test.mjs`：锚根 5 助手、`gateOutPlacementDiag`、`stateContext` 三分支的进程内边界测试。
- `test/surface-consistency.test.mjs` 增结构守卫：commands.mjs ≤150 行且不含 run* 实现；每命令族一个 cmd-*.mjs 且不 import
  commands.mjs；cmd-* 顶层函数 ≤120 行；lib 其余超长函数只能是白名单（validateLayout 364 / buildReport 317 / runDoctor 276 /
  runGate 173）且只减不增；cmd-* 的每个 import 须被使用（模块对象须以 名字. 访问——删掉未用的 node:path，使漏解构的 path 报 ReferenceError 而非静默拿到模块）。

### 实证附记


## [0.23.0] - 2026-09-27

减法批二（命令面单源化，设计 docs/superpowers/specs/2026-09-27-single-source-surface-design.md）。结构性事实只写一次：
错误码 = lib/error-codes.mjs，命令与旗标 = COMMANDS/OPTIONS 注册表；契约附录 A 与技能命令速查由 scripts/sync-generated.mjs
生成。守"副本一致"的两个门禁因无副本可守而删除。命令行为、回执形状、退出码、错误码集合零变化。

### Changed

- **错误码注册表**：92 条自契约附录 A 逐字迁入 `lib/error-codes.mjs`（迁移前后附录数据行 diff = 0）；`diag()` 成为唯一诊断
  构造器（lib 内 7 份本地助手与 12 处内联字面量收口），未登记码构造即抛错——测试先红，生产 = 顶层 catch exit 2。取代旧门禁
  "只认四种形态"的静态扫描。
- **旧门禁盲区补登记**：旧扫描正则 `[a-z][a-z0-9_-]*` 不认带点与大写开头的码，doctor --atlas 的 11 个 `layout.*` 规则码与
  `P1`–`P6` 从未登记附录 A。以两条模板行 `layout.<rule>`、`P<n>` 登记（模板机制：`<n>` 只放行纯数字后缀），发射码不变。
- **生成物同步 `scripts/sync-generated.mjs`**：附录 A（← ERROR_CODES）、技能命令速查（← `--help` 原文）、技能副本共享区与
  metadata.version（原 verify-injection-freshness --write）三处统一写回；`--check` 入 CI 与公开投影；公开树无 integrations
  时跳过不失败。verify-size-budgets 不再把 generated 标记块内部行计入单件预算（登记新码不撞预算）。
- **防退化守卫**（整分支审阅修复）：`SIDECAR_OP_CODES` 导出并断言全部已登记（顶层 catch 内 diag 不得抛）；lib/bin
  内 `diag('…'` / `.code = '…'` / `code: '…'` / `code || '…'` 字面量逐一断言已登记；内联诊断守卫改认任意位置的
  `rule: '…'`。
- **预算/旗标/章节对账改单元测试** `test/surface-consistency.test.mjs`：命令 ≤11、旗标 ≤50、每命令旗标 ⊆ usage（只认
  --help，比旧 flags⊆usage∪契约节更严）、每命令契约章节存在。
- 技能 SKILL.md：命令速查改为 `--help` 生成块（逐字一致）；「证据锚绝对路径」「compile --previous-receipt」两条并入纪律 8/4；
  删 v0.10.0 移除历史告示。契约 §5 evidence 历史压成一行，附录说明并入标题行，保 ≤260 行。

### Removed

- `scripts/verify-contract-freshness.mjs（内部件，未随本版发布）`（229 行）、`scripts/verify-injection-freshness.mjs（内部件，未随本版发布）`（116 行）及
  `test/injection-freshness.test.mjs（内部件，未随本版发布）`；flag-guard 中依赖扫描器的 7 个用例、audit 中扫描器形态用例。CI 门禁 5 → 4。
- 14 个"关键语义词"检查与 ADAPTER 宽检：命令/旗标已生成，剩余是防纪律散文误删，属内容回归非漂移；部署机
  `verify-deploy-injection.mjs` 仍以 `injection-terms.mjs` 查部署副本。

### 实证附记

npm test 572 项 571 通过 0 失败 1 异机跳过；sync-generated --check / release-version / deploy-injection（异机跳过）/
size-budgets 四门禁 ok；export-public --selfcheck 117 文件幂等、隐私零命中；公开树 sync-generated --check exit 0。
公开树 npm test 514/516：2 个 anchor-roots O1 用例在 main 的投影上同样失败（预先存在，与本批无关）。

---

更早的 48 个版本（0.1.0 → 0.22.1）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
