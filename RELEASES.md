# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

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

## [0.29.0] - 2026-09-27

import 解析覆盖面（设计 docs/superpowers/specs/2026-09-27-import-coverage-design.md）。f-xui（Go）此前 import 类先后事实为零；
demo-b（TS monorepo）只认相对路径 import；`.sql/.sh` 与真正未解析的语言混在 `importsUnparsed`。本版补齐，只读 HEAD、只出能落到仓内的边。

### Breaking

- (b) `importsUnparsed` 语义收窄：只列「有 import 机制但未解析」的扩展名（如 `.py .sh .css`）；本无 import 的扩展名
  （文档/数据/配置/`.sql`/图片/无扩展名）移至新字段 `importsNotApplicable`。
- (c) 同命令同参数 facts 增多：JS/TS 补全 `.tsx/.mts/.cts/.jsx/.cjs` 与 `index.*`、`./a.js → a.ts`、`require()` / `import()` 字面量
  （字符串字面量内的示例不算）；仓内 `package.json` name 的包名引用（入口 exports/module/main，回退 `src/index.*`、`index.*`）；
  Go 按最近 `go.mod` 的 module 前缀解析到包目录（该目录下被锚定的非 `_test.go` 文件的节点都是被依赖方，via 形如 `cmd/a.go → internal/b/`）。
  解析改以 HEAD 文件清单为准：工作树里未提交的新文件不再能被命中。
- 迁移：依赖 `importsUnparsed` 判断「有无解析缺口」的调用方，同时看新字段 `importsUnresolved.count`。

### Added

- `importsUnresolved: { count, top≤10:[{ file, spec }] }`：仓内相对或包名引用解析失败（file 相对 sourcePath）；第三方包、Go 外部包、跨仓引用不计。
- `lib/trajectory-imports.mjs`：HEAD 批读（`git cat-file --batch`）+ HEAD 文件清单索引 + 语言登记表；`trajectory.mjs` 旧解析迁出。

Non-Goals：TS 路径别名、跨嵌套仓包名引用、Python、CSS `@import`、shell `source`。

### 实证附记

npm test 648 项 647 通过 0 失败 1 异机跳过（+16 例，含整分支审阅修复 3 例）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 幂等、隐私零命中；--help 行数不变。
本机冒烟（合成节点表：每个源码目录一个节点，新旧两版对比）：f-xui（Go，42 节点）builtOn / dependsOnNewer / importSameCommit
0/0/0 → 13/21/29，unresolved 4（均为 vendored `URI.min.js` 引用未收录的模块）、耗时 243→123ms；atlas-engine 事实不变、unresolved 0、406→86ms；
Xray-core（Go，167 节点 / 898 文件，本地仅 1 提交）importSameCommit 0 → 1349、unresolved 0、206ms。冒烟发现字符串字面量内的
`require()` 被误认为引用，已修（RED→GREEN）。整分支审阅修复（均 RED→GREEN）：单仓仓外锚致整批 cat-file 失败（回归）、缺失文件名含空格致其后文件静默丢失、
含换行路径串位、Go 原始字符串内 import 模板误认、`../` 出仓引用误计 unresolved、未提交 Go 锚作被依赖方。

## [0.28.0] - 2026-09-27

trace order 完整回执瘦身（设计 docs/superpowers/specs/2026-09-27-unowned-grouping-design.md）。demo-b 复测（umax）：full 回执 5.2MB，
主体是 `unowned` 逐文件路径约 4.16 万条——读不动，也看不出哪块没有归属。

### Breaking

- (b) `unowned` 数组元素由路径字符串改为分组 `{ repo, dir, count, sample }`：按「仓 / 仓内前两层目录」聚合（仓根文件 dir 为 `'.'`），
  每组附字典序前 ≤3 个样本（相对 sourcePath），按 count 降序；同一路径在顶层旧史与嵌套仓都出现只计一次、归前缀最深的参与仓。
  各组 count 之和 = `--node` 聚焦时 `{ omitted: 'focus', count }` 的 count。`--brief` 下 `unowned.count` 由文件数改为组数。
  迁移：逐条读路径的调用方改读 `sample`；需要全量清单的，以 `git log --name-only` 对照证据锚自查。`unownedByRepo`、内核 `computeOrder` 不变。

### 实证附记

npm test 632 项 631 通过 0 失败 1 异机跳过（+3 例：groupUnowned 边界、跨仓去重与聚焦口径、单仓回执形状）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 137 文件幂等、隐私零命中；--help 49 行不变。

---

更早的 56 个版本（0.1.0 → 0.27.1）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
