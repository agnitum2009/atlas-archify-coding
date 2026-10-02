# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

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

## [0.34.1] - 2026-10-01

0.32.1→0.34.0 差异审阅后的纪律补正（裁决回执 rulings/RULINGS-2026-10-01-audit-0.33-0.34.md）。代码行为零变化；不回退 0.34.0。

### Fixed

- 恢复 0.34.0 删除的结构守卫测试（cmd-*.mjs 顶层函数 ≤120 行；lib 超长函数只能是白名单且不超上限）；`validateLayout` 367→362 行、`buildReport` 318→317 行收回白名单上限内（等价改写，无行为变化）。越限的正确处置是收函数，不是删守卫。
- 恢复 0.34.0 删除而仍成立的测试：init INDEX 两条文案断言、「无参数 = --help」用法行断言、0.10.0 移除面断言（不再重钉历史行数，行数只由 ≤50 预算守）。
- 补审计批裁决回执：权威链（审计来源、负责人 AE-23 单项例外、负责人合并授权）、仓内可还原的 31 项修复清单、6 项边界债的内容缺口及处置、0.34.0 审阅发现（实测：新 import 解析器在两真实仓上与旧实现逐文件一致；combined diff 语义核对；`gitCommits` 耗时 archify 70ms→1281ms 待 demo-b 实测）。

### 不变

- 不重做 0.33/0.34 任何修复；不改契约与回执形状；不放宽任何预算。

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

---

更早的 65 个版本（0.1.0 → 0.33.0）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
