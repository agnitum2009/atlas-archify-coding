# ADD 规范 v1.0.0（规范层正文）

> 宪法依据：方法论基座文档（第一性×MECE×Ontology×Owner，历史存档于早期项目根仓；本仓 specs/ 为正本）。
> 本档为规范正文（职责/本体与语言为正本）；命令契约见 command-contract.md（详细操作政策为正本）；快照策略见 snapshot-policy.md（侧车存储兼容为正本）——三者互相引用，不重复完整规则。
> 修订流程：提案 → 负责人裁定 → 改本档 → 验证入库（任何与本档冲突的实现均为缺陷）。

## 一、术语（本体词表，closed vocabulary）

| 实体 | 定义 | 必填属性 |
| --- | --- | --- |
| Atlas | 图集本体（一个项目的完整图谱） | id, owner, created_at |
| Layer | 视图分层（六层，见 §五） | id, kind |
| Diagram | 单图（一型一主故事） | id, type（五类之一）, title, main_story |
| Node | 节点（唯一真相拥有者） | id, owner, truth_axis, progress_axis, ledger_axis |
| Edge | 关系（语义标签不可省） | id, from, to, type（八关系之一）, label |
| Card | 结论卡 | id, kind（conclusion / product_visible_change / ruling_point / backlog）, items |
| Slice | 切片（一刀一销账） | id, scope, owner, progress_axis |
| Evidence | 证据 | id, locator（文件:行号）, sha?, verifier? |
| Ruling | 负责人裁定 | id, quote, decided_at, receipt |
| TraceEvent | 轨迹事件（kind ∈ tool_call / decision / diagram_diff / evidence / ruling / command；command=gate/compile/report 运行后自动留痕，可携 detail={ command, params, result } 结构化摘要，2026-08-15 清单 B1） | id, at, kind, actor |

> 注（2026-08-15 裁定②）：Node 可选字段 `kind: 'meta'`（账务/元节点——记图本身与命令本身的账，不参与 A1 图账交叉
> 对账；三轴与 a/b/c 证据规则照常适用，豁免数由 report 计入 a1.metaExempted）。豁免语义显式落在数据（节点自声明），
> 不引入 id 语义猜测。

> 注（2026-08-15 清单 B3）：Notice（席位通知）**非**上表十实体之一，不升格本体——它是跨席位运行态收件箱数据
> （demo-harness 启示：通知是一等数据非侧信道），不是设计/治理真相；只以侧车根可选 notices[] 数据段落账
> （schemaVersion 保持 1），契约见 command-contract.md §11。

> 术语注记（2026-08-15 D7 裁定）：呈报单=承载多条提案的文档载体；提案=单条待裁定事项——两词不混用。

> 使用注记（0.8.0，plan-tree 吸收补齐 V1——想法池挂既有原语）：**低承诺想法 = kind=backlog 的 Card**
> （想法池本体既有原语，不是新实体）；想法晋升为正式工作项（Slice/Node）时，用 **supersedes** 关系
> 回链原卡（新项 → 原卡），**不删原卡**——想法池历史留痕，晋升链可溯。零新命令、零新字段、零新关系，
> 只是把既有原语（§一 Card kind 枚举 + §三八关系之一 supersedes）的用法写清。

### 1.1 概念与现有存储的映射（各是什么 / 不是什么）

下表把词表与本仓**现有**落点对齐：**概念属性不等于真实 JSON 字段**——无落点的实体不因本表获得存储，也不为任何模型实体虚构存储；每个实体的已知落点各自写明（如 Node → 侧车 nodes 条目、Evidence → 节点 evidence/evidenceMeta、TraceEvent → 侧车 trace），未写明即本档不主张其存储形态。

| 概念对 | 区别（前者是什么，不是什么） |
| --- | --- |
| Node ／ 图中节点 | Node = 侧车 nodes 条目（owner + 三轴 + 可选 class，唯一真相拥有者）；图中节点 = archify spec 的 component/state（图件投影）。二者的对应由单一解析入口（lib/spec-id.mjs）按精确同名 / 既有归一化 / 节点 specRefs 认领解析、歧义不绑定（compile 注入与 A1 对账共用），不是同一份数据；未绑定、分类豁免与非账本实体声明按 command-contract §6 区分，不将「未绑定」一概视为缺账。 |
| Node ／ Slice | Node = 按 id 记账的状态节点（有侧车落点）；Slice = 「一刀一销账」的工作切片概念，`report --slice` 只是标注/锚定口径——侧车**没有** slices 存储，不得假定 Slice 已持久化。 |
| Evidence ／ locator ／ evidenceMeta | Evidence = 节点的证据主张；locator 是它的存储形态（绝对化的 `文件:行号` 字符串，存 node.evidence[]）；evidenceMeta[locator] = { h: 锚行 trim 后 sha256 前 12 hex, at }。四件事互不相同：锚**存在**（文件在）≠ **可解析**（行在界）≠ **哈希未漂移**（行内容未变）≠ **业务支撑**（该行是否支持主张——机器不判，见 command-contract §6 nonClaims）。 |
| verified ／ settled | verified 在执行轴（工作已验完，A3 要求证据）；settled 在账务轴（该欠账条目已闭环）。正常路径由 settle/import 同事件双写两者，但两轴各自独立可读：独立 verified 仍是合法的待销账前态。 |
| Ruling ／ receipt ／ truth | Ruling = 负责人裁定（业务判断）；receipt = 其载体（任一现存普通文件，建议归位仅 §2.5 软约定、非必需目录；机器只验「现存普通文件」，**文件校验不是业务语义校验**）；truth = 节点的业务事实生效程度（candidate…closed）。truth 前进必须有 receipt，但「有 receipt」≠「业务已生效」（机器不自证）。 |
| history ／ trace | history = 挂在节点上的写事件账（谁把哪一轴从什么改成什么，含 kind/reason/by）；trace = 跨节点轨迹（含命令自动留痕），仅显式锚定时回指 node.traceRefs。二者是 replay 的两个来源、互不为副本；replay 取节点**当前**三轴快照再合并三源时间线，**不是事件溯源**（不从事件恢复状态）。 |
| Notice ／ TraceEvent | Notice = 跨席位运行态收件箱数据（非本体实体，有 readBy）；TraceEvent = 审计轨迹（本体实体）。notice 不承担审计，trace 不承担收件箱。 |
| class ／ kind | class = 账务分类（node.class，七值，可经 `state set --axis class` 写；决定活帐视图与图账豁免，见 §2.6）；kind = 节点身份标记（现存仅 'meta'，建号时定、**不可改**，只豁免 A1 的 d 项）。 |

## 二、状态三轴（机器定义）

每个 Node/Slice 同时携带三轴，各轴内部状态集互斥完备（`class` 是节点上的**账务分类**、可由 CLI 写，但不属三轴、不构成第四条生命周期轴——见 §2.6）。

### 2.1 真相轴 truth（业务事实生效程度，单向单调）

状态集：candidate / pending_confirmation / effective / closed
合法迁移：candidate → pending_confirmation → effective → closed（只允许逐级单向；closed 为终态；禁止回退）

### 2.2 执行轴 progress（开发工作流位置）

状态集：planned / in_progress / blocked / verified / cancelled
合法迁移：
- planned → in_progress | cancelled
- in_progress → verified | blocked
- blocked → in_progress
- verified / cancelled 为终态

### 2.3 账务轴 ledger（闭环账状态，按欠账条目记录）

状态集：clean / backlog / settled
合法迁移：clean → backlog → settled（settled 为终态，保留历史；新欠账产生新条目）

### 2.4 跨轴事件（一般跨轴操作 vs settled 专用事件）

跨轴写 = 同一事件写两个轴。**一般跨轴操作**（如 block --with-backlog：progress→blocked 且 ledger→backlog 双写）只能走到 settled 之前的状态；**正常路径下写 ledger=settled 的只有 settled 专用事件 settle 与 import**，其余直达（含 set 首写与 transition）一律非法——显式纠错通道 `--correction` 是例外且必须留痕（见 §2.5 与 command-contract §2 写边总则）。

- 销账事件 settle：前态 progress∈{in_progress,verified} 且 ledger∈{clean,backlog}；同事件写 progress=verified、ledger=settled、history 和 notice，只推进一次 revision。独立 verified 仍可正常销账；仅轴内迁移仍遵循上表，其他前态及重复销账拒绝。
- 导入事件 import（0.17.0，路线一裁定）：历史/迁移事实的 ledger →settled 与 progress →verified 同事件双写，必须携带 ≥1 条 Evidence；class/source/cutoff 可选，显式 class 校验并留痕，省略 source/cutoff 记为 null（未知）；与 settle 并列为仅有的两条**正常** settled 写入路径——set 直达（含 init 首写）一律非法（纠错通道 --correction 除外，须留痕）。

#### 2.4.1 progress × ledger 组合表（2026-09-18 负责人裁定；truth 轴与二者正交，无组合约束）

| progress ＼ ledger | clean | backlog | settled |
| --- | --- | --- | --- |
| planned / in_progress / blocked | 表内 | 表内 | **表外**（settled ⇒ verified，§2.4 双写不变量） |
| verified | 表内 | 表内（待销账） | 表内 |
| cancelled | 表内 | **表外**（取消的工作不可销账，欠账成孤儿） | **表外** |

两条约束的来源不同：settled ⇒ verified 是 §2.4 双写不变量的成文（写边已由 settled_requires_event 守住）；cancelled ⇒ clean 是**新增观测约束**——写边今天仍允许先挂 backlog 再 cancelled，但取消后欠账无法经任何事件销账（settle 要求 in_progress/verified，import 要求 planned×clean），成永久孤儿，故先以 warning 统计。执法口径：本版只成文；report 对表外组合发 warning `cross_axis_unlisted`（常开、不阻断）；是否升 error / 是否在写边拦截待统计后另行裁定。

### 2.5 真相轴启用协议（2026-08-15 负责人裁定，提案③）

真相轴语义（§2.1）保留不变：candidate → pending_confirmation → effective → closed 单向逐级，closed 为终态，回退仍按 A2 迁移表拒绝。启用协议：

- 真相轴任何前进写入（candidate→pending_confirmation→effective→closed 各步，含 state set 跳级前进）一律要求 `--receipt <负责人本地回执文件路径>`：未给 = failed（rule=receipt_required）；给了但文件不存在 = failed（rule=receipt_not_found，诊断携带解析后绝对路径）。**本门与 A2 门相互独立、判定互不改写**：只按「起点→目标是否前进」判定（起点缺失/null 按 candidate，跳级前进同算前进）；A2 的两例外（初始化/首写、`--correction` 纠错）都不豁免本门，普通逐级迁移也不因此加严；回退与原地写入不触发本门（回退仍按 A2 处理，经 `--correction` 放行且无需回执）。
- 写边将 truth 缺失/null 视为 candidate；回执须为现存普通文件（允许指向文件的 symlink），目录=receipt_not_file，无法 stat=receipt_unreadable。机器不读取/校验业务语义（生效与否属负责人判断）。
- 放行后回执解析出的绝对路径写入该次 history 事件（receipt 字段），并在节点追加 truthReceipts 条目 `{to, receipt, at}`。
- 回执文件建议归位 `<图谱目录>/rulings/receipts/`（软约定，不硬校验位置）。
- 非 truth 轴写入不受影响；truth 非前进写入与非 truth 轴传入的 `--receipt` 一律忽略（契约 §2）。
- 本协议即五公理 A5（裁定即节点：每条 Ruling 必须有 receipt）的机器化落地：回执文件本身即 A5 要求的 receipt 载体。在首个真实回执出现前，节点 truth 停在 candidate 是事实而非欠账。

### 2.6 账务分类 class（CLI 可写轴，非第四执行生命周期轴）

- class 答「这是什么」（声明/注册/容器/任务/债/门控），三轴答「真到哪、做到哪、账到哪」。它是节点属性、可由 CLI 写入（`state set --axis class`，`state transition` 同样受理 class 轴），但**不代表生命周期**：它走同一套迁移校验（值域校验 + 迁移表），只是现有七值之间全连接（含同值），故重分类一律放行——这是「分类可改」，不是「无校验」。
- 七值词表 `declared / registry / container / task / debt / batch-gated / trigger-gated`（值域见 command-contract 附录 A `class_required` 行与 lib/state-machine.mjs）。**本节不新增选类规则**：分类由建号者据实声明，机器消费行为见下，不得仅据名称推断额外义务。
- 两类消费者：① `state active` 默认视图 = class∈活帐类 {task, debt, batch-gated, trigger-gated} 且 progress∉{verified, cancelled}；**无 class 的未完成节点单列** unclassified[] 并计入 count（warning 不静默漏出；存量不追溯补分类）。② report --spec 的 A1：未绑定图件但**已声明 class** 的节点计 classExempted＝豁免，只表示不参与绑定核对，**既非 matched 也不代表已验证/已上图**。
- 待销账视图与此正交：pendingSettlement 列 progress=verified 且 ledger=backlog 的节点，**不按 class 过滤**，也不等于全部可销账前态（见 command-contract §2）。
- 写入边界（O3，2026-09-14）：**`state set` 的新建节点**首个写入必带 class（`--axis class --value …` 或 `--class <同类值>`，与本次轴写入同事件留痕；缺 = failed class_required）——同次写入而非两步建号，因为两步法会把后续首写从 A2 初始化例外变成轴值变更，改 A2 语义。`--class` 不改写已有分类（重分类走 `--axis class` 独立事件）；**`state import` 是既有例外**（`--class` 可选，省略保持无分类兼容且不覆盖已有分类）。

## 三、关系（typed relations，八种）

realizes（实现）/ verifies（验证）/ derives（派生）/ blocks（阻塞）/ supersedes（取代）/ anchors（锚定：TraceEvent→Node）/ feeds（反哺：销账→图谱更新）/ rules（Ruling→Node）。

## 四、五公理（validator 判定式）

下列为判定式摘要；触发面、例外与豁免的完整判据以 command-contract §2（写边总则）、§6（A1 口径）与附录 A 为准——摘要不构成第二条规则源。

- A1 图=投影、码=实相、违者必有一错：任一 Node 的非空状态断言必须携带指向实相（代码/运行证据）的 Evidence；图与码证据矛盾 = 判定失败。
- A2 状态迁移合法：任何状态写入必须符合 §二 迁移表（class 轴同表校验，见 §2.6）；违规输出诊断（from, to, axis, rule）。
- A3 闭环必要性：**完成声称**必须携带至少 1 条**非空且可解析**的 Evidence——progress→verified、settle/import 跨轴双写、truth→effective/closed 同判；progress→cancelled 只要求非空（取消是终态声明）。确切判据、豁免边界与错误码见 command-contract §2 写边总则与附录 A（本节只给判定式，不复制简化版）。
- A4 单一真相拥有者：每个 Node 只有一个 owner；销账写入者必须等于 owner。
- A5 裁定即节点：每条 Ruling 必须有 receipt（日期+回执引用）；未入台账的裁定 = 规范违反。

## 五、六层视图与图型五类（MECE 声明）

- 六层（全局/横切门/表面/关系/真相/生产）= 视图分层，不是实体分区；实体本体唯一，视图不产生新实体、新状态。
- 图型五类定界：architecture=组件拓扑；workflow=过程+门；sequence=时间序；dataflow=数据管道；lifecycle=状态转移。一图一型，主语义定型。

## 六、职责边界（内部职责分区与外部边界）

问题域（本体边界，2026-08-17 负责人裁定）：本体系服务**已开工、中后期失去进度掌控的项目**（「开了头不知道如何收」）；从零开始的新项目不是本工具的场景。下列分区是**同一体系内的职责分工（同一 CLI、同一侧车、同一图集），不是独立限界上下文**：不拆上下文，也不为 Node 或 sidecar 追认聚合根、Repository、CQRS 一类建模身份——它们仍是既有原语与既有存储。

| 职责 | 承担者与正本 | 边界（不做什么） |
| --- | --- | --- |
| 核心闭环治理 | 本档（三轴 + class、八关系、五公理、跨轴事件）；错误码正本在 command-contract 附录 A | 不定义图件 schema，不做渲染/布局/视觉交付 |
| 命令编排 | command-contract（命令接口）＋ lib/commands.mjs 注册表（--help 单一来源） | 不做交互提示；不自行定义状态语义（判定式在 state-machine / state-policy） |
| 持久化 | lib/store.mjs（锁 + CAS + rename + 失败分层）＋ snapshot-policy（schema 立场与增量字段登记） | 不解释业务语义；未知字段容忍不拒，不静默改字段 |
| 审计与协作支撑 | history（节点写事件账）/ trace（轨迹与命令留痕）/ lessons（经验池）/ notice（席位收件箱，非本体实体）＋ report/doctor 读方 | 不是事件溯源（replay 取当前状态、合并三源，不从事件恢复状态）；notice 是运行态数据，不是治理真相 |
| 图件投影 | compile（tag 注入 + 焦点章节）与 report --spec（A1 图账交叉） | 图是投影而非台账镜像；不改图件 schema；绑定经单一解析入口（精确同名 / 既有归一化 / specRefs 认领），歧义不绑定、不猜测 |

外部边界：

- archify（耦合基线 v2.14.0，运行时实测 v2.16.0-dev.0，MIT；doctor 机检实际版本）= 表达/校验/交付内核（validate/deliver/visual-check 三闸 + 结构化回执 + Delta）；atlas-engine 经 CLI 契约调用它，视觉复核不自动过关（visualReview 恒 pending）。
- codegraph 是读码提名工具；scripts/ 层通过 check-codegraph-freshness 核查索引新鲜度、reconcile-graph-edges 做边级对账。代码关系线索不等于业务真相；它不是状态治理内核的必需依赖。新鲜度脚本区分分母为空（N/A）、无索引（warning）与陈旧超阈值（warning 或失败），不把缺少覆盖说成已验证。
- 互不侵入：atlas-engine 不改 archify schema；ADD 状态存于 sidecar（atlas-state.json），compile 时注入 archify 原生字段（component.tag / sources）。

