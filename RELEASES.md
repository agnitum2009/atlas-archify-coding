# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

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

---

更早的 54 个版本（0.1.0 → 0.26.0）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
