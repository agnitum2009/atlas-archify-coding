# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.15.0] - 2026-09-01

codegraph × archify 协同补齐批（负责人令 2026-09-01 逐项裁：P-0 落 / P-1 加 / P-2 落 / P-3 做）。
**内核零 codegraph 引用不变**（lib/test/specs 零引用，可退出=删纪律文本即零残留）；archify 源码不动。

### Added

- **`state set --kind meta`**（边入账正规通道）：建号时把节点标为账务/元节点——此前活账里的 meta 节点全是
  手工写侧车（绕过 CLI = 绕过 CAS/锁/公理），此旗标补上 CLI 入口；kind 不可改（已存在节点传 --kind
  即 exit 1 bad_args）；A1 的 a1-unmatched-account 对 kind='meta' 的既有豁免通道由此被 CLI 真正接上。
- `scripts/check-codegraph-freshness.mjs`：codegraph 索引新鲜度门禁——分母=注册表∪账本锚指向的仓（现算），
  判据=索引 mtime vs 末次提交；>1 天 warning、>3 天红；无索引仓=提名能力缺失 warning；分母空=N/A 不报 0；
  停放仓 --exempt 显式豁免。立法依据：实测 29 索引仓 19 个陈旧（最狠 69 天），陈旧提名=看着权威的错细节。
- `scripts/reconcile-graph-edges.mjs`：边级三方对账（图 connection ↔ codegraph 边 ↔ 真码）——图的边在
  archify schema 里没有证据槽（connections 仅 from/id/label/to/variant），故对账走账本锚+只读 codegraph.db
  （node:sqlite，Node≥22，更低版本 N/A 降级）。输出：无端点/无据边/漏边三类清单，先 warning 不阻断，
  --strict 时 exit 1。
- `docs/CODEGRAPH-ARCHIFY-PIPELINE.md`：协同管线四步与精度红线（提名→实读→校验→锚）。

### Fixed

- SKILL 纪律节 ③ 条纠错：原文写「符号/位置/结构=M 级事实可引用」与经验池"行号偏移"教训矛盾——
  位置/行号改为 I 级提名（锚坐标只认实读真文件），注入块同行扩展（行数不变，预算零腾挪）。
  三个副本（pi/demo-harness/部署 pi）同步。

### 验证

  specs/command-contract.md 245 行（≤250）。公开投影两个新脚本随白名单进入公开版（隐私门禁通过）。

## [0.14.4] - 2026-08-28

公开版版本沿革拆分为"首屏 + 全量档案"（负责人裁丙案：**不删一行**，只搬家）。

### Changed

- 生成物拆分：`RELEASES.md` 只列最近 5 个版本（含指向全量沿革的链接），新增生成物 `docs/HISTORY.md`
  保留**全部**版本条目。两者同源同一次派生：唯一真相在上游实现仓，本页每次投影整体重生成，不产生第二处手工维护。
- README 目录段补 `docs/HISTORY.md` 指针；`checkGenerated` 必备生成物清单同步加入该文件。
- 派生器重构为 `deriveChangelog()` 单源分段（中性化/未发布路径标注/不可证数字断言过滤逻辑只写一遍），
  RELEASES 与 HISTORY 各自取段渲染，避免两处规则漂移。

### Verification

- 版本数 parity 有回归钉：`HISTORY` 的 `## [x.y.z]` 集合必须与上游版本记录 **逐项相等**（防"搬家"演变成"丢家"）；
  当前全量版本一律保留，RELEASES 137 行。

## [0.14.3] - 2026-08-28

公开版对外语气与可用性修订（**纯生成物文案，零代码行为改动**）——公开版首个发布版本。

### Changed

- README：术语落地（"A1 公理机器执法"→讲清"图上有、账上没销"会被点名并注代号；"一等数据"→"账本里的
  正式条目"；"本体边界"→"适用边界（请先读）"并补一句痛点自诊）；**补 archify 出处**（此前只说"设
  ARCHIFY_BIN"却没说去哪拿，对公众是硬伤）、补 Node 支持矩阵、补"其余命令不需要 archify"、补 CI 面说明。
- CONTRIBUTING："什么会被拒"→"什么情况下可能合不进去（先聊再动手，省你的时间）"；补代码风格
  （ESM·无分号·2 空格）与"先开 issue / 贡献到 scripts/ 不受能力上限约束"的替代路径——原稿只讲拒因不讲出路。
- SECURITY：去对峙语气（"请先读完再报漏洞"→"先读这段，能省你一次误报"）；"不视为安全问题"改中性表述并
  明确其外风险欢迎报告；补受理示例（含"让账本看起来比实际更可信"这一类本仓特有病理）与披露时间线。

### 记录（待裁的减法）

- 公开版 `RELEASES.md` 现约 845 行（内部 RELEASES 全量派生，语气偏内部治理叙事）。是否精简为
  "近 N 版 + 首个公开版说明"属**减法**，按负责人令先征询，本次**未删任何内容行**。
- GitHub Release 说明为面向公众另写，不复用该长文。

## [0.14.2] - 2026-08-28

公开版投影机制（负责人两令：①「以后不单独维护公开仓，只关心本体更新」②「公开仓要能收别人的 PR」）。
公开版 `atlas-archify-coding`（简称 aac）自此是**本仓的派生投影**，不是第二份代码。

### Added

- `scripts/export-public.mjs（内部件，未随本版发布）`（泄压区，非命令面）：净室投影器。排除为缺省、收录需显式白名单；
  源码内 `// aac-cut:start/end` 切除标记（不配对即报错）；标识符级中性化用**合法 ASCII 占位名**
  （踩坑：换中文词会污染「把名字当真数据用」的校验，造出公开版假失败）；生成 README/RELEASES/
  CONTRIBUTING/SECURITY/package.json（包名 aac + 双命令别名 atlas-engine·aac + 去 private）/ci.yml。
- `scripts/check-public-privacy.mjs`：公开面隐私门禁（22 词规 + 16 路径规），命中即 exit 1。
  扫描器自身含要猎的词故自我豁免，但豁免的可核性 = 「公开版该文件与内部版字节一致」，不可夹带改动。
- **锚规则腐化检测**：任何一条改写规则在全树零命中即投影失败——「零手工维护」能成立的前提是
  规则失效会响亮报错，而不是静默产出死链或漏脱敏产物。
- **PR 保护**：投影记录管辖文件哈希；再投影时若外部 PR 改过管辖文件 → exit 1 点名并要求先回流本仓；
  非管辖文件（外部新增）保留且显式报告。永不 force-push、永不覆盖他人内容。
- `test/public-projection.test.mjs（内部件，未随本版发布）` 6 条回归钉（幂等/排除面/身份别名/扫描器一致/冲突拒绝/外来文件保留）；
  本仓 CI 在 node 24 上加 `--selfcheck` 步骤。
- `docs/PUBLIC-PROJECTION.md（内部件，未随本版发布）`（内部协议档，不导出）。
- `docs/PUBLIC-PROJECTION.md（内部件，未随本版发布）`（内部协议档，不导出）。
- 安全联系人经 `安全联系人常量` 常量注入生成物（公开版是投影产物，手工编辑会被判为外来改动）。
- **生成物完整性校验** `checkGenerated`：必备七件（README/RELEASES/CONTRIBUTING/SECURITY/package.json/ci.yml/LICENSE）
  必须存在、非空、且不含未填模板痕迹（中文填空尖括号、TBD/TODO、未替换常量名）。
  立法来自本轮自曝的两个缺陷：SECURITY.md 的写入行被误删而自证仍报绿（校验只看内容不看存在）；
  README 曾带着 `<owner>` 占位符通过全部检查。**宁可不投影，也不把占位符发给公众**。
- 隐私规则收窄：禁的是**内部仓 URL 与硬编码第三方远端**，不禁账号本身（账号随公开仓必然可见，
  禁它只会逼生成物写假地址）。

### 记录

- **P4 已裁（2026-08-28，保留不切除）**：`notice` 命令族与 `--seat` 席位语义原样进入公开面。
  切除需共享文件内分支手术（`lib/commands.mjs` 8 处触点、`doctor --stats`、侧车 schema、`specs/` 17 处、
  help↔契约对账测试），会造出与内部不同的第二份实现，直接违背"投影只做文件级取舍、本体只维护一处"；
  且本仓改为接收外部 PR 后公开场景本身即多人协作，该能力的前提价值成立。故零改动，代价为零。

## [0.14.1] - 2026-08-27

交叉审核（reviewer-A + kimi reviewer-B 双席，workflow 编排）处置批——0.14.0 的三项 NIT 修正。

### Fixed

- gate 失败尾「另 N 条同类诊断」措辞错误（reviewer-B 席 b 发现）：`diags.length - 1` 计的是剩余诊断
  总数而非同类数，改「另 N 条诊断」。
- **三闸结构化摘要声称与实际覆盖不符（glm 席 b① 发现，主线亲手复核确认）**：visual-check
  回执形状与 validate/deliver 不同——无 `diagnostics[]`，失败状态分置
  containment/readability/viewerChrome/captures 子项；0.14.0 的 `structuredDiagNote` 在第三闸
  静默返空。新增 `visualCheckNote`（解析子项状态，把失败项与证据联络表路径提进失败尾），
  三闸声称补全。specs/command-contract.md §gate 同步注明两套解析面。

### 附记（审核结论）

  双席一致「高」；「零破坏」前提=内核升级划在 archify 版本轨，图集结果变化属旧内核假阴性
  被新守卫揭露（demo-c 12 张修复为 一线席位 动作，本章 RELEASES 记 一线席位 归功）。
- 记债不修：gate spawnSync 无 timeout（挂死内核阻塞 gate，预存债）；低于基线仅 doctor
  warning 不入 gate（基线漂移与闸行为之间无联动防线，可作后续债）。

---

更早的 32 个版本（0.1.0 → 0.14.0）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 15 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
