# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.37.0] - 2026-10-08

本体项目中立（负责人 2026-10-08 裁定：引擎不得知道任何项目的名字或形状；项目账本上的发现只问「引擎有没有做错或没说清」）。设计稿 docs/superpowers/specs/2026-10-08-0370-project-neutral-core-design.md。不写任何侧车。

### Breaking (a) — 拒绝此前接受的输入

- 图件 id ↔ 账本节点 id 的解析入口（lib/spec-id.mjs，report / compile / settle 共用）不再剥 `demo-b-` 项目前缀：归一化只折叠大小写，解析序为 精确同名 → 大小写归一唯一命中 → specRefs 显式认领。此前靠前缀命中的绑定升级后报 `a1-diagram-local-id`、compile 不注入；项目要这种绑定用 `state spec-ref --node <节点> --ref <图名>/<图件id>` 认领（A3 本有通道）。

### Breaking (c) — 改变默认行为

- archify 解析序改为 ARCHIFY_BIN → PATH → none：删除 lib/resolve-archify.mjs 的本机回退路径常量及 doctor 的 source=fallback 提示。未设 ARCHIFY_BIN 且 PATH 无 archify 的机器，gate 由静默走回退变为 `archify-missing` fail-closed；生产机用 ARCHIFY_BIN 不受影响。

### Changed

- lib/ 内 27 处「立法动机（demo-b 实测…）」类注释去项目名、保留日期与事实；error-codes 两处文案同改并重新生成契约附录 A；契约 §6/§10、USAGE 的解析顺序与归一化措辞同步。
- scripts/export-public.mjs（内部件，未随本版发布）：删除已无对象的 doctor fallbackHint 锚规则与 P7 aac-cut 段；本体两份文件（spec-id、resolve-archify）的公开副本自此与私有副本逐字节相同，不再需要脱敏替换。

### Added

- 结构守卫：lib/ 与 bin/ 全文不得出现项目名或本机路径（demo-b / demo-a / odoo / demo-c / knifeseq / demo-ledger / <home>）；投影测试钉住 spec-id / resolve-archify 公开副本字节一致且无 `demo-b-` 痕迹。
- test/spec-id.test.mjs：仅差大小写绑定、仅差前缀不绑定、前缀 + spec-ref 认领绑定三例。

## [0.36.0] - 2026-10-08

### Breaking (c) — 改变默认行为

- R1：reconcile 的 nonAccounts 按图作用域判断；图名与 report 一致（文件 basename 去 `.json`），只有该图同时声明两端点才计入 ungroundedDeclared，另一图同名 ID 不再获豁免。conn.spec 显示值、显式声明路径优先级、缺文件空集行为及 nonAccountsDeclared 的全局去重 ID 计数不变；不修改 report / spec-id。

### Added

- R2：set / transition / settle / import 的完成声称实际使用 grandfathered 豁免时，回执新增 anchor_root_grandfathered warning；按 rule+subject 去重，保留首次快照披露，保存失败仍带原错误与警告。warning 不进入策略阻断诊断，不重写已标记豁免清单；经负责人补充裁定，evidence-remove 保持既有删除语义，不扩大重验与拒绝范围。

### Documentation

- R3：收口 report 留痕契约：参数解析与输入文件读取失败（bad_args / bad_verify / bad_spec / 侧车不可用）不留痕，进入报告评估后的成功与规则失败都记；增加有效侧车下 bad_verify 不改变 revision/trace 的现状测试，report 实现不变。
- R4：对齐 pi 部署门禁的词表/版本两段、skipped 与宿主加载边界；将 v2.16.0-dev.0 标为 2026-09 历史基线，生产 v3.0.1 以 doctor 为准；Codegraph 两边都有仅为文件级提名一致，AE-12 保持能力限制。compile 的校验归 gate 条款原已明确，保持不变；仓内三条注入通道同步口径。
- U2：USAGE 的合成验收件标明仅演示机器链路；正式流程先解释真实验收，再登记证据并合法进入 verified，复核 report 的 checked/exempt/unchecked 后 settle；图件机器 pass 与人工视觉批准分开记录。
- AAC 公开 README（2026-10-03 直推 0034dce / AAC 673f52c，随本版一并记账）：AAC 对外 README 改为桌面/窄屏专属图谱与账本 SVG 示意、图账闭环流程、问题与命令对照表及可运行起步示例；插图由内部投影白名单导出并列入 npm 文件清单。同步说明 gate v3 四闸、report --spec 无需 Archify 内核及人工验收边界；无 CLI 行为变更。公开仓继续只由本体投影生成。

## [0.35.2] - 2026-10-02

### Fixed

- 修复 trace order 多仓归并读取错误层级的 firstAt，改用 entry.firstAt；按实际时刻交错归并，同刻保留仓序，仓内提交序不变。修前已用真实 CLI 复现较晚仓节点排在较早仓节点之前；补跨仓交错、时区、同刻与仓内时钟回拨回归。
- 内部脚本 unowned-oversize-scan：缺失或损坏的 --context-map 现返回既有 bad_args JSON 失败回执与 exit 1，不再输出未捕获栈；成功扫描语义不变，该脚本不在 AAC 公开包内。

### Documentation

- 对齐现行能力边界：report 的节点范围、全账图绑定覆盖、外部 verify 附件及 brief 消费；diff spec 是按路径/数组索引的结构差异；gate 只验图件；notice 是拉取式收件箱；lessons 不证明阅读或应用，hitLesson 已于 0.10.1 删除；class 门控名称不增加执行机制。同步仓内技能与使用说明，不新增命令、旗标、字段或门禁规则。

## [0.35.1] - 2026-10-02

设计 `ba6fc46` 获批后按 AE-12 → AE-30 → AE-24 实施；六项边界债闭环与裁决回执 §八 在本实现 PR 合并后另做。本版无 Breaking，不加命令/旗标/帮助行。

### Added

- AE-12：reconcile 对 sequence/messages、dataflow/flows、lifecycle/transitions 在原始 connections/edges 缺省或为空时披露 `data.unsupported` 数组，单份也是一元数组；项为 `{ spec, diagramType, relationSet }`，spec 为绝对路径，按输入顺序去重。只披露未支持，不映射这些关系；普通空 architecture 的 note 和既有 findings/strict 退出语义不变。

### Fixed

- AE-30：目录共享豁免清单新增 `ledgers[侧车文件名] = { at, receipt }`，A 的快照不再阻止 B；每账扫描一次且零条也标记。保留旧条目和未知字段，按规范化绝对文件路径追加去重；旧无 ledgers 文件逐账补扫，包括原创建者。
- 快照逐路径 warning 通过共用命令回执 helper 输出；import 二次检查不覆盖首次 warning，后续校验/写账失败（含已提交但耐久未知）仍披露，不把 warning 混入阻断诊断。已标记不扫描、不重写；保留既有当前目标豁免 warning。不加锁、不承诺同目录并发或断电原子性，不扩大白名单。

### Documentation

- AE-24：契约明载 trace import 的单写者前提，并发不承诺幂等去重；同一事件串行导入。代码和测试未改，属于冻结限制说明，不是并发修复。

## [0.35.0] - 2026-10-02

负责人裁定 AE-08/13/14 仅补 fail-loud 缺口；本版先推分支、开 PR，由本侧审阅合并，合并后再销三项债。不加命令/旗标/帮助行，不修改 AE-12/24/30。

### Breaking (a) — 拒绝此前接受的输入

- AE-08：重复带值参数仅对注册表 `repeatable: true` 者聚合；其余返回 `bad_args` / exit 1 并点名旗标，init 重复 `--title` / `--dir` 不产生文件。经数组消费点核对仅 `--spec`、`--replay`、`--allow-root` 保留可重复，单次传值和布尔旗标行为不变。旗标仍 50/50，帮助仍 ≤50 行。
- AE-13：`check-codegraph-freshness.mjs` 的 `--warn-days` / `--fail-days` 必须为有限非负数，非数字/无穷/负数返回既有 `bad_args` / exit 2，不再假报 fresh。本脚本在 AAC 的 KEEP_SCRIPTS 投影清单内；不改 warn > fail 顺序规则。

### Breaking (b) — 本版无此类变更

- freshness 输入失败沿用脚本既有 exit 2，不顺手改为 CLI 的 exit 1；退出码统一须另行裁定。

### Breaking (c) — 改变默认行为

- AE-14 根预检：`unowned-oversize-scan.mjs --root` 不存在或不是目录时按既有输入守卫返回 `bad_args` / exit 1，不再返回假 `ok, scanned: 0`。

### Added

- AE-14 部分扫描披露：目录读取失败计入 `data.unreadableDirs`，`data.unreadableDirSamples` 最多保留 5 条相对根路径（根自身为 `.`）；仍 `status: ok` / exit 0，不升级为阻断门禁。除这两项授权字段外不改回执形状；该脚本及其新增测试均不投影 AAC。
- 回归覆盖三项红→绿：全部不可重复带值旗标、init 零文件输出、非法/合法阈值、缺失/非目录根、真实 chmod 000 子目录、正常及空目录扫描。

---

更早的 67 个版本（0.1.0 → 0.34.1）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
