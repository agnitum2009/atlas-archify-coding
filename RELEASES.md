# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

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

---

更早的 42 个版本（0.1.0 → 0.19.1）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 17 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
