// 错误码注册表（diagnostics.rule 唯一源；减法批二，命令面单源化）。
// 契约附录 A 由本表经 scripts/sync-generated.mjs 生成——新增/改码只改这里，然后跑同步脚本。
// 字段：code = diagnostics.rule；exit = 退出码（原表文字，含「不阻断（warning）」等）；source = 发射位置；remedy = 语义与补救。
// diag() 是唯一诊断构造器：未登记码构造即抛错（测试先红；生产 = 顶层 catch exit 2），不可能悄悄进回执。
// 含 <…> 的码为模板行：gate_<stage> / layout.<rule> 放行同前缀任意非空后缀；P<n> 放行前缀 + 纯数字。

export const ERROR_CODES = Object.freeze([
  { code: 'sidecar_conflict', source: 'store.mjs CAS：持锁重读的文件存在性或 revision 与预期不同；缺失不等于现存 revision=0', exit: '1', remedy: '并发写被拦截；补救 = 重新 load 后在最新数据上重放变更再保存' },
  { code: 'sidecar_locked', source: 'store.mjs 写锁超时（缺省 5000ms，可由环境变量 ATLAS_LOCK_TIMEOUT_MS 覆盖缺省值）', exit: '1', remedy: '另一席位持锁中；补救 = 等待/重试。**2026-09-15 起不再自动接管任何已有锁**（死 PID/超龄锁同样 fail-closed——零依赖环境无安全的跨平台「比较并删除他人锁」原语，TOCTOU 会误删活锁）：确认所有写者停止后人工删除锁文件' },
  { code: 'sidecar_readonly', source: 'store.mjs 写前守卫（0.7.0，demo-b holdout 缺陷1）：目标侧车存在且无写权限——权限位无写位（root 等特权同样受判：保护意图先于 euid 豁免）或 accessSync W_OK 被拒（ACL/只读挂载等）', exit: '1', remedy: '只读=保护意图，fail-loud 拒写，文件内容与权限均未动（此前 tmp+rename 原子写只需目录写权限，会静默穿过并把权限重置为 umask）；补救 = 如确需写入请 chmod +w 解除保护后重试' },
  { code: 'illegal_transition', source: 'state set/transition：违反 A2 迁移表；set 只校验轴值变更，transition 同值仍须有表内自环（三轴无，class 有）', exit: '1', remedy: 'set 违表消息附「set 现过 A2 校验（2026-08-15 裁定④）；确属纠错请加 --correction」，纠正后 history 事件 corrected:true 留痕；transition 补救 = 沿合法路径逐级迁移，或经 set --correction 纠错' },
  { code: 'transition_from_mismatch', source: 'state transition（2026-09-15）：--from 不等于节点当前轴值——前态必须如实申报，伪造 from 不得跳级（修复前只校 from/to 表内合法性，可从 planned 伪造 in_progress 直达 verified）；truth 缺失/null 按 candidate 比对（2026-09-18，与回执门禁同口径，存量节点不卡死）', exit: '1', remedy: '补救 = 先 state get 核对当前状态，from 填真实现值；纠错走 state set --correction' },
  { code: 'sidecar_bad_revision', source: 'store.mjs：revision 非非负整数', exit: '1（load 路径）', remedy: 'sidecar 数据损坏，fail-loud' },
  { code: 'unknown_template', source: 'init：--template 非 minimal\\|demo', exit: '1', remedy: '未知模板不静默降级到缺省（用户输入校验失败，非 internal）' },
  { code: 'bad_spec', source: 'report：--spec 文件不可读或非 JSON', exit: '1', remedy: 'spec 输入坏' },
  { code: 'receipt_required', source: 'state set/transition：truth 轴前进写入未携带 --receipt（--correction 不免除本门禁，2026-08-15 裁定④）', exit: '1', remedy: '真相轴推进需负责人本地回执文件（开发规范：Owner 真相需目标本地回执，机器不自证）；补救 = 补 --receipt <回执文件路径>（建议归位 <图谱目录>/rulings/receipts/，软约定）' },
  { code: 'receipt_not_found', source: 'state set/transition：--receipt 文件不存在', exit: '1', remedy: '提供现存普通文件；机器不校验业务语义' },
  { code: 'receipt_not_file', source: 'state set/transition：--receipt 不是普通文件（如目录）', exit: '1', remedy: '提供普通文件或指向它的链接' },
  { code: 'receipt_unreadable', source: 'state set/transition：无法检查回执文件状态', exit: '1', remedy: '检查文件权限/路径；不作为缺失回执放行' },
  { code: 'p5-sha-broken', source: 'layout P5：git <sha> 证据列在解析出的 git 根（图谱目录自身仓或 ATLAS_GIT_ROOT）中不存在', exit: '1', remedy: '提交级事实声称失效；补救 = 核对 SHA，或设 ATLAS_GIT_ROOT 指向含该提交的仓（无可用根时不报此码，改 unchecked 披露）' },
  { code: 'trace_degraded', source: 'gate/compile/report 自动留痕（B1）写侧车失败', exit: '不阻断（warning）', remedy: '留痕失败降级为 severity=warning 诊断附在主结果回执 diagnostics（含 ok 信封），主功能照出；补救 = 核对侧车可读可写/CAS 重试，或 --no-trace 显式关闭' },
  { code: 'lesson_not_found', source: 'lessons retire：--id 指向的经验条目不存在', exit: '1', remedy: '补救 = 先 lessons list 核对 id' },
  { code: 'bad_args', source: 'CLI 参数校验失败：trace list/replay --since 非 ISO8601（消息带示例）、lessons list --recent 非正整数、缺参数值/未知参数等通用参数错误；state 非 set 子命令传 --correction（0.22.0，ADD-SPEC §2.4.2 纠错唯一入口）', exit: '1', remedy: '用户输入校验失败（非 internal）；补救 = 按消息修正参数' },
  { code: 'bad_seat', source: 'notice ack：缺 --seat 或为空', exit: '1', remedy: '确认语义具名到席位；补救 = 补 --seat <席位名>' },
  { code: 'notice_not_found', source: 'notice ack：--id 指向的通知条目不存在', exit: '1', remedy: '补救 = 先 notice list 核对 id' },
  { code: 'unknown_axis', source: 'state set/transition：--axis 非 truth\\|progress\\|ledger\\|class', exit: '1', remedy: '用户输入校验失败；补救 = 按消息修正' },
  { code: 'invalid_state_value', source: 'state set：--value 不在该轴状态集', exit: '1', remedy: '用户输入校验失败；补救 = 查该轴状态集' },
  { code: 'invalid_node_id', source: 'state set/import（0.12.0，实战反馈档-2026-08-23）：新建节点 id 不合 ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$（修前管道符/换行可静默建号且无删除原语）；只拦新建，既存畸形 id 仍可读改（存量清理通道）', exit: '1', remedy: '用户输入校验失败；补救 = 换合法 id' },
  { code: 'project_prefix_gate', source: 'state set/import（0.13.0，负责人令 2026-08-27 L1 前缀硬门）：新建节点 id 不以本侧车项目前缀开头（激活条件 = 同目录 projects.json 条目 sidecar 字段映射本侧车；共享侧车取并集如 demo-a\\|add；只拦新建，存量 grandfather，P6 doctor warning 继续管存量）', exit: '1', remedy: '越界拦截；补救 = 换 <项目名>- 前缀 id 或换正确 --sidecar' },
  { code: 'seat_gate', source: 'state set/transition/settle/block/import（0.13.0，L2 席位门）：--owner 不在映射条目 seats 并集（仅映射条目全部缺省 seats 时不限；显式数组保持并集语义，空数组可限制全部席位；sidecar 缺省不激活门禁）', exit: '1', remedy: '越权拦截；补救 = 用授权席位或经负责人扩 seats' },
  { code: 'invalid_from_state', source: 'state transition：--from 不在该轴状态集', exit: '1', remedy: '用户输入校验失败；补救 = 沿合法状态迁移' },
  { code: 'invalid_to_state', source: 'state transition：--to 不在该轴状态集', exit: '1', remedy: '用户输入校验失败；补救 = 沿合法状态迁移' },
  { code: 'node_not_found', source: 'state get/evidence-add/evidence-remove/evidence-reanchor/transition/settle/block、trace add/replay、report --replay：节点不存在或仅为继承属性', exit: '1', remedy: '补救 = 核对节点 id；report 内联 replay 时该条带 error 字段，不整体失败' },
  { code: 'owner_mismatch', source: 'state set/transition/settle/block/import：写入者非节点属主（A4 单一真相拥有者）', exit: '1', remedy: '补救 = 用属主 --owner 写' },
  { code: 'already_settled', source: 'state settle/import：ledger 已是 settled 终态', exit: '1', remedy: '幂等终态拒绝重复销账/重复导入' },
  { code: 'bad_locator', source: 'state evidence-add/remove/reanchor、state import、report 证据 lint（读方）：locator 非严格 文件:行号（parseLocator 正则；全角冒号典型触发，处置见 DEFENSIVE.md §3）', exit: '1', remedy: '补救 = 改半角冒号/补行号' },
  { code: 'locator_not_found', source: 'state evidence-remove/evidence-reanchor：指定锚（绝对化后）不在该节点 evidence 数组', exit: '1', remedy: '补救 = 核对锚字符串（evidence-add 落账即绝对化，须传当初落账的同一形态，即同一 cwd 下的同一相对形态或绝对形态）' },
  { code: 'verified_requires_evidence', source: 'state set/transition/settle/evidence-remove（A3）：progress→verified 或 ledger→settled 无证据（0.17.0 起 set 同责，init 首写不豁免；0.22.0 起 --correction 不豁免，S 族）；或移除会使声称对齐节点（progress=verified / ledger=settled / truth∈{effective,closed}）失去全部证据', exit: '1', remedy: '补救 = 先 state evidence-add；历史导入用 state import；或改用 state evidence-reanchor 原子替换（移除+追加单次写入，不出现零证据瞬间）；失败信封 data 附 lessonPrompt（B4）' },
  { code: 'settled_requires_event', source: 'state set/transition（A2 §2.4，0.17.0 路线一裁定；2026-09-15 起 transition 直达同拦）：ledger→settled 只能经 state settle（执行闭环）或 state import（历史导入）跨轴事件写入；同值原地写不拦', exit: '1', remedy: '补救 = 执行闭环用 state settle；历史导入用 state import；确属纠错用 state set --correction（P 族可豁免；写后仍须 progress=verified 且证据非空可解析，history 记 corrected:true + waivedRules）' },
  { code: 'import_conflict', source: 'state import（0.17.0）：目标节点已有执行史（progress≠planned 或 ledger≠clean）——import 只登记新节点或零执行史节点的历史闭环', exit: '1', remedy: '补救 = 执行闭环用 state settle；确需重登记先 --correction 修正轴值' },
  { code: 'import_unmarked', source: 'report（0.17.0 存量清洗，常开不依赖 --spec）：节点 ledger=settled 但 history 无 settle/import 事件（存量直达赋值或手工写账遗存）', exit: '不阻断（warning）', remedy: '补救 = 历史导入事实用 state import 补登事件；误直达用 state set --correction 修正' },
  { code: 'cross_axis_unlisted', source: 'report（0.21.0，常开不依赖 --spec）：progress×ledger 组合不在 ADD-SPEC §2.4.1 表内（settled 而 progress≠verified / cancelled 而 ledger≠clean）', exit: '不阻断（warning）', remedy: '补救 = state set --correction 把一轴修回表内（每步写后须在表内，ADD-SPEC §2.4.2 可达性保证），或经 settle/import 事件；0.22.0 起两半边写边均拦且不可纠错，本码只剩存量观测' },
  { code: 'cancelled_requires_clean', source: 'state set/transition（A2 §2.4.1 S 族；0.21.2 起组合判定，0.22.0 起不可纠错）：写入改动 progress/ledger 且写后组合为 progress=cancelled × ledger≠clean 即拒（双方向：带欠账取消、cancelled 节点反向挂账；truth/class 等无关轴补记不冻结存量孤儿）——取消的欠账此后无事件可销', exit: '1', remedy: '补救 = 先 state set --axis ledger --value clean --correction 核销欠账（backlog→clean 违表属 P 族可豁免，留痕）再取消' },
  { code: 'settled_requires_verified', source: 'state set/transition/block（A2 §2.4.1 S 族）：写入改动 progress/ledger 且写后 ledger=settled × progress≠verified 即拒，--correction 不豁免', exit: '1', remedy: '补救 = 执行闭环用 state settle、历史导入用 state import；纠错须先使 progress=verified（带证据）再 set ledger --correction' },
  { code: 'cancelled_requires_evidence', source: 'state set/transition（A3，2026-09-14）：progress→cancelled 无证据——取消是终态声明，须锚定被取代/退役依据；--correction 不豁免（S 族，0.22.0，含 init 首写）', exit: '1', remedy: '补救 = 先 state evidence-add 锚定取消理由（KB 页、审计报告、退役声明等）' },
  { code: 'unknown_subcommand', source: '未知顶层命令（bin 薄壳；**0.10.0 起**由 internal/exit 2 归位 exit 1——用户输入校验失败非内部错误，holdout #2 P2b）/ 各命令组未知子命令（如 state foo）', exit: '1', remedy: '用户输入校验失败；补救 = 看 --help' },
  { code: 'internal', source: 'bin/lib 未分类内部错误（顶层/命令级 catch）', exit: '2', remedy: '不伪装成功；修复 = 按 subject/evidence 定位代码缺陷' },
  { code: 'bad_kind', source: 'trace add --kind 非枚举；notice add --kind 非 note（settled\\|blocked 为 settle/block 自动投递专属）', exit: '1', remedy: '补救 = 按消息修正' },
  { code: 'bad_input', source: 'compile：diagram/sidecar/previous-receipt 读取、解析、回执身份失败，或 out 与读输入同物理路径/inode；diff spec 输入读取失败', exit: '1', remedy: '提供合法 JSON 与匹配的 compile 回执；compile 用独立输出路径，不覆盖任何读输入' },
  { code: 'bad_verify', source: 'report：--verify 文件不可读或非 JSON', exit: '1', remedy: '补救 = 提供合法 JSON' },
  { code: 'atlas_exists', source: 'init：任一计划输出（INDEX/spec/sidecar/projects/裁定）已占用，含预检后竞争占位', exit: '1', remedy: '拒绝覆盖（不破坏既有图谱）；补救 = 换目录或处理已占用输出，已有非冲突目录可复用' },
  { code: 'empty_lesson', source: 'lessons add：--lesson 为空', exit: '1', remedy: '补救 = 补教训文本' },
  { code: 'empty_summary', source: 'notice add：--summary 为空', exit: '1', remedy: '补救 = 补通知文本（与 empty_lesson 同例）' },
  { code: 'missing_code_sha', source: 'report：未传 --code-sha', exit: '不阻断（warning）', remedy: '销账回执建议附代码 SHA' },
  { code: 'missing_spec_sha', source: 'report：未传 --spec-sha', exit: '不阻断（warning）', remedy: '销账回执建议附图谱 SHA' },
  { code: 'line_out_of_bounds', source: 'state evidence-reanchor 写方校验、report 证据 lint（读方）：locator 行号超文件总行数', exit: '1', remedy: '补救 = 核对行号' },
  { code: 'file_missing', source: 'state evidence-reanchor 写方校验、report 证据 lint（读方）：locator 指向文件不存在', exit: '1', remedy: '补救 = 核对路径/配 --root' },
  { code: 'file_unreadable', source: 'state evidence-reanchor 写方校验、report 证据 lint（读方）：locator 指向文件不可读', exit: '1', remedy: '补救 = 检查权限' },
  { code: 'evidence_lint_warnings', source: 'report：节点证据 lint 存在 warning 级诊断', exit: '不阻断（warning）', remedy: '明细随回执；补救 = 修证据或核对 --root' },
  { code: 'evidence_reblessed', source: 'state evidence-add（0.11.0）：锚已存在于该节点 → 本次为重新加持（刷新哈希），未重复添加', exit: '不阻断（warning）', remedy: '若意图是换锚而非加持，用 state evidence-reanchor --from/--to' },
  { code: 'evidence_near_duplicate', source: 'state evidence-add（0.12.0，实战反馈档-2026-08-23 P3-8）：同文件近邻（±3 行）已有本节点锚——大概率是想 reanchor 却用了 add；限本节点，跨节点不报', exit: '不阻断（warning）', remedy: '若意图是改锚，用 state evidence-reanchor' },
  { code: 'a1-missing-evidence', source: 'report --spec（A1）：节点声称对齐实相（progress=verified / ledger=settled / truth∈{effective,closed}）而证据数为 0', exit: '1', remedy: '补救 = 先 state evidence-add（A3 配套）' },
  { code: 'a1-weak-assertion', source: 'report --spec（A1）：progress=in_progress\\|blocked 且无证据（未声称对齐，降级警告）', exit: '不阻断（warning）', remedy: '明细随回执' },
  { code: 'a1-evidence-broken', source: 'report --spec（A1）：声称对齐节点携带失效 locator（图与码矛盾）', exit: '1', remedy: '补救 = 修复证据 locator' },
  { code: 'a1-evidence-drifted', source: 'report --spec（A1）：声称对齐节点携带漂移锚——行在界但内容哈希不匹配（锁口② 2026-08-16；图码矛盾未证实但复核义务成立）', exit: '不阻断（warning）', remedy: '补救 = 复核目标行内容后重新 state evidence-add 钉新哈希；无哈希锚=unhashed 不发此码' },
  { code: 'a1-unmatched-account', source: 'report --spec（A1）：侧车节点 id 不在任何已提供 spec（覆盖缺口；node.kind=\'meta\' 豁免，豁免数计入 a1.metaExempted）', exit: '不阻断（warning）', remedy: '非已证实矛盾' },
  { code: 'a1-diagram-local-id', source: 'report --spec（A1）：spec 组件 id 无对应账本节点（归一化、specRefs 与非账本实体声明皆未命中；2026-09-10 起替代 a1-unaccounted-node）', exit: '不阻断（warning）', remedy: '多为图内局部标签，非已证实矛盾；也可用 state/diagram-nonaccounts.json 显式声明' },
  { code: 'a1-settle-unbound', source: 'state settle（P1 余项，2026-09-11）：销账回执 graphBinding.verdict=unbound 且节点未分类——结构性节点该上图', exit: '不阻断（warning）', remedy: '补救 = 补图同拍 / `state spec-ref` 认领 / 归入 `class`' },
  { code: 'spec_ref_not_found', source: 'state spec-ref --remove：ref 不在该节点 specRefs[]（A3 认领面）', exit: '1', remedy: '补救 = 核对已认领清单；追加时去掉 --remove（幂等）' },
  { code: 'anchor-empty-line', source: 'doctor evidence-resolvability（0.8.0，锚质量）：锚目标行 trim 后为空——空行无证据语义（:360 漂移教训）', exit: '不阻断（warning）', remedy: '补救 = 复核后 state evidence-reanchor 改锚到实际内容行；写入边不拦截（lint 属读方，理由见 §5）' },
  { code: 'anchor-binary', source: 'doctor evidence-resolvability（0.8.0，锚质量）：锚目标文件疑似二进制（前 8KB 含 NUL 字节）——二进制无证据行语义', exit: '不阻断（warning）', remedy: '补救 = 改锚到可读证据行；写入边不拦截（lint 属读方，理由见 §5）' },
  { code: 'anchor_root_denied', source: 'state 落锚及完成声称写边（O1）：真实目标不在白名单或身份无法解析；白名单=atlas 根∪projects.json sourcePath∪anchor-roots.json∪本条 --allow-root；registry/config 过滤 dist/.next/临时目录/机外介质。projects.json 与 anchor-roots.json 都不存在时不激活', exit: '1', remedy: '把证据移到登记仓/atlas 根内，或本条显式 --allow-root（不继承旧命令授权）；修复悬空/环状链接。合法存量按 anchor-root-exemptions.json 豁免，不豁免不可解析身份' },
  { code: 'anchor_root_grandfathered', source: 'state 落锚及完成声称写边（O1）：真实目标命中 anchor-root-exemptions.json 合法存量豁免——放行但发 warning；同目录共享 entries，ledgers[canonical 侧车文件名]={at,receipt} 按账本一次快照（含零条），旧无 ledgers 文件逐账补扫且保留旧条目，每个本账根外存量路径逐条 warning，后续写账失败亦披露；已标记账本不再扫描或重写。维持现有同步文件写入与同目录单写者使用前提；本刀不抽象通用存储、不另建共享锁、不承诺并发两账快照的去重/不丢更新，也不承诺断电原子性。保存错误沿现有失败路径报告，不用成功结果遮掩。测试和正式迁移串行操作同一目录；不同目录互不共享文件。侧车锁不保护共享清单，快照与侧车不是跨文件事务；升级回退不删标记或重新生成清单', exit: '不阻断（warning）', remedy: '复核后 evidence-reanchor 回白名单内并删除该清单条目；不清空 ledgers 强制重扫，不扩大根绕门' },
  { code: 'anchor_root_rejected', source: 'state 锚根检查（O1）：本条 --allow-root 被拒（根过大、dist/.next 段或物理身份无法解析）；相对根先按 cwd 解析', exit: '不阻断（warning）', remedy: '改用合法、可解析的根路径' },
  { code: 'a3-head-mismatch', source: 'report / doctor（O2）：verified 节点证据行与真实目标文件所在仓 HEAD 不同，或 HEAD 行界不足；链接路径不能制造 no-git 免检', exit: 'report 1；doctor 不阻断（warning 级检查 head-anchor-consistency）', remedy: '不自动改锚：先把目标行提交到 HEAD，或 evidence-reanchor 到 HEAD 内已提交行' },
  { code: 'a1-evidence-uncommitted', source: 'report / doctor（O2）：progress=verified 节点的锚指向不在 git HEAD 的文件（工作树-only，未提交且未被 .gitignore 排除）——未提交文件不得当「已对齐实相」的证据', exit: 'report 1；doctor 不阻断（warning 级）', remedy: '先 git add/commit 目标文件并重新 evidence-add 钉哈希，或改锚到 HEAD 内证据行；gitignored 生成物另计（不报本码）' },
  { code: 'class_required', source: 'state set（O3，2026-09-14 设计件 O3）：新建节点的首个写入未声明 class 轴（账务分类）——建号必填（只约束**新建**，存量含历史无 class 节点不受限，不追溯补分类）', exit: '1', remedy: '二选一：`--axis class --value <declared\\|registry\\|container\\|task\\|debt\\|batch-gated\\|trigger-gated>`，或在本次写入带 `--class <同类值>`（与轴写入同事件留痕，**不改写已有分类**——重分类走 --axis class）' },
  { code: 'unclassified_nodes', source: 'state active（O3）：本账存在无 class 轴且未完成的节点——它们单列在回执 unclassified[] 并计入 count，不再从默认活帐视图静默漏出', exit: '不阻断（warning）', remedy: '逐个 state set --axis class 补分类（新节点 O3 起建号即必填）' },
  { code: 'gate_out_placement', source: 'gate（0.10.0，holdout #2 P0）：--out 父目录正好是某 atlas 的 artifacts/<项目>/ 根（祖父目录名==artifacts 且图谱根下有 spec/<项目>/）——生成物直落项目根会触发布局 P2', exit: '不阻断（warning）', remedy: '附在 gate 回执 diagnostics（成败均附），消息给建议落点 artifacts/<项目>/<模块>-<YYMMDD>/（日期取当天）；不改退出码、不自动移动文件；补救 = --out 改落模块-日期目录' },
  { code: 'layout.spec-unparsable', source: 'doctor --atlas 布局校验（0.10.0，holdout #2 P2c）：spec/<项目>/*.json 不可 JSON.parse', exit: '1', remedy: '坏 spec 不再活到 compile 才炸；补救 = 按消息指明的文件与解析错误首行修正 JSON 语法（schema 校验属 archify validate / compile）' },
  { code: 'sidecar_missing', source: 'store.mjs：侧车文件不存在——trace/lessons/notice 全子命令一律 failed（0.12.0 行为反转：此前成文「缺省空账本初始化不报此码」，实战隐藏 112 经验+59 通知整个战役周期；实战反馈档-2026-08-23 P0-1）', exit: '1', remedy: '补救 = 显式 --sidecar 指真实账本；新账本走 init；仅合法 state set 保留创世；state active/get/import 等其余子命令均报缺账' },
  { code: 'sidecar_unreadable', source: 'store.mjs：侧车存在但不可读', exit: '1', remedy: '补救 = 检查权限/占用' },
  { code: 'sidecar_invalid_json', source: 'store.mjs：侧车非合法 JSON', exit: '1', remedy: 'fail-loud，不猜测修复；无双前缀原样呈现' },
  { code: 'sidecar_bad_schema', source: 'store.mjs：侧车 schemaVersion 不兼容', exit: '1', remedy: 'fail-loud' },
  { code: 'sidecar_bad_shape', source: 'store.mjs：侧车结构坏（如 notices 非数组）', exit: '1', remedy: 'fail-loud' },
  { code: 'sidecar_error', source: 'CLI 侧车读取兜底：store 抛错但 e.code 缺失', exit: '1', remedy: '兜底码，正常不可达（store 错误均带自身码）' },
  { code: 'sidecar_write_failed', source: 'store.mjs：提交前底层写入失败（磁盘与调用对象均未推进、revision 回滚、tmp 清理）；与同档提交边界 sidecar_commit_unknown 同属保存失败分层', exit: '1', remedy: '回执 data.commit.committed=false；按 causeCode/消息核对磁盘/权限/文件系统后重试' },
  { code: 'sidecar_commit_unknown', source: 'store.mjs：rename 已发布但目录 fsync 失败或不支持——内容已提交、持久性未知，不伪装零写入', exit: '1', remedy: '回执 data.commit={committed:true,revision,durability,path}；先重新 loadSidecar 读磁盘值再决定是否重跑' },
  { code: 'sidecar_lock_failed', source: 'store.mjs：锁创建或锁内容写入失败（非 EEXIST）——未进入写阶段', exit: '1', remedy: '核对目录可写/文件系统；残留锁须确认归属后人工删除' },
  { code: 'sidecar_path_unresolvable', source: 'store.mjs：sidecar 路径为断链 symlink 或无法解析——不按「新账本」凭空回落', exit: '1', remedy: '修复链接或显式传真实账本路径' },
  { code: 'sidecar_hardlinked', source: 'store.mjs：sidecar 为硬链接（nlink>1）——无法保证跨路径单锁与发布边界，保守拒写', exit: '1', remedy: '使用独立账本文件，或解除硬链接后统一真实路径' },
  { code: 'gate_<stage>', source: 'gate：闸链（validate→deliver→〔v3：check〕→visual_check）任一非零退出即停，rule=gate_<当前闸名>；图 spec 前置读取失败另见 gate_bad_diagram', exit: '1', remedy: '修复 = 按对应闸诊断处理；fail 信封 data 附 lessonPrompt（B4）' },
  { code: 'layout.<rule>', source: 'doctor --atlas 布局校验（lib/layout.mjs）：规则码 = layout.<规则>，现有 root / zones / index / naming / portal / portal-v2 / root-index / registry / data-placement / evidence-placement / legacy / spec-unparsable；判据见 specs/atlas-layout.md', exit: '1（error 级）/ 不阻断（warning 级）', remedy: '按诊断 supportedFixes 处置；error 级使 doctor failed，warning 级只提示；规则清单以 lib/layout.mjs 为准（旧门禁扫描正则不认带点的码，此前 11 个规则码未登记——0.23.0 以模板行登记）' },
  { code: 'P<n>', source: 'doctor --atlas 布局校验（lib/layout.mjs）：以 atlas-layout 原则号命名的规则码 P1（平铺）/ P2（交付物落位）/ P3（版本化规格名）/ P4（项目注册）/ P5（证据列）/ P6（节点前缀）；判据见 specs/atlas-layout.md', exit: '1（error 级）/ 不阻断（warning 级）', remedy: '同 layout.<rule>：按诊断 supportedFixes 处置；error 级使 doctor failed，warning 级只提示（旧门禁扫描正则不认大写开头的码，此前未登记——0.23.0 以模板行登记）' },
  { code: 'gate_bad_diagram', source: 'gate：--diagram 不可读或非合法 JSON（图型探测前置失败）', exit: '1', remedy: '修正 spec JSON 后重跑' },
  { code: 'evidence_missing', source: 'report（默认面）与 state 完成声称守卫：声称对齐实相但证据数为 0（progress=verified 保持既有码 verified_requires_evidence）', exit: '1', remedy: '先 state evidence-add 绑定可解析证据；历史闭环用 state import' },
  { code: 'evidence_unresolvable', source: 'report（默认面）与 state set·transition·settle·import 完成声称守卫：证据锚存在但格式/文件/行界任一不可解析（写边 X 族，--correction 不豁免，0.22.0）', exit: '1', remedy: '修正路径/行号后重新 evidence-add，或 evidence-reanchor 到可解析锚' },
  { code: 'a1-ambiguous-id', source: 'report --spec（A1）：图件 id 解析到多个账本节点——歧义不绑定', exit: '不阻断（warning）', remedy: '改名消歧，或 state spec-ref 图限定认领' },
  { code: 'a1-nonaccounts-scope-unknown', source: 'report --spec（A1）：库调用未提供图名，nonAccounts 声明无法按图作用域解释——声明不生效且逐条披露', exit: '不阻断（warning）', remedy: '用 CLI（自动供图名）或改按图声明/认领' },
  { code: 'anchor_roots_config_invalid', source: '写边锚根门禁配置（anchor-roots.json / anchor-root-exemptions.json）已存在但不可读、非 JSON 或形状不符——坏配置不解除门禁', exit: '1', remedy: '修复或移走该配置文件后重试' },
  { code: 'project_gate_config_invalid', source: 'state set/transition/settle/block/import（L1/L2 门）：projects.json 不可读/非 JSON/形状不符，或显式 sidecar 声明畸形、匹配条目的 project/seats 畸形——坏配置不解除门禁', exit: '1', remedy: '修复或移走注册表后重试' },
  { code: 'trajectory_source_unreadable', source: 'trace import：--source 不存在、是目录或不可读', exit: '1', remedy: '补救 = 传规整事件 JSONL 文件路径；harness 原始日志先经 scripts/ 下转换器规整（管道可用 /dev/stdin）' },
  { code: 'trajectory_bad_event', source: 'trace import/order：规整事件行不是合法 JSON 或字段形状不符（schemaVersion 1；source/session/eventId/at/tool 非空；reads/writes 为绝对路径数组且不同时为空），消息带文件与行号', exit: '1', remedy: '补救 = 修正转换器输出后重导；已落盘 trajectory.jsonl 的坏行需人工修复（只追加文件，引擎不自动改写）' },
  { code: 'trajectory_no_atlas', source: 'trace import/order：侧车不在 atlas 版式内，无 data/<项目>/ 落点', exit: '1', remedy: '补救 = 使用 atlas 版式侧车（atlas-engine init 创建）' },
  { code: 'project_source_missing', source: 'trace order：侧车同目录 projects.json 无本项目 sourcePath', exit: '1', remedy: '补救 = 在 projects.json 本项目条目登记 sourcePath（项目代码 git 仓）' },
  { code: 'project_source_not_git', source: 'trace order：sourcePath 不是可读 git 仓，或 git 调用失败/超时（ATLAS_GIT_TIMEOUT_MS）', exit: '1', remedy: '补救 = 核对 sourcePath 指向 git 工作树；大仓可调大 ATLAS_GIT_TIMEOUT_MS' },
].map(Object.freeze));

const CODE_SET = new Set(ERROR_CODES.map((e) => e.code));
const TEMPLATES = ERROR_CODES.map((e) => e.code).filter((c) => c.includes('<')).map((c) => {
  const at = c.indexOf('<');
  return { prefix: c.slice(0, at), digits: c.slice(at) === '<n>' };
});

export function isRegisteredRule(rule) {
  if (typeof rule !== 'string' || rule.length === 0) return false;
  if (CODE_SET.has(rule)) return true;
  return TEMPLATES.some((t) => rule.startsWith(t.prefix) && rule.length > t.prefix.length && (!t.digits || /^\d+$/.test(rule.slice(t.prefix.length))));
}

export function diag(rule, message, subject, severity = 'error', supportedFixes = []) {
  if (!isRegisteredRule(rule)) throw new Error('未登记错误码：' + rule + '（须先登记 lib/error-codes.mjs）');
  return { rule, severity, subject, evidence: message, supportedFixes };
}
