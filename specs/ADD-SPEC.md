# ADD 规范 v1.0.0（规范层正文）

> 宪法依据：方法论基座文档（第一性×MECE×Ontology×Owner，历史存档于早期项目根仓；本仓 specs/ 为正本）。
> 本档为规范正文；命令契约见 command-contract.md；快照策略见 snapshot-policy.md。
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

## 二、状态三轴（机器定义）

每个 Node/Slice 同时携带三轴，各轴内部状态集互斥完备。

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

### 2.4 跨轴事件（唯一合法的跨轴写）

- 销账事件 settle：ledger backlog→settled 与 progress →verified 必须同回执双写，缺一即违反 A2。
- 阻塞事件 block：progress →blocked 可伴随 ledger clean→backlog（登记欠账条目）。

### 2.5 真相轴启用协议（2026-08-15 负责人裁定，提案③）

真相轴语义（§2.1）保留不变：candidate → pending_confirmation → effective → closed 单向逐级，closed 为终态，回退仍按 A2 迁移表拒绝。启用协议：

- 真相轴任何前进写入（candidate→pending_confirmation→effective→closed 各步，含 state set 快捷路径跳级前进）一律要求 `--receipt <负责人本地回执文件路径>`：未给 = failed（rule=receipt_required）；给了但文件不存在 = failed（rule=receipt_not_found，诊断携带解析后绝对路径）。
- 机器只校验回执文件存在性，不校验语义（生效与否属负责人判断，机器不自证）。
- 放行后回执解析出的绝对路径写入该次 history 事件（receipt 字段），并在节点追加 truthReceipts 条目 `{to, receipt, at}`。
- 回执文件建议归位 `<图谱目录>/rulings/receipts/`（软约定，不硬校验位置）。
- 非 truth 轴写入不受影响；truth 非前进写入与非 truth 轴传入的 `--receipt` 一律忽略（契约 §2）。
- 本协议即五公理 A5（裁定即节点：每条 Ruling 必须有 receipt）的机器化落地：回执文件本身即 A5 要求的 receipt 载体。在首个真实回执出现前，节点 truth 停在 candidate 是事实而非欠账。

## 三、关系（typed relations，八种）

realizes（实现）/ verifies（验证）/ derives（派生）/ blocks（阻塞）/ supersedes（取代）/ anchors（锚定：TraceEvent→Node）/ feeds（反哺：销账→图谱更新）/ rules（Ruling→Node）。

## 四、五公理（validator 判定式）

- A1 图=投影、码=实相、违者必有一错：任一 Node 的非空状态断言必须携带指向实相（代码/运行证据）的 Evidence；图与码证据矛盾 = 判定失败。
- A2 状态迁移合法：任何状态写入必须符合 §二 迁移表；违规输出诊断（from, to, axis, rule）。
- A3 闭环必要性：progress=verified 必须携带至少 1 条 Evidence。
- A4 单一真相拥有者：每个 Node 只有一个 owner；销账写入者必须等于 owner。
- A5 裁定即节点：每条 Ruling 必须有 receipt（日期+回执引用）；未入台账的裁定 = 规范违反。

## 五、六层视图与图型五类（MECE 声明）

- 六层（全局/横切门/表面/关系/真相/生产）= 视图分层，不是实体分区；实体本体唯一，视图不产生新实体、新状态。
- 图型五类定界：architecture=组件拓扑；workflow=过程+门；sequence=时间序；dataflow=数据管道；lifecycle=状态转移。一图一型，主语义定型。

## 六、与 archify 的边界

- archify（耦合基线 v2.14.0，运行时实测 v2.16.0-dev.0，MIT；doctor 机检实际版本）= 表达/校验/交付内核（validate/deliver/visual-check 三闸 + 结构化回执 + Delta）。
- atlas-engine = 本规范的执行器：状态/证据/轨迹/销账/对账；经 CLI 契约调用 archify。
- 互不侵入：atlas-engine 不改 archify schema；ADD 状态存于 sidecar（atlas-state.json），compile 时注入 archify 原生字段（component.tag / sources）。

