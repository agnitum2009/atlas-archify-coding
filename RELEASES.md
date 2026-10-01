# Releases

> 本仓是上游实现仓的**派生投影**（规则表见生成器），条目保留能力级变更；主体名、内部档名与本机路径已中性化。
> 本页只列最近 5 个版本；**完整沿革一行不删**，在 [docs/HISTORY.md](docs/HISTORY.md)。

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

---

更早的 63 个版本（0.1.0 → 0.32.0）：
见 [docs/HISTORY.md](docs/HISTORY.md)。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 18 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
