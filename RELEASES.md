# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.17.0] - 2026-09-14

路线一裁定落地（2026-09-14 负责人裁定：`settled` 闭环语义只能由带证据的跨轴事件产生；判据 = Lamport 归纳不变量 Init ⇒ Inv、DbC 创建过程不豁免类不变量、Temporal/Kubernetes/Git/Liquibase/ISA 510/IFRS 1 等十二来源交叉验证，无一允许终态经普通初始化获得第二种含义）。

### Breaking（set 终态守卫：拒绝直达终态）

- **`state set --axis progress --value verified`**：无证据被拒（`verified_requires_evidence`），**init 首写不再豁免**——昨天合法的无证据直达 verified（含新建节点）今天被拒；`--correction` 为唯一显式出口（history corrected:true 留痕）。属破坏性变更 (a)。
- **`state set --axis ledger --value settled`**：一律被拒（`settled_requires_event`），含 init 首写与表内 backlog→settled——ledger→settled 只能经 `state settle`（执行闭环）或 `state import`（历史导入）跨轴事件写入（A2 §2.4 双写不变量）；同值原地写不拦；`--correction` 放行并留痕。属破坏性变更 (a)。

### Added

- **`state import --node <id> --reason --owner --locator <文件:行号> [--source <来源系统>] [--cutoff <截止日期>]`**：历史/迁移导入的唯一合法跨轴写（蓝本 = Liquibase `MARK_RAN` 独立 EXECTYPE，绝非 settle 别名）——原子双写 progress=verified + ledger=settled + 证据锚（evidence-add 同款校验/绝对化/锚行哈希）+ history kind='import'（含 source/cutoff 溯源字段）+ 自动 notice（kind=settled，summary 带 [import] 前缀）。只登记新节点或零执行史节点（progress=planned 且 ledger=clean），已有执行史 = `import_conflict`；建号校验（id 白名单/L1 前缀门/L2 席位门）与 set 同则。回执 rule=`A2-cross-axis-import`、dualWrite:true、provenance='imported'，与执行闭环永久可区分。
- **report 存量清洗 `import_unmarked`**（warning 不阻断，常开不依赖 --spec）：ledger=settled 但 history 无 settle/import 事件的节点逐条列出——0.16.x 及更早 init 漏洞的直达赋值遗存/手工写账由此可机检；补救 = state import 补登或 --correction 修正。
- set 纠错留痕补全：守卫命中但 A2 表合法（backlog→settled 本在迁移表内）时 admittedCorrection 不覆盖 corrected 标记，0.17.0 起由终态守卫自身打标。

### 验证

- 新增 test/state-import.test.mjs 六例（happy path 全落账含 notice/缺参零写入/冲突与属主与桩节点/双守卫+correction 留痕/同值原地写不拦/report 清洗消解）；
- set-a2 ②③ 改钉新契约（init 免表改用非终态 blocked 验证；首写 verified 带证据放行）；report-gate 种子 bad 节点改钉 import_unmarked；
- 契约附录 A 登记 settled_requires_event / import_conflict / import_unmarked 三新码 + verified_requires_evidence 扩至 set；verify-contract-freshness 全绿。

## [0.16.0] - 2026-09-14

A3-cancelled 守卫 + state get 语义 + doctor 完整性检查（负责人令 2026-09-14：防智能体读不全整体项目）。

### Breaking（A3-cancelled 守卫：拒绝无证据取消）

- **`state set --axis progress --value cancelled`**（`set` 路径）：对已存在节点，无 `--correction` 且 evidence 为空时被拒，新错误码 `cancelled_requires_evidence`（A3：取消是终态声明，须锚定被取代/退役依据）。属破坏性变更 (a)——无证据取消昨天合法、今天被拒。
- **`state transition --axis progress --to cancelled`**（`transition` 路径）：同上，`cancelled_requires_evidence`。

### Added

- **`state get` 输出语义增强**：新增 `lastHistory` 字段（kind/at/reason，最近一次事件）——读节点时直接看到"为什么"，防止只看 progress 不看语义。
- **doctor 新增 `cancelled-evidence` 检查**（warning 级不阻断）：progress=cancelled 但零证据的节点列为数据债，消息附前 5 个节点+全量汇总（nodeSample 体例）——无依据取消在操作面可闻。

### Fixed

- **A3 守卫补全**：此前 `settle`/`transition→verified` 有证据守卫但 `set→cancelled` 无——本次补上，与 verified 同构。

### 验证

- 新增错误码已入 `specs/command-contract.md` 附录 A（契约保鲜测试拦截未登记）；

## [0.15.0] - 2026-09-01

codegraph × archify 协同补齐批（负责人令 2026-09-01 逐项裁：P-0 落 / P-1 加 / P-2 落 / P-3 做）。
**内核零 codegraph 引用不变**（lib/test/specs 零引用，可退出=删纪律文本即零残留）；archify 源码不动。

### Added

- **`state set --kind meta`**（边入账正规通道）：建号时把节点标为账务/元节点——此前活账里的 meta 节点全是
  手工写侧车（绕过 CLI = 绕过 CAS/锁/公理），此旗标补上 CLI 入口；kind 不可改（已存在节点传 --kind
  即 exit 1 bad_args）；A1 的 a1-unmatched-account 对 kind='meta' 的既有豁免通道由此被 CLI 真正接上。
- `scripts/check-codegraph-freshness.mjs`：codegraph 索引新鲜度门禁——分母=注册表∪账本锚指向的仓（现算），
  判据=索引 mtime vs 末次提交；>1 天 warning、>3 天红；无索引仓=提名能力缺失 warning；分母空=N/A 不报 0；
  停放仓 --exempt 显式豁免。立法依据：实测 29 索引仓 19 个陈旧（最狠 69 天），陈旧提名=看着权威的错细节。
- `scripts/reconcile-graph-edges.mjs`：边级三方对账（图 connection ↔ codegraph 边 ↔ 真码）——图的边在
  archify schema 里没有证据槽（connections 仅 from/id/label/to/variant），故对账走账本锚+只读 codegraph.db
  （node:sqlite，Node≥22，更低版本 N/A 降级）。输出：无端点/无据边/漏边三类清单，先 warning 不阻断，
  --strict 时 exit 1。
- `docs/CODEGRAPH-ARCHIFY-PIPELINE.md`：协同管线四步与精度红线（提名→实读→校验→锚）。

### Fixed

- SKILL 纪律节 ③ 条纠错：原文写「符号/位置/结构=M 级事实可引用」与经验池"行号偏移"教训矛盾——
  位置/行号改为 I 级提名（锚坐标只认实读真文件），注入块同行扩展（行数不变，预算零腾挪）。
  三个副本（pi/demo-harness/部署 pi）同步。

### 验证

  specs/command-contract.md 245 行（≤250）。公开投影两个新脚本随白名单进入公开版（隐私门禁通过）。

## [0.14.4] - 2026-08-28

公开版版本沿革拆分为"首屏 + 全量档案"（负责人裁丙案：**不删一行**，只搬家）。

### Changed

- 生成物拆分：`RELEASES.md` 只列最近 5 个版本（含指向全量沿革的链接），新增生成物 `docs/HISTORY.md`
  保留**全部**版本条目。两者同源同一次派生：唯一真相在上游实现仓，本页每次投影整体重生成，不产生第二处手工维护。
- README 目录段补 `docs/HISTORY.md` 指针；`checkGenerated` 必备生成物清单同步加入该文件。
- 派生器重构为 `deriveChangelog()` 单源分段（中性化/未发布路径标注/不可证数字断言过滤逻辑只写一遍），
  RELEASES 与 HISTORY 各自取段渲染，避免两处规则漂移。

### Verification

- 版本数 parity 有回归钉：`HISTORY` 的 `## [x.y.z]` 集合必须与上游版本记录 **逐项相等**（防"搬家"演变成"丢家"）；
  当前全量版本一律保留，RELEASES 137 行。

## [0.14.3] - 2026-08-28

公开版对外语气与可用性修订（**纯生成物文案，零代码行为改动**）——公开版首个发布版本。

### Changed

- README：术语落地（"A1 公理机器执法"→讲清"图上有、账上没销"会被点名并注代号；"一等数据"→"账本里的
  正式条目"；"本体边界"→"适用边界（请先读）"并补一句痛点自诊）；**补 archify 出处**（此前只说"设
  ARCHIFY_BIN"却没说去哪拿，对公众是硬伤）、补 Node 支持矩阵、补"其余命令不需要 archify"、补 CI 面说明。
- CONTRIBUTING："什么会被拒"→"什么情况下可能合不进去（先聊再动手，省你的时间）"；补代码风格
  （ESM·无分号·2 空格）与"先开 issue / 贡献到 scripts/ 不受能力上限约束"的替代路径——原稿只讲拒因不讲出路。
- SECURITY：去对峙语气（"请先读完再报漏洞"→"先读这段，能省你一次误报"）；"不视为安全问题"改中性表述并
  明确其外风险欢迎报告；补受理示例（含"让账本看起来比实际更可信"这一类本仓特有病理）与披露时间线。

### 记录（待裁的减法）

- 公开版 `RELEASES.md` 现约 845 行（内部 RELEASES 全量派生，语气偏内部治理叙事）。是否精简为
  "近 N 版 + 首个公开版说明"属**减法**，按负责人令先征询，本次**未删任何内容行**。
- GitHub Release 说明为面向公众另写，不复用该长文。

---

更早的 34 个版本（0.1.0 → 0.14.2）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 16 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
