# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

## [0.34.0] - 2026-10-01

主 Agent 亲自重跑剩余 27 项；仅修当前 0.33.0 实际复现且符合现契约的 21 项。AE-08/12/13/14/24/30 保留边界债；不清洗生产数据、不改 Archify。2026-10-01 经负责人追加授权合并主线，并发布本体及 AAC 0.34.0 正式版本。

### Breaking

- (b) 保存前建目录失败由 internal / exit 2 归位 sidecar_write_failed / exit 1（AE-07），不是成功回执；未提交事实与调用者状态保持不变。
- (a) 规则段落跨行句末不再误豁免超六行正文；预算扫描对该超限输入由通过转为失败（AE-35）。

### Fixed

- AE-07/09/10：保存建目录失败归位 sidecar_write_failed 并披露未提交；版本路径用 URL 解析；公开导出预检忽略文件占用父路径，在任何发布前拒绝。
- AE-11/36：反向边核验按端点集合检查成员，锚数量不改变方向；候选截断披露包含多属主过滤。
- AE-15/16：Git 轨迹纳入 merge 自创文件但不把继承的父分支文件冒充 merge 改动；NUL 分隔保真处理引号、制表符、换行、Unicode 及重命名。
- AE-18/19/22：按解析时刻比较、排序和含边界截窗；等时刻稳定，无效日期末置。diff state 的 --since 帮助由 version 更正为 ISO8601。
- AE-20/21/33：replay 摘要保留删除锚与 scoped spec-ref；notice 席位 trim 后一致读写；brief 失败报告 errors 仅含 error，留痕降级 warning 只计 warnings。
- AE-23：经负责人单项许可，只补合法无 LF 末行追加时所需分隔；trace import 仍冻结，不扩并发/格式/提名能力，AE-24 未修。
- AE-26/27/28/31/32：同项目全部 sourcePath 参与 SHA 候选；失败候选如实披露 unchecked 且不妨碍其他项目；漏项按全候选判定；每张图保留本图歧义；注册表冲突不再误造项目缺失 error，独立门户缺陷仍报错。
- AE-35：技能纪律预算按段落实际正文行数核算，删除跨行找句末的截短豁免，超六行正文不再误放行。
- AE-37：门户的产物、缩略图及期目录 href 逐路径段 URI 编码，保留真实文件名中的 #、?、% 与 Unicode，不把文件名误当 fragment/query。

### Tests

- 增补消费者回归覆盖错误码/零写入、Git 历史与字面文件名、时间边界、JSONL 顺序追加、候选核验、回执与门户 URL。
- 移除绑定源码函数行数的实现断言，不重钉行数；命令、旗标、文本预算门禁保留原上限。

## [0.33.0] - 2026-10-01

本批只修复审计 AE-01/02/03/04/05/06/17/25/29/34；未清洗生产账本，未修改 Archify 内核。

### Breaking

- (a) `compile --out` 与任一读输入同路径、symlink 或 hardlink 同身份时拒绝（bad_input），不再支持原地覆盖输入；独立输出仍可重写。
- (a) `init` 任一计划输出已占用即拒绝（atlas_exists），不再只保护侧车；多文件初始化仍非事务。
- (a) CAS 区分缺失账本与现存 revision=0：新建意图不得覆盖后来创建的零版本账本，读过的零版本账本消失后也不得重建（sidecar_conflict）。
- (a) `transition` 同值仍过迁移表；三轴自环拒绝，class 表内自环保留。`block` 不得把存量非法 settled 组合写成 blocked。
- (a) 锚根门激活时，无法解析物理身份的链接拒绝；set/transition 的完成声称及 settle/import 重验当前锚根授权。`--allow-root` 只授权本条命令，完成时需重新提供。
- (c) HEAD 检查按真实目标文件所在 Git 仓判定；仓外链接不能再把仓内脏行降为 no-git 免检。跨行字符串中的示例不再产生 M 级依赖；不可靠词法上下文列入 import 未解析披露。

### Fixed

- AE-01：输出预检与无截断 fd 打开后的 inode 复验，保护 diagram、sidecar、previous-receipt。
- AE-02/03：完整 init 输出计划碰撞预检、独占首写，以及含文件存在性的创世 CAS。
- AE-04：批量移锚从原始 evidence/evidenceMeta 快照一次映射，先删全部旧键再立新键，保留各锚哈希及未知元数据；相邻移位与交换不互相吞锚。
- AE-34：备份使用 COPYFILE_EXCL；竞争占位后选下一序号，不覆盖后来文件或链接。
- AE-25/29：真实路径 HEAD 身份、悬空链接 fail-closed 与完成时授权重验；普通根内待创建路径和既有合法存量豁免仍保留。
- AE-05/06：transition 不再借同值免表，block 在 history/notice/保存之前经过统一跨轴策略。
- AE-17：按代码词法上下文识别 JS/TS 字面量依赖，区分注释、跨行引号/模板、模板表达式、正则与 JSX 文本；真实静态/动态 import、require 与 module.require 保留。

### 验证

十项隔离真实 CLI/API 场景通过，含双进程 genesis 竞态；真实 trace order 验证示例无 M、实际 import 有 M、不可靠解析明确披露且不写侧车。原生 Archify 3.0.1 五类图四闸及 2.16.0-dev.0 架构图三闸共 6/6 通过；机器闸不代人工视觉批准。
最终 `npm test`：716 项、714 通过、0 失败、2 跳过（未设置真内核测试环境变量；另已实跑上述六条原生图链）；受影响回归 61/61 通过。删除历史帮助文案/行数下降断言，不重钉旧措辞；既有命令/旗标/帮助及函数尺寸预算未放宽。

## [0.32.1] - 2026-09-29

v3 生产路径加固。生产内核已切到 archify v3.0.1（裁决回执 rulings/RULINGS-2026-09-29-archify-v3-switch.md：10 项目 143 图双内核普查、49 图修复、
51 次生产 gate 均走四闸），0.32.0 暂缓的三项 v3 相关 Minor 随之转正。回执形状不变，纯加固。

### Fixed

- v3 的 visual-check 回执（`--require-provenance`）由 gate 自行核对 `provenance=current` 与 `deliveryReceiptId`=本轮 deliver `receiptId`，
  不再只靠内核退出码——与 check 闸同口径；不符 reason=`visual-check-artifact-mismatch`。2.x 无此契约，不要求。
- 侧车 gate 留痕（trace detail.result）带 `kernel`：侧车历史可区分一次 gate 走的是 v2 还是 v3（此前只有 gate-detail.jsonl 有）。

### Added

- 测试：v3 visual-check 溯源字段三种不符；v2 不要求溯源字段；v3 停在 deliver 时 gate-detail.jsonl 与侧车留痕都把 check / visual_check 记为 skip 并带 kernel。

### 实证附记

npm test 694 项 691 通过 0 失败 3 跳过（+5 例）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 幂等、隐私零命中；--help 行数不变。真内核实跑（本机 2.16.0 与 3.0.1）2/2 通过——v3 visual-check 回执溯源字段在真内核上逐项核对成立。

## [0.32.0] - 2026-09-29

接驳 archify v3，双版本兼容 2.16 / 3.x（设计 docs/superpowers/specs/2026-09-29-archify-v3-bridge-design.md；负责人裁定：双版本兼容、焦点卡仅 v3）。

**依据**（2026-09-28/29 实测，本地 archify 3.0.1 克隆与 2.16.0 worktree）：v3 要求 `meta.output`（RELEASES 未载）——atlas 的 init 模板与
compile 产物都没有，v3 下 gate 在 validate 闸全部失败；v3 退役 `meta.views`，atlas 的「当前焦点」章节静默消失；v3 官方验收链改为
deliver → 严格溯源 check → 浏览器检查；3.0.1 起 deliver 自带联网更新检查。

### Added

- 内核契约族判定 `kernelProfile` / `kernelOf`（只读 bin 旁 package.json，先解析符号链接以覆盖 `npm i -g` / `npm link` 安装；major ≥ 3 → v3，其余与未知 → v2，`versionKnown` 如实标）。
- compile：`meta.output` 缺则补 `<图名>.html`（portable；作者已写原样保留）；v3 内核下另加一张 atlas 自管说明卡「当前焦点（在途 n）」置 `cards` 首位
  （只替换 atlas 生成的精确格式卡——amber 且标题「当前焦点（在途 N）」，作者卡即使同前缀也不动；2.x / 版本未知 / 无在途时不生成并清除残留）；回执 `injected.focusCard`、`injected.kernel`。init 模板补 `meta.output`。
- gate：v3 闸链 validate → deliver → **check**（`--require-provenance`，核对 ok / file / provenance=current / 产物摘要 / deliveryReceiptId，
  不符 `check-receipt`、非零 `check-failed`）→ visual_check（加 `--require-provenance`）；2.x 三闸不变。回执 `data.kernel`，v3 `results.check`；
  gate-detail.jsonl 逐闸记录随实际闸链并带 `kernel`。gate 调 archify 的子进程一律 `ARCHIFY_UPDATE_CHECK_DISABLED=1`。
- doctor：`archify-kernel` 的 detail 披露 `profile=v2|v3`。
- `test/archify-real.test.mjs`：真内核集成测试（选跑；设 `ATLAS_REAL_ARCHIFY_V2` / `ATLAS_REAL_ARCHIFY_V3` 时执行）。

### 已知差异（如实记录）

- v3 上游移除了交互式引导章节，atlas 在 v3 下以焦点卡 + 节点 tag 承接，交互式章节不可恢复。
- 焦点卡不在 2.x 生成：2.16 visual-check 禁首屏纵向溢出，2.16 自带示例加一张五行卡即 `viewer/viewport-overflow`。
- 部分 lifecycle 图在 2.16 过不了 visual-check：本机 v2.16.0 标签下，内核自带的两个 lifecycle 示例与一张最小三状态图原样都纵向溢出
  （与 atlas 无关、0.31 同样；v3 下同图通过）。**并非 lifecycle 必然过不了**——umax 的 2.16.0-dev.0 上 demo-b 的 8 状态 lifecycle 三闸全过
  （2026-09-29 复测更正）：是否溢出取决于具体图的尺寸。

### 非变更（明示拒绝）

- 不接仓库证据（`sources` / `--repo-root`）与 compare；不改 diff；不改 2.x 闸链的调用与回执形状；不提高耦合基线（仍 2.14）。
- 不改用 `finalize`（不产截图，改过去即丢现有视觉证据）；不单独加 `browser-check`（v3 的 visual-check 已含其全部测量）。
- 不新增旗标（50/50 已满）、命令、错误码行；不安装 / 升级 archify。

### 实证附记

npm test 689 项 686 通过 0 失败 3 跳过（含整分支审阅修复 3 例）（1 异机、2 真内核选跑）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 141 文件幂等、隐私零命中；--help 49 行不变；投影后的公开树相关测试通过。真内核实跑（本机 2.16.0 worktree 与 3.0.1 克隆，WORKDIR 置 $HOME 下以避开 snap Chromium 的 /tmp 限制）：两版 2/2 通过——架构图全闸（v2 三闸、v3 四闸）、visualReview=pending、进度 tag、2.x 焦点章节、v3 焦点卡、lifecycle tag 注入（v3 全闸）、失败诊断原样带出。

## [0.31.0] - 2026-09-27

共享锚口径并报（设计 docs/superpowers/specs/2026-09-27-shared-anchor-caliber-design.md；负责人裁定方向 A「逐条标注口径」）。

**依据**（umax demo-b 只量实测）：锚文件 797 个中 202 个（25%）被 ≥2 个节点认领；639 个被认领节点里 300 个（47%）没有独占锚；
coChange 1,846 对中只有 6 对有 ≥3 次两端都经独占锚被触及的提交，1,820 对（98.6%）一次都没有；import 三类关系 75–87% 的 via 样本全依赖共享锚。
节点级关系与活动在文件层为真，但同一件事两个口径相差 300 倍，此前只报一个且不标注（DEFENSIVE §11）。

### Added

- `facts.coChange[].specificCommits`：与 `commits` 同口径的提交中，两端都经独占锚（只被 1 个节点认领的锚文件）被触及的次数。
- import 三类关系 `edges` / `specificEdges`：构成关系的文件级 import 边数；其中两端都是独占锚的边数（Go 目录目标：A 在该目录有独占锚）。
- `order[]` / `recency[]` 的 `firstSpecificAt` / `lastSpecificAt`：首次 / 最近一次经独占锚被触及的提交时刻（全史；从未经独占锚被触及则为 null）；`recency[].specificAnchors`：独占锚文件数。
- `blindSpots.anchors.shared = { files, nodes, top≤10 }`：共享锚文件数、只有共享锚的节点数、被认领节点最多的共享锚。
- 读法（契约陈述）：`specificCommits` / `specificEdges` 为 0 = 没有任何一次提交（一条边）两端都经独占锚被触及——每次都至少有一端只经共享锚被触及，另一端可能是它自己的独占锚；`lastSpecificAt` 早于 `lastAt` = 最近活动只来自共享锚文件。
- import 边按文件级去重：同一文件以不同写法（`'./a.mjs'` 与 `'./a'`）引用同一目标只计 1 条（此前 via 已去重，边数随新字段首次计数即按此口径）。

### 非变更（明示拒绝）

- 不改任何既有字段的值与语义；不过滤、不降权任何关系；不改默认判定口径（方向 B「只按独占锚判定」已否决：会丢掉文档介导的真实关联，且等于替账本做判断）。
- 不给「应该怎么认领 / 哪些锚该拆」的建议；不改侧车（atlas 不替用户改锚）。
- 回执顶层字段仍 11；无新旗标 / 错误码 / 侧车字段；trace import（已冻结）与 readBeforeWrite 不动。

### 实证附记

npm test 665 项 664 通过 0 失败 1 异机跳过（+10 例，含整分支审阅修复 3 例）；sync-generated --check / release-version / size-budgets 通过；export-public --selfcheck 幂等、隐私零命中；--help 行数不变；投影后的公开树 trajectory 测试通过。本机冒烟（atlas-engine 本仓人造共享锚：RELEASES.md 被 5 个节点认领）：回执与 umax 只量脚本逐项一致——coChange 61 对、specificCommits=0 的 16 对、≥3 的 30 对、共享锚 1 个。

---

更早的 61 个版本（0.1.0 → 0.30.1）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
