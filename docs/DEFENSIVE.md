# 防御模式汇总（2026-08-15 D5 成文）

> 本仓踩过/防过的坑固化清单。格式：缺陷类别 → 规则 → 锚点（行号均逐条核实）。
> 维护约定：**新坑修复时必须来此登记一条**（缺陷类别、规则、锚点），未登记
> 不算修复完成；与经验池（lessons）互训——此处是工程侧登记册。

## 1. 陈旧锁接管 TOCTOU → 不自动抢占已有锁
判陈旧后 unlink 可能删除另一写者刚取得的活锁；一次 token 回读无法封闭该竞态。
规则：所有已有锁都等待或报 sidecar_locked，死 PID 和超龄同样拒绝自动接管。
锚点：lib/store.mjs acquireLock；specs/command-contract.md 附录 A sidecar_locked。

## 2. pid 复用与锁恢复 → 持有者信息只作诊断
PID、时间、token 与存活探测用于说明锁状态，不作为强制抢占依据。
确认全部写者已停止后，才人工删除锁并重试；释放自己取得的锁仍核对身份。
锚点：lib/store.mjs lockHolderInfo、removeLockOwnedBy；恢复说明见契约 sidecar_locked。

## 3. locator 全角冒号 → bad_locator 可行动提示，不做归一
实测中文括号路径合法，真凶是全角冒号「：」（bad_locator 拒）。
规则：不做全角自动归一——Linux 文件名可合法含全角冒号，归一会破坏该类
locator；改为报错携带可行动提示，用户自行改半角。
锚点：lib/evidence.mjs:6-11、17；docs/实战反馈档（2026-08-15）.md 附记 1
（处置记录）；test/evidence.test.mjs:46-64。

## 4. node --test 目录形式假失败 → glob 形式铁律
`node --test test/` 在本机 Node v24.19 产出假失败（干净最小仓复现，属环境
行为非仓库缺陷），glob 形式 93/93 通过。
规则：测试入口一律 glob 形式（package.json test 脚本即 glob），目录形式在
REVIEW 复现命令 1 明示禁用。
锚点：docs/DEFENSIVE.md:17；package.json:10；docs/AUDIT-SUMMARY-2026-08-15.md 审核一发现①。

## 5. A1 证据数随 cwd 漂移 → locator 绝对化 + 复现命令钉 cwd
report 的 A1 对账按 --root 解析证据 locator（缺省 '.'），同仓不同 cwd 证据
lint 结果不同（实测 6↔15）。
规则：证据 locator 绝对化（活样 20/20 落账，行号逐条核验在界）；REVIEW
复现命令 9 钉死 cwd，终验任意 cwd 逐字节一致。
锚点：lib/report.mjs:25（root 缺省 '.'）；docs/DEFENSIVE.md:25；docs/AUDIT-SUMMARY-2026-08-15.md
「整改批次一/二」。
**类杀（2026-08-15 批二）**：写入边根治——state evidence-add 落账前把相对
locator 绝对化（path.resolve against cwd，lib/evidence.mjs absoluteLocator，
lib/commands.mjs evidence-add 分支），新锚不再依赖读方 root；读方维持旧相对锚
兼容（按 --root 解析）；doctor evidence-resolvability（warning 级）对失效锚
日常可闻并提示绝对化，防旧债无主。锚点：lib/evidence.mjs:24-30、lib/doctor.mjs
evidence-resolvability 检查、specs/command-contract.md §5/§10。

## 6. CI 无 archify 环境 gate 短路 → 测试注入 ARCHIFY_BIN stub
CI 等无 archify 环境 gate 走 archify-missing 短路，detail 形状不同，自动留痕
测试不可复现。
规则：测试注入确定性 stub（任意 node 脚本均可充当 ARCHIFY_BIN，gate 用
node <bin> 起进程），保证 validate 在任何机器都真实跑到且确定性失败。
锚点：test/auto-trace.test.mjs:35-38、54-55；test/resolve-archify.test.mjs:10-28；
specs/command-contract.md §10（archify 解析顺序）。

## 7. 报告格式耦合 → 消除不必要的输出解析
2026-09-15 退役 scripts/verify-doc-test-count.mjs；它为同步文档宣传数字而重复执行全套测试，
还必须兼容 TTY/CI 的不同报告格式。当前直接以 `npm test` 退出码和本次日志验收。
锚点：package.json scripts.test；.github/workflows/ci.yml。

## 8. 文档数字腐烂 → 当前文档引用运行入口
当前操作说明不手写测试总数或固定耗时；日期明确的审计与版本记录保留当时观测。
历史文档中的计数门禁指针仅说明当时机制，该脚本已按 §7 退役，不再作为操作指令。
锚点：README.md；docs/DEFENSIVE.md；docs/USAGE.md。

## 9. 空态被当成验证通过 → 无发现与无对象必须分开措辞（vacuous green）
零对象时说「全部可解析」= 用「无事可查」冒充「已查过」。同类形态：第三方工具在
无法解析的仓上仍回报「复杂度 10.0 满分」（度量项为 0 → 无扣分 → 满分），总分被空洞项抬高。
规则：①无发现用「尚无/未发现」，无法分析用「无法…」并带 reason；②绝不用 pass/clean/safe/
通过/健康 等裁决词；③**用测试守住公开字符串**，措辞纪律必须有牙齿而非仅写在文档。
外部依据：Architec 裁定 034（advisory empty-state wording，其做法即以测试守词）。
锚点：lib/doctor.mjs:125-131（零锚分支）、test/doctor.test.mjs 末两测（守词 + 不过度）。

## 10. 裁定被过度解读 → 每条决策强制写 Non-Goals
只写「决定做什么」的记录，会被后人扩张解释成「顺带也决定了相邻的事」。
规则：裁定/决策类记录固定四段 **Context / Decision / Non-Goals / Consequences**；
Non-Goals 逐条写明「本决策不做什么、不保证什么」。本仓 RELEASES 的「非变更（明示拒绝）」
节即此段的等价物，凡有明确拒绝项的批次必须写，防日后回头猜。
外部依据：Architec 的 71 份决策记录全部含 Non-Goals 段（如裁定 018 明示 concern_id
不跨重命名、不是严重度信号、不建全局注册表）。
锚点：RELEASES.md 各版本「非变更」节；本档为体例登记处。

## 11. 多口径指标只报一个 → 并报或标注口径（选择性报告）
同一件事按不同口径可差一个数量级：账本覆盖率按「文件锚直指」是 7.8%，按「上下文内存在任一锚」
是 89.8%——11 倍。只报前者会把「口径不匹配」误伤成「对方失职」（2026-08-18 实际发生，肇事者是本线）。
规则：①凡存在多口径的指标，**并报所有口径**或在单报时**显式标注口径与其局限**；②口径必须与被
评价方的实践粒度对齐后才可用于评价；③分母为 0 时返回 N/A（null），不得填 0 或 100——
0 是「测过为零」、100 是 vacuous truth，两者都在撒谎（依据：SPDX `NOASSERTION` 与覆盖率最佳实践）。
锚点：scripts/unowned-oversize-scan.mjs（coverage 与 contextView.coverageByContext 并报、0/0 返 null）。
