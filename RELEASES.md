# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.27.0] - 2026-09-27

多仓工作区回溯（设计 docs/superpowers/specs/2026-09-27-multi-repo-workspace-design.md）。demo-b 实测（umax）：1 顶层仓 + ≥6 嵌套独立仓，
单 sourcePath 模型下 44% 节点 notSeen、业务主体不可见。本版由证据锚推出参与仓，嵌套仓历史纳入回溯。只回溯不规划，不写侧车。

### Breaking

- (c) 同命令同参数，多仓项目输出显著变化：锚在嵌套仓的节点由 notSeen 进入 order / recency；`unowned` 路径基准由仓根改为
  sourcePath（单仓不变）；sourcePath 不再要求本身是 git 仓（非 git 工作区根合法，其下无锚所在仓才报 project_source_not_git）。
  迁移：依赖「嵌套仓节点在 notSeen」的调用方改读 `repos` 与 `notSeenReasons`。
- (c) sourcePath 位于某仓的子目录（不是仓根）且其下无锚所在的嵌套仓：0.26.0 返回 ok 但把节点全部误报 neverCommitted，
  现报 project_source_not_git 并提示改登记仓根。

### Added

- 回执 `repos: [{ repo, commits, totalCommits, span }]`；`order` / `recency` 条目增 `firstRepo` / `lastRepo`，跨多仓节点增
  `repos` 明细；`recency` 条目增 `firstSeq` / `firstAt`；`facts.*` 每条增 `repo`（关系只在同仓内判定）；`unownedByRepo`。
- 任一参与仓 git 失败 → 整体 fail-loud `project_source_not_git` 并点名该仓。空仓（已 init、HEAD 尚无提交）按 0 提交处理，不算读取失败。
- 整分支审阅修复：空嵌套仓不再让整条命令失败；非 git 工作区根下的散放锚归 outsideRepo（不再误报 neverCommitted，DEFENSIVE §9）；
  合并 span 按时刻比较（时区偏移混排时字典序≠时序）。

### 实证附记

npm test 626 项 625 通过 0 失败 1 异机跳过（含审阅修复 4 例）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 136 文件（+2）幂等、隐私零命中。效果复测交 umax（demo-b）。

## [0.26.0] - 2026-09-27

demo-b 真实项目实测（远端 umax，657 节点 / 1633 提交）三项小修。实测确认单仓能力成立（全量约 1.2s、M 级 import 边抽样全对、
进行中 × 最后活动交叉揪出 2 个账面在做实际停摆的节点），同时暴露：notSeen 不分因（嵌套仓 187 / 仓外 99 混列）、--node 回执
781KB 未瘦身、recency 不带账本状态需自行联查。最大缺口「多仓工作区」（44% 节点失明）另批设计。

### Breaking

- (b) `--node` 聚焦时 `unowned` 由文件数组改为 `{ omitted: 'focus', count }`：无主改动不属于任何节点，聚焦时只披露计数；
  不给空数组（空数组会被读成「无无主改动」）。迁移：需要全量无主改动的调用方去掉 `--node` 再取。

### Added

- `recency` 条目并列 `progress` / `ledger`（节点账本状态，缺省 null）——事实并列，不作「停摆」判断。
- `notSeenReasons`：未被 git 触及的节点按原因分桶——outsideRepo（锚在代码仓外）/ nestedRepo（锚在嵌套独立 git 仓内，顶层历史
  看不见）/ neverCommitted（锚在仓内但从未进入任何提交）/ mixed，附 `nestedRepos: [{ root, nodes }]`；`notSeen` 字符串数组保持不变。
- `--node` 聚焦时 `notSeen` / `notSeenReasons` 随之收窄。

### 实证附记

npm test 615 项 614 通过 0 失败 1 异机跳过；sync-generated --check / release-version / size-budgets 通过。效果复测交由 umax。

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

---

更早的 50 个版本（0.1.0 → 0.23.1）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
