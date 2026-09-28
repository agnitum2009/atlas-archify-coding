# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.32.0] - 2026-09-29

接驳 archify v3，双版本兼容 2.16 / 3.x（设计 docs/superpowers/specs/2026-09-29-archify-v3-bridge-design.md；负责人裁定：双版本兼容、焦点卡仅 v3）。

**依据**（2026-09-28/29 实测，本地 archify 3.0.1 克隆与 2.16.0 worktree）：v3 要求 `meta.output`（RELEASES 未载）——atlas 的 init 模板与
compile 产物都没有，v3 下 gate 在 validate 闸全部失败；v3 退役 `meta.views`，atlas 的「当前焦点」章节静默消失；v3 官方验收链改为
deliver → 严格溯源 check → 浏览器检查；3.0.1 起 deliver 自带联网更新检查。

### Added

- 内核契约族判定 `kernelProfile` / `kernelOf`（只读 bin 旁 package.json，先解析符号链接以覆盖 `npm i -g` / `npm link` 安装；major ≥ 3 → v3，其余与未知 → v2，`versionKnown` 如实标）。
- compile：`meta.output` 缺则补 `<图名>.html`（portable；作者已写原样保留）；v3 内核下另加一张 atlas 自管说明卡「当前焦点（在途 n）」置 `cards` 首位
  （只替换 atlas 生成的精确格式卡——amber 且标题「当前焦点（在途 N）」，作者卡即使同前缀也不动；2.x / 版本未知 / 无在途时不生成并清除残留）；回执 `injected.focusCard`、`injected.kernel`。init 模板补 `meta.output`。
- gate：v3 闸链 validate → deliver → **check**（`--require-provenance`，核对 ok / file / provenance=current / 产物摘要 / deliveryReceiptId，
  不符 `check-receipt`、非零 `check-failed`）→ visual_check（加 `--require-provenance`）；2.x 三闸不变。回执 `data.kernel`，v3 `results.check`；
  gate-detail.jsonl 逐闸记录随实际闸链并带 `kernel`。gate 调 archify 的子进程一律 `ARCHIFY_UPDATE_CHECK_DISABLED=1`。
- doctor：`archify-kernel` 的 detail 披露 `profile=v2|v3`。
- `test/archify-real.test.mjs`：真内核集成测试（选跑；设 `ATLAS_REAL_ARCHIFY_V2` / `ATLAS_REAL_ARCHIFY_V3` 时执行）。

### 已知差异（如实记录）

- v3 上游移除了交互式引导章节，atlas 在 v3 下以焦点卡 + 节点 tag 承接，交互式章节不可恢复。
- 焦点卡不在 2.x 生成：2.16 visual-check 禁首屏纵向溢出，2.16 自带示例加一张五行卡即 `viewer/viewport-overflow`。
- 2.16 下 lifecycle 图过不了 visual-check：2.16 的 lifecycle（v1 布局）画布高于首屏，内核自带示例与最小三状态图原样都溢出——与 atlas 无关、
  0.31 同样；v3 下同图通过。

### 非变更（明示拒绝）

- 不接仓库证据（`sources` / `--repo-root`）与 compare；不改 diff；不改 2.x 闸链的调用与回执形状；不提高耦合基线（仍 2.14）。
- 不改用 `finalize`（不产截图，改过去即丢现有视觉证据）；不单独加 `browser-check`（v3 的 visual-check 已含其全部测量）。
- 不新增旗标（50/50 已满）、命令、错误码行；不安装 / 升级 archify。

### 实证附记

npm test 689 项 686 通过 0 失败 3 跳过（含整分支审阅修复 3 例）（1 异机、2 真内核选跑）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 141 文件幂等、隐私零命中；--help 49 行不变；投影后的公开树相关测试通过。真内核实跑（本机 2.16.0 worktree 与 3.0.1 克隆，WORKDIR 置 $HOME 下以避开 snap Chromium 的 /tmp 限制）：两版 2/2 通过——架构图全闸（v2 三闸、v3 四闸）、visualReview=pending、进度 tag、2.x 焦点章节、v3 焦点卡、lifecycle tag 注入（v3 全闸）、失败诊断原样带出。

## [0.31.0] - 2026-09-27

共享锚口径并报（设计 docs/superpowers/specs/2026-09-27-shared-anchor-caliber-design.md；负责人裁定方向 A「逐条标注口径」）。

**依据**（umax demo-b 只量实测）：锚文件 797 个中 202 个（25%）被 ≥2 个节点认领；639 个被认领节点里 300 个（47%）没有独占锚；
coChange 1,846 对中只有 6 对有 ≥3 次两端都经独占锚被触及的提交，1,820 对（98.6%）一次都没有；import 三类关系 75–87% 的 via 样本全依赖共享锚。
节点级关系与活动在文件层为真，但同一件事两个口径相差 300 倍，此前只报一个且不标注（DEFENSIVE §11）。

### Added

- `facts.coChange[].specificCommits`：与 `commits` 同口径的提交中，两端都经独占锚（只被 1 个节点认领的锚文件）被触及的次数。
- import 三类关系 `edges` / `specificEdges`：构成关系的文件级 import 边数；其中两端都是独占锚的边数（Go 目录目标：A 在该目录有独占锚）。
- `order[]` / `recency[]` 的 `firstSpecificAt` / `lastSpecificAt`：首次 / 最近一次经独占锚被触及的提交时刻（全史；从未经独占锚被触及则为 null）；`recency[].specificAnchors`：独占锚文件数。
- `blindSpots.anchors.shared = { files, nodes, top≤10 }`：共享锚文件数、只有共享锚的节点数、被认领节点最多的共享锚。
- 读法（契约陈述）：`specificCommits` / `specificEdges` 为 0 = 没有任何一次提交（一条边）两端都经独占锚被触及——每次都至少有一端只经共享锚被触及，另一端可能是它自己的独占锚；`lastSpecificAt` 早于 `lastAt` = 最近活动只来自共享锚文件。
- import 边按文件级去重：同一文件以不同写法（`'./a.mjs'` 与 `'./a'`）引用同一目标只计 1 条（此前 via 已去重，边数随新字段首次计数即按此口径）。

### 非变更（明示拒绝）

- 不改任何既有字段的值与语义；不过滤、不降权任何关系；不改默认判定口径（方向 B「只按独占锚判定」已否决：会丢掉文档介导的真实关联，且等于替账本做判断）。
- 不给「应该怎么认领 / 哪些锚该拆」的建议；不改侧车（atlas 不替用户改锚）。
- 回执顶层字段仍 11；无新旗标 / 错误码 / 侧车字段；trace import（已冻结）与 readBeforeWrite 不动。

### 实证附记

npm test 665 项 664 通过 0 失败 1 异机跳过（+10 例，含整分支审阅修复 3 例）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 幂等、隐私零命中；--help 行数不变；投影后的公开树 trajectory 测试通过。本机冒烟（atlas-engine 本仓人造共享锚：RELEASES.md 被 5 个节点认领）：回执与 umax 只量脚本逐项一致——coChange 61 对、specificCommits=0 的 16 对、≥3 的 30 对、共享锚 1 个。

## [0.30.1] - 2026-09-27

trace import 冻结（裁决回执 rulings/RULINGS-2026-09-27-trace-import-freeze.md）。

### Changed

- 契约 §8 与 --help 标注 trace import **冻结**：demo-b 实测（umax，事先写死判定标准）会话提名抽样真 0/10——共享锚 `run-gates.sh` 被 25 节点认领致提名扇出
  （552/733 条权重恰为 20）、Bash 运行脚本被计为读、Bash 推定 writes 8/10 无踪迹；demo-b 的 Claude Code 日志只覆盖到 08-25，主力 harness 无转换器。
  负责人裁定：保留不删、行为不变、不再投入。

### 非变更（明示拒绝）

- 不删除、不弃用 trace import / 规整事件格式 / 转换器 / readBeforeWrite / sessionEvents / 相关错误码；不改任何输出；不加运行时冻结告警。
- 不做降噪、不写 一线席位 / pi 转换器。git 回溯（facts / recency / order / blindSpots）不受影响。

### 实证附记

npm test 655 项 654 通过 0 失败 1 异机跳过（无新增——只改文字）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 幂等、隐私零命中；--help 49 行不变。

## [0.30.0] - 2026-09-27

trace order 盲区披露收敛（设计 docs/superpowers/specs/2026-09-27-blindspots-design.md）。

**依据**：回执顶层字段 0.24.0→0.29.0 由 10 涨到 18，其中 8 个在答同一件事——「atlas 看不见什么、为什么」；每轮实测发现一个盲区就多
一个兄弟字段。demo-b 的三类盲区（notSeen 89、无主文件 41,570、包名边只有 1 条）同根：证据锚稀疏；atlas 不替用户补锚（写真相），
能做的只有如实披露——披露应收在一处。本版把 8 个字段收进 `blindSpots`，顶层 18 → 11，预算随之下调到 11。

### Breaking

- (b) 8 个盲区顶层字段收进 `blindSpots = { anchors, nodes, files, imports }`：

  | 旧 | 新 |
  |---|---|
  | `anchorsSkipped` | `blindSpots.anchors` |
  | `notSeen`（列表） | 由 `blindSpots.nodes` 各桶拼出；数量 = `blindSpots.nodes.count` |
  | `notSeenReasons.<桶>` | `blindSpots.nodes.<桶>` |
  | `unowned`（分组数组） | `blindSpots.files.groups`；总数 `blindSpots.files.count` |
  | `unowned`（聚焦 `{ omitted, count }`） | `blindSpots.files`（同形） |
  | `unownedByRepo` | 去掉；按 `blindSpots.files.groups` 的 repo 求和 |
  | `importsUnparsed` / `importsNotApplicable` / `importsUnresolved` | `blindSpots.imports.unparsed` / `.notApplicable` / `.unresolved` |

  `nodes.count` = 四桶之和（桶互斥）；`files.count` = 去重后无主文件数 = 各组之和 = 聚焦时 count。聚焦：nodes 收窄、files 只给 count，
  anchors 与 imports 为全局。`--brief`：nodes 各桶与 files.groups 为 `{ count, top≤10 }`。空态：`nodes` 与 `imports` 均为 `{ status: 'no-anchored-nodes' }`（无锚定文件可解析，不给一组零），anchors、files 照常。
- `unownedByRepo` 去掉的理由：它按「历史所在仓」计数，groups 按「路径所在仓」归属，是两个口径；0.28.0 复测的 424 条困惑出自两口径并存。
  依 DEFENSIVE §11 单报并标注口径：契约写明 files 的 repo 是路径归属、不保证该仓自身 git 史含此改动。

### Changed

- 契约治理节：trace order 回执顶层字段预算 18 → 11。契约 §8 写明「import 关系只在两端都有锚的文件之间判定，目标无锚的引用不产生关系、
  不单独计数（全史口径下其目标必在 blindSpots.files；--since 时 files 只含窗口内改动）」。--help 的 `unowned=无主改动` 改为 `blindSpots=看不见什么及原因〔锚不可用/节点未见/文件无锚/import 未解析〕`（行数不变）。
- `briefOrder` 从 `lib/trajectory.mjs` 迁到 `lib/trajectory-workspace.mjs`（作用于回执形状）；内核 `computeOrder` 返回形状不变。
- 单仓路径的无主文件路径统一为 `/`（此前是本机分隔符；顺带修掉 0.28.0 暂缓的 Windows 单仓分隔符问题，Windows 仍标记为未验证）。

### 非变更（明示拒绝）

- 不新增任何信息：无新盲区类别；不算覆盖率百分比（新指标会带来 DEFENSIVE §11 口径问题）；不做 `importsToUnowned`——import 目标在 HEAD 中，
  必然被提交过，全史口径下无锚即已落在 `blindSpots.files`，盲区已披露，只缺一句说明（已补进契约，并写明 `--since` 时的局限）。
- 不叫 `coverage`：atlas 已用该词指账本覆盖率百分比（`unowned-oversize-scan`、DEFENSIVE §11 的 `contextView.coverageByContext`）。
- 不输出任何「应该补锚 / 先补哪里」的建议；排序只是按数量排事实。
- 不动 order / recency / facts / nominations / repos / commits / totalCommits / span / sessionEvents；不改 anchors 内部键名。

### 实证附记

npm test 655 项 654 通过 0 失败 1 异机跳过（+4 例，既有盲区断言全部迁到新路径；含整分支审阅修复）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 幂等、隐私零命中；--help 行数不变；投影后的公开树 trajectory 测试通过。

## [0.29.1] - 2026-09-27

0.29.0 demo-b 复测（umax）后的反思批 A：修一处解析缺陷，并给 trace order 回执顶层字段立预算。回执形状不变。

**为什么立字段预算**：命令（≤11）与旗标（≤50）有预算，回执字段没有；0.24.0→0.29.0 trace order 顶层字段由 10 涨到 18，
新增 8 个中 5 个是同一类「为什么看不见」的披露，每轮实测发现一个盲区就多一个兄弟字段。先锁在现值止住增长，
再由下一批把盲区披露收敛为一处（预期下调预算）。准入：第 0 问——防回执膨胀、保持中后期项目可读；只立约束不改输出，
不改变何为真、无新侧车字段 / 旗标 / 错误码，--help 不变。

### Fixed

- import 规格先去 `?query` / `#hash` 再解析（demo-b 实测 `../mcp-server.mjs?ops-tools` 被计为 unresolved）；unresolved 报告仍用原规格；
  `#` 开头的 Node imports 字段写法不解析（按外部忽略，不计 unresolved）。
- 契约 §8 回执字段表漏列 `unownedByRepo`（0.27.0 起已输出），补上——字段表与实测回执此前不一致，由新测试发现。

### Added

- 契约治理节：trace order 回执顶层字段 ≤18。`test/trajectory-cli.test.mjs` 以契约 §8 字段表为唯一来源，断言实测回执（full 与 --brief）
  顶层字段与之相同、字段数不超预算；`test/trajectory-workspace.test.mjs` 断言多仓、单仓、无锚定节点空态三条路径字段集合一致。
  沿命令 / 旗标预算的既有做法（契约写预算、测试断言占用），不放进行数门禁 verify-size-budgets（该门禁只管文本行数，不跑代码）。

### 实证附记

npm test 651 项 650 通过 0 失败 1 异机跳过（+3 例）；字段预算测试经两次反向验证（契约删一字段 → 失败；预算调为 17 → 失败）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 幂等、隐私零命中；--help 行数不变。

---

更早的 58 个版本（0.1.0 → 0.29.0）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
