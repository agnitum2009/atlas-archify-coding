# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.21.1] - 2026-09-18

裁定收尾批（0.21.0 留给下一版的二问落裁，依据同日真实账本统计：551 节点，cross_axis_unlisted=36，全部为 settled⇒verified 半边的历史直达遗存；cancelled⇒clean 半边存量=0。可机检项各有先红后绿测试 test/ruling-2026-09-18-followup.test.mjs，7 项）。

### Breaking

- (a) `state set/transition`：progress→cancelled 而 ledger≠clean = failed `cancelled_requires_clean`/exit 1（零写入）——0.21.0 成文的「写边仍允许先挂 backlog 再 cancelled」语义就此收口。零误伤依据：真实账本该半边存量 0；补救 = 先 state settle 核销欠账再取消，或 --correction 显式核销（corrected:true 留痕，与 settled_requires_event 同款）。

### Fixed

- report 失败信封（非 --brief）丢 warnings：errors>0 时 data 仅 {a1?, evidenceHead}，存量统计仪器（cross_axis_unlisted 等）恰在账本不健康时不可见——重演 0.4.0「藏明细」缺陷（evidenceHead 同型问题已修而 warnings 漏了）。修复 = data 补 warnings 全文；--brief 失败信封仍为计数（语义对称）。

### Added

- `which` 探测（lib/resolve-archify.mjs）补 5s 超时：裁定5「子进程不得无限挂起」的唯一 lib 内例外收口；超时按探测失败走既有回退链，fail-closed 不变，不伪装成功。

### 观测口径（非行为）

- cross_axis_unlisted 拆半裁定成文（ADD-SPEC §2.4.1 执法口径段）：settled⇒verified 半边维持 warning（写边已由 settled_requires_event 守住，36 条存量与 import_unmarked 同人群，清偿后归零）；cancelled⇒clean 半边升写边拦截（本版 Breaking 项）。

## [0.21.0] - 2026-09-18

裁定批（负责人 2026-09-18 对 0.20.0「未纳入」清单逐项裁定；可机检项各有先红后绿测试 test/ruling-2026-09-18.test.mjs，5 项）。

### Added

- **progress × ledger 组合表成文**（ADD-SPEC §2.4.1）：settled ⇒ progress=verified（既有双写不变量的成文）；cancelled ⇒ ledger=clean（**新增观测约束**：写边今天仍可先 backlog 再 cancelled，但该欠账此后无任何事件可销，成永久孤儿）；truth 轴与二者正交。report 新增常开 warning `cross_axis_unlisted`（附录 A），用于统计存量，**不阻断**；是否升 error 待统计后另裁。
- **git 子进程超时**：lib 内全部 git 调用经 `gitSync`（lib/evidence.mjs）统一带 timeout，缺省 10000ms，`ATLAS_GIT_TIMEOUT_MS` 覆盖。HEAD 比对超时的锚计入 `evidenceHead.unchecked.timeout`（未检查，verdict 不得为 verified，ok=false），其余调用点按既有失败路径处理（check-ignore 超时同归未检查，复审修正）。单次 git 调用不再无限挂起；多文件按锚缓存逐个计时（累计上限 = 文件数 × 超时），archify 内核探测的 `which` 不在本批。
- `evidenceHead.noGitReasons`（report/doctor，纯增字段）：no-git 免检按原因计数——`no-repo`（无 git 仓）与 `git-unavailable:<code>`（git 不可用）可区分。
- `--help` 首行印 `atlas-engine <version>`（不加 `--version` 旗标：旗标预算 50/50 已满，需求只是「看到版本」）。
- `sidecar_locked` 回执附带可直接执行的恢复命令 `rm -- '<锁文件绝对路径>'`（不加 `unlock` 命令：0.18.0 关闭自动接管的裁定不回退，用户缺的是"怎么办"而非新能力）。

### Docs

- 支持平台声明：Linux / macOS；Windows 未验证（公开版 README 已知边界 + SECURITY 信任模型）。
- 0.20.0「未纳入」清单勘误：ADD-SPEC class 轴条文实为 0.19.1 §2.6 已完成，划销。

### 明示不做

- `slugify` / `repoRootOf` 去重：零行为收益且动 lib/scripts 边界，记债不做；待其中一份真出问题再修。

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

- 崩溃残留锁的显式恢复命令（`unlock`）、`--version` 旗标（全仓旗标预算已满 50/50）、ADD-SPEC 补 class 轴条文（勘误：0.19.1 §2.6 已有，0.21.0 划销）、跨轴合法组合矩阵、git 子进程超时、Windows 支持声明、`slugify`/路径守卫/git 根发现去重。逐项裁定结果见 [0.21.0]。

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

---

更早的 40 个版本（0.1.0 → 0.18.0）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 16 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
