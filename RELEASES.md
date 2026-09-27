# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.27.1] - 2026-09-27

demo-b 多仓复测（umax，12 仓 / 5127 提交）后的小修与供应链卫生。复测确认 0.27.0 成立：notSeen 286→89（余者全为图谱 spec 的仓外锚）、
嵌套仓失明归零、跨仓关系零泄漏、全量约 2.4s。

### Fixed

- `--node` 聚焦时 `unowned.count` 与非聚焦 `unowned` 条数口径不一（实测聚焦 42694 vs 非聚焦 41570）：各仓不再各自聚焦，
  先按 sourcePath 相对路径去重、再在合并层施加聚焦——同一路径在顶层旧史与嵌套仓都出现只计一次。
- 多仓合并不再让各仓计算随即丢弃的 notSeenReasons（`computeOrder` 增 `withNotSeenReasons`，缺省 true）。

### Changed

- 契约 §8 写明同改口径：按改动发生时所在仓的历史判定（文件后来迁入嵌套仓的，其顶层仓时期的同改仍记 repo:'.'）。
- CI（本仓与公开投影生成的模板）actions 引用钉到 commit SHA：actions/checkout 与 actions/setup-node 均为 v4.4.0 对应提交；
  新增 `test/ci-pinning.test.mjs` 守卫任何 `uses:` 必须是 40 位 SHA。主版本未升级（v7 已发布，升级另议）。

### 实证附记

npm test 629 项 628 通过 0 失败 1 异机跳过；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 137 文件（+1 守卫测试）幂等、隐私零命中。

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

---

更早的 51 个版本（0.1.0 → 0.24.0）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
