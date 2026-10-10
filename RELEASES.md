# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.37.3] - 2026-10-10

修正两处陈旧文案。纯文案修改，命令、字段、退出码与校验行为不变。

### Changed

- archify 解析顺序的说明去掉已不存在的「内置回退」（0.37.0 起解析序为 ARCHIFY_BIN → PATH → none）：--help 页脚（技能帮助块重新生成）与 gate 的 archify-missing 诊断。
- report 的 A1 非主张与命令契约中 truth 轴一句，与 0.37.1 的回执诊断统一为「机器不可判：truth 推进只核对本地回执文件存在，不自证」，不再写「需负责人回执」。

## [0.37.2] - 2026-10-10

恢复身份表述（负责人 2026-10-10 裁定：早前的「ADD 图谱驱动研发体系 L2 状态机层」更准确）。纯文案修改，行为不变。

### Changed

- --help 首行与 package 描述等身份表述恢复为 0.37.1 之前的写法（不恢复早先文案中过时的 archify 版本号）；公开 README 标语同步统一为「L2 状态机层工具」。

## [0.37.1] - 2026-10-10

specs 收窄为组件契约：只规定本组件的状态机、证据、回执、关系标签与存储（负责人 2026-10-10 裁定）。纯文档与诊断文案修改，命令、字段、退出码与校验行为不变。

### Changed

- specs/ADD-SPEC.md：标题与开头改为组件契约的适用范围；§一 改称组件数据词表；A5 与 §2.5 注明本组件只在 truth 推进时检查回执文件存在；§三 注明侧车不存边、只有 anchors 有实现，想法池的 supersedes 晋升链同注；问题域一句改为「本组件」。command-contract 本体边界同改。
- truth 推进缺回执的诊断文案（lib/truth-receipt.mjs、lib/error-codes.mjs，命令契约附录 A 重新生成）改为「真相轴推进需本地回执文件（机器只核对文件存在，不自证）」；对应测试同改。
- --help 首行、package 描述与两份技能的身份说明改为「ADD 状态与证据账本组件」，技能帮助块重新生成。
- docs/USAGE.md、docs/QUICKSTART-NONCODER.md 改为描述本组件；USAGE 的完整契约指向 specs/ADD-SPEC.md，相应删去一条已无对象的投影锚点规则。

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

---

更早的 70 个版本（0.1.0 → 0.35.2）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
