# Releases

> 本仓是内部工作仓的**派生投影**（生成器 `scripts/export-public.mjs` 的公开面规则表）。
> 条目按版本保留能力级变更；主体名、内部档名与本机路径已中性化，被判定为内部治理叙事的行不导出。



## 破坏性变更三定义

各版本 Breaking 节收录的变更，必须满足以下至少一条（2026-08-15 增长控制开发规范批一#1 成文）：

- (a) **拒绝了昨天接受的输入**：某条此前合法（ok/exit 0）的命令输入，现被拒绝（failed/exit 1/2）；
- (b) **改变既有字段/退出码语义**：回执字段含义或退出码含义变化（如某错误从 exit 2 归位 exit 1）；
- (c) **改变默认行为**：同一命令、同一参数，缺省执行路径的行为与结果变化（如只读命令变写者）。

不满足任一条的纯增量（新增字段/新命令/新参数/新子命令）不列入 Breaking，列入 Added。

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

## [0.14.0] - 2026-08-27

archify 内核升级适配批（2.14.0 → 上游 HEAD v2.16.0-dev.0，skill 侧 2026-08-27 已同步）。
三面耦合契约（validate / deliver --quality showcase --json / visual-check --json）接口形状零变化；
新守卫（composition/desktop-readability 投影字号下限、layout/constraint 标签重叠收紧）由此批的
gate 诊断摘要面可见。

### Added

- doctor 版本机检（关闭 2026-08-17 评估记录的「纸面钉版无机器验证」缺口）：archify-kernel 检查
  现探测实际版本（`probeArchifyVersion`，零依赖零 spawn，读 bin 旁 package.json）并在 detail 报
  `version=`；低于耦合基线 v2.14.0 或版本不可探 → 追加提示级 warning（不改 ok/exit——环境漂移
  信号不是环境损坏，与 fallback 可移植提示同语义级）。新导出：`ARCHIFY_BASELINE`、
  `probeArchifyVersion`、`isBelowBaseline`（只比 major.minor，prerelease 后缀忽略）。
- gate 失败尾结构化诊断摘要：三闸失败且内核 stdout 可解析为回执时，失败尾追加
  `内核诊断[code] message + supportedFixes 首条`（archify 2.16 新守卫的处置建议——如
  labelAt/labelDx/labelDy 移标签、缩短文案/拆图——不再淹没在截断 JSON 里）。纯增：解析失败或
  无 code 诊断返回空串，stub 文本内核零影响，无新规则码不改退出语义。

### Changed

- 版本钉版语义：「固定版本 v2.14.0」→「耦合基线 v2.14.0 + doctor 机检实际版本」（specs 两处）。
  运行时实测 v2.16.0-dev.0。

### 记录不做（能力五问否决）

- `archify brands`（107 商标矢量 + digest 钉定采集）、Viewer `meta.locale` 本地化、sequence
  `meta.column_fit`：服务图表美化与阅读体验，不服务「中后期项目进度掌控」——本体第 0 问不符，
  且扩耦合面违背三面契约最小化。 Brands 若未来用于治理图谱的品牌标识需求再单独立项。

### 实证附记

- 上轮（2026-08-23）移交的 demo-c 图集 12 张在新守卫下的失败，一线席位 已于 08-27 全部修复
  （13 张含此前 schema 坏的 fb 系 2 张，升级后 validate 全绿）——新守卫暴露的是真实排版债，
  旧版通过属假阴性。

## [0.13.0] - 2026-08-27

### Added

- **L1/L2 越界门禁**（负责人令 2026-08-27，atlas-engine 出域多项目使用前的防误写加固；直接动机 = 并行席位同日实际案例：把 demo-b 工单当主线执行，P6 仅有 doctor warning、写路径零拦截）：
  - L1 `project_prefix_gate`：state set 新建节点 id 必须以本侧车项目前缀开头（共享侧车取并集）；只拦新建，存量 grandfather（P6 doctor warning 继续管存量）。
  - L2 `seat_gate`：state set/transition/settle/block 的 --owner 必须 ∈ 映射条目 seats 并集。
  - 激活条件 = 注册表 opt-in（同目录 projects.json 条目 `sidecar` 字段映射本侧车；新增 `seats` 字段可选）。init 产物与自由侧车零影响；条目无 seats = 席位不限（渐进启用）。信任模型 = 防误不防恶。
  - 新模块 lib/project-gate.mjs（engine 对注册表只读）；零新命令/旗标；测试 +13（test/project-gate.test.mjs）；契约错误码表 +2 行（244/250）。
  - L3（history host 戳）/L4（多设备单保管权治理约定）负责人已批后置。

## [0.12.0] - 2026-08-23

实战反馈档-2026-08-23（一线席位 demo-a 战役实战反馈）缺陷批。处置经 reviewer-A + kimi-reviewer-B 双席对抗式交叉验证
（独立复现，不见主线推理）：两席总判可靠度均为高；五处纠正已吸收（B 依据换五问②、P1-5 引据更正、
P1-4 通道事实重写、E 停嫌疑级、本节 Breaking 补立）。规则码净增 +2（invalid_node_id、
evidence_near_duplicate；sidecar_missing 为既有码扩发射路径）。

### Breaking

- **(a) trace/lessons/notice 全子命令：侧车文件不存在从 exit 0 变 exit 1（rule=sidecar_missing）**。
  此前读路径凭空造空账（`lessons list` → ok/count:0）、写路径静默自建新账本——且该行为是契约
  附录 A 成文的设计选择（原文「不报此码」）；实战后果：注入块一度缺 --sidecar，112 条经验
  + 59 条未读通知被隐藏整个战役周期（P0-1，vacuous green 家族）。现 fail-loud 并附出路
  （显式 --sidecar / init）。拒绝报告方案二「缺省解析链」：向上搜索会静默挂上父项目侧车，
  错账污染 > 空账不可见（交叉验证双席背书）。state set 的 :68 成文创世语义不变。
- **(a) state set 新建节点 id 白名单 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`（rule=invalid_node_id）**。
  此前管道符/换行/任意字符可静默建号且无删除原语（误建永久留账）。只拦新建：既存畸形 id
  节点仍可读改（存量清理通道，如 progress=cancelled 作废）。

### Added

- `evidence_near_duplicate`（warning 不阻断）：evidence-add 同文件 ±3 行已有本节点锚——大概率是
  想 reanchor 却用了 add（P3-8；限本节点）。
- `anchor-empty-line` 警告附最近内容行建议（落既有 supportedFixes 字段，不新增 schema 键；P3-9）。
- `scripts/reanchor-moved.mjs`（泄压区，非命令面）：纯移位漂移锚批量自动 reanchor——吸收 P0-2
  （一线席位 PoC 113/113 路径固化），进程内 import lib 单进程一次 CAS（顺带解 P2-7 的 93% spawn 开销）；
  缺省 dry-run，--apply 才写；逐锚镜像 evidence-reanchor 语义含 history 审计（via 字段）；
  弱行（<4 字符）与内容真变不自动，落人工清单。不做 doctor --fix-moved：依据是五问②
  （脚本可组合达成即拒进内核），非「doctor 只读教义」——compile/report/gate 早有自动留痕写例外，
  教义论证不成立（交叉验证双席一致纠正）。

### 更正注（嫌疑级，不翻案）

- 0.9.0 废弃 lessons hit 时引用的「0/49 零命中」读数，录得期间注入块缺 --sidecar（P0-1），
  可见性受损为死因**嫌疑**（非定论）；「无任何消费者」判据独立于可见性成立，移除结论不翻案。
  同步见 docs/ADOPTION-BASELINE-2026-08-17.md（内部件，未随本版发布） 更正行。

### 记录不做（理由经交叉验证校正）

- P1-3 symbol 锚：零依赖硬边界；P1-5 project 字段：依据五问②（前缀过滤一行 jq 可达），**非**五问③
  （那是登记义务非否决条款，且 projects.json 不编码节点归属——原判词引据双错，经两席指正）；
  按项目拆账并入 P2-6 冷归档设计回应真实痛点（188 前缀族实测）。P1-4 supersede：原判词
  「settle+reason 可表达」对 planned 废节点不成立（settle 被迁移表拒，实测），正确通道是
  progress=cancelled+reason（合法迁移，实测）；残余缺口仅「superseded-by 机器可读指针」，
  与 node-remove 下批联合过五问（同族：误建/被取代节点的终态表达）。

## [0.11.8] - 2026-08-18

修正一条**取向错误**的监测口径：从「追着堵漏」改为「选定泄压区」。

### Changed

- `docs/ADOPTION-BASELINE` 的增长转移监测节改写（不新增条目、不新增文件、零能力面）。
  **原表述有取向错误**：「每堵一个泄压口，增长就换地方冒——预算机制有效但覆盖面永远慢半拍」，
  这是把守恒量当成可追平的漏洞，追下去必然徒劳。

  **权威依据**：控制论 **Bode 灵敏度积分**——`∫₀^∞ ln|S(jω)|dω` 守恒
  （稳定系统且极点比零点至少多 2 时为 0），**压住一处必抬一处，总量不可消除、只能选地方**。
  同一规律在另两层被独立发现：软件侧**复杂度守恒定律**（Tesler，维基列为 Bode 积分 See also）、
  度量侧 **Goodhart 定律 / Meadows 政策阻力**。三个领域撞同一堵墙 = 不是本仓机制设计得差。

  **三条推论**：
  ① 追分项徒劳，该盯**总量比值**（治理文本占内核比、scripts 占内核比——二者已在 0.11.7 入观测项）；
  ② **泄压区是设计选择**：按单位成本分层——常驻上下文与能力面**贵、硬顶**；specs/docs 中、单件顶；
     **scripts 与 tests 便宜、明示为泄压区、只测量不设顶**。2026-08-18 增长转到 scripts，
     是压力找到了正确的便宜区，**不是覆盖面慢半拍**；
  ③ **Respect the unstable**（Stein 的 Bode 讲座同名论旨）：`π·Σ Re(pₖ)` 表明系统越不稳定、
     守恒面积越大。本仓两天 12 个版本＝高速演化＝大守恒面积，**单日三次转移是速度的函数，
     不是纪律失效**；速度降下来，转移频率自然下降。

### 顺带：门禁上线以来第一次真的挡住东西，挡的是本次改动自己

写完上述改写后 `size-budgets` 报 fail：`ADOPTION-BASELINE 124 行 > 文档单件预算 120`。
**一篇论证增长控制的文字，被增长控制门禁当场拦下。** 处置按纪律：**压缩而非提预算**
（压回 116 行，保留全部论证与引用）。这是 0.11.3 立此门禁以来它第一次产生阻断——
此前七个版本它只在报观测数。**写了并且执行了，与只写在文档里，差别在此。**


## [0.11.7] - 2026-08-18

本轮 ADD 自体检的三项处置（负责人令：注意力回到 ADD 能力，防过拟合/膨胀/失真/低效）。

### Fixed

- **本轮自己引入的重复硬编码**（过拟合的入口形态）：0.11.3 新增的 `verify-size-budgets.mjs`
  自行硬编码了 `<宿主注入块>`，而仓内**早已存在**四级路径解析
  （`verify-deploy-injection.mjs`，且其头注明写「harness 专属候选路径只落本文件，绝不入 lib」）。
  同一份 harness 知识出现在两处 = 重复实现 + 边界外泄。
  现抽出**单一实现** `scripts/deploy-injection-path.mjs（内部件，未随本版发布）`，两个门禁均从此处取；
  实测收敛：全仓除注释外，`.一线席位` 路径只出现在该唯一文件。

### Added

- **size-budgets 门禁增 scripts/ 观测项**（先测量、不设顶）。立项理由是实测的第三次增长转移：
  ```
  能力面被命令/旗标预算控住 → 增长转移到 docs（0.11.3 咬住）
                            → 又转移到 scripts/（单日 +2 件，1567 行 ≈ 内核的 48%，此前零约束）
  ```
  **每堵住一个泄压口，增长就换一个地方冒出来**——预算机制有效，但覆盖面永远慢半拍。
  故本项只测量不设顶，与 docs 同路数，避免用「再加一条规则」治「规则太多」。
- **防御模式 #11：多口径指标只报一个 = 选择性报告**。实例：账本覆盖率文件级 7.8% vs
  上下文级 89.8%（差 11 倍），只报前者把「口径不匹配」误伤成「对方失职」——2026-08-18 实际发生，
  肇事者是本线。规则含 0/0 必须返 N/A（依据 SPDX `NOASSERTION` 与覆盖率最佳实践）。

### 本轮体检结论（记录，非变更）

- **过拟合：未发生**。两次 holdout 实证引擎零改动可用；lib 模块数 19 自 v0.2.0 零增长；
  内核内唯一项目类表述是「如治理型项目」（类型非实例）；其余 8 处项目名均在注释中说明缺陷来源、不影响行为。
  唯一失守即上述重复硬编码，本批已修。
- **膨胀：能力面未膨胀**（命令 10/11、旗标 44/50、模块 19 三者长期不动），但泄压口三次转移，已如上处置。
- **失真：发生过一次且肇事者是本线**，机制已建（并报 + N/A），并入防御模式。
- **低效：7 个版本无一无效**，但探索性投入（第三方工具评估、开发规范条款追溯）占比高，
  产出是认识而非能力——单轮可接受，连续多轮即为低效信号。


## [0.11.6] - 2026-08-18

扫描器增**路径豁免**：把「分母边界」从人工判断变成机器口径。

### Added

- `--exempt-paths <substr,...>`：按路径子串豁免**非自写代码**（第三方源缓存、vendor 等）。
  开发规范 G1 管的是「自写源文件」，第三方源缓存计入分母会令覆盖率**向另一个方向失真**
  （分母虚胖、覆盖率虚低）——与「分母圈小了」同病反向。豁免量**单独报数不静默丢弃**
  （`data.exempted.byPath/byMarker/samples`），可审计。

  独立复现执行席的分类（实测，非采信）：
  ```
  platform-third-party：扫描 7430 → 路径豁免 791 → 计入分母的超限 0
  不加豁免：超限 791 / 无人负责 791   ← 正是它警告的分母虚胖
  ```
  **791 与执行席自报数字精确吻合**；回归：annotation-bff / sdk 路径豁免均为 0，自写代码零误伤。

### 记录：这一轮双方各自把对方的错补上了

- 我方指出它「分母圈小了」（8 仓，漏 business-integration-assets）；
- 它自查后发现**错得更多**（真实 19 仓、20056 文件、1326 超限），并指出我方**也漏了 sdk**；
- 它同时指出一个我没想到的反向失真：791 个第三方源缓存文件**不能计入分母**；
- 本批把这条判断机器化——此前只能靠人工分类。

其新教训 `denominator-boundary-is-part-of-denominator`（分母的边界本身也是分母的一部分）
是 `progress-denominator-before-percentage` 的必要注脚：**立规一天即在双方身上同时应验**。

### 指标现状（口径已双方对齐）

```text
annotation-bff  文件级 8.1% → 10.5%   上下文级 89.8% → 91.1%   ← 其补锚确实推动了指标
platform-third-party  791 全部豁免，不再污染分母
真实自写债 504（执行席全域单次扫描），504/504 已归属上下文、零未命中
```


## [0.11.5] - 2026-08-18

扫描器增**上下文级归属口径**（兑现对 demo-a 侧的承诺）；口径一换，结论翻转。

### Added

- `unowned-oversize-scan.mjs` 增 `--context-map <map.json>` / `--map-root <前缀基准>`：
  读 demo-a 侧 `2026-08-18-context-path-prefix-map.json`（39 上下文，`rule: longest-prefix-wins`），
  按最长前缀把超限文件归入限界上下文，判定「该上下文内是否存在任一证据锚」。
  **两个数字并报、不互相替代**：文件级答「这个文件有没有证据」，上下文级答「这块地盘有没有人在记账」。

### 口径切换后的实测（八仓）

```text
文件级覆盖   26/333 =  7.8%   ← 旧口径（严格，但与「归属粒度=限界上下文」的实践不匹配）
上下文级覆盖 299/333 = 89.8%   ← 新口径（与执行席的归属粒度对齐）
```
**7.8% 不是执行席的失职，是我的口径太机械**——它明确拒绝「为 316 个文件各建节点」，
理由是「那是把账本当文件系统用」，这个判断正确。真正的缺口由新口径给出：
**11 个上下文在账本内零证据锚**——appeal / commissioning / contract-center /
enterprise-readiness / field-extension-incentive / golden-answer / platform-operation /
settlement-center / task-strategy-change / third-party-vertical / training-trial-exam-qualification。

### 记录：两侧分母都不全（本轮最值钱的发现）

映射档自报 `316 matched / 0 unmatched` **为真，但只在它自己的分母内为真**：

```text
一线席位 清单覆盖 8 仓（含 sdk 13 条），漏 business-integration-assets（4 个超限文件从未进入 316）
我方扫描覆盖 8 仓（含 business-integration-assets），漏 sdk（13 个从未进入我的 333）
→ 真实全域 = 9 仓；两边各自的「穷尽性」都只在自己划的圈里成立
```
**我们各自在建分母机制，而各自的分母都漏了对方看见的那块。**
这恰是执行席本轮新教训 `progress-denominator-before-percentage`（任何百分比先问分母从哪来）
的最强实例——立即应用到了立规者自己身上。

处置：口径与清单须由**同一次扫描**产出（单一事实源），不得一侧手工列表、另一侧独立遍历。
下一轮由本脚本统一产出全域清单，demo-a 侧据此核对而非另立。


## [0.11.4] - 2026-08-18

补账本的**分母**：新增盲区扫描脚本（非命令、不占能力预算）。

### Added

- `scripts/unowned-oversize-scan.mjs（内部件，未随本版发布）`：找出「体量超硬限 **且** 账本无节点负责」的文件。
  **阈值不自造**——取自开发规范 charter-final 原则3 / CI 门禁 G1（自写源文件 ≤400 行且 ≤20KB），
  并支持开发规范的豁免约定（`@third-party-audited` 头注释）。始终 exit 0（报告非门禁），
  只处理显式传入路径、绝不触碰固定目录（与 backfill 脚本同式）。

  首跑实测（demo-a/annotation-bff，只读）：扫描 1366 文件 → **超限 124 个，其中 114 个账本无人负责，
  账本覆盖率仅 8.1%**。（此前用第三方工具的 450 行口径只测出 44 个，且未覆盖 scripts/。）

### 为什么需要它（ADD 的结构性边界）

ADD 是**账本**不是**探针**：它能证明「已记的有证据」（188 锚零冗余、drifted 清零、A4 属主校验
当场拦下过编排线下错的任务），但**完全不能证明「没漏记」**——账本只有分子，没有分母。
「148/158 settled」这个隐含的进度感，在开发规范口径下的真实覆盖率是 8.1%；**这是组合层面的
vacuous green**，与 0.11.2 修掉的「零锚说全部可解析」同病，只是高了一层。

### 记录：开发规范里早已有解，我用犯错的方式重新推导了一遍

开发规范 charter-final 三.1 + G8 + PROGRESS_SCHEMA 已给出完整机制：
`项目进度 = Σ 上下文分数 / **上下文总数**`，且 **`trace_coverage < 100` 时进度字段显示 frozen、
不显示百分比**——先定义分母，覆盖率不足就拒绝报数。这正是 ADD 缺的那一块。
另：G14「门禁自身必须描述实况（新增/修改的门禁必须在引入提交上为真）」——正是 0.11.3
所修问题的既有条文。**结论：接新工具前应先读已有开发规范。**


## [0.11.3] - 2026-08-18

**把写了不执行的规则变成门禁**（负责人质疑「抛出问题但没解决」后的直接处置）。

### Added

- **第七道门禁 `scripts/verify-size-budgets.mjs（内部件，未随本版发布）`**（已接入 CI）。
  立此门禁的实测理由：契约与 SKILL 里写了四类行数预算——specs 单件 ≤250、docs 单件 ≤120、
  部署注入块 ≤60、SKILL 核心纪律 ≤10 条且单条 ≤6 行——而 `rg 'budget|250|120' scripts/verify-*.mjs`
  **返回空：全仓没有任何门禁在校验它们**。0.11.2 里「预算当场拦下我」的说法因此只是半真——
  拦住的是手算，不是机制；若不手算，写成 251 行不会有任何东西报警。
  门禁分两类：**硬失败**=执行既有四类预算（只执行，不新立规则）；**观测**=总量与结构比值
  （**不设硬顶**——先测量，恶化再依数据立法，避免用「再加一条规则」去治「规则太多」）。
  上线即报出两个此前不可见的读数：**部署注入块 60/60 已触顶**、**治理文本占代码比 51%**。

### 记录：这是同一病灶的第四次

①一线席位 挂账 37/38/39 只写在文档 → doctor/report/gate 全失明；②lessons 49 条 hits=0 → 写了没人读；
③行数预算无门禁 → 写了不执行；④0.11.2 我新立的「连续三次纪律增量触发减法批」判据 → 同样是
纯散文、没有任何东西在数。**我诊断了这个病，然后自己又犯了一次。**
处方始终一致且已成文：**确定性工作交给确定性工具**（全局适配器行为铁律第 2 条）。
④仍未机器化——判据需要跨版本状态，本批不做，明示为已知缺口而非静默留白。

### Changed

- 契约门禁节**就地改写**（不增行，契约仍 240/250）：门禁六件→七件。


## [0.11.2] - 2026-08-18

第三方方法论解构后的**最小足迹**吸收 + 一次项目建设体检。

### Fixed

- **空态措辞：零证据锚不得声称「全部可解析」**（防御模式 #9）。修复前 `doctor` 在零锚账本上输出
  「全部节点证据锚 0 条全部可解析」——用「无事可查」冒充「已查过」，即 vacuous green。
  现零锚分支改为「本账本尚无证据锚（未作可解析性断言；无锚可检 ≠ 已验证）」；非零锚语义一字未变。
  外部依据：Architec 裁定 034（empty-state wording），其做法是**以测试守住公开字符串不出现裁决词**
  ——本批照办：新增两测，一测守词（禁 clean/safe/通过/健康 等）+ 断言不出现「全部可解析」，
  一测钉「非零锚仍给验证性断言」防过度矫正。

### Added

- `docs/METHODOLOGY-TEARDOWN-ARCHITEC-2026-08-18.md（内部件，未随本版发布）`（82 行）：以第一性原理拆出 8 层
  （观测/断言/标识/呈现/权威/反馈/时间/经济），MECE 自检并**如实标注 ④⑤ 的一处交叉**；
  逐层对照 Google SWE Book ch20（Tricorder 四判据、<10% effective FP、not-useful 闭环终点是
  **停用分析器**、删除用户级自定义）、Johnson ICSE 2013、SARIF partialFingerprints、
  SonarQube Clean as You Code、CDSS 告警疲劳实证；给出完整性评分与 ADD 互补判定。
- 防御模式 #9（空态 vacuous green）、#10（裁定强制写 Non-Goals）。
- PENDING 立 **E2**：architec 体外评估通道搁置，解冻条件=上游落地 TypeScript 支持。
- 采用率基线增**增长转移监测**节（见下）。

### 项目建设体检（本批的自我否决记录）

原计划把两条纪律写进契约，实测被预算当场拦下：契约 240 + 约 11 行 ≈ 251 > 硬顶 250。
进一步复算暴露结构性问题：**减法一次（v0.10.0 契约 −9）之后四个 patch 加回 15 行，净 +6**；
当日 **五个预算 ≥90%**（契约 96 / 注入块 98 / SKILL 纪律 100 / help 90 / 命令 90），
而 lib 模块数自 v0.2.0 起恒为 19——**能力面确实被控住了，增长转移到了未设总量预算的纪律面**（水床效应）。
处置：①本批改为最小足迹——实质进测试（有牙齿）、纪律进 DEFENSIVE（66→83，预算 ≤120）、
**契约 +0 行**；②监测口径写入采用率基线，并立判据：**连续三次纪律增量而无一次减法做功，
即触发强制减法批**（Lehman 法则 2 的降复杂度义务，本仓履行过一次后中断）。

### 非变更（明示拒绝）

- 不采纳 advisory-only：与 ADD 公理直接冲突，放弃裁决＝放弃 A3 全部价值。
- 不采纳反馈台账的 `scope: pattern` 档：Google 实证此类用户级开关会掩盖检测器自身 bug。
- 反馈 scope 机制 / delta 趋势 / 置信度分档：**记录不做**——均为新能力面，须先过第 0 问与准入五问。


## [0.11.1] - 2026-08-17

**本体边界成文**（负责人裁定）。零代码改动。

### Added

- **契约治理节增「本体边界」第 0 问**，前置于既有能力准入五问：
  ADD 的问题域 = **已开工、中后期失去进度掌控的项目**（「开了头不知道如何收」）；
  **从零开始的项目不是本工具的场景**——这类工具已极多，兼顾会让本体累赘，什么都做反而做不好。
  第 0 问：这个能力服务的是「中后期项目重获进度掌控」，还是「更好地开一个新项目」？后者一律拒。

### 重分类（不是修复，是划到场景外）

- 同日实测：空目录上 `init/doctor/state set/evidence-add/settle/evidence-reanchor` 全链其实**跑得通**
  ——设计期以 ADR 为实相落锚，代码落地后 `evidence-reanchor` 转移；A3 从不要求「证据必须是代码」，
  它要求的是「声称必须挂在可逐行核验的东西上」。
  但 `init` 种子图 `components: []` 过不了 archify 的 `minItems: 1`、且 init 回执零指引。
  **按本体边界，这不是缺陷而是场景外，不予修补**——显式记录以免日后被当成未修债重新捡起
  （即 36-R1 查证里那类「假债」的反面防范）。
- 原拟的「全新项目开局」文档节**一并取消**。

### 这条边界回溯解释了已有实测数据

两次 holdout 都是「既有项目」场景（治理型 demo-b / 外部多语言仓），适配代价从「手工迁三层目录」降到
「零引擎改动」；**唯一需要新增便利设施的场景恰恰是全新项目**——数据本就指着这条边界，此前只是没划线。


## [0.11.0] - 2026-08-17

自嗜狗食发现：**官方推荐的补救路径本身会污染账本**。

### Fixed

- **`state evidence-add` 对同一 locator 不幂等**：会往 `evidence` 数组真的重复插入一条。
  要害在于这正踩在官方推荐路径上——drifted 的诊断消息自己写着「须复核后**重新 evidence-add**」，
  于是**每修一次锚漂移就往账本塞一条重复锚**。代码注释当时写的是「重复落同锚刷新哈希」，
  即**意图本就是幂等**，是实现漏了去重（数组 push 无条件执行）。
  现改为：已存在的锚只刷新 `evidenceMeta` 哈希（=重新加持），不重复插入，回执附 warning
  `evidence_reblessed` 明示「未重复添加、evidence 仍为 N 条」并给出换锚的正确出路（evidence-reanchor）。
  `history` 事件加 `rebless: true` 标记，便于事后区分「首次落锚」与「重新加持」。
  发现路径：编排线去修活账本上唯一一条 drifted 锚（引擎自有节点 add-cmd-init）时实测撞见；
  活账本当时**恰好 0 重复**（188 锚全唯一）——纯属还没人走过这条路，不是设计挡住了。

### Added

- 规则码 `evidence_reblessed` 入附录 A；契约 §5 evidence-add 条补幂等语义与「换锚请用 reanchor」的区分。

版本位：新增规则码入附录 A → 按本仓成文 semver 必升 minor。无破坏性——退出码不变、

## [0.10.4] - 2026-08-17

36-R1 查证档追记三条更正（负责人裁定 yes 后）。零代码改动。

### Fixed（本档自身的错误）

- **v0.10.3 查证档里「38 号口径矛盾至今张着」这句话是错的**，本批更正。
  一线席位 复核回到一手出处、编排线独立核验全部命中：路由 `routes.ts:147` 的三元与其上一行注释
  「改派/撤派/拒派/接派 → 200」、契约正本 `task-dispatch-adapter-contract.md:62` 表格行
  「201（assign/claim）/ 200（其余）」——**契约与路由从头到尾一致**；「契约 201」的唯一出处是
  `master-handoff:391` 一行台账行文笔误。负责人裁定按「正名销账」（改台账一行字，代码与测试零改动）。
  按史实不改写原则：原文保留，加「四之二 后续更正」节。

### Added

- **错误模式记录（DEFENSIVE 候选）**：同一个错误本周犯了两次——①读侧车原始 JSON 未按 owner 过滤，
  把引擎属主的 demo-a-handoff 当成执行席欠账推荐出去（被 A4 当场拒）；②读 handoff 台账的转述，
  当成契约事实（本次）。**共同点：拿二手记录当一手真相**——正是本工具公理 A1「图=投影、码=实相」
  要防的事，而我两次拿投影当实相。
- **台账双向失效的发现**：37/39 是「该记没记」的真债，38 是「记错了」的假债；**病因同一**——
  文档条目不需要证据锚就能存在。落账后节点须挂 evidence 才能 settle（A3 守卫），
  **假债在结清那刻会被证据门禁挡住**。这是 v0.10.3「开账/销账对称」纪律有效性的第二个实据。

### 已投递

notice → `demo-a-d2-gap38-reassign-status`（活账本 revision 762）：裁定 yes + 致歉 +
销账须挂证据锚（建议 routes.ts:147，否则 A3 拦）+ lesson 50 缺 --rule 建议补 open-close-symmetry。


## [0.10.3] - 2026-08-17

36-R1「半写」查证（负责人令）——正名 + 三条残留 + 一条纪律折入。零代码改动。

### Added

- **查证档 docs/事故查证档.md**：时间戳级经过 + 代码侧闭合核验 + 三条残留风险 + 非声明。
  **正名**：36-R1 是 demo-a BFF 的挂账编号（36=读缝 / R1=写缝），「半写」指**写缝半闭**——
  读的一面接好、写的一面仍指向会被 0037 CHECK 拒的旧方法；**与账本损坏无关**，生产侧车零损坏（逐字段核）。
  最要害的事实：断链发生时**单测 12/12 全绿**，是人工复核抓出来的，不是测试抓的。

### Changed

- **SKILL 第 5 条由「销账反哺」扩为「开账/销账对称」**（折入，**不增条数**，10/10 不破；单条 3 行 ≤6）：
  发现新债的第一动作 = `state set` 落节点（可 kind=backlog），文档只做详情——
  **只写在文档里的挂账，doctor/report/gate 全部失明**。
  实例：36-R1 同批的挂账 37/38/39 未落账本，其中 38 号「契约 201 vs 路由 200」口径矛盾至今张着。
  部署侧注入块同步（59/60 行，逼近顶——下次新增须先精简）。

### 记录（不构成本仓变更）

- 残留 R-1：settle(04:20:22) 早于对穿冒烟 PASS(04:24) 4 分钟——A2/A3 未破，记为纪律候选。
- 残留 R-2：经验 `adapter-read-write-pair` hits=0。**反向含义已写准**：v0.10.0 移除 `lessons hit`
  的理由是「零采用且无消费者」，本例说明问题不在能力本身而在**没有被读的时机**；
  此非翻案——再提案须先解决「何时读」，而不是先把计数器加回来。
- 已投 notice 至 `demo-a-d2-gap36-r1-wiring`，请 一线席位 对 38 号给完整提案并补落 37/38/39 节点。


## [0.10.2] - 2026-08-17

一线席位 一线前后对比暴露的体例不一致缺陷（负责人同意提议 A；编排线亲自修，未分派）。

### Fixed

- **doctor 的四个节点样例列表静默截断**：brokenNodes / driftedNodes / emptyLineNodes / binaryNodes
  各自封顶 5 条却**不给任何汇总**，而 layout 侧 P6 在 0.10.0 已改为「前 5 逐条 + 另有 N 个」。
  同一个仓两套采样封顶体例，**且已在一线造成实害**：执行席据此把截断读成了「全量漂移节点」，
  并把它当作本次升级的改善之一上报（实际那条改善来自 v0.4.0 的锚三态，属对比窗口之外）。
  现四个列表在超限时于消息补 P6 同式汇总「另有 N 个节点同类，共 M 个；前 5 个已逐条列出」。
  ≤5 时逐条语义与文案一字不变。
- 附带修正 layout.mjs P6 注释里「与 doctor 侧采样封顶风格一致」这一**当时并不成立**的说法
  ——本批之后它才真正成立。

### 非变更（明示拒绝，防日后回头猜）

- **不新增结构字段**（如 driftedNodeCount）：实害是读消息时误判，无任何已知结构化消费方；
  按能力准入五问第②问「能否用现有手段」即应拒。回执 evidenceResolvability 形状零变化，
  已加断言钉死（Object.keys 全等）。


## [0.10.1] - 2026-08-17

plan-tree 引入链的收尾批：清三处陈旧/死重 + 立搁置记录。纯 patch——无能力面、无退出码、
无旗标语义、无侧车结构变更（按本仓成文 semver 规则：纯纪律与文档增量 = patch）。

### Removed

- **lib 层 hitLesson 删除**：v0.10.0 移除其 CLI 写入口后它零调用方，却仍被自身测试养活
  ——「被测试养活的死代码」最具欺骗性（Sculley 死分支处方）；更要害的是 v0.10.0 已声明
  「hits 为存量只读字段」，同时保留一个 mutator 会让声明与代码互相打脸。hits **数据照旧保留**：
  listLessons 正常读出，旧条目无该字段按 0 补，既有非零值照读（已加测试钉死）。
  若将来真需重新计数，按能力准入五问 + 采用率基线重新提案。

### Fixed

- **v1 废弃文案的时间炸弹**：运行期字符串与两份规范写着「v0.10.0 起不再校验」，而版本已到
  v0.10.0 —— 消息在自我否定（Status rots 同病：**运行期字符串里写未来版本号必然腐烂**）。
  改为只陈述已发生的事实：「其详细布局校验已于 v0.9.0 停止」。两处测试原本把该未来版本号
  钉死（assert includes 'v0.10.0'），一并改钉迁移目标与停校验事实。
- **plan-tree 评估档陈旧**：立案时写「ready-check 六判据（本批已落地）」，实际 v0.7.0 已扩为
  八判据（增⑦依赖⑧回滚）。按史实不改写原则，加一条前置更新注而非重写正文。

### Added

- **PENDING 清单立 E 组（验证广度）**：E1 多席位并发场景 holdout —— 唯一尚未被任何 holdout
  触及的分布（前两次均为单席位），**负责人令 2026-08-17 搁置**，记录解冻条件与预期判据；
  同时写明 holdout 覆盖数读数为 2，以及搁置期间监测纪律以其他形态样本兑现、不停摆。

## [0.10.0] - 2026-08-17

来源：holdout #2（外部多语言仓 3x-ui：415 Go 文件/93k 行 + React 前端）对抗实验实测缺陷修复 + 兑现两段式废弃政策第二阶段（0.9.0 承诺 v0.10.0 移除）。

**版本位理由（成文）**：本批有 Breaking（移除命令/子命令 = 类型 (a)；未知顶层命令退出码归位 = 类型 (b)）且新增两个规则码入契约附录 A（gate_out_placement、layout.spec-unparsable）——按本仓 semver 规则（契约「治理」节：错误码/退出码/旗标语义/迁移表/侧车结构任一变更，含新增规则码入附录 A = 必升 minor），0.x 下 Breaking 仍走 minor（先例 0.7.0 的 sidecar_readonly 同为类型 (a) 走 minor），故为 minor。

### Breaking

- **移除 evidence 顶层命令（类型 (a)：拒绝了昨天接受的输入）**：两段式废弃第二阶段（0.9.0 标记 → 本版物理移除）。理由 = 功能重复：locator lint 写时由 state evidence-add 内嵌格式校验、读时由 doctor evidence-resolvability 全量覆盖（判据与实测口径见 docs/ADOPTION-BASELINE-2026-08-17.md（内部件，未随本版发布））。迁移指引：写侧换 `state evidence-add --node <id> --locator <文件:行号>`（格式校验同款 parseLocator 正则）；读侧换 `doctor --sidecar <path>`（evidence-resolvability 检查）或 `report --spec` 的 A1 对账。移除后调用 = exit 1 / rule=unknown_subcommand。连带退役：deprecated_command 诊断码（不再有发射方）、bad_file 错误码（evidence lint --file 的唯一发射方随之移除）——两码从契约附录 A 清理，旧回执数据中的该两码按 0.9.0 条目释义。
- **移除 lessons hit 子命令（类型 (a)：拒绝了昨天接受的输入）**：同上第二阶段。理由 = 0/49 采用率且无任何消费者（无门禁依赖、无报表依赖）。**hits 字段与既有数据保留为存量只读计数**（只删 CLI 写入口；lib 层 hitLesson 保留供宿主程序调用），lessons list 照带 hits。移除后调用 = exit 1 / rule=unknown_subcommand。
- **未知顶层命令 exit 2 → exit 1（类型 (b)：改变既有退出码语义）**：bin 薄壳对未注册命令名此前抛错落顶层 catch = exit 2 / rule=internal——用户拼错被归「内部错误」属归类错误（holdout #2 P2b 实测）；现归位 exit 1 / rule=unknown_subcommand（复用既有码，消息列出当前支持命令）。影响面：只涉未注册命令名路径；已注册命令组的未知子命令本就是 exit 1 / unknown_subcommand，不变。

### Fixed

- **gate 产物落点自相矛盾（holdout #2 P0，最要害）**：`gate --out <atlas>/artifacts/<项目>/x.html` 成功后，gate 与 visual-check 共 7 个生成物直落 artifacts/<项目>/ 根，`doctor --atlas` 立刻报 7 条 P2 error（exit 1）——照官方快乐路径做会把自家 atlas 打成 failed，而 gate 全程零提示。现 gate 在写产物前判定 --out 父目录形状：正好是某 atlas 的 artifacts/<项目>/ 根（祖父目录名==artifacts 且图谱根下有 spec/<项目>/）时，回执 diagnostics 追加 warning 级诊断 **gate_out_placement**（消息给建议落点 artifacts/<项目>/＜模块＞-<YYMMDD>/，日期取当天，并说明直落项目根会触发布局 P2）——不阻断、不改退出码、不自动移动文件（移动用户指定的输出路径太越权）。契约 §7 与 USAGE 同步写明推荐落点。
- **P6 警告洪峰无封顶（holdout #2 P1）**：306 个无前缀节点曾让 doctor 逐条打印 306 条相同 warning（anchor-empty-line 有采样封顶而 P6 没有）。现 P6 改聚合式：最多逐条列前 5 个节点 id，其余以计数汇总为一条（形如「另有 N 个节点同类，共 M 个」），与 emptyLine/binary 采样封顶风格一致；≤5 个时逐条语义不变。
- **gate 坏内核消息对二进制场景不可行动（holdout #2 P2a）**：ARCHIFY_BIN=/bin/ls 实测 tail 918 字符里 23% 是 ELF 不可打印字节 + node 栈，且不含已解析路径（「可能不是 archify 可执行文件」只在输出全空时才出现）。现 tail 生成时过滤不可打印字节（保留 \n\t，其余非打印字符替换为 ·，并注明「已过滤 N 个不可打印字节」），并无条件附已解析路径与来源（env/path/fallback/override）；截断预算动态让位给注记行，合计仍 ≤900 字符。
- **doctor 不验 spec JSON 可解析性（holdout #2 P2c）**：spec/<项目>/bad.json 内容为「{bad json」时 doctor 零诊断，直到 compile 才炸——「图谱目录自检」名不副实。现 atlas 布局检查遍历 spec/<项目>/*.json 尝试 JSON.parse，失败 = error 级诊断 **layout.spec-unparsable**（入附录 A），指明文件与解析错误首行；只验可解析性，schema 校验仍属 archify validate / compile。

### Changed

- **预算：命令数 11→10，硬顶保持 ≤11**（腾出 1 个名额）。退役的目的是为增长让路（负责人 2026-08-17 令）：硬顶若随实数回落，减法成果即纯装饰，且永久冻结能力面、违反 Lehman 法则 6「功能内容须持续增长以维持适用性」。占用该名额仍须过能力准入五问 + 出具采用率基线（docs/ADOPTION-BASELINE-2026-08-17.md（内部件，未随本版发布））。
- **注入通道同步**：SKILL.md 命令速查改十命令 + 移除注记（evidence / lessons hit 行删除，经验池纪律的 hit 写入口描述移除）；ADAPTER.md 宽检命令数改动态值（verify-injection-freshness 对账脚本同步改注册表动态计数，防硬编码「十一」腐烂成假绿/假红）；契约附录 A 的 unknown_subcommand 行来源扩写为「未知顶层命令 / 各命令组未知子命令」。部署侧 <宿主注入块> 由编排线同步（其属地，本批不碰）。

## [0.9.0] - 2026-08-17

来源：减法批——首次真正动用两段式废弃政策（契约「治理」节已成文）+ Lehman 法则2 复杂度做功（Sculley 死分支处方）。实测口径：docs/ADOPTION-BASELINE-2026-08-17.md（内部件，未随本版发布）。

**版本位理由（成文）**：本批新增 `deprecated_command` 规则码入契约附录 A——按本仓 semver 规则（契约「治理」节：错误码/退出码/旗标语义/迁移表/侧车结构任一变更，含新增规则码入附录 A = 必升 minor；先例：0.4.0 增 a1-evidence-drifted、0.8.0 增 anchor-empty-line/anchor-binary），故为 minor。**无破坏性**：废弃仅加 warning 不改退出码（三定义 (a)(b)(c) 皆不涉——未拒任何昨天接受的输入、未改既有字段/退出码语义、未改缺省行为路径；成功回执 diagnostics 为纯增）；v1 平铺仍 warning 级 exit 0 不判死。

### Deprecated

- **evidence 顶层命令**（两段式第一阶段，v0.10.0 移除）：理由 = **功能重复**（非低频）——locator lint 已被两侧覆盖：写时 `state evidence-add` 内嵌格式校验，读时 `doctor` 的 evidence-resolvability 全量校验。标记：--help 该行加 `[deprecated]` 前缀（帮助行数不变）；执行成功时回执 diagnostics 追加一条 severity=warning 的 `deprecated_command` 诊断（指明替代路径与移除版本），**退出码与 data 不变**；失败路径原样不追加。
- **lessons hit 子命令**（两段式第一阶段，v0.10.0 移除）：理由 = **0/49 采用率且无任何消费者**（无门禁依赖、无报表依赖）= 真死重。标记机制同上；**hits 字段保留**（存量数据不动，lessons list 照带）。

### Changed

- **v1 平铺校验链塌缩（Lehman 法则2 复杂度做功）**：lib/layout.mjs 检测到 v1 平铺（spec/ 无一级子目录）不再跑整条 v1 校验链，只发一条 warning「v1 平铺版式已废弃，请迁移至 v3（见 atlas-layout §〇-v3）；v0.10.0 起不再校验」并直接返回（保持 warning 级、exit 0——不制造破坏性变更）；随之不可达的 v1 分支代码已删除（P2/§三.1 v1 分支、P4 v1 分支、v1 CSV 收集分支及各 v2 三元/合取死判断，lib/layout.mjs 479 → 430 行）。理由：数据根已 v3、init 自 0.7.0 起直接生成 v3，完整 v1 校验链无数据可服务。
- **规范瘦身（#4 复杂度做功）**：契约 §10 的 v1 版式存量条款精简为一句指针（v1 旧校验链描述存于本 RELEASES 0.9.0 前条目史实区与 specs/atlas-layout.md §二术语章节）；atlas-layout.md §〇.3 同步改写为塌缩语义；契约治理节预算行更新为实测口径（命令 11，其中 1 条已标废弃 v0.10.0 收回 → 届时 10；旗标 45/50）。

### Added

- **docs/ADOPTION-BASELINE-2026-08-17.md（内部件，未随本版发布）**：能力使用率与纪律遵守率两表（活账本实测口径）、只读命令测量盲区声明（不引入遥测的理由）、退役判据优先级（①功能重复 > ②零采用且无消费者 > ③投机性泛化未兑现冻结不删；频率对保险类/公理类不适用）、下次新增能力的前置（先出本表，遵守率为 0 先退役或改门禁）。
- **`deprecated_command` 规则码**（契约附录 A）：两段式废弃第一阶段的提示诊断码，warning 级不阻断，只附在成功回执 diagnostics。

## [0.8.0] - 2026-08-17

来源：holdout 对抗实验遗留项 + plan-tree 吸收补齐（负责人已批）。

**版本位理由（成文）**：本批新增 `anchor-empty-line` / `anchor-binary` 两个规则码入契约附录 A——按本仓 semver 规则「错误码/退出码/旗标语义/迁移表/侧车结构任一变更 = 必升 minor」，故为 minor（先例：0.4.0 增 a1-evidence-drifted、0.6.0 增 locator_not_found 均 minor）。**无破坏性变更**：两个新判定全为 warning 级，不拒任何昨天接受的输入（破坏性三定义 (a)(b)(c) 皆不涉——未拒输入、未改既有字段/退出码语义、未改缺省行为路径；evidenceResolvability 增四个字段属纯增）。

### Fixed

- **gate 坏内核消息为空（holdout 遗留缺陷1）**：`ARCHIFY_BIN=<非 archify 的文件>` 跑 gate，此前只盯子进程 stdout——node 对非 JS 文件把 SyntaxError 打到 stderr，tail 为空，诊断 evidence 是「三闸停在 validate：」冒号后一片空白，用户完全不知发生了什么。现失败时把子进程 **stdout 与 stderr 尾部**（各截断，合计 ≤900 字符）带进 tail 与诊断 evidence；两者皆空则明写「内核无输出（可能不是 archify 可执行文件），已解析路径=<source> → <路径>」。三闸（validate/deliver/visual-check）同一修复路径。

### Added

- **版本纪律成文（督导 LOW-MED）**：本仓 semver 判据（minor/patch 触发条件、破坏性三定义、各自先例）此前只存在于 RELEASES 自引，全仓无权威落点——现落进 specs/command-contract.md「治理」节。此前多批的版本位判定不受影响（先例一致），但从此有据可查。

- **两类锚质量 warning（holdout 遗留缺陷2）**：lint 原只验存在+行界，不验「这行有内容」——`/bin/ls:1`（二进制）与空文件 `:1` 均判 ok（我们自吃过空行锚的亏：:360 漂移）。三态判定旁增两类 **warning 级**判定（lib/evidence.mjs `anchorQuality`），**绝不升 error**：目标行 trim 后为空 → `anchor-empty-line`；文件疑似二进制（前 8KB 含 NUL 字节）→ `anchor-binary`（命中即跳过空行判定——二进制无行内容语义）。落地面 = doctor evidence-resolvability 检查增两类计数与前 5 个节点样例（emptyLine/binary/emptyLineNodes/binaryNodes，与 broken/drifted 同形；任一 >0 使该检查 ok:false，仍 warning 级不使 exit 1）；**evidence-add 写入边不拦截**——「lint 属读方」既有语义不变，理由入契约 §5（写边拦截会把「补记当前不完美的锚」这类正当记账拒之门外，债反而落不了账）。两规则码入契约附录 A。
- **回退路径明示（holdout 泛化残债3）**：lib/resolve-archify.mjs 的回退常量与该文件「消灭机器相关硬编码」的注释矛盾，但本机 PATH 无 archify、删了 gate 立刻失效——保留并在常量旁补注释「本机便利默认，非契约的一部分」（契约只规定解析顺序，不规定常量值）；doctor 的 archify-kernel 检查在 `source=fallback` 时 detail 附 warning 级提示「正在使用机器相关回退路径，建议设 ARCHIFY_BIN 使其可移植」（env/path/override 来源不出；提示不改 ok/exit 语义）。
- **行数预算扩面（plan-tree 吸收补齐）**：行数预算从 SKILL 与注入块扩到 specs 与 docs——契约「治理」节补：规范单件 ≤250 行、docs 单件 ≤120 行，超出先拆或退役，不得静默膨胀（0.8.0 落定时实测：command-contract 228、atlas-layout 184、ADD-SPEC 98、snapshot-policy 69、docs 最大件 107，均在界内；契约本身不再自报行数——旧版记录必腐烂，读数请现跑 wc -l）。
- **想法池挂既有原语（plan-tree 吸收补齐 V1）**：ADD-SPEC §一 增使用注记——低承诺想法 = `kind=backlog` 的 Card；晋升为正式工作项时用 `supersedes` 关系回链原卡，不删原卡（历史留痕、晋升链可溯）。零新命令、零新字段、零新关系，只是把既有原语的用法写清。
- **已解问题窄化纪律（plan-tree 吸收补齐 走样3）**：解阻塞时若残留更窄问题，新建 block 节点承载，不静默关闭——折进 SKILL.md 既有第 3 条（状态三轴，阻塞语义所在条），未新增编号条（行数预算 ≤10 条自约束本批首次咬人）。

### Changed

- **文档硬写路径泛化（holdout 泛化残债4）**：docs/USAGE.md（2 处）与 docs/QUICKSTART-NONCODER.md（2 处）硬写的 `<home>/demo-ledger` 改为 `<数据根>` 占位并注明「本机示例路径」；REVIEW.md 的 6 处保留不动（第三方审核入口，必须能复制粘贴）。

## [0.7.0] - 2026-08-17

来源：demo-b 治理型项目 holdout 对抗实验（编排线亲手复现确认，非传闻）——暴露三个真缺陷 + 两条纪律走样；本版修复三缺陷、完成两条零成本对齐，并把一个负面结果（A1 适用边界）成文为资产。

### Breaking

- **只读侧车拒写（类型 (a)：拒绝了昨天接受的输入）**：saveSidecar 写前新增守卫——目标侧车存在且不可写（权限位无写位，root 等特权同样受判：保护意图先于 euid 豁免；或 accessSync W_OK 被拒）即 fail-loud exit 1，新错误码 **sidecar_readonly**（契约附录 A 已收录），消息写明「侧车为只读=保护意图，如确需写入请 chmod +w」。此前 chmod 444 的侧车会被 tmp+rename 原子写静默穿过（只需目录写权限），rename 后新文件继承 umask 权限（444→664 静默重置，保护意图连痕迹都不留）——违反 fail-loud 立身之本。补救：确需写入先 chmod +w 解除保护再重试。

### Fixed

- **doctor failed 信封丢 data**：doctor 失败路径（如 --atlas 布局校验有 error）此前只出 diagnostics 不出 data，atlas-layout 明细自述「详见 data.layout.diagnostics」在失败时指向不存在位置——恰在出错时藏明细。现失败信封携带与成功路径同形的 data（checks 全量 + layout.diagnostics 明细 + unchecked）。
- **init↔portal 版式断链**：init 原生成 v1 平铺版式（spec/<id>.json 直落），build-portal 要 v3 伞目录版式（spec/<项目>/ 等）且无迁移工具——新项目必须手工迁三层目录才能被门户收录。init 现直接生成 v3 版式，零手工迁移直通 build-portal --project 与 doctor --atlas（端到端测试钉死：init → build-portal exit 0 → doctor layout error=0）。

### Changed

- **init 生成 v3 版式**：七区之上建项目一级子目录 spec/<项目>/、evidence/<项目>/、data/<项目>/、artifacts/<项目>/（模块目录 <模块>-<YYMMDD>/ 由交付/build-portal 流程按需建）；主 spec 落 spec/<项目>/<diagram-id>.json；INDEX.md 增项目注册表段；写 state/projects.json 注册条目（project/umbrella=<项目>-add/sourcePath:null/firstSeen/portals:[]）。项目名派生零新旗标：显式 --diagram-id 取首段（第一个连字符前），未给取 --dir basename，清洗为 [a-z0-9-]（与 build-portal slugify 同则）；派生为空 = bad_args fail-loud；派生结果随回执 data.project 返回。
- **侧车写入保留原权限**：saveSidecar 正常写路径 rename 前 statSync 取目标 mode、rename 后 chmodSync 回设——消灭「写入即静默重置权限为 umask」；新文件（首次写入）仍按 umask。

### Added

- **ready-check 对齐上游双目标并补两项**：SKILL.md 核心纪律第 9 条「退回澄清」修为「退回澄清**或方案成形**」（上游 ready-check 退回是双目标 clarify/shape-plan——补回「方向已定、只欠方案」的中间态）；六判据补上游 pt:14 展开清单有而我们缺的两项——⑦依赖 ⑧回滚/退路（现八项）。ADAPTER.md 指针行同步；部署侧注入块（<宿主注入块>）由编排线同步（其属地，本批不碰）。
- **行数预算纪律成文**：SKILL.md 核心纪律第 10 条 + 契约「治理」节——核心纪律条目 ≤10 条、单条 ≤6 行，超出须先退役一条或经开发规范程序上调（与命令 ≤11 / 旗标 ≤50 同一治理精神，Sculley 死分支处方同源）；写清这是「防注入块无限膨胀」的自我约束。
- **A1 适用边界成文（负面结果变资产）**：holdout 实证 A1 图账交叉的前提是「图节点 id 即账节点 id」——「图=结构实体、账=工作切片」的项目（如治理型项目）上 compile 注入 tags=0、d 项 unmatched/unaccounted 全为噪声。契约 §6 增适用前提段（不满足时处置建议：不传 --spec 停用 A1，或建立 id 映射纪律后启用）；report nonClaims 增一条同义声明。适用边界非缺陷，措辞中性。

## [0.6.4] - 2026-08-17

来源：外部项目 plan-tree（SeemSeam/plan-tree，Markdown 规划树技能）通读评估成文——与 ADD 重叠面大且无机器牙齿，判定不引入包、只吸收纪律；唯一值得吸收的是其 ready-check 判据（ADD 三轴覆盖执行与账务，独缺「这个计划够不够格开工」一维）。

### Added

- **ready-check 开工成熟度闸纪律入三通道 + 门禁词表**：SKILL.md 核心纪律新增第 9 条（动手前六项须显式——①范围 ②方案 ③影响面 ④验收标准 ⑤验证路径 ⑥风险；缺任一退回澄清，禁「边写边想」核心决策，六项齐备才进实施；方向类问题走呈报单由负责人裁定，技术战术自决但六项仍须写清，落进切片节点 reason 或 trace decision）；ADAPTER.md 加指针行；scripts/injection-terms.mjs（内部件，未随本版发布） 的 CORE_TERMS 增 'ready-check'（登记前已对 SKILL.md 与部署侧 <宿主注入块> 双侧 grep + termPresent 实证，两道注入门禁对漏写当场红）。部署侧注入块由编排线先行同步，本批只读验证。纯纪律/文档增量——按破坏性三定义（拒输入/改语义/改默认）皆不涉，patch 位正确（与 0.3.1 codegraph 纪律先例同理）。
- **plan-tree 评估存档**：docs/PLAN-TREE-EVALUATION-2026-08-17.md（内部件，未随本版发布）——对象与读法、机器面近零判定、与 ADD 五维对照表、不引入包判定与两条吸收（(A) ready-check 六判据本批落地；(B) handoff 文档注册表与 active/history 分离编排线另行处置）、三处硬冲突、Rule 17 供应链结论、零退出成本。

## [0.6.3] - 2026-08-16

来源：生命周期桩基批开工前实检发现——report --spec 的 A1 图码对账只提取 components，lifecycle 族 states 不参与图账交叉，切片销账时 A1 形同虚设（与 0.6.1 compile 同源盲区，对账面补全）。

### Added

- **report A1 提取 lifecycle states**：spec 图内节点 id 提取面扩到 states（图账同 id 约定与 compile 一致）——四刀销账时 `report --slice <刀> --spec <生命周期 spec>` 的图账交叉正式生效；a1 回执字段 specComponentIds 名不更（0.x 内部期，语义注释为「图内节点 id 数」）。纯增量，不列 Breaking。

## [0.6.2] - 2026-08-16

来源：负责人裁定——add 自身不得包含任何项目（demo-a 等）内容。全仓去项目名化审计：功能面（代码/模板/规范正文/测试夹具/示例名/种子文件）全部泛化，史实面（本档历史条目、ADD-PROJECT/AUDIT-SUMMARY 溯源叙述）保留不改写。

### Added

- **fixtures 种子去项目化**：移除真实项目 spec 种子与快照清单（fixtures/ 仅保留演示种子 atlas-seed，其中引用组件亦泛化）；snapshot-policy 升 v1.1.0 记录移除并收回本地路径引用。
- **init rulings 模板泛化**：生成文本不再指向特定项目台账路径。

### Changed

- **规范/测试示例名泛化**：specs/atlas-layout.md、lib/layout.mjs 注释、layout/build-portal 测试夹具中的项目示例名全部替换为 demo 等通用名（同命令同参数行为零变化，不列 Breaking）。

## [0.6.1] - 2026-08-16

来源：首张生命周期型图落图实战发现——lifecycle 型图此前不在显示契约内（compile 只认 components，states 零注入），生命周期图账动图不动，违反「HTML 默认全图可见+状态 tag 随账本」的显示契约。

### Added

- **compile 注入 lifecycle states（图账同 id 约定）**：tag 注入面从 architecture 族 components 扩到 lifecycle 族 states——图中节点 id 即侧车节点 id，同名节点注入执行轴标签（◐ 计划中 / ▶ 进行中 / ⛔ 阻塞 / ✅ 已销账 / ✕ 取消），in_progress 节点照旧进入「当前焦点」章节；无同名侧车节点的 state 保留作者 tag 不动（盘点类图签如「盘点 v1」「R1 已裁」不受账本覆盖）。契约 §3 更新；纯增量（新注入面，未拒绝旧输入、无字段/退出码语义变化），不列 Breaking。

## [0.6.0] - 2026-08-16

来源：一线席位 一线实战反馈（处置 8 条 drifted 锚时发现 evidence-add 是追加语义、无 remove/reanchor，被迫手改 JSON 绕过 CLI 的 CAS/锁/公理治理路径——工具缺陷不得逼用户越过治理面；教训已入经验池 rule=anchor-drift-hot-file）。

### Added

- **state evidence-remove --node <id> --locator <锚>**：锚移除写路径（此前只能手改侧车 JSON）。输入锚按 evidence-add 同法绝对化后匹配；不在数组 = exit 1 新错误码 locator_not_found（附录 A 登记）。**A3 守卫**：声称对齐实相（progress=verified / ledger=settled / truth∈{effective,closed}，与 A1 声称判定同语义）的节点移除最后一条证据 = exit 1 复用 verified_requires_evidence，消息指明两条出路（先 evidence-add 新锚再移除，或 evidence-reanchor 原子替换）。成功同时删除 evidenceMeta 对应键 + history 记 kind='evidence-remove' 事件（含 locator），经 saveSidecar 走 CAS+锁；回执 { node, removed, remaining }。复用既有旗标 --node/--locator/--sidecar（命令仍 11/11，旗标仍 45/50）。
- **state evidence-reanchor --node <id> --from <旧锚> --to <新锚>**：drifted 处置的规范路径——原子改锚（先验后改，任何一步失败零写入）：①旧锚必须存在（locator_not_found）；②新锚过 evidence-add 同款校验（格式+绝对化）再加行存在（file_missing）/行界（line_out_of_bounds）lint（比 evidence-add 写边更严：改锚即 drifted 处置，新锚必须真实可解析）；③一次 save 内完成「移除旧锚（含 meta）+追加新锚（含新哈希）」——中途绝不出现证据为零的瞬间，A3 天然不受威胁（无需额外守卫，设计理由入契约 §2）；④history 记 kind='evidence-reanchor' 事件（含 from/to）。幂等边界：from===to 按刷新哈希处理（契约写明）；新锚已存在视为合并去重。回执 { node, from, to, hash }。

### Fixed

- **孤儿 evidenceMeta 边界关闭（0.4.0 已知边界表该条标注已关闭）**：evidence-remove/evidence-reanchor 同步清理 meta 键——0.4.0 立场是「手工删 evidence 条目不自动清理（不做写路径越权清理）」，0.6.0 起删/改锚有了正规写路径，清理随写路径入治理面（仍不迫溯清理历史孤儿键，读方按键取值无害）。

## [0.5.0] - 2026-08-16

### Added

- **项目伞目录层（atlas-layout v3，2026-08-16 负责人令：门户伞目录 + 同名异路命名 + 两级导航）**：门户从根下平铺 `<项目>-add-<YYMMDD>/` 升为两级 `<伞名>/<伞名>-<YYMMDD>/`（初始化/重扫各一期，旧期保留为历史，不删不覆盖）；specs/atlas-layout.md 新增 §〇-v3（三层结构图/命名规则含同名异路与「首个忽略路径」/注册表形状与职责/两级导航要求/v2→v3 兼容迁移指引/参照 mkdocs-mike version-alias 布局一行），标题升 v3.0.0。
- **机器可读项目注册表 state/projects.json**（§〇-v3.3）：{schemaVersion:1, projects:[{project, umbrella, sourcePath|null, firstSeen, portals:[YYMMDD...]}]}；由 build-portal 读写（portals 去重升序，同期重跑注册表字节稳定），坏 JSON fail-loud（exit 1 registry_invalid，绝不静默重建，--project 与 --root 同法），文件缺失视为空注册表；放 state/ 区不落根（P1 禁平铺）。
- **build-portal `--source <源仓路径>`**（scripts 成员参数，不入命令/旗标预算）：伞名决策四分文——a) 项目未登记 → 缺省伞 `<项目>-add`（首个登记者不带路径段，负责人原话「第一个出现忽略这个路径」，给了 --source 也用缺省伞）；b) 已登记且（未给 --source / 与登记值相同 / 登记值为 null）→ 复用该伞（登记值 null 首次给出时补记，后续异路才能分流）；c) 已登记且 --source 异值 → 新条目伞 `<项目>-<路径简写>-add`（slug = 源路径父目录名清洗 [a-z0-9-]；被占用自父目录向上追加一段连字符连接直到唯一；仍冲突追加路径 sha256 前 6；占用 = 注册表伞名 ∪ 根下同名目录）；d) 门户写入 `<根>/<伞名>/<伞名>-<日期>/index.html`，幂等覆盖同期。
- **根索引两级导航**（build-portal --root，§〇-v3.4）：每项目卡片列该伞下全部期（日期倒序，最新一期标「最新」），链接 `<伞名>/<伞名>-<日期>/index.html`；卡片显示伞名、源仓路径（若登记）、期数、初始化（首期）与最近重扫（末期）；兼容收录根下 v2 平铺门户（取最新一期，标注「v2 平铺门户（建议迁移）」，不报错）；七区地图/账本速览/页脚照 v2 保留；未登记伞目录按「去掉 -add 后边界前缀匹配」归属项目（注册表优先）。
- **layout v3 校验**（lib/layout.mjs）：根下允许伞目录 ^(.+)-add$；伞内只允许 `<伞名>-<YYMMDD>/` 期目录（其它条目/期名前缀不符/期缺 index.html = error layout.portal）；伞名项目段优先按 state/projects.json 注册表对齐，缺失/未登记回退首段/边界前缀匹配，不在册 = error；根下 v2 平铺门户降 warning「v2 平铺门户已过时，建议迁入伞目录（见 atlas-layout v3）」不判 error（存量宽容，与 v1 legacy 同精神；结构校验照跑：项目名不在册/缺 index.html 仍 error）；注册表坏 JSON 在校验器侧 = warning + 回退（fail-loud 属 build-portal 写侧）；UNCHECKED 增「伞目录与源路径映射正确性（需外部真相，静态不可判）」一条；伞目录与 v2 平铺门户同属门户区，其内快照豁免证据归位检查；伞内符号链接垫片一律跳过。

### Changed

- **门户路径结构变更 `<根>/<伞名>/<伞名>-<YYMMDD>/`（按破坏性三定义属 (c) 改变默认行为，minor 位）**：build-portal --project 同命令同参数，缺省产物由根下一级 `<项目>-add-<YYMMDD>/` 变为伞下两级 `<伞名>/<伞名>-<YYMMDD>/`，门户页相对链接由 `../artifacts/...` 变 `../../artifacts/...`（深度 +1，测试对全部 href/src 逐条 resolve 验存在）——同一命令同一参数缺省执行路径的产物位置变化，记 Changed 于 0.4.1→0.5.0 minor 位；不列 Breaking（未拒绝任何输入、无字段/退出码语义变化——坏注册表 exit 1 属新增 fail-loud 路径）。v2 平铺门户降 warning 兼容不判死（校验器不拒绝既有目录，仅提示迁移；--root 照常收录）。

## [0.4.1] - 2026-08-16

### Hardened（reviewer-B 督导 Low#1/Low#2 当场处置）

- 词表匹配升级为词界感知 `termPresent`（injection-terms.mjs）：纯 ASCII 词要求前后不紧贴单词字符，封掉「`async` 冒认 `sync`、`BA2` 冒认 `A2`」类假绿（督导造样实证，反测已复验）；含中文词无词界概念保持朴素包含。两门禁同源共用。
- 删除 test① 的「已知漂移容忍分支」：首跑抓到的 init/diff 缺项已由编排线补齐部署块，容忍分支留着会掩盖未来同类回归——改为严格断言 exit 0。

### Added

- **部署侧注入块门禁 scripts/verify-deploy-injection.mjs（内部件，未随本版发布）（门禁五件→六件；reviewer-B 督导 F3 缺口机器化）**：三条纪律注入通道中部署侧 <宿主注入块> 在引擎仓外，此前无任何门禁——v2 版式与 v0.4.0 三态升级时漏同步两块知识靠人工比对才发现。校验：CORE_TERMS ∪ DEPLOY_TERMS 逐词必含 + 注册表动态 import 十一命令名逐一词界必含（与 injection-freshness 同法，缺任一 exit 1 列名）；路径四级解析（--path > ADD_DEPLOY_INJECTION 环境变量 > ~/.一线席位 与 ~/.pi 候选存在即取 > 无）；文件不存在（CI runner）exit 0 skipped 优雅跳过不假红——对账真实战场是本地部署机。已入 CI（verify-injection-freshness 之后一行）。harness 中立铁律：一线席位/pi 专属候选路径只落 scripts/ 适配器层，不入 lib/。实跑当前真实部署文件：如实 exit 1 报缺 init/diff 两命令名提及（部署块存量缺口实锤，修复属编排线属地）。纯增门禁与文档，不改引擎语义。
- **公共词表 scripts/injection-terms.mjs（内部件，未随本版发布）**：CORE_TERMS（三通道共同必含，自 KEY_TERMS 迁入 8 词，逐词 grep 实证 SKILL.md 与部署侧文件双侧齐备）+ DEPLOY_TERMS（部署块额外必含：drifted/build-portal/版式/纯生成物，分别钉 v0.4.0 三态、v2 门户重生成、v2 版式落位、门户禁手改四块知识）；verify-injection-freshness.mjs 改 import 公共词表 ∪ SKILL 专属词（未知旗标/--stats，部署块无对应文本不入公共表），行为与输出不变，两门禁间词表抄写漂移面消灭；维护约定成文：新增纪律块必须来此登记关键词，否则门禁不咬。

### Fixed

- **SKILL.md 补齐 v2 版式落位与锚行哈希三态两块纪律（通道对等）**：demo-harness 席位用同一数据根同一引擎，此前这两块知识仅部署侧有——核心纪律新增第 7 条（数据根 v2 落位：spec/<项目>/、artifacts/<项目>/<模块>-<YYMMDD>/、evidence/<项目>/<图 id>/、data/<项目>/、P6 项目前缀、每批收尾 build-portal 重生成门户纯生成物禁手改、旧平铺垫片属过渡物新写用规范路径）与第 8 条（锚行哈希三态：evidence-add 自动存哈希；ok/drifted/broken；drifted=证据已腐烂复核后重新 evidence-add，不阻断但必须处置）；ADAPTER.md 同步指针一行。纯文档补齐，patch 位（与 0.3.1 纪律入通道先例同理）。

## [0.4.0] - 2026-08-16

### 已知边界（0.4.0 锚行哈希，督导 F1 要求成文）

- 行号位移盲区：哈希钉「该行号当前内容」；上方增删行导致整体位移时表现为 drifted（若位移后内容恰好相同则漏检为 ok）——LINE:HASH 模式固有边界。
- 同内容重复行之间的锚位移不可测（哈希相同即判 ok，督导 F2 实测）。
- 孤儿 evidenceMeta：手工删 evidence 条目不自动清理对应 meta 键（读方按键取值无害，不做写路径越权清理）。**0.6.0 已关闭**：evidence-remove/evidence-reanchor 同步清理 meta 键；手动改数组的孤儿键仍留（读方无害，不迫溯清理）。
- 存量相对锚永远 unhashed：回填脚本只处理绝对锚，相对锚须先绝对化再回填（两步走）。
- a1-evidence-drifted 仅对声称对齐节点发声（与 a1-evidence-broken 同界）；未声称节点的 drifted 只在 doctor 面可见。
- evidence-add 写边不校验存在性（既有语义保持）：broken 锚以 unhashed 落账，由 doctor/report 读方报出。

### Added

- **锚行哈希三态（锁口② 语义绑定增强，harness 无关；先例=pi-readseek 的 LINE:HASH 模式）**：节点可选增量字段 evidenceMeta（键=锚字符串，值={h:目标行 trim 后内容 sha256 前 12 hex, at:ISO}；snapshot-policy §5.2 登记，schemaVersion 不升）；evidence 数组保持纯字符串，全部既有消费者零影响；旧侧车无此字段照常（D2 容忍立场，unhashed）。
- **evidence-add 落锚同时写哈希**：格式 lint 通过后读目标行计算并写 evidenceMeta；行读取失败不阻断落锚（哈希缺失=unhashed）；重复落同锚刷新哈希（复核后重新 evidence-add 钉新内容）。
- **三态解析（读方统一，lib/evidence.mjs anchorState）**：broken（文件缺/行越界，语义不变）/ drifted（行都在但内容哈希不匹配）/ ok（哈希匹配）；无哈希锚=unhashed（存量，不算 drifted，容忍不误报）。哈希只证行内容未变，不证语义支撑（report nonClaims 同句声明）。
- **doctor evidence-resolvability 三态升级**：data.evidenceResolvability = { total, ok, broken, drifted, unhashed, brokenNodes, driftedNodes }；drifted 与 broken 同样使该检查 ok:false（warning 级不 exit 1，理由既有：数据债不阻断环境自检）；detail 含「drifted=锚内容已漂移，须复核后重新 evidence-add」。doctor --stats 的 evidence 小节增 hashed 计数（携带哈希锚数，与是否匹配无关）。
- **report A1 新规则 a1-evidence-drifted（warning）**：声称对齐节点携带漂移锚 → 图码矛盾未证实但复核义务成立（broken 仍 error a1-evidence-broken 不变；无哈希锚不发声；仅 --spec 传入时启用，A1 规则码五条→六条）。
- **存量回填脚本 scripts/backfill-evidence-hashes.mjs --sidecar <path>**：复用 lib/store load/save（CAS+锁）；先整份备份到 <侧车目录>/../history/（七区制 history 与 state 同级；缺失则退侧车同目录并 fail-loud 说明；同日重跑不覆盖旧备份）；只对绝对锚回填（可读且行在界→补 evidenceMeta，已有则跳过=幂等，幂等重跑零写入零 revision 推进）；broken 跳过列入清单 exit 0（数据现状非脚本失败）；相对锚不回填只计数。存量活目录回填由编排线审核后执行。

### Changed

- **resolvability 输出形状增字段（纯增，按破坏性三定义不涉 Breaking）**：doctor data.evidenceResolvability 由 { total, broken, brokenNodes } 增至 { total, ok, broken, drifted, unhashed, brokenNodes, driftedNodes }；stats.evidence 增 hashed——均为新增字段、无既有字段语义变化、无退出码变化。minor 位（0.3.1→0.4.0）理由：A1 判定语义能力增强（drifted 维度新增），非补丁修复也非破坏。

## [0.3.1] - 2026-08-15

### Added

- **codegraph 协作纪律入三通道 + 门禁关键词**：SKILL.md 新增「codegraph 调用纪律」节（①新鲜度门 ②查询姿势 ③证据分级 ④边界——读码省 token，引擎零耦合纯纪律，不入运行时依赖）；ADAPTER.md 加指针行；scripts/verify-injection-freshness.mjs（内部件，未随本版发布） 的 KEY_TERMS 增 'codegraph' 与 'sync'（SKILL.md 漏写即 CI 红）。纯纪律/文档增量——按破坏性三定义（拒输入/改语义/改默认）皆不涉，patch 位正确。
- **采纳决策存档**：docs/CODEGRAPH-ADOPTION-2026-08-15.md（内部件，未随本版发布）——角色钉死（读码加速器 + 图谱提名层，非裁决依据）、纪律 v2 三条硬化全文、四组实测数字（边精确率 18/20、召回率 14/15、同名串边 3/3、status 判 git 不判索引库 + 读码 token 3415→230 十五倍压缩）、准入五问逐问结论、供应链处置（遥测关停带备份/钉 1.5.0/升级重测约定/MIT/单维护者对策）、负面清单 A/B/C 三级摘要、退出成本（删纪律块即零残留）。

## [0.3.0] - 2026-08-15

### Changed

- **atlas-layout v2 多项目版式**（2026-08-15 负责人令）：specs/atlas-layout.md 新增 §〇——数据根 = 宿主唯一，根下三类内容（人类门户目录 `<项目>-add-<YYMMDD>/`（纯生成物禁手改，重扫以重建目录名体现，旧门户留历史）+ 共享七区（spec/evidence/data 一级子目录 = 项目名隔离，artifacts 两级 = 项目/模块-YYMMDD，state/rulings/history 跨项目共享靠节点前缀 + owner 纪律）+ 根 INDEX.md 项目注册表）；隔离五条成文；v1 平铺 = legacy（原校验照跑 + 迁移 warning），符号链接垫片不计平铺违规并按废弃两段式退出。
- **layout 校验器 v2 识别**（lib/layout.mjs）：spec/ 下有一级子目录 = v2 模式——项目子目录结构、artifacts 模块-YYMMDD 命名、门户目录 `<项目>-add-<YYMMDD>` 且含 index.html、INDEX 项目注册（P4 以项目为单位）；v1 平铺 = legacy 模式照跑原校验 + 一条「v1 平铺已过时」warning；新增 P6 节点前缀纪律（warning 级，需 --sidecar 联动，diagram-*/kind=meta 豁免）；符号链接不计为平铺违规；P5 证据列检查适配 v2 的 data/<项目>/ 隔离。

### Added

- **build-portal 门户生成器**（scripts/build-portal.mjs，独立脚本非新命令）：扫 artifacts/<项目>/（按模块分组）与 evidence/<项目>/（visual-check PNG 缩略），生成 `<根>/<项目>-add-<YYMMDD>/index.html`——相对链接 ../artifacts/... 零拷贝；纯生成物头注；旧门户目录不删（历史保留）；幂等（重跑即覆盖）；零运行时依赖手写 HTML 模板（明暗自适应一行 CSS）；项目子目录不存在 = exit 1 fail-loud。
- **build-portal --root 根可视化索引**（scripts/build-portal.mjs，§〇.1）：`--atlas <根> --root` 生成 `<根>/index.html` 纯生成物可视化目录索引，四块——项目卡片区（每项目一卡：门户链接取字典序最新 `<项目>-add-<YYMMDD>/`、初始化时间从门户目录名解析、规格/交付物/证据目录实扫计数）+ 七区地图（职责一句 + 文件/目录实时计数）+ 账本速览（直读 state/atlas-state.json，存在才读、容错：节点数/revision/trace/lessons/notices）+ 页脚（生成时间戳 + 纯生成物声明 + INDEX.md 相对链接）；与门户同一套零依赖明暗自适应卡片式 HTML，全相对链接；幂等覆盖；--root 与 --project 互斥（同给 exit 1 bad usage），--root 拒 --init；根缺 spec/ 项目一级子目录 = exit 1 fail-loud。v2 布局校验器同步（lib/layout.mjs）：根 index.html 缺失 = warning 并提示生成命令（INDEX.md 仍为 error 级要求），P1 平铺豁免生成式根 index.html。
- **doctor --atlas 与 --sidecar 联动**：P6 节点前缀纪律需要侧车，--atlas 布局校验时同传 --sidecar 即验（显式给了才验，不给不报噪音）。

### Breaking

- **evidence-add 存储形态绝对化**（2026-08-15 批二）：相对 locator 落账前按 cwd path.resolve 绝对化（已是绝对的原样），格式校验与行界 lint 逻辑不变（parseLocator 同正则）——根治 cwd 漂移（DEFENSIVE.md §5 的类杀）。写入形态变化、读方无感（旧相对锚仍被 report/evidence lint 按 --root 解析），不算 Breaking；顺带对齐契约 §5「任何后缀一律 bad_locator 拒绝」（此前宽松检查会把 文件:1:后缀 静默落账，现按 parseLocator 正则拒绝）。

### Added

- **doctor evidence-resolvability 检查**（2026-08-15 批二）：遍历全部节点证据锚跑 lint（文件存在 + 行界），输出 data.evidenceResolvability = { total, broken, brokenNodes（前 5 个失效节点 id）}；broken>0 时检查 ok:false 并附站位无关性提示（锚应为绝对路径）——A1 a/b/c 规则不依赖 spec 却曾锁在 report --spec 之后，失效锚由此在日常操作面可闻。warning 级：不使 doctor exit 1（数据债不阻断环境自检，契约 §10 写明理由）。
- **doctor --stats**（2026-08-15 批二，需显式 --sidecar）：账本侧派生度量 data.stats = { nodes, ownedNodes（原拟名 seatedNodes，发布前依 一线席位 A/B 报告改名避同名异义）, evidence:{total,absolute,relative}, truthAdvances, traceKinds（六 kind 计数）, lessons:{total,active,retired,hits}, notices:{total}, attribution:{historyTotal,withBy,withEngine}, sidecarBytes, revision }——全部单源可算，杜绝手搓度量脚本。
- **doctor ledger-size 检查**（2026-08-15 批二）：侧车 >1MB 或 trace >1000 条 → warning 提示「考虑冷归档到 history/ 区」（仅提示，不自动动账），当前值入 detail。

### Breaking

- **未知旗标拒绝**（增长控制开发规范批一#2；类 a「拒绝了昨天接受的输入」）：一切 '--' 开头但不在命令注册表 flags 白名单的旗标 = exit 1 rule=bad_args，消息列出未知旗标名 + 该命令合法旗标清单——拆除「typo → 静默新建平行账本」雷（此前 `--sidcar` 会静默创建一份 atlas-state.json 副本账本；拼错的 --slcie/--no-trac 等同样被拒）。白名单粒度 = 命令组统一并集（state/evidence/diff/trace/lessons/notice 子命令共用命令组白名单），注册表 flags 字段为唯一机器源。

### Added

- **注册表 flags 字段**：十一命令全部登记合法旗标白名单（机器校验源；usage 文本为人类阅读源，两者仍同处注册表）。
- **契约保鲜门禁升级**（verify-contract-freshness）：新增预算对账（命令数 ≤11、全仓唯一旗标 ≤50，超限打印「预算超限=强制一次显式决定:提预算或退一个旗标」并 exit 1）+ 旗标三向对账（每命令 flags ⊆ usage ∪ 契约对应节，防白名单私加旗标绕文档）。
- **specs/command-contract.md「治理」节**（批一#2/#4）：预算硬顶 + 能力准入五问（判真变更/3 行 bash 组合/侧车字段登记/注入通道同步/fail-loud 可表达） + 废弃政策两段式（deprecated 标注 → 一个 minor → 次 minor 删除，理由入 RELEASES）。

### Fixed


## [0.2.0] - 2026-08-15

### Breaking

- **state set 过 A2 校验**（2026-08-15 裁定④）：set 不再架空 A2——已存在节点的轴值变更同样过迁移表，违表 = exit 1 rule=illegal_transition；新增 `--correction` 显式纠错通道（放行写入的 history 事件带 corrected:true 留痕；不免除 truth 回执门禁）。免表情形：init/该轴首写/同值写入。
- **unknown_template 退出码 2→1**：init --template 传未知模板名属用户输入校验失败，按总纲归位 exit 1（不再落入 2=内部错误）。
- **compile/report/gate 默认自动留痕**（2026-08-15 清单 B1）：三命令原为只读，现运行后（成功与失败都记）默认向侧车追加一条 kind='command' 轨迹事件并推进 CAS revision——只读命令变写者 = 改默认行为；`--no-trace` 显式关闭；留痕失败降级为 warning 不阻断主结果。
- **truth 轴前进强制 --receipt**（2026-08-15 裁定③）：set/transition 任何离开 candidate 的前进写入必须携带负责人本地回执文件，未给 = receipt_required，文件不存在 = receipt_not_found（机器只校验存在性，语义归负责人；--correction 不免除本门禁）。放行时 history 事件带 receipt 字段 + 节点 truthReceipts 落账。

### Added

- 第十一命令 **notice**：settle/block 成功自动投递席位通知 + notice list/ack/add（notices 一等数据段，未读过滤+幂等确认）。
- report --spec **A1 对账器**：五规则码（a1-missing-evidence/weak-assertion/evidence-broken/unmatched-account/unaccounted-node）+ nonClaims 显式非声称 + meta 节点豁免（2026-08-15 裁定②）。
- doctor --atlas **布局校验器**：七区/P1-P5 机器可判项 + 不可判项显式 unchecked；P5 证据双形态（文件:行号 / git sha，ATLAS_GIT_ROOT 解析，2026-08-15 裁定①）。
- **CAS + 锁加固**：侧车 revision + sidecar_conflict 丢写封堵；陈旧锁回收（PID 死亡/30s 锁龄）+ 锁 token 化接管回读核对（TOCTOU 闭环）；sidecar_conflict/locked 归位 exit 1 自身码。
- 回执 token 优化（2026-08-15 清单 A 组）：report **--brief** 计数摘要、trace list/replay **--since** 截窗、lessons list **--recent/--rule** 过滤、lessons **retire**/status（D3，缺省只列 active、--all 含退役）。
- **lessons hits** 命中计数 + hit 子命令（B4，防膨胀；settle/A3 拦截/gate fail 三处 lessonPrompt 回写提示）。
- init **--template** minimal|demo 教学套件（O_EXCL 独占创建带 revision:0）；trace replay 三源合并时间线 + report --replay 内联摘要（B2，每节点≤10条截尾）；settle 回执 data.next 销账下一步提示（实战反馈档（2026-08-15））；ARCHIFY_BIN→PATH→回退→none 四级路径解析。
- 门禁入 CI：verify-doc-test-count（测试数五文档对账）、verify-contract-freshness（help↔契约双向 + 错误码↔附录 A）、verify-release-version（RELEASES 顶部版本 ↔ package.json，2026-08-15 批一#1）。
- **账本 engine 版本戳**（2026-08-15 批一#1）：state 写路径每条 history 事件与自动留痕 detail 增可选字段 engine=引擎版本号（lib/version.mjs 启动读一次）——账本语义世系，回答「这条账是哪个引擎语义写的」；schemaVersion 不动，旧读方照常解析（snapshot-policy §5.2 登记）。

### Fixed

- **错误码双前缀消灭**：store 错误码在 diagnostics.rule 原样呈现（rule=sidecar_invalid_json 而非 sidecar_sidecar_invalid_json）；sidecar_conflict/locked 不再落入 internal/exit 2。
- **Node v24 目录形式测试假失败 bug**：测试命令改 glob 形式 `node --test test/*.test.mjs`（目录形式在本机 Node v24.19 产出假失败，干净最小仓已复现）。
- 对账门禁自身可移植性：node --test 输出解析兼容 TTY（spec 报告器 ℹ）与非 TTY（TAP 报告器 #）双格式（b9d5fd7）。
- CI 无 archify 环境 gate 留痕形状漂移：ARCHIFY_BIN 确定性 stub 注入测试（d02c5fb）。
- 文档测试数三版本漂移（52/55/69）统一为实测值并机器化对账（Status rots 教训）。

## [0.1.0] - 2026-08-15

初始七命令时代，未及记录。


<!-- 生成物：请勿在公开版直接编辑本文件；要改历史叙述请提 issue，由上游同步。 -->
<!-- 派生时丢弃 14 行（内部治理叙事 / 公开面不可证的数字断言）。 -->
