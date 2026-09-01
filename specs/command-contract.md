# 十命令接口契约 v1.0.0（P1 规范层）

> 原则：每个命令 = 纯函数 + JSON 回执；无交互提示；错误只输出诊断，不打印调用栈（对齐 archify 结构化修复回执哲学）。
> 十命令：init / state / diff / compile / report / gate / trace / lessons / notice / doctor（notice 为 2026-08-15 清单 B3 增补的第十一命令；evidence 顶层命令已于 v0.10.0 按两段式废弃政策第二阶段物理移除——见 §5 移除注记与 RELEASES [0.10.0]）。
> 统一回执信封：{ "schemaVersion": 1, "command": string, "status": "ok"|"failed", "data"?: object, "diagnostics"?: [ { "rule": string, "severity": "error"|"warning", "subject": string, "evidence": string, "supportedFixes": string[] } ] }
> 帮助文本（--help）由命令注册表单一来源生成：lib/commands.mjs 注册表 { name, usage, flags, run } 的 usage 字段拼装（D4 2026-08-15 重构；今后新增命令的帮助行与分发同处登记，防 help 与实现漂移复发）。
> 退出码：0=ok；1=failed（校验/约束失败）；2=内部错误（未分类，不得伪装成功）。

## 治理（增长控制开发规范批一#2/#4，2026-08-15）

**预算硬顶**：命令数 ≤ 11（当前 **10**——v0.10.0 移除 evidence 顶层命令后**腾出 1 个名额**；硬顶不随实数回落，理由：退役的目的是为增长让路（负责人 2026-08-17 令），若硬顶跟着降则等于永久冻结能力面，违反 Lehman 法则 6「功能内容须持续增长以维持适用性」。占用该名额仍须过能力准入五问 + 出具采用率基线，见 docs/ADOPTION-BASELINE-2026-08-17.md）；全仓唯一旗标总数 ≤ 50（当前 44；scripts/verify-contract-freshness.mjs 从注册表 flags 字段聚合统计，不 grep 文本）。超限 = 门禁 exit 1 并打印「预算超限=强制一次显式决定:提预算或退一个旗标」——加项必须显式换入，禁止静默膨胀。

**本体边界（负责人裁定 2026-08-17，前置于下列五问）**：ADD 的问题域 = **已开工、中后期失去进度掌控的项目**
（「开了头不知道如何收」）。**从零开始的项目不是本工具的场景**——这类工具已极多，兼顾会让本体累贅，
什么都做反而做不好。故 **第 0 问：这个能力服务的是「中后期项目重获进度掌控」，还是「更好地开一个新项目」？
后者一律拒**，不进入下列五问。

> 实据与重分类（同日实测）：空目录上 `init/doctor/state set/evidence-add/settle/evidence-reanchor` 全链其实跑得通
> （设计期以 ADR 为实相落锚，代码落地后 reanchor 转移）；但 init 种子图 `components: []` 过不了 archify 的
> `minItems: 1`、且 init 回执零指引。**按本边界，这不是缺陷而是场景外，不予修补**——显式记于此，
> 以免日后被当成未修债重新捡起（即 36-R1 查证里那类「假债」的反面防范）。

**能力准入五问**（过了第 0 问才问；新命令/新旗标/新能力入内核前逐条回答，任一不过即拒）：
1. 它是否改变「什么被判为真」？（是 = 内核变更，需裁定+版本+契约+测试四件套）
2. 不加它，现有命令+3 行 bash 能否组合达成？（能 = 拒进内核，落 scripts/）
3. 它新增侧车字段吗？（须登记 snapshot-policy §5.2+缺省兜底+旧引擎读行为写实）
4. 它需要三条注入通道同步吗？（须同批次改，否则不许合）
5. 它的失败模式是否 fail-loud 且能用 0/1/2 表达？

**废弃政策（两段式）**：标 deprecated（--help 标注 + 回执 warning 诊断——severity=warning 的 deprecated_command 诊断指明替代路径与移除版本，退出码与 data 不变）→ 存活一个 minor 周期 → 次 minor 删除，删除理由与替代路径入 RELEASES。首批已走完两段全程：evidence 顶层命令、lessons hit 子命令（0.9.0 标记 → v0.10.0 物理移除，deprecated_command 诊断码随之退役；理由与替代路径入 RELEASES [0.10.0] Breaking 节；判据与实测口径见 docs/ADOPTION-BASELINE-2026-08-17.md）。

**旗标白名单粒度**（批一#2）：注册表 flags 字段 = 唯一机器源（usage 给人看，flags 给机器查）；粒度 = 命令组统一并集（state/diff/trace/lessons/notice 的子命令共用命令组白名单）；一切 '--' 开头未登记旗标 = exit 1 bad_args，消息带未知旗标名 + 该命令合法旗标清单（含拼错，如 --sidcar）。

**注入文本行数预算**（2026-08-17，与命令/旗标预算同一治理精神，Sculley 死分支处方同源）：SKILL.md 核心纪律条目 ≤ 10 条、单条 ≤ 6 行——「防注入块无限膨胀」的自我约束；超出须先退役一条或经开发规范程序上调，禁止静默膨胀。

**规范/文档行数预算**（0.8.0 扩面，plan-tree 吸收补齐——同一治理精神从注入文本扩到规范与文档）：specs/ 单件 ≤ 250 行、docs/ 单件 ≤ 120 行；超出先拆或退役，不得静默膨胀。**本节不自报当前行数**——旧版记录必腐烂（这正是 Status rots，与文档测试数漂移同病）；要读数请现跑 `wc -l specs/*.md docs/*.md`。

**版本纪律（semver 判据，2026-08-17 成文——此前只存于 RELEASES 自引，督导指出后落位）**：

- **minor**（0.x.0）：错误码/退出码/旗标语义/迁移表/侧车结构 任一变更（含新增规则码入附录 A）；先例：0.4.0 增 a1-evidence-drifted、0.6.0 增 locator_not_found、0.8.0 增 anchor-empty-line/anchor-binary。
- **patch**（0.x.y）：纯增可选字段且有缺省兜底、纯纪律/文档增量；先例：0.3.1 codegraph 纪律、0.6.4 ready-check 纪律。
- **破坏性三定义**（见 RELEASES 头部）：(a) 拒绝了昨天接受的输入 (b) 改变既有字段/退出码语义 (c) 改变默认行为——任一命中即在 RELEASES 立 Breaking 节并如实标类型。

## 1. init

用途：新项目一键初始化 **v3 版式**图谱目录（atlas-layout.md §〇-v3：七区 + 项目一级子目录）+ 状态侧车 + INDEX.md（项目注册表）+ state/projects.json 机器可读项目注册表——init 产物零手工迁移直通 build-portal --project 与 doctor --atlas（0.7.0 修复 init↔portal 版式断链，demo-b holdout 对抗实验）。
输入：--dir 目标目录；--diagram-type architecture|workflow|sequence|dataflow|lifecycle；--title 图标题；--template minimal（缺省，只出骨架）|demo（额外播种 spec/<项目>/demo-map.json 演示图 + 侧车示例节点 demo-a progress=planned + INDEX 注册；未知模板名 = failed exit 1）。
项目名派生（0.7.0，零新旗标）：显式 --diagram-id 取其首段（第一个连字符前）；未给 --diagram-id 取 --dir 的 basename；清洗为 [a-z0-9-]（小写、非法字符折叠为单个连字符、去首尾连字符，与 build-portal slugify 同则）；派生为空 = failed exit 1 bad_args。派生结果随回执 data.project 返回（调用方可见）。
版式（v3）：七区（spec/artifacts/evidence/data/state/rulings/history）+ 项目一级子目录 spec/<项目>/、evidence/<项目>/、data/<项目>/、artifacts/<项目>/（模块目录 <模块>-<YYMMDD>/ 由交付/build-portal 流程按需建）；主 spec 落 spec/<项目>/<diagram-id>.json；INDEX.md 增项目注册表段；state/projects.json 写入注册条目 { project, umbrella: <项目>-add, sourcePath: null, firstSeen, portals: [] }。
输出：{ root, project, diagram_spec, state_sidecar, index, created, template }
约束：目标目录已存在 atlas-state.json 时拒绝（不覆盖）。

## 2. state

用途：节点状态读写与迁移。
子命令：
- state get --node <id>：读三轴当前值。
- state set --node <id> --axis truth|progress|ledger --value <v> [--receipt <文件路径>] [--correction]（truth 轴前进写入必填 --receipt，见下）：直接置值（须带 --reason 与 owner 校验）。A2 迁移表校验（2026-08-15 裁定④，set 不再架空 A2）：对已存在节点的轴值变更同样按 ADD-SPEC §二 迁移表校验，违表 = exit 1、与 transition 同码 rule=illegal_transition，消息附「set 现过 A2 校验（2026-08-15 裁定④）；确属纠错请加 --correction」；两例外免表直接写——(a) 初始化（节点不存在，或该轴尚无值=首次写），(b) 显式 --correction 纠错旗标（绕过 A2 表；仍必填 --reason；放行的 history 事件带 corrected:true 留痕，成功回执 receipt.rule=A2-correction）。同值写入（from==to，无变更）不触发校验。--correction 不免除 truth 回执门禁（前进仍必填 --receipt）；truth 回退经 --correction 放行且无需回执。
- state transition --node <id> --axis <axis> --from <s> --to <t> [--receipt <文件路径>]（truth 轴前进写入必填，见下）：按 ADD-SPEC §二 迁移表校验，违规输出诊断（from, to, axis, rule）。
- state evidence-add --node <id> --locator <文件:行号>：登记证据（A3 前提）。**同 locator 重复落锚幂等**（0.11.0，自嗜狗食发现）：
  已存在的锚只刷新 evidenceMeta 哈希（=「重新加持」，drifted 的规范补救），**不往 evidence 数组重复插入**，回执附 warning `evidence_reblessed` 明示；修复前会真重复插入，而 drifted 诊断消息自己写着「须复核后重新 evidence-add」——照官方推荐路径做每修一次漂移就塞一条重复锚。换锚请用 evidence-reanchor（语义不同：移锚而非加持）。**存储形态绝对化**（2026-08-15 批二）：格式校验（parseLocator 正则）通过后按 process.cwd() path.resolve 绝对化落账，已是绝对的原样；写边不校验文件存在/行界（lint 属读方——report/doctor，语义不变），旧相对锚仍被读方按 --root 解析（兼容读）。**落锚同时写锚行哈希**（锁口② 2026-08-16）：读目标行计算 trim 后内容 sha256 前 12 hex，写入节点 evidenceMeta[锚]={h, at}（可选增量字段，语义见 §5）；行读取失败不阻断落锚（哈希缺失=unhashed）；重复落同锚刷新哈希（复核后重新 evidence-add 即钉新内容）。
- state evidence-remove --node <id> --locator <锚>（0.6.0，一线席位 一线实战反馈）：移除该节点 evidence 数组中的指定锚——输入锚按 evidence-add 同法绝对化后匹配（落账形态=绝对，须传当初落账的同一形态）；不在数组 = failed exit 1 **locator_not_found**。成功：移除锚 + 同步删除 evidenceMeta 对应键（孤儿 meta 边界由此关闭，见 §5）+ history 记 kind='evidence-remove' 事件（含 locator），经 saveSidecar 走 CAS+锁；回执 data = { node, removed, remaining }。**A3 守卫**：节点声称对齐实相（progress=verified / ledger=settled / truth∈{effective,closed}，与 §6 A1 声称判定同语义）且移除后 evidence 长度归零 = failed exit 1 复用 **verified_requires_evidence**，消息写明「移除会使声称对齐节点失去全部证据（A3）；请先 evidence-add 新锚再移除，或用 evidence-reanchor 原子替换」；失败信封 data 附 lessonPrompt（B4 同模式）。
- state evidence-reanchor --node <id> --from <旧锚> --to <新锚>（0.6.0）：drifted 处置的规范路径——**原子改锚，先验后改，任何一步失败零写入**。①旧锚必须存在（绝对化匹配，否则 locator_not_found；格式坏 = bad_locator）；②新锚过 evidence-add 同款校验（格式 lint + 绝对化）再加**行存在（file_missing）/行界（line_out_of_bounds）lint**——比 evidence-add 写边更严，理由：改锚即 drifted 处置，新锚必须真实可解析，否则处置落空为 broken/unhashed；③一次 saveSidecar 内完成「移除旧锚（含其 evidenceMeta 键）+ 追加新锚（含新行哈希）」——**中途绝不出现证据为零的瞬间，故 A3 天然不受威胁，无需额外守卫**（设计理由：把移除+追加合并为单次 CAS 写入，若拆两步则中间态可被 A3 拦截/被他席位观察）；④history 记 kind='evidence-reanchor' 事件（含 from/to）。回执 data = { node, from, to, hash }（hash=新锚目标行哈希；极端竞态下读取失败为 null=unhashed）。幂等边界：--from === --to 时按刷新哈希处理（重读目标行钉新哈希与时间戳，evidence 数组不动，与 evidence-add 重复落锚同语义）；新锚已在 evidence 中（to≠from）视为合并去重（移除旧锚不重复追加，新锚哈希刷新）。
- state settle --node <id> --reason --owner：销账跨轴事件（progress in_progress→verified + ledger backlog→settled 同回执双写；A3 无证据拒绝；A4 owner 校验）。
- state block --node <id> --reason --owner [--with-backlog]：阻塞跨轴事件（progress in_progress→blocked；--with-backlog 时 ledger clean→backlog 双写）。
- settle/block 成功同次写入自动投递一条席位通知 notice（2026-08-15 清单 B3：from=--owner 值，kind=settled|blocked，summary=--reason，readBy 初始空，revision 只随该次保存推一次；详见 §11）。
输出：{ node, axis, from, to, receipt }（set 的 receipt.rule 三态：A2=过表校验通过 / A2-init=初始化或首写免表 / A2-correction=纠错通道放行；settle/block 输出 { node, from, to, receipt }（to 为双轴对象）。settle 成功回执另含 data.next = 「销账五动作第4步：atlas-engine report --sidecar <本次调用实际 sidecar 路径> 生成销账回执」（2026-08-15 实战反馈修补：销账五动作第 4 步 report 曾整批漏做，实战反馈档（2026-08-15）；纯增字段，非破坏）。settle 成功回执另含 data.lessonPrompt = 「本刀有无新教训？有则 lessons add 回写（S5a 欠账教训）」（2026-08-15 清单 B4 防膨胀回写提示）；A3 拦截失败回执（settle/transition 的 verified_requires_evidence）同样在 failed 信封 data 附带 lessonPrompt（与 data.next 同模式纯增字段）。
约束：transition 违反迁移表 = status failed + diagnostics；跨轴事件必须同回执双写；sidecar 首次使用（文件缺失）由 set 自动初始化空账本（仅限初始化语义）。set 违反迁移表 = status failed + diagnostics（rule=illegal_transition，消息带裁定④注记与 --correction 纠错出口，见上）。
truth 轴回执门禁（2026-08-15 负责人裁定，提案③；ADD-SPEC §2.5）：truth 前进写入（candidate→pending_confirmation→effective→closed 各步，含 set 跳级前进）必须 --receipt <负责人本地回执文件>；未给 = receipt_required，文件不存在 = receipt_not_found（诊断带解析后绝对路径）；存在则放行并把绝对路径落 history 事件 receipt 字段 + 节点 truthReceipts {to, receipt, at}；机器只校验存在性不校验语义。非 truth 轴与 truth 非前进写入传入 --receipt 一律忽略（语义完全不变）。
history 事件引擎戳（2026-08-15 增长控制开发规范批一#1）：state 写路径（set/evidence-add/transition/settle/block）每条 history 事件增可选字段 engine=引擎版本号（lib/version.mjs），标识该条账由哪个引擎语义写入；旧事件无此字段照常解析（snapshot-policy §5.2 登记）。

## 3. compile

用途：sidecar 状态合并进 archify spec（tag 注入 + meta.views 首章「当前焦点」）→ 产出可渲染 spec。注入面：architecture 族 components + lifecycle 族 states（0.6.1 起；图账同 id 约定 = 图中节点 id 即侧车节点 id，同名才注入；无同名节点的 state 保留作者 tag 不动）。
输入：--diagram <archify-spec.json> --sidecar <atlas-state.json> --out <compiled.json>。
输出：{ out, sha256, injected: { tags: n, focus: [ids] } }
语义（2026-08-15 负责人显示契约）：
- **完整+焦点双呈现**：tag = 执行轴标签（▶ 进行中 / ✅ 已销账 / ⛔ 阻塞 / ◐ 计划中 / ✕ 取消）直接标在完整图节点上（components 与 states 同法，0.6.1 起 lifecycle 图账联动）；progress=in_progress 的节点进入 meta.views 首章「当前焦点（在途 n）」。
- 空焦点不发声章节（archify schema focus minItems=1；不造假焦点）；views 上限 5 截断。
约束：输出必须通过 archify validate（gate 命令内校验）；sidecar 中引用不存在节点的状态 = failed + diagnostics。compile 幂等（tag/views 每次由 sidecar 全量重算）。
自动留痕（2026-08-15 清单 B1，语义变化明示）：compile 原为只读命令，现运行后（成功与失败都记）默认向 --sidecar 追加一条 kind='command' 轨迹事件（detail={ command, params:{ diagram, sidecar, out }, result:{ injected, sha256 } }），CAS revision 随写推进；--no-trace 关闭（重复跑审计不想涨账时用）；留痕失败降级为 diagnostics 一条 severity=warning（rule=trace_degraded），主结果照出不阻断。

## 4. diff

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
输入：--slice <id>；聚合该切片的：图 diff 摘要、状态迁移清单、证据 lint 结果、外部验收器输出（可选 --verify-results <json>）；--spec <archify-spec.json>（可重复；传入即启用 A1 图码对账：声称对齐实相而无证据/证据失效 = error，账外/图外节点 = warning；未传 = 行为与无 A1 时完全一致）。图内节点 id 提取面：architecture 族 components + lifecycle 族 states（0.6.3 起，图账同 id 约定与 compile 一致）；--replay <节点id>（可重复，2026-08-15 清单 B2 replay 消费闭环）；--brief（2026-08-15 清单 A3 token 优化：只出计数摘要 + 全部 error 级诊断，见下）。
输出：{ slice, shas: { code, spec }, state_changes: n, evidence: { valid, invalid }, gate?: 对象, a1?: { checkedNodes, errors, warnings, nonClaims }, replays?: [...] }
--replay（B2）：data 增 replays 段，内联各节点 replayNode 时间线**摘要**——每节点最多最近 10 条事件（防 token 膨胀；超出注 truncated: true 与 total 总数），每条只留 at/kind/source/一行要点 summary；节点不存在 = 该条目带 error 字段，不整体失败。
--brief（A3，2026-08-15 清单）：data 只保留计数摘要 + 全部 error 级诊断，warning 级诊断与明细数组全文略去——nodes 降为节点数（receipts 计数 = state_changes 保留，状态迁移回执条数合计）、warnings 降为计数、errors 全文保留（诊断数组）、lessons 只留 { count }（规则数组略去）、shas/verify 略去；a1 小节仅计数且 nonClaims 降为条数（全文略去）；--replay 组合时 replays 每节点只出 { node, total }（未知节点带 error 不整体失败）。exit 码语义不变（error 仍 failed exit 1、纯 warning 仍 ok exit 0）；失败信封同样携带 brief 计数摘要（与成功路径同形）。与 --spec/--replay 可组合。
约束：缺失 sha 或缺失证据 = warning（不阻断）；A3 违反而声称完成 = error。
自动留痕（2026-08-15 清单 B1，语义变化明示）：report 原为只读命令，现运行后（成功与失败都记）默认向侧车追加一条 kind='command' 轨迹事件（detail={ command, params:{ slice, specs }, result:{ errors, warnings } }；--slice 传入时事件锚定该节点），CAS revision 随写推进；--no-trace 关闭；侧车缺失时 report 本身按原行为 failed（sidecar_missing），留痕保存失败（如 CAS 冲突/只读目录）降级为 diagnostics 一条 severity=warning（rule=trace_degraded），主结果照出不阻断。
A1 适用前提（2026-08-17 demo-b 治理型项目 holdout 对抗实验成文；适用边界，非缺陷）：A1 图账交叉（与 compile 注入同源）以**「图节点 id 即侧车账节点 id」约定为前提**。在「图=结构实体、账=工作切片」的项目上（如治理型项目）该约定不成立——compile 注入 tags=0，d 项 a1-unmatched-account / a1-unaccounted-node 全为噪声。不满足时的处置建议：不传 --spec（停用 A1，行为与无 A1 完全一致），或建立 id 映射纪律（图节点与账节点同 id 命名）后再启用。
A1 对账规则码（六条，仅 --spec 传入时启用）：
- a1-missing-evidence（error）：节点声称对齐实相（progress=verified / ledger=settled / truth∈{effective,closed}）而证据数为 0。
- a1-weak-assertion（warning）：progress=in_progress|blocked 且无证据（未声称对齐，降级警告）。
- a1-evidence-broken（error）：声称对齐节点携带失效 locator（图与码矛盾）。
- a1-evidence-drifted（warning，锁口② 2026-08-16）：声称对齐节点携带漂移锚——行在界但内容哈希不匹配（图码矛盾未证实但复核义务成立；无哈希锚=unhashed 不发声，存量容忍；消息附「复核后重新 evidence-add 钉新哈希」；与 a1-evidence-broken 同仅对声称对齐节点发声）。
- a1-unmatched-account（warning）：侧车节点 id 不在任何已提供 spec 中（覆盖缺口，非已证实矛盾；node.kind='meta' 的账务/元节点跳过本检查，2026-08-15 裁定②，豁免数计入 a1.metaExempted）。
- a1-unaccounted-node（warning）：spec 组件 id 不在侧车账中（覆盖缺口，非已证实矛盾）。
a1 数据小节：{ specs, checkedNodes, specComponentIds, errors, warnings, metaExempted, nonClaims }；report 失败时 failed 信封仍携带 data.a1（不伪装成功）。
nonClaims（显式声明的机器不可判项）：truth 轴业务生效性需负责人回执；证据仅静态 lint（文件存在 + 行号在界），不验证证据内容与代码语义一致；锚行哈希只证行内容未变（ok/drifted 三态判定），不证行内容对节点声称的语义支撑（锁口② 2026-08-16）；图账交叉按 component/node id 精确匹配，不判语义等价或别名；A1 图账交叉仅在图账同 id 约定成立时有信号（适用前提见上，0.7.0 增）；boundary/connection 拓扑正确性不在对账范围；meta 节点豁免图账交叉（仅 d 项，a/b/c 照查）。

## 7. gate

用途：串行三闸（archify validate → deliver → visual-check），全绿才过。
输入：--diagram <compiled.json> --out <out.html> [--sidecar <path>] [--no-trace]。**推荐落点（0.10.0，holdout #2 P0）**：--out 应落 `artifacts/<项目>/<模块>-<YYMMDD>/` 下；若 --out 父目录正好是某 atlas 的 `artifacts/<项目>/` 根（祖父目录名==artifacts 且图谱根下有 spec/<项目>/），gate 与 visual-check 生成物直落项目根会触发布局 P2（doctor --atlas 判 error——照官方快乐路径做会把自家 atlas 打成 failed）——gate 在写产物前判定该形状，回执 diagnostics 追加 warning 级诊断 **gate_out_placement**（消息给出建议路径 `artifacts/<项目>/<模块>-<YYMMDD>/`，日期取当天）；**不阻断、不改退出码、不自动移动文件**（移动用户指定的输出路径太越权）。
流程：调用 archify CLI（耦合基线 v2.14.0，doctor 机器探测实际版本并提示低于基线）依次执行；任一非零退出即停止并汇总诊断（0.14.0 起失败尾附内核结构化诊断与处置建议摘要——validate/deliver 解析 diagnostics[]，visual-check 解析子项状态，0.14.1 修正三闸声称）。
输出：{ validate: 回执, deliver: 回执, visual_check: 回执, final: "pass"|"fail" }；fail 信封 data 附 lessonPrompt（2026-08-15 清单 B4，纯增字段）。
约束：绝不宣称 pass 当任一闸非零；visual-check 收据的 visualReview 保持 pending（人工视觉复核不自动过关）。任一闸失败时回执 tail 必带可诊断消息（0.8.0 修复，holdout 遗留缺陷1：坏内核只盯 stdout → 冒号后空白）——子进程 **stdout 与 stderr 尾部**各截断（保尾部=最新错误行，合计 ≤900 字符，注记行计入预算）；**0.10.0 起（holdout #2 P2a）tail 生成时过滤不可打印字节**（保留 \n\t，其余非打印字符替换为 ·，并注明「已过滤 N 个不可打印字节」——二进制内核如 ARCHIFY_BIN=/bin/ls 实测 918 字符里 23% 是 ELF 不可打印字节），且**无条件附已解析路径与来源**（env/path/fallback/override，不再只在全空时提示）；两者皆空时明写「内核无输出（可能不是 archify 可执行文件），已解析路径=<source> → <路径>」，绝不给空白消息。
自动留痕（2026-08-15 清单 B1）：显式传入 --sidecar 时，运行后（成功与失败都记）向侧车追加一条 kind='command' 轨迹事件（detail={ command, params:{ diagram, out }, result:{ final, stage, gates } }）；不传 --sidecar 保持原行为（只读不留痕）；--no-trace 关闭；留痕失败降级为 diagnostics 一条 severity=warning（rule=trace_degraded），主结果照出不阻断。

## 8. trace（轨迹锚定，P3 增补）

用途：TraceEvent 入侧车 + anchors（event.node → Node.traceRefs 回指）。
子命令：trace add --kind tool_call|decision|diagram_diff|evidence|ruling|command --actor <name> [--note] [--node <id>]；trace list [--node <id>] [--since <ISO8601>]；trace replay --node <id> [--since <ISO8601>]。
输出：add → { event, anchors }；list → { count, events }；replay → { node, current, events }。
--since（A2，2026-08-15 清单，沿用 diff --since 先例补齐）：含边界（at == since 计入）截窗——list 过滤 trace 事件，replay 过滤**三源合并后**时间线（state+trace+lesson 合并排序后统一过滤）；缺省行为完全不变。
约束：kind 枚举硬校验；node 锚定时回写 node.traceRefs（Ontology anchors 关系机器化）；--since 格式非法（Date.parse 不可解析）= failed exit 1 rule=bad_args，消息带 ISO8601 示例（2026-08-15T00:00:00.000Z）。
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
--atlas 布局校验的版式识别（2026-08-15 负责人令，atlas-layout.md §〇；2026-08-16 v3 增量见 §〇-v3）：spec/ 下有一级子目录 = v2/v3 多项目版式——校验项目子目录结构、artifacts/<项目>/<模块>-<YYMMDD>/ 命名（模块-YYMMDD 正则）、INDEX 项目注册（P4 以项目为单位）；门户自 v3 起为两级 `<伞名>/<伞名>-<YYMMDD>/`（伞名 ^(.+)-add$，伞内只允许期目录：其它条目/期名前缀与伞名不符/期目录缺 index.html = error layout.portal；伞名项目段优先按 state/projects.json 注册表对齐，注册表缺失/未登记回退去掉 -add 后首段/边界前缀匹配项目名，不在册 = error）；根下 v2 平铺门户 `<项目>-add-<YYMMDD>` = warning「v2 平铺门户已过时，建议迁入伞目录（见 atlas-layout v3）」不判 error（存量宽容；结构校验照跑：项目名不在册/缺 index.html 仍 error）；v1 平铺（文件直接在 spec/ 下）= **已废弃**——0.9.0 塌缩：只发一条 warning「v1 平铺版式已废弃，请迁移至 v3（见 atlas-layout §〇-v3）；其详细布局校验已于 v0.9.0 停止」并直接返回（不再跑整条校验链；保持 warning 级 exit 0 语义，不判死旧目录；符号链接垫片不计平铺违规、伞内符号链接同样跳过——此豁免对 v2/v3 照旧）；v1 旧校验链描述已入 RELEASES 0.9.0 前条目史实区。spec JSON 可解析性（0.10.0，holdout #2 P2c）：遍历 spec/<项目>/*.json 尝试 JSON.parse，失败 = **error layout.spec-unparsable**（指明文件与解析错误首行；只验可解析性，schema 校验属 archify validate / compile——坏 spec 不再活到 compile 才炸）；P6 节点前缀纪律（v2 账本隔离，warning 级）：节点 id 不以任何已知项目名前缀开头 = warning（项目名集合取自 spec/ 一级子目录名；diagram-* 元节点与 kind=meta 豁免）——需与 --sidecar 联动，显式给了才验，不给不报噪音；**0.10.0 起聚合封顶（holdout #2 P1）**：最多逐条列前 5 个节点 id，其余以计数汇总为一条（形如「另有 N 个节点同类，共 M 个」，与 emptyLine/binary 采样封顶风格一致）——此前逐条打印，306 个无前缀节点实测打出 306 条相同 warning。写路径硬门见错误码表 project_prefix_gate/seat_gate（0.13.0，注册表 opt-in：条目 sidecar 字段映射本侧车才激活；存量 grandfather）。
检查项（warning 级，2026-08-15 批二：ok:false **不使 exit 1**——数据债不阻断环境自检，理由：失效锚/大账本是积累的数据债，doctor 的职责是让环境可自检并给出提示，若数据债使 doctor 全红，环境自检本身被债阻断，债反而无人可查）：
- evidence-resolvability：遍历全部节点证据锚做三态解析（锁口② 2026-08-16 升级：lib/evidence.mjs anchorState；旧相对锚按 process.cwd() 解析）——broken（文件缺/行越界，语义不变）/ drifted（行都在但内容哈希不匹配）/ ok（哈希匹配）；无哈希锚=unhashed（存量，不算 drifted）。broken>0 或 drifted>0 时 ok:false：broken 附站位无关性提示「锚应为绝对路径，详见 report --spec 的 A1 对账」，drifted 附「锚内容已漂移，须复核后重新 evidence-add」——A1 a/b/c 规则不依赖 spec 却曾锁在 report --spec 之后，失效/漂移锚由此在日常操作面可闻。**0.8.0 增锚质量 warning（与三态正交叠加，皆 warning 级绝不升 error）**：目标行 trim 后为空计 emptyLine（规则码 anchor-empty-line）、文件疑似二进制（前 8KB 含 NUL）计 binary（规则码 anchor-binary）——任一 >0 同样使本检查 ok:false（仍 warning 级，不使 exit 1）；理由与形状语义见 §5「锚质量 warning」。data.evidenceResolvability = { total, ok, broken, drifted, unhashed, brokenNodes, driftedNodes, emptyLine, binary, emptyLineNodes, binaryNodes }（brokenNodes/driftedNodes/emptyLineNodes/binaryNodes = 失效/漂移/空行/二进制锚所在节点 id 各前 5 个，去重按遍历序）。
- 节点样例列表封顶（0.10.2）：brokenNodes / driftedNodes / emptyLineNodes / binaryNodes 均只逐条列前 5 个去重节点 id，
  **超出时消息补 P6 同式汇总**「另有 N 个节点同类，共 M 个；前 5 个已逐条列出」——修复前静默截断，一线据此误判为全量。
  结构字段形状不变（不新增计数字段：实害是读消息时误判，无已知结构化消费方，准入五问②拒）。
- ledger-size：侧车 >1MB 或 trace >1000 条 → ok:false 并提示「考虑冷归档到 history/ 区」（仅提示，不自动动账——冷归档属人工决定）；当前字节数与 trace 条数入 detail。
输出：{ ok, checks: [...], evidenceResolvability?: {...}, stats?: {...}, layout?: { root, diagnostics }, unchecked?: [...] }
stats（--stats 时，data.stats，全部账本侧单源可算，杜绝手搓度量脚本）：{ nodes, ownedNodes（owner 非空的节点数；命名避让：「座位」保留给图账交叉语义，本字段测 owner 指派——2026-08-15 依 一线席位 A/B 报告改名，原名 seatedNodes 未及发布即废；图账交叉座次校验仍属 report --spec 的 A1 面，doctor 不做）, evidence: { total, absolute（文件部分 path.isAbsolute）, relative, hashed（携带锚行哈希的锚数，锁口② 2026-08-16；哈希是否匹配属 resolvability 三态不在此重复）}, truthAdvances（history 中 axis=truth 且 from→to 按 A2 迁移表为前进的事件数，lib/truth-receipt.mjs isTruthAdvance）, traceKinds（六 kind 全量计数，零值保留）, lessons: { total, active, retired, hits }, notices: { total }, attribution: { historyTotal, withBy, withEngine }, sidecarBytes, revision }。
约束：任一 error 级检查不通过 = status failed exit 1（failed 信封 diagnostics 只列 error 级不通过的检查；**0.7.0 起 failed 信封同时携带 data**——与成功路径同形，含 checks 全量与 data.layout.diagnostics 明细；此前失败路径丢 data，atlas-layout 明细自述「详见 data.layout.diagnostics」在失败时指向不存在位置，demo-b holdout 对抗实验缺陷2）；warning 级检查不通过不改变 exit 码（检查项仍在 data.checks 全量呈现，ok:false 可机器判读）；机器不可判定的规范条目逐条列入 unchecked 具名披露，不静默跳过。
archify 解析顺序（lib/resolve-archify.mjs）：ARCHIFY_BIN（存在于磁盘才算）→ PATH 上的 archify → 内置回退路径（existsSync 才算）→ none。

## 11. notice（席位间主动通知，2026-08-15 清单 B3）

用途：demo-harness 启示=通知是进 inbox 的一等数据非侧信道；补「共享账本+CAS=不互踩，但互相不知道」缺口——settle 后他席位不再等到下次 load 才知晓。
侧车 schema：根增可选 notices 数组（旧侧车缺省空，向后兼容，schemaVersion 保持 1；loadSidecar 缺省补 []，存在则必须为数组否则 sidecar_bad_shape）。条目形状：{ id, at, from, kind: settled|blocked|note, node, summary, readBy: [] }。
自动投递：state settle / state block 成功时同次写入自动追加一条（from=--owner 值，kind=settled|blocked，summary 取 --reason，readBy 初始空；不占额外 revision）。
子命令：
- notice list [--seat <名>] [--sidecar <path>]：缺省全量；带 --seat 只列 readBy 不含该席位的未读（回执 data 带 seat 与 unreadOnly: true）。
- notice ack --seat <名> [--id <notice-id>] [--sidecar <path>]：把该席位记入 readBy；无 --id=全部未读确认；幂等（已确认不重复计）；回执 { seat, confirmed（本次新确认数）, ids }。
- notice add --kind note --node <id> --summary <text> --from <名> [--sidecar <path>]：手动跨席位喊话；kind 硬校验只接受 note（settled|blocked 为 settle/block 自动投递专属，手动伪造 = bad_kind）。
输出：list → { count, notices }；ack → { seat, confirmed, ids }；add → { notice }。
约束：ack 缺 --seat = bad_seat；ack --id 指向不存在条目 = notice_not_found；空 summary 拒绝（empty_summary，与 empty_lesson 同例）；notice add 不校验 node 存在性（与 trace add 同例：话题锚点不硬绑）。revision 递增即触发他席位重读语义（B3 立案原义）。

## 附录 A 错误码（diagnostics.rule，2026-08-15 增补）

| 错误码 | 来源 | 退出码 | 语义与补救 |
| --- | --- | --- | --- |
| sidecar_conflict | store.mjs CAS：持锁重读磁盘 revision ≠ 待写 revision | 1 | 并发写被拦截；补救 = 重新 load 后在最新数据上重放变更再保存 |
| sidecar_locked | store.mjs 写锁超时（缺省 5000ms，可由环境变量 ATLAS_LOCK_TIMEOUT_MS 覆盖缺省值；陈旧锁——持有进程 PID 死亡或锁龄 >30s——自动接管，不占此码） | 1 | 另一席位持锁中；补救 = 等待/重试。接管加固（2026-08-15）：锁内容增随机 token，接管闭环 = 判陈旧→unlink→O_EXCL 重抢→回读核对 token 一致才算持有；pid 复用残余风险下 30s 锁龄兜底为接受的有界风险 |
| sidecar_readonly | store.mjs 写前守卫（0.7.0，demo-b holdout 缺陷1）：目标侧车存在且无写权限——权限位无写位（root 等特权同样受判：保护意图先于 euid 豁免）或 accessSync W_OK 被拒（ACL/只读挂载等） | 1 | 只读=保护意图，fail-loud 拒写，文件内容与权限均未动（此前 tmp+rename 原子写只需目录写权限，会静默穿过并把权限重置为 umask）；补救 = 如确需写入请 chmod +w 解除保护后重试 |
| illegal_transition | state set/transition：轴值变更/迁移违反 A2 迁移表（set 路径自 2026-08-15 裁定④ 起生效，不再架空） | 1 | set 违表消息附「set 现过 A2 校验（2026-08-15 裁定④）；确属纠错请加 --correction」，纠正后 history 事件 corrected:true 留痕；transition 补救 = 沿合法路径逐级迁移，或经 set --correction 纠错 |
| sidecar_bad_revision | store.mjs：revision 非非负整数 | 1（load 路径） | sidecar 数据损坏，fail-loud |
| unknown_template | init：--template 非 minimal\|demo | 1 | 未知模板不静默降级到缺省（用户输入校验失败，非 internal） |
| bad_spec | report：--spec 文件不可读或非 JSON | 1 | spec 输入坏 |
| receipt_required | state set/transition：truth 轴前进写入未携带 --receipt（--correction 不免除本门禁，2026-08-15 裁定④） | 1 | 真相轴推进需负责人本地回执文件（开发规范：Owner 真相需目标本地回执，机器不自证）；补救 = 补 --receipt <回执文件路径>（建议归位 <图谱目录>/rulings/receipts/，软约定） |
| receipt_not_found | state set/transition：--receipt 指向的文件不存在 | 1 | 补救 = 提供已存在的回执文件（诊断 subject 为解析后绝对路径）；机器只校验存在性，语义属负责人 |
| p5-sha-broken | layout P5：git <sha> 证据列在解析出的 git 根（图谱目录自身仓或 ATLAS_GIT_ROOT）中不存在 | 1 | 提交级事实声称失效；补救 = 核对 SHA，或设 ATLAS_GIT_ROOT 指向含该提交的仓（无可用根时不报此码，改 unchecked 披露） |
| trace_degraded | gate/compile/report 自动留痕（B1）写侧车失败 | 不阻断（warning） | 留痕失败降级为 severity=warning 诊断附在主结果回执 diagnostics（含 ok 信封），主功能照出；补救 = 核对侧车可读可写/CAS 重试，或 --no-trace 显式关闭 |
| lesson_not_found | lessons retire：--id 指向的经验条目不存在 | 1 | 补救 = 先 lessons list 核对 id |
| bad_args | CLI 参数校验失败：trace list/replay --since 非 ISO8601（消息带示例）、lessons list --recent 非正整数、缺参数值/未知参数等通用参数错误 | 1 | 用户输入校验失败（非 internal）；补救 = 按消息修正参数 |
| bad_seat | notice ack：缺 --seat 或为空 | 1 | 确认语义具名到席位；补救 = 补 --seat <席位名> |
| notice_not_found | notice ack：--id 指向的通知条目不存在 | 1 | 补救 = 先 notice list 核对 id |
| unknown_axis | state set/transition：--axis 非 truth\|progress\|ledger | 1 | 用户输入校验失败；补救 = 按消息修正 |
| invalid_state_value | state set：--value 不在该轴状态集 | 1 | 用户输入校验失败；补救 = 查该轴状态集 |
| invalid_node_id | state set（0.12.0，实战反馈档-2026-08-23）：新建节点 id 不合 ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$（修前管道符/换行可静默建号且无删除原语）；只拦新建，既存畸形 id 仍可读改（存量清理通道） | 1 | 用户输入校验失败；补救 = 换合法 id |
| project_prefix_gate | state set（0.13.0，负责人令 2026-08-27 L1 前缀硬门）：新建节点 id 不以本侧车项目前缀开头（激活条件 = 同目录 projects.json 条目 sidecar 字段映射本侧车；共享侧车取并集如 demo-a\|add；只拦新建，存量 grandfather，P6 doctor warning 继续管存量） | 1 | 越界拦截；补救 = 换 <项目名>- 前缀 id 或换正确 --sidecar |
| seat_gate | state set/transition/settle/block（0.13.0，L2 席位门）：--owner 不在映射条目 seats 并集（条目无 seats = 不限；注册表 opt-in 渐进启用） | 1 | 越权拦截；补救 = 用授权席位或经负责人扩 seats |
| invalid_from_state | state transition：--from 不在该轴状态集 | 1 | 用户输入校验失败；补救 = 沿合法状态迁移 |
| invalid_to_state | state transition：--to 不在该轴状态集 | 1 | 用户输入校验失败；补救 = 沿合法状态迁移 |
| node_not_found | state get/evidence-add/evidence-remove/evidence-reanchor/transition/settle/block、trace replay、report --replay：节点不存在 | 1 | 补救 = 核对节点 id；report 内联 replay 时该条带 error 字段，不整体失败 |
| owner_mismatch | state set/transition/settle/block：写入者非节点属主（A4 单一真相拥有者） | 1 | 补救 = 用属主 --owner 写 |
| already_settled | state settle：ledger 已是 settled 终态 | 1 | 幂等终态拒绝重复销账 |
| bad_locator | state evidence-add/remove/reanchor、report 证据 lint（读方）：locator 非严格 文件:行号（parseLocator 正则；全角冒号典型触发，处置见 DEFENSIVE.md §3） | 1 | 补救 = 改半角冒号/补行号 |
| locator_not_found | state evidence-remove/evidence-reanchor：指定锚（绝对化后）不在该节点 evidence 数组 | 1 | 补救 = 核对锚字符串（evidence-add 落账即绝对化，须传当初落账的同一形态，即同一 cwd 下的同一相对形态或绝对形态） |
| verified_requires_evidence | state transition/settle/evidence-remove（A3）：progress→verified 无证据；或移除会使声称对齐节点（progress=verified / ledger=settled / truth∈{effective,closed}）失去全部证据 | 1 | 补救 = 先 state evidence-add；或改用 state evidence-reanchor 原子替换（移除+追加单次写入，不出现零证据瞬间）；失败信封 data 附 lessonPrompt（B4） |
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
| a1-unaccounted-node | report --spec（A1）：spec 组件 id 不在侧车账中 | 不阻断（warning） | 非已证实矛盾 |
| anchor-empty-line | doctor evidence-resolvability（0.8.0，锚质量）：锚目标行 trim 后为空——空行无证据语义（:360 漂移教训） | 不阻断（warning） | 补救 = 复核后 state evidence-reanchor 改锚到实际内容行；写入边不拦截（lint 属读方，理由见 §5） |
| anchor-binary | doctor evidence-resolvability（0.8.0，锚质量）：锚目标文件疑似二进制（前 8KB 含 NUL 字节）——二进制无证据行语义 | 不阻断（warning） | 补救 = 改锚到可读证据行；写入边不拦截（lint 属读方，理由见 §5） |
| gate_out_placement | gate（0.10.0，holdout #2 P0）：--out 父目录正好是某 atlas 的 artifacts/<项目>/ 根（祖父目录名==artifacts 且图谱根下有 spec/<项目>/）——生成物直落项目根会触发布局 P2 | 不阻断（warning） | 附在 gate 回执 diagnostics（成败均附），消息给建议落点 artifacts/<项目>/<模块>-<YYMMDD>/（日期取当天）；不改退出码、不自动移动文件；补救 = --out 改落模块-日期目录 |
| layout.spec-unparsable | doctor --atlas 布局校验（0.10.0，holdout #2 P2c）：spec/<项目>/*.json 不可 JSON.parse | 1 | 坏 spec 不再活到 compile 才炸；补救 = 按消息指明的文件与解析错误首行修正 JSON 语法（schema 校验属 archify validate / compile） |
| sidecar_missing | store.mjs：侧车文件不存在——trace/lessons/notice 全子命令一律 failed（0.12.0 行为反转：此前成文「缺省空账本初始化不报此码」，实战隐藏 112 经验+59 通知整个战役周期；实战反馈档-2026-08-23 P0-1） | 1 | 补救 = 显式 --sidecar 指真实账本；新账本走 init；state set 保留 :68 成文创世语义（仅 set，非附件命令） |
| sidecar_unreadable | store.mjs：侧车存在但不可读 | 1 | 补救 = 检查权限/占用 |
| sidecar_invalid_json | store.mjs：侧车非合法 JSON | 1 | fail-loud，不猜测修复；无双前缀原样呈现 |
| sidecar_bad_schema | store.mjs：侧车 schemaVersion 不兼容 | 1 | fail-loud |
| sidecar_bad_shape | store.mjs：侧车结构坏（如 notices 非数组） | 1 | fail-loud |
| sidecar_error | CLI 侧车读取兜底：store 抛错但 e.code 缺失 | 1 | 兜底码，正常不可达（store 错误均带自身码） |
| gate_<stage> | gate：三闸（validate→deliver→visual_check）任一非零退出即停，rule=gate_<当前闸名> | 1 | 修复 = 按对应闸诊断处理；fail 信封 data 附 lessonPrompt（B4） |

注（2026-08-15 增补；双前缀/吞码两缺陷修复后实况，替代旧「实测披露」）：store 错误码在 diagnostics.rule 原样呈现——load 路径与 save 路径均无二次前缀（如 rule=sidecar_invalid_json，非 sidecar_sidecar_invalid_json）；sidecar_conflict / sidecar_locked / sidecar_readonly（0.7.0 增）属可操作运行态，由 CLI 以 status failed、exit 1、rule=自身错误码呈现（不再落入 internal/exit 2）。测试：test/cli-error-codes.test.mjs。
退役码史实（0.10.0）：deprecated_command（两段式废弃第一阶段提示码）与 bad_file（evidence lint --file 专用）随 evidence 顶层命令/lessons hit 子命令移除而不再有发射方，本表同批清理——旧回执数据中的该两码按本 RELEASES/0.9.0 条目释义。
unknown_template 曾用 exit 2，与总纲「2=内部错误」存在归类张力；已按总纲推导归位 exit 1（2026-08-15）：未知模板名是用户输入校验失败，非内部错误。
契约保鲜门禁（2026-08-15 D6）：scripts/verify-contract-freshness.mjs 对账 --help ↔ 本文档章节、代码字面错误码 ↔ 附录 A 表——代码有而附录缺 = exit 1 列名清单（新增码必须同步入表），附录有而代码无 = warning 不阻断（历史码宽容）；gate_<stage> 为模板行不参与字面量反向核对。
注入通道门禁（2026-08-16，门禁五件→六件；0.11.3 增第七件 scripts/verify-size-budgets.mjs——本节所有行数预算此前零门禁，写了不执行=不存在，现机器执行）：仓内两通道由 verify-injection-freshness 咬着，部署侧仓外注入块（<宿主注入块> 等，路径四级解析 --path > ADD_DEPLOY_INJECTION 环境变量 > 已知候选存在即取 > 无）由 scripts/verify-deploy-injection.mjs 对账——CORE_TERMS ∪ DEPLOY_TERMS（公共词表 scripts/injection-terms.mjs，新增纪律块必须去登记否则门禁不咬）+ 注册表命令名（现十条）逐一词界必含；部署文件在引擎仓外、CI runner 上不存在 → exit 0 skipped 优雅跳过（CI 上不假红；对账真实战场是本地部署机）；harness 专属候选路径只落 scripts/ 适配器层，lib/ 内核不知 harness 存在。
