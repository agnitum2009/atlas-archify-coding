# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.37.4] - 2026-10-16

gate 回执透传内核诊断与复核信号。纯增可选字段，命令、退出码、既有字段语义与 visualReview 边界不变。

### Added

- gate：validate / deliver / check 非零退出时，该闸回执带 `kernelDiagnostics`（内核 diagnostics[] 前 8 条的 code/severity/subject/message；无 code 不计；解析失败为 []），CLI fail 信封以 `data.kernelDiagnostics` 暴露（不适用为 null，内核非零但无可解析诊断为 []）。此前失败尾只摘第一条且截 180 字，上层无法按 code+subject 逐条追踪修复轮次（编排层的修复上限规则需要逐条身份）。
- gate：v3 check 通过时 `check.receipt.review` 转述内核 `composition` 的复核信号（resolvedCrossovers / routesOverSuggestedBends / routesOverSuggestedStretch）、`routeReview`（crossings / detours / crowdedSides 各 ≤8 条，`truncated` 标记）与 leadingSpace / sequenceColumnSpace 的 `reviewSuggested`。archify 3.x 的 `finalize` 据此生成 visualReviewRecommendation；gate 此前只留溯源三字段，人工 visualReview 没有清单可对。只转述不判定。
- gate-detail.jsonl：每条增 `kernelDiagnostics`（失败闸的码列表或 null）与 `review`（上述对象或 null），观察期可按内核码分类拦截。

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

---

更早的 71 个版本（0.1.0 → 0.36.0）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
