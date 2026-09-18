# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.20.0] - 2026-09-18

审核修复批（第一性 × MECE × 奥卡姆审查，2026-09-18）：源于公开仓 atlas-archify-coding PR #1（作者 ubvip），按投影协议回流本仓、经独立对抗复审修正两处后再投影；每项修复先有复现测试（test/audit-2026-09-18.test.mjs，11 项）。与 0.19.1 独立修复重叠的契约保鲜扫描（requireRule/三元采码）以本仓 0.19.1 版为准，公开仓分支版本被投影覆盖。

### Breaking

- (a)(c) `state set` 建账须显式 `--sidecar`：缺省路径 `cwd/atlas-state.json` 缺失一律 `sidecar_missing`/exit 1，不再在 cwd 静默新建账本（幽灵账本 = 空态绿；契约 §2 写边总则已同步）。

### Fixed

- `transition` 的 from 比对把 truth 缺失/null 视为 `candidate`（与 truth 回执门禁同口径），存量节点不再被 `transition_from_mismatch` 卡死（放宽既有拒绝，非破坏；附录 A 同步）。
- 锚根白名单（O1）改用 realpath 判包含：根与目标两侧均取实相（根经符号链接到达仍合法），图谱根内符号链接指向根外文件不再放行（`anchor_root_denied`）；目标不存在时按最近存在祖先解析。复审修正：公开仓 PR 版只 realpath 目标不 realpath 根，符号链接根下的合法锚会被误拒并写入豁免快照，本仓未采用该版。
- git 可执行文件不存在/不可执行（spawn ENOENT/EACCES）时，HEAD 锚比对归免检 `no-git`（`headAnchorState` 返回 `reason`；report/doctor 汇总仅计数），不再把已提交的锚误判为 `a1-evidence-uncommitted`。复审修正：公开仓 PR 版把任何 spawn error/信号终止都归免检，ENOBUFS 等瞬态失败会由 error 变绿；本仓只认 ENOENT/EACCES，其余仍 fail-closed。
- `lib/cli-util.mjs` 的 `diag()` 第 4 参 severity 生效：此前被丢弃，settle 成功回执携带的 `a1-settle-unbound` 实为 error 级，现为 warning 级（report.mjs 自带 diag 早已正确，不受影响）。
- `autoTrace` 的侧车路径解析移入 try：断链 symlink 侧车只降级为 `trace_degraded`，不再把通过的 gate/compile/report 变成 exit 1。
- 契约附录 A `unknown_axis` 行补 class 轴（与 0.19.1 --help 同步）。

### Docs / Packaging

- USAGE 示例证据改落 `evidence/<项目>/<diagram-id>/receipt.json`（此前落 evidence/ 根，跑完 doctor 即 atlas-layout 报错）；QUICKSTART-NONCODER 改为宿主中立、可原样执行的三步；DEFENSIVE §11 锚点注明内部门禁不随投影。
- 投影生成器：公开版 package.json 增 `files` 白名单（不再随包发布 test/、fixtures/ 与隐私黑名单脚本）、`repository`/`homepage`/`bugs`、`prepublishOnly`（npm test + 三门禁），由 test/public-projection.test.mjs（内部件，未随本版发布） 钉住；README 不再声称文档行数有公开仓门禁。`.gitignore` 增 `.omc/`。
- pi SKILL `metadata.version` 同步（0.19.1 遗留漂移，injection-freshness 基线红清零）。

### 未纳入本批（待负责人裁定）

- 崩溃残留锁的显式恢复命令（`unlock`）、`--version` 旗标（全仓旗标预算已满 50/50）、ADD-SPEC 补 class 轴条文、跨轴合法组合矩阵、git 子进程超时、Windows 支持声明、`slugify`/路径守卫/git 根发现去重。

## [0.19.1] - 2026-09-16

本次仅确立 atlas-engine 本地版本并保留变更历史；AAC 不修改、不导出、不同步，待下一版本再评估是否更新。

### Added

- `state get` 回执新增可选字段 `class`（节点账务分类，直接取节点自身字段）：节点无该字段时整个字段省略，显式 null、空串与未知未来值一律原样返回；读命令不写账、不做分类过滤。默认行为与既有字段不变，属纯增字段——但**严格的外部 JSON 消费者**（拒绝未映射字段的解码/schema 校验）须按增量字段放宽；本仓内调用方按字段消费，不受影响。

### Fixed

- `--help` 的 `state transition` 用法补 `--axis …|class`：class 轴（2026-09-10）与 set 用法早已支持，帮助文本此前漏列，属文档与实现不一致（不改实现、不加旗标）。
- 契约保鲜扫描（scripts/verify-contract-freshness.mjs）此前只采集 `diag('code', …)`、`code = 'code'`、`rule: 'code'` 等直接字面量，漏采策略助手 `requireRule('code', …)` 首参与「首参处以单个标识符条件选码」的三元两个分支——`settled_requires_event`、`cancelled_requires_evidence`、`receipt_not_found`、`receipt_unreadable` 四个仍在发射的码因此被判为“附录历史码”宽容放行（删掉附录行也不报错）。现按有界静态字面量补认上述形态：两分支都计入“已使用”与“必须登记”集合，消息参数（第二实参）里的字符串仍不算错误码；删附录行 = exit 1 逐名列出。局限明示于脚本头部注释（不做通用 JS 数据流分析）。
- 规范整理：补齐 ADD-SPEC 与命令契约中的领域语义、状态迁移、证据守卫及失败边界说明；不据此改动存储模型或状态机。

## [0.19.0] - 2026-09-15

### Breaking

- (a) 状态写入补齐取消/验证/真相的证据政策；truth 初始前进须普通文件回执，畸形账本字段与未知 trace 节点提前拒绝。项目注册、init/portal 路径、编译回执与 gate 的矛盾或缺失证明亦拒绝。
- (b) CLI 必填参数遗漏归为 bad_args/exit 1；`--remove` 支持裸旗标和旧 true/false。verified 标签改为“已验证”，只有 verified+settled 才显示“已销账”；diff 对象/数组替换与特殊键不再丢失。
- (c) 仅 state set 可初始化缺失账本；公开导出取 Git 跟踪文件与公开清单交集，先验隐私和三方文件冲突。已登记但未授权的源仓进入 freshness 分母，同名仓按规范路径区分；歧义归属显式披露。

### Added / Fixed

- settle 支持 in_progress/verified × clean/backlog 四种前态，active 单列待销账；import 保留可选 class 与未知来源语义。实际规则豁免才记纠错；时间线统一按时间值排序。
- compile 新增显式 `--previous-receipt`，回执携带标签所有权、绝对输出路径与原图作用域。旧无回执输出保留并披露未知归属，须回原 spec 重编。
- init 排他创建，门户写前校验路径归属，注册表读取复用但授权与观测分开。typed 边先检查索引/同仓覆盖，未观测不再误报无边。
- 参数类型与范围统一声明，demo-harness 技能正文同步生成 pi 共享段，USAGE 示例直接执行验证；保持十命令、零运行依赖及原预算。

### Removed / Verification

- 退役 `scripts/verify-doc-test-count.mjs（内部件，未随本版发布）` 及重复执行测试的 CI 步骤；日期明确的历史记录保留原观测。当前说明统一引用 `npm test` 输出，保留 Node 18/20/22/24 矩阵与其他验证器。
- 修复证据及最终验收见本批实施报告；gate 的机器通过仍保留 visualReview=pending，存量账本/历史不会自动迁移，宿主技能不会自动部署。

## [0.18.0] - 2026-09-14

O1–O5 合并（分支 opt/o1-o5-20260914 × 主线 0.17.0）——「写边合法性 + 判据换源 + 逐闸可证」族。
本条目由 demo-b 编排线在合并候选分支 `merge/o1-o5-candidate` 落笔（冲突解 c856fbd）；合并入 main 的时机与
版本号由负责人在合并窗口确认。

### Breaking（写边从「只校格式」升级为「校合法性」）

- **O3 `class_required`**：**新建节点**的首个写入未声明 class 轴即拒（exit 1）——`--axis class --value <…>` 或本次写入带
  `--class <值>` 二选一；只约束新建，存量无 class 节点不追溯。同批 `state active` 增 `unclassified[]`（无 class 且未完成的
  节点单列并计入 count，不再从默认活帐视图静默漏出，`unclassified_nodes` warning）。属破坏性变更 (a)。
- **O1 锚根白名单写边硬拦**：`state evidence-add` / `evidence-reanchor` 的目标锚不在白名单（侧车 atlas 根 ∪
  `projects.json` 各 sourcePath ∪ `<侧车同目录>/anchor-roots.json` ∪ `--allow-root`）即拒（`anchor_root_denied`，exit 1）；
  `--allow-root` 显式传入的根若非法（非绝对路径/根过大/dist·.next 段）落 `anchor_root_rejected`（warning）。存量错根锚
  走 `<侧车同目录>/anchor-root-exemptions.json` 一次性 grandfathered 豁免（首跑快照，含 receipt 锚，豁免不静默）。属 (a)。
- **O2 锚对 HEAD**：`report` 新增 error 码 `a1-evidence-uncommitted`（`progress=verified` 节点的锚指向不在 git HEAD 的
  工作树-only 文件）；`a3-head-mismatch`（HEAD 同行内容不同 / HEAD 行数少于锚行号）在 report 为 error、doctor 为 warning
  级 `head-anchor-consistency`。不自动改锚。属 (a)：既有一批工作树-only 锚自本版起报红。
- **建号校验先于轴级守卫**（合并语义）：无 class 的建号先被 `class_required` 拒；已有 class 时 0.17.0 的终态守卫
  （`settled_requires_event` / `verified_requires_evidence`）照常生效。
- **2026-09-15 可靠性审核修复批**（独立审核直改主线，属破坏性变更 (a)）：
  - **存储**：坏形状侧车（`nodes` 数组/顶层 null/字段类型错）load/save 均拒（`sidecar_bad_shape`），修复「写入后节点静默丢失」；
    硬链接侧车保守拒写（`sidecar_hardlinked`）；断链 symlink fail-loud（`sidecar_path_unresolvable`）；**写锁不再自动接管**——
    死 PID/超龄锁同样 `sidecar_locked` fail-closed（原「判陈旧→unlink→重抢」存在 TOCTOU 误删活锁窗口，零依赖环境无安全原语）；
    提交边界显式化：rename 前失败回滚 revision 且权限不动，rename 后目录 fsync 失败返回 `sidecar_commit_unknown`（committed=true）。
  - **证据完成声称**：`set/transition→verified`、`settle`、`import` 要求证据锚可解析（此前「有锚但指向不存在文件」可完成销账）；
    `evidence-add`/`evidence-reanchor`/`import` 统一过锚根白名单（此前 import 绕过）。
  - **transition 前态绑定**：`--from` 必须等于节点当前轴值（`transition_from_mismatch`）——修复前只校 from/to 表内合法性，
    伪造 from 可跳级直达 verified；`transition` 直达 `ledger→settled` 同拦（`settled_requires_event`，与 set 同责）。
  - **report 常开对账**：声称对齐节点零证据（`evidence_missing`）与不可解析锚（`evidence_unresolvable`）升级为 error（exit 1），
    不再默认绿；HEAD 汇总增 verdict/checked/unchecked/exempt，broken/未检查不再计入「一致」。
  - **gate 回执契约**：validate/deliver/visual-check 各自校验真实成功回执与产物（digest/bytes/目标文件），不再只看子进程
    exit code——假内核 exit 0 无法伪造 pass；visual-check skipped 或子项失败 fail-closed。
  - **图账映射统一**（`lib/spec-id.mjs`）：compile/report/settle 共用 exact→normalized→scoped specRefs 解析，多候选报
    ambiguous 不静默误绑；class 豁免与 matched 分开披露。
  - **边对账**：区分 typed directional hit / file-level nomination / reverse-only / kind mismatch，不再把任意双向文件关系
    当作语义证明；漏边探测稳定排序并披露截断（`nominationTruncated`）。

### Added

- **O4 G-CG 判据换源**：新鲜度改读索引内部语义时间——`.codegraph/last-sync.json`（字段时间戳优先，退文件 mtime）与
  `codegraph.db` mtime 取较新；**不再取 `.codegraph/` 目录内 max mtime**（读一次即刷绿=假绿）。无 marker 时回退 db mtime 并标
  `mtime_fallback` warning；回滚档 `--source mtime`（只读 db mtime，仍不读目录 max）。marker 生产侧属 codegraph 契约。
- **O5 gate 逐闸 detail append-only**：每次 gate 运行把逐闸结果（含 fail-fast 前未跑闸记 `skip`）追加一行 JSONL 到
  `<atlas>/data/<project>/gate-detail.jsonl`，使「哪次哪个闸红」可回溯；与使用方仓 `gate-history.jsonl` 互不冲突。
- O1：`--allow-root` 旗标；`anchor-roots.json` 显式登记；`lib/anchor-roots.mjs`（白名单解析/裁决/豁免快照）。

### 验证

- `npm test` **343/343 绿**（325 基线 + 审核修复批 16 + transition 守卫 2；含 anchor-roots 5·head-anchor·codegraph-freshness·gate-detail·o3-class-axis·state-import 6·state-transition-guard 2）；
- 六件 verify 脚本全绿：`verify-contract-freshness` / `verify-size-budgets` / `verify-doc-test-count` / `verify-release-version`
  / `verify-injection-freshness` / `verify-deploy-injection`；
- 契约件按预算内维护（`specs/command-contract.md` 257 行 ≤ 260；合并期把两条史实注与两条门禁注各并一行，内容未删；09-15 审核批新增 `transition_from_mismatch` 行并改写 `sidecar_locked`/`settled_requires_event` 语义行）；
- 文档测试数 315→343（README/REVIEW/USAGE/ADD-PROJECT×3/QUICKSTART-NONCODER）；
- 合并冲突 2 处（`lib/commands.mjs` 旗标白名单取并集、set 事件留痕取「O3 class 赋值 + 0.17.0 终态守卫打标」；
  `test/set-a2.test.mjs` 取 0.17.0 值 + O3 `--class`）。

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

---

更早的 38 个版本（0.1.0 → 0.16.0）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 16 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
