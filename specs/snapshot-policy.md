# 快照策略 v1.1.0（与项目执行并行边界）

> 依据：负责人 2026-08-14 裁定——atlas-engine 与外部项目的执行并行；本仓不写任何项目文件；外部图集仅以快照方式只读引用。
> 0.6.2 去项目名化（2026-08-16）：试点快照文件已从 fixtures/ 移除（项目内容不入框架仓），本档保留为史实并收回本地路径引用。

## 一、快照内容与时机

- 试点单图：早期六段链图快照 + 依赖数据资产（史实快照文件已随 0.6.2 移除出仓，路径不复引）。
- 时机 1：试点开始时首拍。
- 时机 2：项目侧每次对试点图销账（图集更新）完成后重拍——重拍产物即 diff 命令首个真实用例（双轮概念的活演示）。
- 禁止：任何时机向项目侧写文件。

## 二、命名与校验

- 命名：fixtures/demo-map-YYYYMMDD-HHMMSS.json（+ 同名 CSV）。
- 每次快照生成 fixtures/SNAPSHOT-MANIFEST.json：{ taken_at, files: [ { path, sha256, source } ] }。
- 校验：manifest 内 sha256 与文件实算一致才可用于 diff/report。

## 三、只读纪律

- fixtures/ 内文件一律视为历史证据，只读不改（改 = 伪造历史）。
- 状态、结论、反哺一律写入 atlas-state.json 与本仓 specs/，不回写快照。
- 一线席位 销账后的图集变动，通过「重拍 + diff」观察，不直接读活文件。

## 四、风险与回退

- 若 一线席位 在快照瞬间正在写图集 JSON：单文件 cp 读取一次，损坏/半写由 JSON 解析失败检出，随即丢弃重拍。
- 本仓任何操作失败不得影响 一线席位（无反向引用、无共享锁）。

## 五、侧车 schema 版本立场（2026-08-15 D2 成文）

> 适用范围：atlas-state.json 侧车（lib/store.mjs 读写）。此前增量字段的隐式放行在本节显式成文；
> 契约 §11（notices）、ADD-SPEC 各注（meta/truthReceipts/B1）同属此立场，本节省略各语义细节。

### 5.1 schemaVersion=1 的语义

- 只有结构性/破坏性变更才升号：删字段、改既有字段语义、改根形状（如 nodes 不再是对象）。
- 增量可选字段不升号：新根可选段、新节点可选属性、新条目可选子字段——旧读方缺省兜底即可安全读新侧车。

### 5.2 增量字段登记表（逐条核 lib 源码，2026-08-15 全数同号落地）

| 字段 | 用途（一句） | 出处（源码行号） |
| --- | --- | --- |
| revision（根） | CAS 版本号：写前持锁重读磁盘核对，不符拒绝覆盖，写后 +1（2026-08-15 侧车 CAS） | lib/store.mjs:39-43（缺省 0）、184-195 |
| truthReceipts（节点） | truth 轴前进回执落账 {to, receipt, at}，公理 A5 机器化（2026-08-15 裁定③） | lib/truth-receipt.mjs:37-40 |
| kind:'meta'（节点） | 账务/元节点自声明，豁免 A1 图账交叉 d 项，a/b/c 证据规则照查（2026-08-15 裁定②） | lib/report.mjs:84-85 |
| notices[]（根） | 席位间主动通知收件箱；缺省 []，非数组 sidecar_bad_shape（2026-08-15 清单 B3） | lib/store.mjs:45-53、lib/notice.mjs |
| lessons[].hits（条目） | 经验实际拦截命中计数，防膨胀；旧条目按 0 处理（2026-08-15 清单 B4） | lib/lessons.mjs:18、26-35 |
| lessons[].status（条目） | 经验生命周期 active\|retired；新条目 active，旧条目无此字段按 active 处理（2026-08-15 清单 D3，随 A 组批次） | lib/lessons.mjs:19、38-47、51-66 |
| trace[].detail 与 kind:'command'（条目） | gate/compile/report 自动留痕的结构化摘要 {command, params, result}（2026-08-15 清单 B1） | lib/trace.mjs:7、24-25 |
| history[].engine（条目） | 账本语义世系：该条 history 事件由哪个引擎版本写入，回答「这条账是哪个引擎语义写的」（2026-08-15 增长控制开发规范批一#1；lib/version.mjs 启动读一次 package.json） | lib/store.mjs:228-231（appendHistory 单一构造点）；detail 同戳见 lib/cli-util.mjs:80 |
| evidenceMeta（节点） | 证据锚行哈希 { 锚字符串: { h:目标行 trim 后 sha256 前 12 hex, at:ISO } }：锚内容三态 ok/drifted 判据（锁口② 语义绑定增强 2026-08-16；先例=pi-readseek 的 LINE:HASH 模式；旧侧车无此字段=unhashed 照常，evidence 数组保持纯字符串不动） | lib/commands.mjs（evidence-add 落哈希）、lib/evidence.mjs（lineHash/computeLocatorHash/anchorState）、scripts/backfill-evidence-hashes.mjs（存量回填） |

### 5.3 读方立场：未知字段默认容忍

- 现行为写实（lib/store.mjs:29-53）：loadSidecar 只硬校验 schemaVersion、nodes 形状、revision 类型、
  notices 数组形状；其余未知字段一律静默容忍——不拒绝、不告警，原样保留于返回对象。
- 政策方向：容忍为默认，且论证方向与 demo-harness 官方仓相反，需明示。demo-harness 立场是「宁可拒绝造成不便，
  不可静默丢数据」——旧读方看不懂新数据时，拒绝优于静默丢弃。但 ADD 侧车取反：① 拒绝会让旧引擎
  读不了新侧车，多席位版本混跑时共享账本整体停摆，代价远大于「旧引擎不识别新字段」；② 本仓读写
  是整对象直通（load 返回原对象、save 全量序列化，无字段投影），未知字段经读-改-写往返原样保留，
  容忍并不产生 demo-harness 担心的静默丢数据路径——对侧车而言增量字段即数据，丢字段即丢数据，容忍正是防丢。
- 配套：已知增量字段一律缺省兜底（revision→0、notices→[]、hits→0、status→active、readBy→[]），旧引擎读新侧车行为确定。

### 5.4 schemaVersion 不符仍硬拒

- lib/store.mjs:29-34 写实：schemaVersion !== 1 一律 failed（sidecar_bad_schema，exit 1），fail-loud，
  不降级不猜测——版本号是形状契约，不符即文件可能由未来结构版本写成，静默读 = 自欺。此点与 demo-harness 立场一致。

