# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

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

## [0.22.1] - 2026-09-27

减法批一（负责人 2026-09-27 令）。方法：清点 → 本质/偶然归类 → 使用证据 → 持有成本 → 移除约束（Tesler）五问；
本批只做零风险两项——无消费者的导出面与仓内承担历史记录职责的文档。产品行为、回执、退出码零变化。

### Changed

- **导出面清理**：13 个仅在定义文件内部使用的符号去掉 `export`（anchor-roots 4、evidence 3、spec-id 2、
  atlas-data / gate / notice / state-machine 各 1）；删除生产路径零调用的 `diff.flatten`（3 行包装器）与
  `state-machine.validateSetWrite`（0.22.0 起被 lib/state-policy.mjs 规则引擎取代，覆盖面由
  invariant-exhaustive 门禁承担）。lib 6080→6056 行。仍被单元测试直接导入的 10 个生产符号**保留导出**
  （测试接缝不是死代码；`lineHash` 另有 scripts/reanchor-moved.mjs 消费者）。`flatten` 原守的无原型字典
  不变量改经公开面 `diffSpecs` 断言。
- **历史文档归档**：12 份带日期快照（审核摘要、实战反馈 ×2、提案单、事故查证、采纳基线、交接单、方法论拆解、
  待办清单、升级简报、plan-tree 评估、codegraph 采纳）与 5 份已执行实施计划（原 docs/superpowers/plans/）
  `git mv` 至 docs/archive/（plans/ 子目录），新增 docs/archive/README.md 说明放入判据。docs/ 根 24→7 件。
  活引用（README / DEFENSIVE / ADD-PROJECT / command-contract / 两份 SKILL.md / ADAPTER.md /
  public-projection 测试）同步改写；**本文件旧条目中的路径保持原文**，文件名一一对应可定位。
  OPTIMIZATION_PROPOSAL_2026-09-14 为 O 系列设计正本且 size-budgets 门禁以其为换入凭据，暂留 docs/ 根。

### 已知副作用

- scripts/verify-size-budgets.mjs（内部件，未随本版发布） 只扫 docs/ 一层，归档件不再受 240 行单件预算约束（当前全部 <240，无实际影响）。

### 实证附记

npm test 568 项 567 通过 0 失败 1 跳过（部署机专属文件异机跳过，设计内）；五门禁全过；export-public --selfcheck
114 文件幂等、隐私零命中。

## [0.22.0] - 2026-09-26

写入规则收敛批（负责人 2026-09-26 确认）。0.16.0→0.21.2 同族守卫六天九版反复补洞，根因审计：组合规则读写两份实现、
纠错可豁免范围逐规则散写、提前 return 使规则互相吞噬、单测刻意隔离规则交互、修复范围 = 复核单复现范围。本版
不再逐例补洞，改为**一条公理 + 全空间门禁**：ADD-SPEC §2.4.2 规则四族（P 路径 / S 状态 / A 权限 / X 外部事实）
为写入规则唯一规格源，`--correction` 只豁免 P 族。新增规则须先归族并通过 test/invariant-exhaustive.test.mjs。

### Breaking

- (a) `--correction` 只被 `state set` 接受：transition / settle / block / evidence-* 等传入 = `bad_args`（指引
  `state set --correction`）。此前 transition 上的纠错可豁免 `settled_requires_event` 与（0.21.2 起）
  `cancelled_requires_clean`，其余子命令静默忽略旗标。
- (a) 组合表不可纠错：`set --correction` 不再能写出 `cancelled × ledger≠clean`（0.21.1/0.21.2 的「直接放行，
  孤儿照落」通道关闭）；settled 半边由「只拦直达事件」收口为组合判定，新码 `settled_requires_verified`
  ——纠错直达 settled 须写后 progress=verified。补救均有表内路径（先 ledger --correction 核销 / 先使 verified）。
- (a) 证据不可纠错：`set --correction` 不再豁免 `verified_requires_evidence` / `cancelled_requires_evidence`
  （含 init 首写）与 `evidence_unresolvable`，与 `--help`「不免除…证据」、report 读边「零证据 verified 恒为 error」、
  evidence-remove「纠错也不能删最后一条证据」对齐。0.17.0 为清理存量保留的零证据出口由同版 `state import` 取代；
  现须先 `evidence-add` 再纠错。`set ledger→settled`（纠错）同样要求证据非空且可解析。
- (a) S 族按「改动成员字段」执法：cancelled×backlog、in_progress×settled 等存量表外节点，改动 progress/ledger
  的写入写后须回到表内（修复写仍可达，见可达性证明）；truth/class/同值写不受影响。

### Fixed

- 0.21.2 回归：组合守卫命中后提前 return 跳过证据守卫——`transition --correction` 可把 planned×backlog 零证据
  节点写成 cancelled（契约 §2 明文 transition 纠错不豁免证据）。一次写入的违规现全部报出（P、A、S、X 序），
  不再「修一个冒一个」；transition 的违表不再先于证据/回执短路。
- 契约 report 约束段恢复 0.21.1 压缩行数时误删的 A1 报码说明与「存量清洗（0.17.0）」指引。
- 契约保鲜扫描看不见组合两码（`out.push` 字面量不在采集形态内，删附录行不报错，0.19.1 同型盲区）：组合表改为
  声明式 `CROSS_AXIS_RULES`，90 码全覆盖、零宽容 warning。

### Added

- history 纠错事件在 `corrected: true` 之外增记 `waivedRules: [规则码]`（纯增字段）——此前只有布尔值，
  事后无法分辨一次纠错绕过了什么。
- test/invariant-exhaustive.test.mjs：set/transition × progress/ledger × 全部前态 × 证据{无,可解析,不可解析}
  × 是否纠错 共 1092 例实跑 CLI，对照按 §2.4.2 独立推导的预言（退出码、全部诊断码、零写入、豁免留痕）；
  可达性模型：16 个表内状态两两可达、14 个表外/违例存量均可修复——收紧纠错不造死路。

### 迁移

  （docs/ADOPTION-BASELINE-2026-08-17.md（内部件，未随本版发布）），cancelled 半边存量 0，影响面限于自动化脚本对 transition 传纠错旗标。

## [0.21.2] - 2026-09-18

守卫完整性修复批（0.21.1 的 cancelled_requires_clean 经 ds41x 席位独立复核——可证实也可证伪的复核单，实测坐实两个缺陷后收口；新增 6 项先红后绿测试，test/ruling-2026-09-18-followup.test.mjs）。

### Breaking

- (a) `cancelled_requires_clean` 从「progress 轴写入」扩为「组合判定」：cancelled×clean 节点经 ledger 轴 set/transition 写 backlog 昨天（0.21.1）合法、今天被拒（exit 1 零写入）——0.21.1 只拦了 progress→cancelled 一个方向，反向挂账路径漏拦。只拦 progress/ledger 成员轴写入；truth/class 等无关轴对存量孤儿的补记不冻结。--correction 显式核销通道语义不变（corrected:true 留痕，孤儿照落、读边持续告警）。

### Fixed

- 守卫补救消息归真：原指引「先 state settle 核销欠账再取消」在唯一可触发状态（planned×backlog）下被 illegal_transition 拒（settle 要求 progress∈{in_progress,verified}，ds41x 实测），且 verified 无出边、settle 后永不可取消——死路指引。消息改为实测可达路径：先 `state set --axis ledger --value clean --correction` 核销欠账（backlog→clean 不在 A2 表，必经纠错通道）再取消。
- 契约与 ADD-SPEC 同步：附录 A cancelled_requires_clean 行、§2.4.1 执法口径段改写为组合判定语义。

---

更早的 45 个版本（0.1.0 → 0.21.1）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
