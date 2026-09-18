# 十命令接口契约 v1.0.0（P1 规范层）

> 原则：每个命令 = 显式输入（旗标/文件）+ 结构化 JSON 回执（统一信封）+ 显式副作用（侧车写入、外部内核调用、产物落盘，均须可由回执判读）；**不是纯函数**——副作用范围与原子性见各命令条目与 §2 操作规则正表。无交互提示；错误只输出诊断，不打印调用栈（对齐 archify 结构化修复回执哲学）。
> 十命令：init / state / diff / compile / report / gate / trace / lessons / notice / doctor（notice 为 2026-08-15 清单 B3 增补的第十一命令；evidence 顶层命令已于 v0.10.0 按两段式废弃政策第二阶段物理移除——见 §5 移除注记与 RELEASES [0.10.0]）。
> 统一回执信封：{ "schemaVersion": 1, "command": string, "status": "ok"|"failed", "data"?: object, "diagnostics"?: [ { "rule": string, "severity": "error"|"warning", "subject": string, "evidence": string, "supportedFixes": string[] } ] }
> 帮助文本（--help）由命令注册表单一来源生成：lib/commands.mjs 注册表 { name, usage, flags, run } 的 usage 字段拼装（D4 2026-08-15 重构；今后新增命令的帮助行与分发同处登记，防 help 与实现漂移复发）。
> 退出码：0=ok；1=failed（校验/约束失败）；2=内部错误（未分类，不得伪装成功）。

## 治理（增长控制开发规范批一#2/#4，2026-08-15）

**预算硬顶**：命令数 ≤11、全仓唯一旗标 ≤50；占用数由 `scripts/verify-contract-freshness.mjs` 从注册表计算。新增能力仍须过下列准入五问；超限必须显式换入或退役，不随本批修复提高预算。

**本体边界（负责人裁定 2026-08-17，前置于下列五问）**：ADD 的问题域 = **已开工、中后期失去进度掌控的项目**（「开了头不知道如何收」）。**从零开始的项目不是本工具的场景**——这类工具已极多，兼顾会让本体累贅，什么都做反而做不好。故 **第 0 问：这个能力服务的是「中后期项目重获进度掌控」，还是「更好地开一个新项目」？后者一律拒**，不进入下列五问。空目录上 init 链实测可跑但属场景外，不予修补（防被当成未修债反复捡起）。

**能力准入五问**（过了第 0 问才问；新命令/新旗标/新能力入内核前逐条回答，任一不过即拒）：
1. 它是否改变「什么被判为真」？（是 = 内核变更，需裁定+版本+契约+测试四件套）
2. 不加它，现有命令+3 行 bash 能否组合达成？（能 = 拒进内核，落 scripts/）
3. 它新增侧车字段吗？（须登记 snapshot-policy §5.2+缺省兜底+旧引擎读行为写实）
4. 它需要三条注入通道同步吗？（须同批次改，否则不许合）
5. 它的失败模式是否 fail-loud 且能用 0/1/2 表达？

**废弃政策（两段式）**：标 deprecated（--help 标注 + 回执 warning 诊断——severity=warning 的 deprecated_command 诊断指明替代路径与移除版本，退出码与 data 不变）→ 存活一个 minor 周期 → 次 minor 删除，删除理由与替代路径入 RELEASES。首批已走完两段全程：evidence 顶层命令、lessons hit 子命令（0.9.0 标记 → v0.10.0 物理移除，deprecated_command 诊断码随之退役；理由与替代路径入 RELEASES [0.10.0] Breaking 节；判据与实测口径见 docs/ADOPTION-BASELINE-2026-08-17.md）。

**旗标白名单粒度**：lib/cli-options.mjs 统一声明命令范围、类型和解析键名，派生注册表 flags 与解析器布尔集合；按命令组并集校验。未知旗标或缺少必填参数 = failed/exit 1 bad_args。重复带值参数保留聚合；--remove 裸旗标为 true，兼容显式 true/false，其他布尔旗标不吞后续位置参数。

**注入文本行数预算**（2026-08-17，与命令/旗标预算同一治理精神，Sculley 死分支处方同源）：SKILL.md 核心纪律条目 ≤ 10 条、单条 ≤ 6 行——「防注入块无限膨胀」的自我约束；超出须先退役一条或经开发规范程序上调，禁止静默膨胀。

**规范/文档行数预算**：specs/ 单件 ≤260 行、docs/ 单件 ≤240 行；沿用 2026-09-14 显式换入，本批不扩容。超出先合并重复说明或退役；当前读数可用 `wc -l specs/*.md docs/*.md` 查看；执行检查以所在仓 CI 为准。

**版本纪律（semver 判据，2026-08-17 成文）**：minor（0.x.0）= 错误码/退出码/旗标语义/迁移表/侧车结构任一变更（含新增规则码入附录 A）；patch（0.x.y）= 纯增可选字段且有缺省兜底、纯纪律/文档增量。破坏性三定义（见 RELEASES 头部）：(a) 拒绝昨天接受的输入 (b) 改变既有字段/退出码语义 (c) 改变默认行为——任一命中即立 Breaking 节并如实标类型。
## 1. init

用途：新项目一键初始化 **v3 版式**图谱目录（atlas-layout.md §〇-v3：七区 + 项目一级子目录）+ 状态侧车 + INDEX.md（项目注册表）+ state/projects.json 机器可读项目注册表——init 产物零手工迁移直通 build-portal --project 与 doctor --atlas（0.7.0 修复 init↔portal 版式断链，demo-b holdout 对抗实验）。
输入：--dir 目标目录；--diagram-type architecture|workflow|sequence|dataflow|lifecycle；--title 图标题；--template minimal（缺省，只出骨架）|demo（额外播种 spec/<项目>/demo-map.json 演示图 + 侧车示例节点 demo-a progress=planned + INDEX 注册；未知模板名 = failed exit 1）。
项目名派生（0.7.0，零新旗标）：显式 --diagram-id 取其首段（第一个连字符前）；未给 --diagram-id 取 --dir 的 basename；清洗为 [a-z0-9-]（小写、非法字符折叠为单个连字符、去首尾连字符，与 build-portal slugify 同则）；派生为空 = failed exit 1 bad_args。派生结果随回执 data.project 返回（调用方可见）。
版式（v3）：七区（spec/artifacts/evidence/data/state/rulings/history）+ 项目一级子目录 spec/<项目>/、evidence/<项目>/、data/<项目>/、artifacts/<项目>/（模块目录 <模块>-<YYMMDD>/ 由交付/build-portal 流程按需建）；主 spec 落 spec/<项目>/<diagram-id>.json；INDEX.md 增项目注册表段；state/projects.json 写入注册条目 { project, umbrella: <项目>-add, sourcePath: null, firstSeen, portals: [] }。
输出：{ root, project, diagram_spec, state_sidecar, index, created, template }
约束：目标目录已存在 atlas-state.json 时拒绝（不覆盖）；显式 diagram-id 与门户 project/umbrella 必须为合法单段身份，禁止穿越/绝对路径/控制字符。全部输出先验实际父路径不逃出图谱根；首写使用排他创建，竞争产生的文件保留。多文件初始化不承诺事务。
## 2. state
用途：节点状态读写与迁移。操作规则紧凑正表（前态/约束 → 证据/回执 → 原子写入/失败边界；错误码语义见附录 A，本节不重列；三轴迁移表与 class 语义见 ADD-SPEC §二）：
| 操作 | 前态 / 约束 | 证据 / 回执 | 原子写入 / 失败边界 |
| --- | --- | --- | --- |
| state set（用法见下） | 既有节点的轴值变更过 ADD-SPEC §二 迁移表（违表 = illegal_transition，消息指引 --correction）；**免表仅两例外：初始化/首写、显式 --correction**；同值写入不校验；owner 必须等于属主（A4）；新建节点须带 class（class_required，见 ADD-SPEC §2.6；`state import` 是既有例外） | 完成声称与 ledger 专用事件要求见文末写边总则；truth 前进见本表末行 | 单次 saveSidecar（写锁 + CAS + rename）：sidecar_write_failed 表示尚未发布（committed=false，revision 恢复、临时文件清理，不承诺调用方内存业务字段回滚）；sidecar_commit_unknown 表示已发布但持久性未知（committed=true，durability 为 unknown 或 unsupported）。锁、权限等前置错误另见附录 A，不将所有 failed 一概视为零写入。 |
| state transition（用法见下） | 节点须**已存在**且 --from 等于该轴当前值（谎报 = transition_from_mismatch），再过迁移表（违表 = illegal_transition）；**无初始化例外，同值/违表不被 --correction 豁免**（该旗标在 transition 上只经 state-policy 豁免 ledger 事件规则）；owner 校验同 set | 同 set | 同 set（单次 saveSidecar） |
| state settle --node <id> --reason <text> --owner <o> | progress∈{in_progress,verified} 且 ledger∈{clean,backlog}；owner=属主；已 settled 拒绝 | 需 ≥1 条非空**且可解析**的锚（A3） | 同一 saveSidecar 内写 progress=verified + ledger=settled + history + notice，revision 只推进一次；此处的「同次保存」只含节点/history/notice，**不含 trace**（state 写命令不自动记 trace，见 §8）；前置校验失败不落盘，保存失败按 commit 分层（见附录 A） |
| state import --node <id> --reason <text> --owner <o> --locator <文件:行号> [--class <分类>] [--source <来源系统>] [--cutoff <截止日期>] | 只登记新节点或零执行史节点（progress=planned 且 ledger=clean）；有执行史 = import_conflict（先判已 settled = already_settled）；**owner 必须等于属主（A4）**；建号校验（id 白名单 / L1 前缀门 / L2 席位门）与 set 同则 | 强制 ≥1 条锚，写边要求可解析（严于 evidence-add），并过锚根白名单门（O1）；`--class` 可选（省略保持无分类兼容，不覆盖已有分类——新建节点的 class 必填只约束 `state set`） | 同 settle 的单次原子双写；history kind='import' 记 locator/source/cutoff，receipt.rule=A2-cross-axis-import、provenance=imported（与执行闭环永久可区分） |
| state block --node <id> --reason <text> --owner <o> [--with-backlog] | progress 必须 = in_progress；--with-backlog 要求 ledger=clean；owner=属主 | 无证据要求 | progress→blocked（--with-backlog 时另写 ledger→backlog）与 history、notice 同次保存 |
| state evidence-add --node <id> --locator <文件:行号> | 节点须存在 | locator 格式（parseLocator）+ 绝对化落账 + **锚根白名单门（O1；坏配置 fail-closed，见附录 A `anchor_*` 行）**；同锚重复落锚 = 幂等重新加持（刷新哈希，不重复插入数组） | 单次 saveSidecar；写边不校验文件存在/行界（lint 属读方 report/doctor） |
| state evidence-remove --node <id> --locator <锚> | 锚须存在于该节点 evidence 数组（按落账形态绝对化后匹配，否则 locator_not_found） | 声称对齐实相（progress∈{verified,cancelled} / ledger=settled / truth∈{effective,closed}）的节点移除后证据归零 = 拒绝（A3 守卫） | 移除锚 + 同步删 evidenceMeta 键 + history 同次保存；**只保非空，不重验其余锚**（坏锚不因此被全量复核） |
| state evidence-reanchor --node <id> --from <旧锚> --to <新锚> | 旧锚须存在（否则 locator_not_found；格式坏 = bad_locator） | 新锚过 evidence-add 同款校验（含锚根门 O1），另加行存在（file_missing）/行界（line_out_of_bounds）lint（严于 add）；写新锚行哈希 | 移除旧锚（含其 evidenceMeta 键）与追加新锚合并为一次 saveSidecar——中途不出现零证据瞬间，A3 天然不受威胁 |
| truth 前进（set/transition） | 前进 = 目标在真相链上严格位于起点之后（起点缺失/null 按 candidate，跳级前进同算）；回退与原地写不触发本门 | 必带 --receipt 现存普通文件（允许指向普通文件的 symlink）：receipt_required / receipt_not_found / receipt_not_file / receipt_unreadable；机器不读/校验业务语义 | 放行后绝对路径写 history.receipt 与 truthReceipts{to,receipt,at}；--correction 不豁免本门（A2 门与回执门互不改写，见 ADD-SPEC §2.5） |
写边总则：仅 set 可在侧车缺失时建账，且须显式 --sidecar（2026-09-18 审核批：缺省路径 cwd/atlas-state.json 缺失一律 sidecar_missing，不在 cwd 静默建幽灵账本）；其余 state 操作报 sidecar_missing。lib/state-policy.mjs 统一判定证据/事件政策：set/transition→verified、settle/import、truth→effective/closed 要求证据非空且可解析，→cancelled 只要求非空；set 的 progress 纠错可豁免证据要求，set/transition 的 ledger 纠错可豁免专用事件要求；truth 证据与回执无纠错豁免，transition 不豁免 A2。只有实际豁免规则才记 corrected:true 与 receipt.rule=A2-correction；**同值或无关字段写不重验旧证据**（不改变上表的 A2 校验边界）。
子命令与未入表细节（读侧：`state get --node <id>` 回执 = { node, class?, owner, truth, progress, ledger, evidenceCount, historyCount, lastHistory? }——**class 为可选字段**，原样取节点账务分类：无该字段则省略、不臆造默认值，显式 null/空串/未知值原样返回（读方自判），读命令不写账、不做分类过滤，按分类筛选用 state active）：
- state set --node <id> --axis truth|progress|ledger|class --value <v> --reason <text> --owner <o> [--receipt <文件路径>] [--correction] [--kind meta] [--class <账务分类>]：直接置值；A2 校验与免表两例外见上表（违表消息附「set 现过 A2 校验（2026-08-15 裁定④）；确属纠错请加 --correction」）。`--kind meta` 建号时标账务/元节点（豁免 A1 的 a1-unmatched-account，此前 CLI 无入口；kind 不可改——已存在节点传 --kind = bad_args）；`--class` 为建号/补分类通道、与本次轴写入同事件留痕且**不改写已有分类**（重分类走 `--axis class`）；新建节点不带 class = class_required（只约束新建，存量含历史无 class 节点不受限、不追溯补分类）。
- state transition --node <id> --axis truth|progress|ledger|class --from <s> --to <t> --reason <text> --owner <o> [--receipt <文件路径>]：节点须已存在且 --from 等于该轴当前值（谎报 = transition_from_mismatch），再过迁移表（class 轴同表校验；七值互连，故重分类与同值放行）；违规输出诊断（from, to, axis, rule）。
- state evidence-add --node <id> --locator <文件:行号>：格式校验通过后按 process.cwd() 绝对化落账（旧相对锚仍被读方按 --root 解析，兼容读）；写边不校验文件存在/行界（lint 属读方 report/doctor）；落锚同时写锚行哈希（目标行 trim 后 sha256 前 12 hex → evidenceMeta[锚]={h,at}，行读取失败不阻断落锚=unhashed，重复落同锚刷新哈希）；已存在的锚（0.11.0 幂等）只刷新哈希并附 warning evidence_reblessed（**不重复插入数组**）——换锚请用 evidence-reanchor（移锚 ≠ 加持）；同文件 ±3 行近邻已有本节点锚时另附 warning evidence_near_duplicate（大概率想 reanchor 却用了 add）。
- state evidence-remove / state evidence-reanchor（0.6.0，一线实战反馈；前置与守卫见上表）：remove 回执 data = { node, removed, remaining }，history 记 kind='evidence-remove' 并同步关闭孤儿 evidenceMeta 键（见 §5），经 saveSidecar 走锁+CAS，A3 拦截的失败信封 data 附 lessonPrompt（B4）；reanchor 是 drifted 处置的规范路径（先验后改；**前置校验失败零写入**，保存失败按 commit 分层：可能已发布、持久性未知），回执 data = { node, from, to, hash }（hash=新锚目标行哈希，极端竞态下读取失败为 null=unhashed），幂等边界 = --from === --to 按刷新哈希处理（evidence 数组不动）、新锚已在数组（to≠from）按合并去重。
输出：{ node, axis, from, to, receipt }（set 的 receipt.rule 三态：A2=过表校验通过 / A2-init=初始化或首写免表 / A2-correction=纠错通道放行）；settle/block 输出 { node, from, to, receipt }（to 为双轴对象）。settle/import 成功回执另含 data.next（「销账五动作第4步：atlas-engine report --sidecar <本次调用实际 sidecar 路径> 生成销账回执」——补实战缺口 实战反馈档（2026-08-15）：该步曾整批漏做）与 data.lessonPrompt（B4 防膨胀回写提示），import 另带溯源字段（receipt.rule / provenance:'imported'）；A3 拦截的失败信封（settle/transition 的 verified_requires_evidence）同样在 data 附 lessonPrompt——以上均为纯增字段，非破坏。
history 写事件带 engine 版本；旧字段缺省仍兼容，详见 snapshot-policy §5.2。
state active：count/activeCount/nodes 执行口径不变；默认视图 = class∈活帐类（ACTIVE_CLASSES = task/debt/batch-gated/trigger-gated，lib/state-machine.mjs）且 progress∉{verified,cancelled}，无 class 的未完成节点单列 unclassified[] 并计入 count（附 warning unclassified_nodes，不静默漏出）。pendingSettlement={count,nodes} 另列 **progress=verified 且 ledger=backlog** 的待销账节点（不按 class 过滤；不等于全部可销账前态），条目 {id,className,progress,ledger,owner}，按 id 排序。

## 3. compile

用途：sidecar 状态合并进 archify spec（tag 注入 + meta.views 首章「当前焦点」）→ 产出可渲染 spec。注入面：architecture 族 components + lifecycle 族 states（0.6.1 起；图件 id → 账本节点走 lib/spec-id.mjs 单一解析：精确同名 / 既有归一化 / 节点 specRefs 认领，歧义不注入并计入 ambiguous；未解析到的条目保留作者 tag 不动，非精确命中的绑定记入 bindings 供审）。
输入：--diagram <archify-spec.json> --sidecar <atlas-state.json> --out <compiled.json> [--previous-receipt <上轮成功compile回执.json>]。
输出：{ out, sha256, injected: { tags, focus, bindings, ambiguous, ownedTags, outputPath, diagramName, unknownOwnership, note } }。ownedTags 按 collection/id 记录 written 与 original={present,value?}；outputPath 为绝对路径，diagramName 保留原图作用域。
语义（2026-08-15 负责人显示契约）：
- **完整+焦点双呈现**：tag = 执行轴标签（▶ 进行中 / ✅ 已验证 / ⛔ 阻塞 / ◐ 计划中 / ✕ 取消；仅 verified 且 ledger=settled 标为 ✅ 已销账）直接标在完整图节点上（components 与 states 同法，0.6.1 起 lifecycle 图账联动）；progress=in_progress 的节点进入 meta.views 首章「当前焦点（在途 n）」。
- 空焦点不发声章节（archify schema focus minItems=1；不造假焦点）；views 上限 5 截断。
约束：门禁仍由 gate 执行。初次以原 spec 重编；复用编译产物时显式提供上轮 schemaVersion=1 成功回执，输入须匹配其绝对输出路径与 JSON 序列化 SHA256，身份/所有权形状/重复键不符在写输出前拒绝。先恢复上轮拥有的标签，再按当前绑定重注入；保留作者标签缺失、空串与文本区别。无回执旧产物中的状态措辞不能证明归属：未绑定/歧义时保留并列入 unknownOwnership，提示回原 spec 重编。
自动留痕（2026-08-15 清单 B1，语义变化明示）：compile 原为只读命令，现运行后（成功与失败都记）默认向 --sidecar 追加一条 kind='command' 轨迹事件（detail={ command, params:{ diagram, sidecar, out }, result:{ injected, sha256 } }），CAS revision 随写推进；--no-trace 关闭（重复跑审计不想涨账时用）；留痕失败降级为 diagnostics 一条 severity=warning（rule=trace_degraded），主结果照出不阻断。

## 4. diff

subject 保留普通点分路径；字面反斜杠、点号、# 分别转义，空键用 \e，根用 #。同一路径数组与对象互换产生一条 changed（before/after 为完整子树），按路径段抑制其后代重复行；同类型空/非空沿用拍平 added/removed，数组仍按索引对齐。

用途：双 spec 差异 + 状态时间线。
子命令：
- diff spec --base <a.json> --head <b.json>：复用 archify Delta 语义（Before/Delta/After + 精确 ID）。
- diff state --sidecar <s.json> --since <version>：状态迁移时间线（谁在何时把什么改成了什么）。
输出（2026-08-15 按实测写实）：diff spec → { rows: [ { subject, kind: added|removed|changed, before, after } ], summary: { added, removed, changed } }；diff state → { count, since, rows }。不另设 receipt 字段：统一 JSON 信封（schemaVersion/command/status/data）本身即回执。
约束：差异行必须带确定性 ID（无 ID 无法对比的实体 = warning）。

## 5. evidence（已于 v0.10.0 移除）

**本命令已于 v0.10.0 按两段式废弃政策第二阶段物理移除**（0.9.0 标记 deprecated，存活一个 minor 周期后删除）。理由 = **功能重复**：locator lint 已被两侧覆盖——写时 state evidence-add 内嵌格式校验（§2，parseLocator 同款正则），读时 doctor evidence-resolvability 全量校验（§10）。替代路径 = state evidence-add（写）/ doctor（读）。调用现落入未知顶层命令处理：**exit 1 / rule=unknown_subcommand**。原 lint 规则码（bad_locator / line_out_of_bounds / file_missing / file_unreadable）由 state evidence-reanchor 写方校验与 report 证据 lint 读方路径继续发射，附录 A 保留；锚行哈希三态（broken/drifted/ok/unhashed）与锚质量 warning（anchor-empty-line / anchor-binary）语义不变，见 §10 与 snapshot-policy §5.2。移除理由与迁移指引入 RELEASES [0.10.0] Breaking 节。

## 6. report

用途：销账回执汇总（一刀的机器证据）。
输入：--slice <id>；聚合该切片的：图 diff 摘要、状态迁移清单、证据 lint 结果、外部验收器输出（可选 --verify-results <json>）；--spec <archify-spec.json>（可重复；传入即启用 A1 图码对账：声称对齐实相而无证据/证据失效 = error，账外/图外节点 = warning；未传 = 行为与无 A1 时完全一致）。图内节点 id 提取面：architecture 族 components + lifecycle 族 states（0.6.3 起，与 compile 同一解析入口解析图件 id → 账本节点）；--replay <节点id>（可重复，2026-08-15 清单 B2 replay 消费闭环）；--brief（2026-08-15 清单 A3 token 优化：只出计数摘要 + 全部 error 级诊断，见下）。
输出：{ slice, shas: { code, spec }, state_changes: n, evidence: { valid, invalid }, gate?: 对象, a1?: { checkedNodes, errors, warnings, nonClaims }, replays?: [...] }
--replay（B2）：data 增 replays 段，内联各节点 replayNode 时间线**摘要**——每节点最多最近 10 条事件（防 token 膨胀；超出注 truncated: true 与 total 总数），每条只留 at/kind/source/一行要点 summary；节点不存在 = 该条目带 error 字段，不整体失败。
--brief（A3，2026-08-15 清单）：data 只保留计数摘要 + 全部 error 级诊断，warning 级诊断与明细数组全文略去——nodes 降为节点数（receipts 计数 = state_changes 保留，状态迁移回执条数合计）、warnings 降为计数、errors 全文保留（诊断数组）、lessons 只留 { count }（规则数组略去）、shas/verify 略去；a1 小节仅计数且 nonClaims 降为条数（全文略去）；--replay 组合时 replays 每节点只出 { node, total }（未知节点带 error 不整体失败）。exit 码语义不变（error 仍 failed exit 1、纯 warning 仍 ok exit 0）；失败信封同样携带 brief 计数摘要（与成功路径同形）。与 --spec/--replay 可组合。
约束：缺失 sha = warning（不阻断）；HEAD 比对的 git 子进程受 ATLAS_GIT_TIMEOUT_MS（缺省 10000ms）约束，超时锚计入 evidenceHead.unchecked.timeout（未检查，verdict 不得为 verified）；no-git 免检按 evidenceHead.noGitReasons 计数（no-repo / git-unavailable:<code>）；**report 是证据读方，不采用写边纠错或同值豁免**。progress=verified 且无证据始终报 verified_requires_evidence；未传 --spec 时，其他完成声称（ledger=settled / truth∈{effective,closed}）无证据报 evidence_missing，完成声称携带坏锚报 evidence_unresolvable；传 --spec 时另按 A1 口径报 a1-missing-evidence / a1-evidence-broken，未声称对齐的 in_progress/blocked 无证据为 warning a1-weak-assertion。码义见附录 A。**存量清洗（0.17.0）**：ledger=settled 但 history 无 settle/import 事件为 warning import_unmarked（不阻断，与 --spec 无关）；历史导入事实用 state import，误直达用 state set --correction 修正，均须满足 §2 前态与守卫。
自动留痕（2026-08-15 清单 B1，语义变化明示）：report 原为只读命令，现运行后（成功与失败都记）默认向侧车追加一条 kind='command' 轨迹事件（detail={ command, params:{ slice, specs }, result:{ errors, warnings } }；--slice 传入时事件锚定该节点），CAS revision 随写推进；--no-trace 关闭；侧车缺失时 report 本身按原行为 failed（sidecar_missing），留痕保存失败（如 CAS 冲突/只读目录）降级为 diagnostics 一条 severity=warning（rule=trace_degraded），主结果照出不阻断。
A1 适用前提（2026-08-17 demo-b 治理型项目 holdout 对抗实验成文；适用边界，非缺陷）：A1 图账交叉（与 compile 注入同源，共用 §3 的单一解析入口：精确同名 / 既有归一化 / specRefs 认领，歧义不绑定）以**「图件 id 能解析到唯一账本节点」为前提**。在「图=结构实体、账=工作切片」的项目上（如治理型项目）该对应本身不成立——compile 注入 tags=0，d 项 a1-unmatched-account / a1-diagram-local-id 全为噪声。不满足时的处置建议：不传 --spec（停用 A1，行为与无 A1 完全一致），或建立 id 映射纪律（图节点与账节点同 id 命名）后再启用。
规则码按入口区分：本节 A1 图账核对码依赖 --spec；state spec-ref 的 spec_ref_not_found、state settle 的 a1-settle-unbound 不受此条件约束；verified_requires_evidence / evidence_missing / evidence_unresolvable 的 report 触发面见上述读方约束。完整码义、退出码与补救以**附录 A** 为正本，不按 a1- 前缀推断所有入口。
口径（report --spec）：正向面（账本节点→图）——已绑定者计 coverage.matched；未绑定但**已声明 class** 者计 classExempted（**豁免 ≠ matched**：只表示该节点不参与绑定核对，不代表已核对、已上图或已验证）；未绑定且未分类者报 a1-unmatched-account（kind='meta' 先跳过并计入 metaExempted，不算 unmatched）。反向面（图件 id→账本）——候选三源 = 精确同名、**既有归一化**（前缀/大小写，仅用于匹配、不改 id）、节点 specRefs 认领（限图 ref 在图名未知时不消解）；恰一个不同节点才绑定，多于一个不绑定并报 a1-ambiguous-id，三源皆未命中才报 a1-diagram-local-id（解析器见 lib/spec-id.mjs）。分母 = ledgerNodes - metaExempted，如实给数；nonClaims 与 a1 数据小节见下。
非账本实体声明（2026-09-11 P4）：report 读 `<侧车同目录>/diagram-nonaccounts.json`（形状 `{ schemaVersion, note?, nonAccounts: { <图名>: { ids: [...], reason } } }`），命中 id 计入 `a1.nonAccountDeclared` 且不再报 a1-diagram-local-id。与 `specRefs` 分工：**specRefs=某节点认领该图件 id**；**本声明=该图件 id 非账本实体**（架构构件/图内局部标签）。无文件或文件坏 = 空集（零破坏）。
a1 数据小节：{ specs, checkedNodes, specComponentIds, errors, warnings, metaExempted, classExempted, diagramLocalIds, nonAccountDeclared, nonClaims }；report 失败时 failed 信封仍携带 data.a1（不伪装成功）。
nonClaims（显式声明的机器不可判项）：truth 轴业务生效性需负责人回执；证据仅静态 lint（文件存在 + 行号在界），不验证证据内容与代码语义一致；锚行哈希只证行内容未变（ok/drifted 三态判定），不证行内容对节点声称的语义支撑（锁口② 2026-08-16）；图账交叉按 id 解析绑定（精确同名 / 既有归一化 / specRefs 认领），不判语义等价或别名；A1 图账交叉仅在图件 id 能解析到唯一账本节点时有信号（适用前提见上，0.7.0 增）；boundary/connection 拓扑正确性不在对账范围；meta 节点豁免图账交叉（仅 d 项，a/b/c 照查）。

## 7. gate

用途：串行三闸（archify validate → deliver → visual-check），全绿才过。
输入：--diagram <compiled.json> --out <out.html> [--sidecar <path>] [--no-trace]。**推荐落点（0.10.0，holdout #2 P0）**：--out 应落 `artifacts/<项目>/<模块>-<YYMMDD>/` 下；若 --out 父目录正好是某 atlas 的 `artifacts/<项目>/` 根（祖父目录名==artifacts 且图谱根下有 spec/<项目>/），gate 与 visual-check 生成物直落项目根会触发布局 P2（doctor --atlas 判 error——照官方快乐路径做会把自家 atlas 打成 failed）——gate 在写产物前判定该形状，回执 diagnostics 追加 warning 级诊断 **gate_out_placement**（消息给出建议路径 `artifacts/<项目>/<模块>-<YYMMDD>/`，日期取当天）；**不阻断、不改退出码、不自动移动文件**（移动用户指定的输出路径太越权）。
流程：调用 archify CLI（耦合基线 v2.14.0，doctor 机器探测实际版本并提示低于基线）依次执行；任一非零退出即停止并汇总诊断（0.14.0 起失败尾附内核结构化诊断与处置建议摘要——validate/deliver 解析 diagnostics[]，visual-check 解析子项状态，0.14.1 修正三闸声称）。 成功须 validate 非空 checks 逐项 ok=true、composition.status=pass/summary.errors=0；deliver 的 checkCount 为正安全整数、checksPassed 同值，compositionStatus=pass/errors=0，不钉死检查数量。visualReview 必须 pending，artifact 的 path/bytes/sha256 与本次交付一致；mtime 须在 deliver 启止窗口两端各容忍1秒内，过旧/未来都拒绝。
输出：{ validate: 回执, deliver: 回执, visual_check: 回执, final: "pass"|"fail" }；fail 信封 data 附 lessonPrompt（2026-08-15 清单 B4，纯增字段）。
约束：绝不宣称 pass 当任一闸非零；visual-check 收据的 visualReview 保持 pending（人工视觉复核不自动过关）。任一闸失败时回执 tail 必带可诊断消息（0.8.0 修复，holdout 遗留缺陷1：坏内核只盯 stdout → 冒号后空白）——子进程 **stdout 与 stderr 尾部**各截断（保尾部=最新错误行，合计 ≤900 字符，注记行计入预算）；**0.10.0 起（holdout #2 P2a）tail 生成时过滤不可打印字节**（保留 \n\t，其余非打印字符替换为 ·，并注明「已过滤 N 个不可打印字节」——二进制内核如 ARCHIFY_BIN=/bin/ls 实测 918 字符里 23% 是 ELF 不可打印字节），且**无条件附已解析路径与来源**（env/path/fallback/override，不再只在全空时提示）；两者皆空时明写「内核无输出（可能不是 archify 可执行文件），已解析路径=<source> → <路径>」，绝不给空白消息。
自动留痕（2026-08-15 清单 B1）：显式传入 --sidecar 时，运行后（成功与失败都记）向侧车追加一条 kind='command' 轨迹事件（detail={ command, params:{ diagram, out }, result:{ final, stage, gates } }）；不传 --sidecar 保持原行为（只读不留痕）；--no-trace 关闭；留痕失败降级为 diagnostics 一条 severity=warning（rule=trace_degraded），主结果照出不阻断。

## 8. trace（轨迹锚定，P3 增补）

用途：TraceEvent 入侧车 + anchors（event.node → Node.traceRefs 回指）。
子命令：trace add --kind tool_call|decision|diagram_diff|evidence|ruling|command --actor <name> [--note] [--node <id>]；trace list [--node <id>] [--since <ISO8601>]；trace replay --node <id> [--since <ISO8601>]。
输出：add → { event, anchors }；list → { count, events }；replay → { node, current, events }。
--since（A2，2026-08-15 清单，沿用 diff --since 先例补齐）：含边界（at == since 计入）截窗——list 过滤 trace 事件，replay 过滤**三源合并后**时间线（state+trace+lesson 合并排序后统一过滤）；缺省行为完全不变。
约束：kind 枚举硬校验；显式 node 须为账本自有节点，未知或继承属性返回 node_not_found 且零写入；锚定后回写 node.traceRefs。旧悬空轨迹仍可读。trace/replay/lessons recent 按可解析时间排序，等时稳定；无效旧时间置后按原文字典序排列；--since 格式非法（Date.parse 不可解析）= failed exit 1 rule=bad_args，消息带 ISO8601 示例（2026-08-15T00:00:00.000Z）。
kind='command' 与 detail（2026-08-15 清单 B1 增补）：gate/compile/report 三命令运行后（成败均记）自动追加 kind='command' 事件，携带可选 detail={ command, params, result } 结构化摘要；手动 trace add --kind command 同枚举合法。state set/transition/evidence-add/settle/block **不自动记 trace**——这些写入已有 history 账覆盖（replay 三源合并的 state 源），重复记 trace 会污染三源合并时间线；detail 字段为可选，旧事件无 detail 照常解析。
detail 引擎戳（2026-08-15 增长控制开发规范批一#1）：自动留痕（autoTrace，lib/cli-util.mjs）的 detail 增可选字段 engine=引擎版本号，标识该条轨迹由哪个引擎语义写出；手动 trace add 无 detail 不涉；旧事件无此字段照常解析（snapshot-policy §5.2 登记）。

## 9. lessons（经验池，P3 增补）

用途：经验条目入侧车（规则码 + 教训 + 来源锚点）。
子命令：lessons add --lesson <text> [--rule <code>] [--source <id>]；lessons retire --id <lesson-id>（2026-08-15 清单 D3）；lessons list [--recent <N>] [--rule <code>] [--all]。
约束：空 lesson 拒绝；开工必读纪律由 SKILL.md 承载（先 lessons list 再动手）。
hits 命中计数（2026-08-15 清单 B4 防膨胀）：条目可选字段 hits（新条目缺省 0，旧条目无此字段按 0 处理，向后兼容）；lessons list 输出每条带 hits。**写入口 lessons hit 子命令已于 v0.10.0 物理移除**（两段式废弃第二阶段：0.9.0 标记 → v0.10.0 删除；理由 = 0/49 采用率且无任何消费者——无门禁依赖、无报表依赖，实测口径见 docs/ADOPTION-BASELINE-2026-08-17.md；调用现 = exit 1 / rule=unknown_subcommand）——**hits 字段与既有数据保留为存量只读计数**，lib 层 hitLesson 保留供宿主程序调用；lessons retire 指向不存在条目 = failed（rule=lesson_not_found）。
status 生命周期（D3，2026-08-15 清单；与 D2 侧车 schema 政策配套）：条目可选字段 status ∈ { active, retired }——新条目 active，旧条目无此字段按 active 处理（与 hits 同模式向后兼容）；lessons retire 置 retired，**幂等**（已 retired 再 retire 仍成功，回执 data.item 含当前状态），未知 id = failed（rule=lesson_not_found）；lessons list **缺省只列 active**，--all 才含 retired。
A1 过滤（2026-08-15 清单）：lessons list --recent <N> 按 at 倒序取最近 N 条（--recent 非正整数 = failed exit 1 rule=bad_args，消息带示例）、--rule <code> 精确匹配 rule 字段、两者可组合（先 rule 过滤再按 at 倒序截取）；缺省行为不变（无 retired 条目时即全量）；回执 data 增 total（经验池全量条数，含 retired，D3）与 filtered 布尔（返回列表是否被截断/过滤，= lessons.length < total）供调用方判断截断。
输出：add → { item }；retire → { item }（含新 status）；list → { count, total, filtered, lessons }。

## 10. doctor（环境自检 + 可选布局校验 + --stats 派生度量）

用途：环境自检；--atlas 追加图谱布局校验（lib/layout.mjs 执行 atlas-layout.md 的机器可判定部分）。
输入：--sidecar <path>（可选）；--atlas <图谱目录>（可选）；--stats（2026-08-15 批二：账本侧派生度量，**必须显式同传 --sidecar**，缺 = bad_args exit 1——度量全部派生自侧车，无侧车无账可统计）。
检查项（error 级，任一不通过 = failed exit 1）：node>=18；archify-kernel（解析来源 source=env|path|fallback|none 随回执披露；none = fail-closed：本检查不通过、gate 停 archify-missing，绝不伪装成功；**0.8.0 增**：source=fallback 时 detail 附 warning 级提示「正在使用机器相关回退路径，建议设 ARCHIFY_BIN 使其可移植」——回退常量=本机便利默认、非契约的一部分，见 lib/resolve-archify.mjs 常量旁注释；提示不改 ok/exit 语义）；sidecar（可读性）；experience-pool（经验池条数，开工必读纪律）；--atlas 时追加 atlas-layout（error/warning 计数，明细在 data.layout.diagnostics；其中 P5 证据列为双形态 文件:行号 / git <sha>（2026-08-15 裁定①），SHA 存在性按 图谱目录 git 仓 → ATLAS_GIT_ROOT 解析根逐条校验，不在仓 = error p5-sha-broken，无根或 git 调用失败时不报噪音、unchecked 具名披露）。
--atlas 布局校验的版式识别（2026-08-15 负责人令，atlas-layout.md §〇；2026-08-16 v3 增量见 §〇-v3）：spec/ 下有一级子目录 = v2/v3 多项目版式——校验项目子目录结构、artifacts/<项目>/<模块>-<YYMMDD>/ 命名（模块-YYMMDD 正则）、INDEX 项目注册（P4 以项目为单位）；门户自 v3 起为两级 `<伞名>/<伞名>-<YYMMDD>/`（伞名 ^(.+)-add$，伞内只允许期目录：其它条目/期名前缀与伞名不符/期目录缺 index.html = error layout.portal；伞名项目段优先按 state/projects.json 注册表对齐，注册表缺失/未登记回退去掉 -add 后按最长项目边界前缀匹配；注册冲突则 layout.registry 警告，不在册 = error）；根下 v2 平铺门户 `<项目>-add-<YYMMDD>` = warning「v2 平铺门户已过时，建议迁入伞目录（见 atlas-layout v3）」不判 error（存量宽容；结构校验照跑：项目名不在册/缺 index.html 仍 error）；v1 平铺（文件直接在 spec/ 下）= **已废弃**——0.9.0 塌缩：只发一条 warning「v1 平铺版式已废弃，请迁移至 v3（见 atlas-layout §〇-v3）；其详细布局校验已于 v0.9.0 停止」并直接返回（不再跑整条校验链；保持 warning 级 exit 0 语义，不判死旧目录；符号链接垫片不计平铺违规、伞内符号链接同样跳过——此豁免对 v2/v3 照旧）；v1 旧校验链描述已入 RELEASES 0.9.0 前条目史实区。spec JSON 可解析性（0.10.0，holdout #2 P2c）：遍历 spec/<项目>/*.json 尝试 JSON.parse，失败 = **error layout.spec-unparsable**（指明文件与解析错误首行；只验可解析性，schema 校验属 archify validate / compile——坏 spec 不再活到 compile 才炸）；P6 节点前缀纪律（v2 账本隔离，warning 级）：节点 id 不以任何已知项目名前缀开头 = warning（项目名集合取自 spec/ 一级子目录名；diagram-* 元节点与 kind=meta 豁免）——需与 --sidecar 联动，显式给了才验，不给不报噪音；**0.10.0 起聚合封顶（holdout #2 P1）**：最多逐条列前 5 个节点 id，其余以计数汇总为一条（形如「另有 N 个节点同类，共 M 个」，与 emptyLine/binary 采样封顶风格一致）——此前逐条打印，306 个无前缀节点实测打出 306 条相同 warning。写路径硬门见错误码表 project_prefix_gate/seat_gate（0.13.0，注册表 opt-in：条目 sidecar 字段映射本侧车才激活；存量 grandfather）。freshness 观测分母独立取全部有效注册 sourcePath ∪ 锚仓 ∪ 显式仓，以绝对规范路径/realpath 去重并输出 path。同名仓分别观测；注册事实读取不推断授权。历史落点优先显式 atlas-<project> 文件名、映射项目、唯一项目或唯一 hint；歧义回退 basename 并披露 projectReason，不搬迁旧历史。
检查项（warning 级，2026-08-15 批二：ok:false **不使 exit 1**——数据债不阻断环境自检，理由：失效锚/大账本是积累的数据债，doctor 的职责是让环境可自检并给出提示，若数据债使 doctor 全红，环境自检本身被债阻断，债反而无人可查）：
- evidence-resolvability：遍历全部节点证据锚做三态解析（锁口② 2026-08-16 升级：lib/evidence.mjs anchorState；旧相对锚按 process.cwd() 解析）——broken（文件缺/行越界，语义不变）/ drifted（行都在但内容哈希不匹配）/ ok（哈希匹配）；无哈希锚=unhashed（存量，不算 drifted）。broken>0 或 drifted>0 时 ok:false：broken 附站位无关性提示「锚应为绝对路径，详见 report --spec 的 A1 对账」，drifted 附「锚内容已漂移，须复核后重新 evidence-add」——A1 a/b/c 规则不依赖 spec 却曾锁在 report --spec 之后，失效/漂移锚由此在日常操作面可闻。**0.8.0 增锚质量 warning（与三态正交叠加，皆 warning 级绝不升 error）**：目标行 trim 后为空计 emptyLine（规则码 anchor-empty-line）、文件疑似二进制（前 8KB 含 NUL）计 binary（规则码 anchor-binary）——任一 >0 同样使本检查 ok:false（仍 warning 级，不使 exit 1）；理由与形状语义见 §5「锚质量 warning」。data.evidenceResolvability = { total, ok, broken, drifted, unhashed, brokenNodes, driftedNodes, emptyLine, binary, emptyLineNodes, binaryNodes }（brokenNodes/driftedNodes/emptyLineNodes/binaryNodes = 失效/漂移/空行/二进制锚所在节点 id 各前 5 个，去重按遍历序）。
- 节点样例列表封顶（0.10.2）：brokenNodes / driftedNodes / emptyLineNodes / binaryNodes 均只逐条列前 5 个去重节点 id，
  **超出时消息补 P6 同式汇总**「另有 N 个节点同类，共 M 个；前 5 个已逐条列出」——修复前静默截断，一线据此误判为全量。
  结构字段形状不变（不新增计数字段：实害是读消息时误判，无已知结构化消费方，准入五问②拒）。
- ledger-size：侧车 >1MB 或 trace >1000 条（**默认阈值**）→ ok:false 并提示「考虑冷归档到 history/ 区」（仅提示，不自动动账——冷归档属人工决定）；当前字节数与 trace 条数入 detail。
  **阈值参数化（2026-09-11，编排线技术自决并留痕）**：`<侧车同目录>/ledger-size.json`（形状 `{ schemaVersion, maxBytes?, maxTraces?, rationale? }`）可覆盖默认阈值；无文件/坏文件/非法值 = 默认（零破坏）；detail 附 `来源=default|config`。立法依据（实测）：1.73MB 侧车 read 4.35ms + parse 2.77ms + write 1.68ms 约 8.8ms/轮，成本线性、无超线性拐点 ⇒ 1MB 是保守启发式而非性能拐点；且 nodes 段常占约半且**不可归档**（拆文件会破坏单一侧车 CAS 语义），单靠归档可能永远达不到 1MB。故由项目按实测定档并写明 rationale，而非把不可达阈值长期挂成常红警告。
输出：{ ok, checks: [...], evidenceResolvability?: {...}, stats?: {...}, layout?: { root, diagnostics }, unchecked?: [...] }
stats（--stats 时，data.stats，全部账本侧单源可算，杜绝手搓度量脚本）：{ nodes, ownedNodes（owner 非空的节点数；命名避让：「座位」保留给图账交叉语义，本字段测 owner 指派——2026-08-15 依 一线席位 A/B 报告改名，原名 seatedNodes 未及发布即废；图账交叉座次校验仍属 report --spec 的 A1 面，doctor 不做）, evidence: { total, absolute（文件部分 path.isAbsolute）, relative, hashed（携带锚行哈希的锚数，锁口② 2026-08-16；哈希是否匹配属 resolvability 三态不在此重复）}, truthAdvances（history 中 axis=truth 且 from→to 按 A2 迁移表为前进的事件数，lib/truth-receipt.mjs isTruthAdvance）, traceKinds（六 kind 全量计数，零值保留）, lessons: { total, active, retired, hits }, notices: { total }, attribution: { historyTotal, withBy, withEngine }, sidecarBytes, revision }。
约束：任一 error 级检查不通过 = status failed exit 1（failed 信封 diagnostics 只列 error 级不通过的检查；**0.7.0 起 failed 信封同时携带 data**——与成功路径同形，含 checks 全量与 data.layout.diagnostics 明细；此前失败路径丢 data，atlas-layout 明细自述「详见 data.layout.diagnostics」在失败时指向不存在位置，demo-b holdout 对抗实验缺陷2）；warning 级检查不通过不改变 exit 码（检查项仍在 data.checks 全量呈现，ok:false 可机器判读）；机器不可判定的规范条目逐条列入 unchecked 具名披露，不静默跳过。
archify 解析顺序（lib/resolve-archify.mjs）：ARCHIFY_BIN（存在于磁盘才算）→ PATH 上的 archify → 内置回退路径（existsSync 才算）→ none。

## 11. notice（席位间主动通知，2026-08-15 清单 B3）

用途：demo-harness 启示=通知是进 inbox 的一等数据非侧信道；补「共享账本+CAS=不互踩，但互相不知道」缺口——settle 后他席位不再等到下次 load 才知晓。
侧车 schema：根增可选 notices 数组（旧侧车缺省空，向后兼容，schemaVersion 保持 1；loadSidecar 缺省补 []，存在则必须为数组否则 sidecar_bad_shape）。条目形状：{ id, at, from, kind: settled|blocked|note, node, summary, readBy: [] }。
自动投递：state settle / state block 成功时同次写入自动追加一条（from=--owner 值，kind=settled|blocked，summary 取 --reason，readBy 初始空；不占额外 revision）；state import 同法投递 kind=settled 且 summary 带 [import] 前缀（与执行闭环可区分）。
子命令：
- notice list [--seat <名>] [--sidecar <path>]：缺省全量；带 --seat 只列 readBy 不含该席位的未读（回执 data 带 seat 与 unreadOnly: true）。
- notice ack --seat <名> [--id <notice-id>] [--sidecar <path>]：把该席位记入 readBy；无 --id=全部未读确认；幂等（已确认不重复计）；回执 { seat, confirmed（本次新确认数）, ids }。
- notice add --kind note --node <id> --summary <text> --from <名> [--sidecar <path>]：手动跨席位喊话；kind 硬校验只接受 note（settled|blocked 为 settle/block 自动投递专属，手动伪造 = bad_kind）。
输出：list → { count, notices }；ack → { seat, confirmed, ids }；add → { notice }。
约束：ack 缺 --seat = bad_seat；ack --id 指向不存在条目 = notice_not_found；空 summary 拒绝（empty_summary，与 empty_lesson 同例）；notice add 不校验 node 存在性（话题锚点不硬绑；trace add 的显式 node 则须存在）。revision 递增即触发他席位重读语义（B3 立案原义）。

## 附录 A 错误码（diagnostics.rule，2026-08-15 增补）

| 错误码 | 来源 | 退出码 | 语义与补救 |
| --- | --- | --- | --- |
| sidecar_conflict | store.mjs CAS：持锁重读磁盘 revision ≠ 待写 revision | 1 | 并发写被拦截；补救 = 重新 load 后在最新数据上重放变更再保存 |
| sidecar_locked | store.mjs 写锁超时（缺省 5000ms，可由环境变量 ATLAS_LOCK_TIMEOUT_MS 覆盖缺省值） | 1 | 另一席位持锁中；补救 = 等待/重试。**2026-09-15 起不再自动接管任何已有锁**（死 PID/超龄锁同样 fail-closed——零依赖环境无安全的跨平台「比较并删除他人锁」原语，TOCTOU 会误删活锁）：确认所有写者停止后人工删除锁文件 |
| sidecar_readonly | store.mjs 写前守卫（0.7.0，demo-b holdout 缺陷1）：目标侧车存在且无写权限——权限位无写位（root 等特权同样受判：保护意图先于 euid 豁免）或 accessSync W_OK 被拒（ACL/只读挂载等） | 1 | 只读=保护意图，fail-loud 拒写，文件内容与权限均未动（此前 tmp+rename 原子写只需目录写权限，会静默穿过并把权限重置为 umask）；补救 = 如确需写入请 chmod +w 解除保护后重试 |
| illegal_transition | state set/transition：轴值变更/迁移违反 A2 迁移表（set 路径自 2026-08-15 裁定④ 起生效，不再架空） | 1 | set 违表消息附「set 现过 A2 校验（2026-08-15 裁定④）；确属纠错请加 --correction」，纠正后 history 事件 corrected:true 留痕；transition 补救 = 沿合法路径逐级迁移，或经 set --correction 纠错 |
| transition_from_mismatch | state transition（2026-09-15）：--from 不等于节点当前轴值——前态必须如实申报，伪造 from 不得跳级（修复前只校 from/to 表内合法性，可从 planned 伪造 in_progress 直达 verified）；truth 缺失/null 按 candidate 比对（2026-09-18，与回执门禁同口径，存量节点不卡死） | 1 | 补救 = 先 state get 核对当前状态，from 填真实现值；纠错走 state set --correction |
| sidecar_bad_revision | store.mjs：revision 非非负整数 | 1（load 路径） | sidecar 数据损坏，fail-loud |
| unknown_template | init：--template 非 minimal\|demo | 1 | 未知模板不静默降级到缺省（用户输入校验失败，非 internal） |
| bad_spec | report：--spec 文件不可读或非 JSON | 1 | spec 输入坏 |
| receipt_required | state set/transition：truth 轴前进写入未携带 --receipt（--correction 不免除本门禁，2026-08-15 裁定④） | 1 | 真相轴推进需负责人本地回执文件（开发规范：Owner 真相需目标本地回执，机器不自证）；补救 = 补 --receipt <回执文件路径>（建议归位 <图谱目录>/rulings/receipts/，软约定） |
| receipt_not_found | state set/transition：--receipt 文件不存在 | 1 | 提供现存普通文件；机器不校验业务语义 |
| receipt_not_file | state set/transition：--receipt 不是普通文件（如目录） | 1 | 提供普通文件或指向它的链接 |
| receipt_unreadable | state set/transition：无法检查回执文件状态 | 1 | 检查文件权限/路径；不作为缺失回执放行 |
| p5-sha-broken | layout P5：git <sha> 证据列在解析出的 git 根（图谱目录自身仓或 ATLAS_GIT_ROOT）中不存在 | 1 | 提交级事实声称失效；补救 = 核对 SHA，或设 ATLAS_GIT_ROOT 指向含该提交的仓（无可用根时不报此码，改 unchecked 披露） |
| trace_degraded | gate/compile/report 自动留痕（B1）写侧车失败 | 不阻断（warning） | 留痕失败降级为 severity=warning 诊断附在主结果回执 diagnostics（含 ok 信封），主功能照出；补救 = 核对侧车可读可写/CAS 重试，或 --no-trace 显式关闭 |
| lesson_not_found | lessons retire：--id 指向的经验条目不存在 | 1 | 补救 = 先 lessons list 核对 id |
| bad_args | CLI 参数校验失败：trace list/replay --since 非 ISO8601（消息带示例）、lessons list --recent 非正整数、缺参数值/未知参数等通用参数错误 | 1 | 用户输入校验失败（非 internal）；补救 = 按消息修正参数 |
| bad_seat | notice ack：缺 --seat 或为空 | 1 | 确认语义具名到席位；补救 = 补 --seat <席位名> |
| notice_not_found | notice ack：--id 指向的通知条目不存在 | 1 | 补救 = 先 notice list 核对 id |
| unknown_axis | state set/transition：--axis 非 truth\|progress\|ledger\|class | 1 | 用户输入校验失败；补救 = 按消息修正 |
| invalid_state_value | state set：--value 不在该轴状态集 | 1 | 用户输入校验失败；补救 = 查该轴状态集 |
| invalid_node_id | state set/import（0.12.0，实战反馈档-2026-08-23）：新建节点 id 不合 ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$（修前管道符/换行可静默建号且无删除原语）；只拦新建，既存畸形 id 仍可读改（存量清理通道） | 1 | 用户输入校验失败；补救 = 换合法 id |
| project_prefix_gate | state set/import（0.13.0，负责人令 2026-08-27 L1 前缀硬门）：新建节点 id 不以本侧车项目前缀开头（激活条件 = 同目录 projects.json 条目 sidecar 字段映射本侧车；共享侧车取并集如 demo-a\|add；只拦新建，存量 grandfather，P6 doctor warning 继续管存量） | 1 | 越界拦截；补救 = 换 <项目名>- 前缀 id 或换正确 --sidecar |
| seat_gate | state set/transition/settle/block/import（0.13.0，L2 席位门）：--owner 不在映射条目 seats 并集（仅映射条目全部缺省 seats 时不限；显式数组保持并集语义，空数组可限制全部席位；sidecar 缺省不激活门禁） | 1 | 越权拦截；补救 = 用授权席位或经负责人扩 seats |
| invalid_from_state | state transition：--from 不在该轴状态集 | 1 | 用户输入校验失败；补救 = 沿合法状态迁移 |
| invalid_to_state | state transition：--to 不在该轴状态集 | 1 | 用户输入校验失败；补救 = 沿合法状态迁移 |
| node_not_found | state get/evidence-add/evidence-remove/evidence-reanchor/transition/settle/block、trace add/replay、report --replay：节点不存在或仅为继承属性 | 1 | 补救 = 核对节点 id；report 内联 replay 时该条带 error 字段，不整体失败 |
| owner_mismatch | state set/transition/settle/block/import：写入者非节点属主（A4 单一真相拥有者） | 1 | 补救 = 用属主 --owner 写 |
| already_settled | state settle/import：ledger 已是 settled 终态 | 1 | 幂等终态拒绝重复销账/重复导入 |
| bad_locator | state evidence-add/remove/reanchor、state import、report 证据 lint（读方）：locator 非严格 文件:行号（parseLocator 正则；全角冒号典型触发，处置见 DEFENSIVE.md §3） | 1 | 补救 = 改半角冒号/补行号 |
| locator_not_found | state evidence-remove/evidence-reanchor：指定锚（绝对化后）不在该节点 evidence 数组 | 1 | 补救 = 核对锚字符串（evidence-add 落账即绝对化，须传当初落账的同一形态，即同一 cwd 下的同一相对形态或绝对形态） |
| verified_requires_evidence | state set/transition/settle/evidence-remove（A3）：progress→verified 无证据（0.17.0 起 set 同责，init 首写不豁免）；或移除会使声称对齐节点（progress=verified / ledger=settled / truth∈{effective,closed}）失去全部证据 | 1 | 补救 = 先 state evidence-add；历史导入用 state import；或改用 state evidence-reanchor 原子替换（移除+追加单次写入，不出现零证据瞬间）；失败信封 data 附 lessonPrompt（B4） |
| settled_requires_event | state set/transition（A2 §2.4，0.17.0 路线一裁定；2026-09-15 起 transition 直达同拦）：ledger→settled 只能经 state settle（执行闭环）或 state import（历史导入）跨轴事件写入；同值原地写不拦 | 1 | 补救 = 执行闭环用 state settle；历史导入用 state import；确属纠错加 --correction（history corrected:true） |
| import_conflict | state import（0.17.0）：目标节点已有执行史（progress≠planned 或 ledger≠clean）——import 只登记新节点或零执行史节点的历史闭环 | 1 | 补救 = 执行闭环用 state settle；确需重登记先 --correction 修正轴值 |
| import_unmarked | report（0.17.0 存量清洗，常开不依赖 --spec）：节点 ledger=settled 但 history 无 settle/import 事件（存量直达赋值或手工写账遗存） | 不阻断（warning） | 补救 = 历史导入事实用 state import 补登事件；误直达用 state set --correction 修正 |
| cross_axis_unlisted | report（0.21.0，常开不依赖 --spec）：progress×ledger 组合不在 ADD-SPEC §2.4.1 表内（settled 而 progress≠verified / cancelled 而 ledger≠clean） | 不阻断（warning） | 补救 = state set --correction 修正一轴，或经 settle/import 事件；存量统计期不升 error |
| cancelled_requires_evidence | state set/transition（A3，2026-09-14）：progress→cancelled 无证据——取消是终态声明，须锚定被取代/退役依据 | 1 | 补救 = 先 state evidence-add 锚定取消理由（KB 页、审计报告、退役声明等） |
| unknown_subcommand | 未知顶层命令（bin 薄壳；**0.10.0 起**由 internal/exit 2 归位 exit 1——用户输入校验失败非内部错误，holdout #2 P2b）/ 各命令组未知子命令（如 state foo） | 1 | 用户输入校验失败；补救 = 看 --help |
| internal | bin/lib 未分类内部错误（顶层/命令级 catch） | 2 | 不伪装成功；修复 = 按 subject/evidence 定位代码缺陷 |
| bad_kind | trace add --kind 非枚举；notice add --kind 非 note（settled\|blocked 为 settle/block 自动投递专属） | 1 | 补救 = 按消息修正 |
| bad_input | compile：--diagram/--sidecar 读取或解析失败；diff spec --base/--head 读取失败 | 1 | 补救 = 提供合法 JSON |
| bad_verify | report：--verify 文件不可读或非 JSON | 1 | 补救 = 提供合法 JSON |
| atlas_exists | init：目标目录已存在 atlas-state.json | 1 | 拒绝覆盖（不破坏既有图谱）；补救 = 换目录 |
| empty_lesson | lessons add：--lesson 为空 | 1 | 补救 = 补教训文本 |
| empty_summary | notice add：--summary 为空 | 1 | 补救 = 补通知文本（与 empty_lesson 同例） |
| missing_code_sha | report：未传 --code-sha | 不阻断（warning） | 销账回执建议附代码 SHA |
| missing_spec_sha | report：未传 --spec-sha | 不阻断（warning） | 销账回执建议附图谱 SHA |
| line_out_of_bounds | state evidence-reanchor 写方校验、report 证据 lint（读方）：locator 行号超文件总行数 | 1 | 补救 = 核对行号 |
| file_missing | state evidence-reanchor 写方校验、report 证据 lint（读方）：locator 指向文件不存在 | 1 | 补救 = 核对路径/配 --root |
| file_unreadable | state evidence-reanchor 写方校验、report 证据 lint（读方）：locator 指向文件不可读 | 1 | 补救 = 检查权限 |
| evidence_lint_warnings | report：节点证据 lint 存在 warning 级诊断 | 不阻断（warning） | 明细随回执；补救 = 修证据或核对 --root |
| evidence_reblessed | state evidence-add（0.11.0）：锚已存在于该节点 → 本次为重新加持（刷新哈希），未重复添加 | 不阻断（warning） | 若意图是换锚而非加持，用 state evidence-reanchor --from/--to |
| evidence_near_duplicate | state evidence-add（0.12.0，实战反馈档-2026-08-23 P3-8）：同文件近邻（±3 行）已有本节点锚——大概率是想 reanchor 却用了 add；限本节点，跨节点不报 | 不阻断（warning） | 若意图是改锚，用 state evidence-reanchor |
| a1-missing-evidence | report --spec（A1）：节点声称对齐实相（progress=verified / ledger=settled / truth∈{effective,closed}）而证据数为 0 | 1 | 补救 = 先 state evidence-add（A3 配套） |
| a1-weak-assertion | report --spec（A1）：progress=in_progress\|blocked 且无证据（未声称对齐，降级警告） | 不阻断（warning） | 明细随回执 |
| a1-evidence-broken | report --spec（A1）：声称对齐节点携带失效 locator（图与码矛盾） | 1 | 补救 = 修复证据 locator |
| a1-evidence-drifted | report --spec（A1）：声称对齐节点携带漂移锚——行在界但内容哈希不匹配（锁口② 2026-08-16；图码矛盾未证实但复核义务成立） | 不阻断（warning） | 补救 = 复核目标行内容后重新 state evidence-add 钉新哈希；无哈希锚=unhashed 不发此码 |
| a1-unmatched-account | report --spec（A1）：侧车节点 id 不在任何已提供 spec（覆盖缺口；node.kind='meta' 豁免，豁免数计入 a1.metaExempted） | 不阻断（warning） | 非已证实矛盾 |
| a1-diagram-local-id | report --spec（A1）：spec 组件 id 无对应账本节点（归一化、specRefs 与非账本实体声明皆未命中；2026-09-10 起替代 a1-unaccounted-node） | 不阻断（warning） | 多为图内局部标签，非已证实矛盾；也可用 state/diagram-nonaccounts.json 显式声明 |
| a1-settle-unbound | state settle（P1 余项，2026-09-11）：销账回执 graphBinding.verdict=unbound 且节点未分类——结构性节点该上图 | 不阻断（warning） | 补救 = 补图同拍 / `state spec-ref` 认领 / 归入 `class` |
| spec_ref_not_found | state spec-ref --remove：ref 不在该节点 specRefs[]（A3 认领面） | 1 | 补救 = 核对已认领清单；追加时去掉 --remove（幂等） |
| anchor-empty-line | doctor evidence-resolvability（0.8.0，锚质量）：锚目标行 trim 后为空——空行无证据语义（:360 漂移教训） | 不阻断（warning） | 补救 = 复核后 state evidence-reanchor 改锚到实际内容行；写入边不拦截（lint 属读方，理由见 §5） |
| anchor-binary | doctor evidence-resolvability（0.8.0，锚质量）：锚目标文件疑似二进制（前 8KB 含 NUL 字节）——二进制无证据行语义 | 不阻断（warning） | 补救 = 改锚到可读证据行；写入边不拦截（lint 属读方，理由见 §5） |
| anchor_root_denied | state evidence-add/reanchor 写边（O1，2026-09-14 设计件 O1）：目标锚不在锚根白名单（白名单 = 侧车 atlas 根 ∪ projects.json 各 sourcePath ∪ <侧车同目录>/anchor-roots.json ∪ --allow-root；registry·config 来源过滤 dist/.next/临时目录/机外介质）；门为 opt-in——projects.json 与 anchor-roots.json 都不存在时不激活，自由侧车旧调用零硬 fail | 1 | 补救 = 把证据移到登记仓/atlas 根内，或 --allow-root <根>（单次）、anchor-roots.json（持久）；存量错根锚走 anchor-root-exemptions.json 一次性豁免（首跑生成） |
| anchor_root_grandfathered | state evidence-add/reanchor 写边（O1）：目标锚命中 <侧车同目录>/anchor-root-exemptions.json 的存量豁免条目——放行但发 warning（不追溯改写、不静默跳过） | 不阻断（warning） | 复核后 evidence-reanchor 回白名单内并删除该清单条目 |
| anchor_root_rejected | state evidence-add/reanchor 写边（O1）：--allow-root 传入的根被拒（非绝对路径已按 cwd 解析 / 根过大 / dist·.next 段）；仅对显式传入的根发声 | 不阻断（warning） | 改用合法的绝对根路径 |
| a3-head-mismatch | report / doctor（O2，2026-09-14 设计件 O2）：progress=verified 节点的锚在 git HEAD 存在但行内容与工作树不同，或 HEAD 版行数少于锚行号（锚所在仓取自己的 HEAD；no-git 仓不报） | report 1；doctor 不阻断（warning 级检查 head-anchor-consistency） | 不自动改锚：先把目标行提交到 HEAD，或 evidence-reanchor 到 HEAD 内已提交行 |
| a1-evidence-uncommitted | report / doctor（O2）：progress=verified 节点的锚指向不在 git HEAD 的文件（工作树-only，未提交且未被 .gitignore 排除）——未提交文件不得当「已对齐实相」的证据 | report 1；doctor 不阻断（warning 级） | 先 git add/commit 目标文件并重新 evidence-add 钉哈希，或改锚到 HEAD 内证据行；gitignored 生成物另计（不报本码） |
| class_required | state set（O3，2026-09-14 设计件 O3）：新建节点的首个写入未声明 class 轴（账务分类）——建号必填（只约束**新建**，存量含历史无 class 节点不受限，不追溯补分类） | 1 | 二选一：`--axis class --value <declared\|registry\|container\|task\|debt\|batch-gated\|trigger-gated>`，或在本次写入带 `--class <同类值>`（与轴写入同事件留痕，**不改写已有分类**——重分类走 --axis class） |
| unclassified_nodes | state active（O3）：本账存在无 class 轴且未完成的节点——它们单列在回执 unclassified[] 并计入 count，不再从默认活帐视图静默漏出 | 不阻断（warning） | 逐个 state set --axis class 补分类（新节点 O3 起建号即必填） |
| gate_out_placement | gate（0.10.0，holdout #2 P0）：--out 父目录正好是某 atlas 的 artifacts/<项目>/ 根（祖父目录名==artifacts 且图谱根下有 spec/<项目>/）——生成物直落项目根会触发布局 P2 | 不阻断（warning） | 附在 gate 回执 diagnostics（成败均附），消息给建议落点 artifacts/<项目>/<模块>-<YYMMDD>/（日期取当天）；不改退出码、不自动移动文件；补救 = --out 改落模块-日期目录 |
| layout.spec-unparsable | doctor --atlas 布局校验（0.10.0，holdout #2 P2c）：spec/<项目>/*.json 不可 JSON.parse | 1 | 坏 spec 不再活到 compile 才炸；补救 = 按消息指明的文件与解析错误首行修正 JSON 语法（schema 校验属 archify validate / compile） |
| sidecar_missing | store.mjs：侧车文件不存在——trace/lessons/notice 全子命令一律 failed（0.12.0 行为反转：此前成文「缺省空账本初始化不报此码」，实战隐藏 112 经验+59 通知整个战役周期；实战反馈档-2026-08-23 P0-1） | 1 | 补救 = 显式 --sidecar 指真实账本；新账本走 init；仅合法 state set 保留创世；state active/get/import 等其余子命令均报缺账 |
| sidecar_unreadable | store.mjs：侧车存在但不可读 | 1 | 补救 = 检查权限/占用 |
| sidecar_invalid_json | store.mjs：侧车非合法 JSON | 1 | fail-loud，不猜测修复；无双前缀原样呈现 |
| sidecar_bad_schema | store.mjs：侧车 schemaVersion 不兼容 | 1 | fail-loud |
| sidecar_bad_shape | store.mjs：侧车结构坏（如 notices 非数组） | 1 | fail-loud |
| sidecar_error | CLI 侧车读取兜底：store 抛错但 e.code 缺失 | 1 | 兜底码，正常不可达（store 错误均带自身码） |
| sidecar_write_failed | store.mjs：提交前底层写入失败（磁盘与调用对象均未推进、revision 回滚、tmp 清理）；与同档提交边界 sidecar_commit_unknown 同属保存失败分层 | 1 | 回执 data.commit.committed=false；按 causeCode/消息核对磁盘/权限/文件系统后重试 |
| sidecar_commit_unknown | store.mjs：rename 已发布但目录 fsync 失败或不支持——内容已提交、持久性未知，不伪装零写入 | 1 | 回执 data.commit={committed:true,revision,durability,path}；先重新 loadSidecar 读磁盘值再决定是否重跑 |
| sidecar_lock_failed | store.mjs：锁创建或锁内容写入失败（非 EEXIST）——未进入写阶段 | 1 | 核对目录可写/文件系统；残留锁须确认归属后人工删除 |
| sidecar_path_unresolvable | store.mjs：sidecar 路径为断链 symlink 或无法解析——不按「新账本」凭空回落 | 1 | 修复链接或显式传真实账本路径 |
| sidecar_hardlinked | store.mjs：sidecar 为硬链接（nlink>1）——无法保证跨路径单锁与发布边界，保守拒写 | 1 | 使用独立账本文件，或解除硬链接后统一真实路径 |
| gate_<stage> | gate：三闸（validate→deliver→visual_check）任一非零退出即停，rule=gate_<当前闸名>；图 spec 前置读取失败另见 gate_bad_diagram | 1 | 修复 = 按对应闸诊断处理；fail 信封 data 附 lessonPrompt（B4） |
| gate_bad_diagram | gate：--diagram 不可读或非合法 JSON（图型探测前置失败） | 1 | 修正 spec JSON 后重跑 |
| evidence_missing | report（默认面）与 state 完成声称守卫：声称对齐实相但证据数为 0（progress=verified 保持既有码 verified_requires_evidence） | 1 | 先 state evidence-add 绑定可解析证据；历史闭环用 state import |
| evidence_unresolvable | report（默认面）与 state set·transition·settle·import 完成声称守卫：证据锚存在但格式/文件/行界任一不可解析 | 1 | 修正路径/行号后重新 evidence-add，或 evidence-reanchor 到可解析锚 |
| a1-ambiguous-id | report --spec（A1）：图件 id 解析到多个账本节点——歧义不绑定 | 不阻断（warning） | 改名消歧，或 state spec-ref 图限定认领 |
| a1-nonaccounts-scope-unknown | report --spec（A1）：库调用未提供图名，nonAccounts 声明无法按图作用域解释——声明不生效且逐条披露 | 不阻断（warning） | 用 CLI（自动供图名）或改按图声明/认领 |
| anchor_roots_config_invalid | 写边锚根门禁配置（anchor-roots.json / anchor-root-exemptions.json）已存在但不可读、非 JSON 或形状不符——坏配置不解除门禁 | 1 | 修复或移走该配置文件后重试 |
| project_gate_config_invalid | state set/transition/settle/block/import（L1/L2 门）：projects.json 不可读/非 JSON/形状不符，或显式 sidecar 声明畸形、匹配条目的 project/seats 畸形——坏配置不解除门禁 | 1 | 修复或移走注册表后重试 |
注：store 错误码在 diagnostics.rule 原样呈现（load/save 无双前缀）；sidecar_conflict/sidecar_locked/sidecar_readonly 等可操作运行态以 failed/exit 1/自身码呈现（不落 internal/exit 2，测试 test/cli-error-codes.test.mjs）；退役码与旧语义史实在 RELEASES 相应版本释义。契约保鲜由 verify-contract-freshness 及所在仓 CI 所列检查机器执行。
