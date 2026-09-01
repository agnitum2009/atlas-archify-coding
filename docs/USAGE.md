# ADD 具体使用方法（USAGE）

> 适用：任何 harness（demo-harness / pi / demo-host / 其他带 bash 能力的智能体）。
> 前置：Node >= 18；gate 三闸另需 archify 内核——解析顺序 ARCHIFY_BIN（存在于磁盘才算）→ PATH 上的 archify → 内置回退路径（existsSync 才算）→ none（fail-closed，绝不伪装成功）；解析来源随 doctor/gate 回执以 source=env|path|fallback 披露。

## 一、三种接入方式

### A. demo-harness（本席方式）：插件层

1. 前提：pnpm 在 PATH（npm i -g pnpm）。
2. 打包安装（本地）：cd atlas-engine/integrations/demo-harness && npm pack && demo-harness plugin --profile web add ./<owner>-atlas-engine-demo-harness-0.1.1.tgz
3. 重启 demo-harness 激活技能（demo-harness plugin --profile web list 可见 @atlas-engine-demo-harness@0.1.1）。
4. 调用：直接说「用 atlas-engine（ADD 模式）管理本项目图谱...」，或按 SKILL.md 命令速查执行。

### B. pi / demo-host（一线席位 方式）：系统提示注入 + CLI 直用

1. 系统提示已注入 ADD 块：<宿主注入块>（备份 .bak-add-20260815）。
2. 无需安装：CLI 直用即达。命令入口：
   node <repo>/bin/atlas-engine.mjs <命令>
3. 完整指南：见 specs/ADD-SPEC.md 与各项目侧 handoff 指南。

### C. 任意 harness：bash + CLI（通用）

零依赖，只要求 Node >= 18 与 bash。所有命令输出统一 JSON 回执（schemaVersion/status/diagnostics），退出码 0/1/2。

## 二、十命令速查

> v0.10.0 移除（两段式废弃第二阶段，0.9.0 已标记）：evidence 顶层命令（功能重复：写时 state evidence-add 内嵌校验、读时 doctor evidence-resolvability 全量覆盖）与 lessons hit 子命令（0/49 采用率且无消费者；hits 字段保留为存量只读计数）——调用现 = exit 1 unknown_subcommand。

| 命令 | 一句话 | 示例 |
| --- | --- | --- |
| init | 生成 v3 版式图谱目录（七区 + 项目子目录 + projects.json 注册表，0.7.0 起直通 build-portal/doctor） | init --dir ./my-atlas --title '我的项目' --diagram-id main [--template minimal\|demo] |
| state | 三轴状态机（A2/A3/A4 硬门禁） | state set --node s1 --axis progress --value in_progress --reason 开工 --owner me |
| diff | spec 差异 + 状态时间线 | diff state --sidecar atlas-state.json --since 2026-08-15T00:00:00Z |
| compile | 状态注入 tag + 当前焦点章节 | compile --diagram spec/main.json --sidecar atlas-state.json --out compiled.json |
| report | 销账回执 + A3 门禁 + A1 对账（--brief 只出计数+error 摘要） | report --sidecar atlas-state.json --slice s1 --code-sha abc --spec-sha def [--spec spec/main.json（可重复，传入即启用 A1 图码对账）] [--replay s1（可重复，内联时间线摘要）] [--brief] |
| gate | 串行三闸（--out 推荐落 artifacts/<项目>/<模块>-<YYMMDD>/，直落项目根会出 gate_out_placement warning） | gate --diagram compiled.json --out artifacts/<项目>/<模块>-<YYMMDD>/out.html |
| trace | 轨迹锚定/回放（list/replay 支持 --since 截窗） | trace add --kind decision --actor owner --note 裁定 --node s1；trace replay --node s1 [--since 2026-08-15T00:00:00Z] |
| lessons | 经验池（list --recent/--rule 过滤；retire 归档；hits 只读保留） | lessons add --lesson '教训' --rule r1；lessons list [--recent 5] [--rule r1] [--all]；lessons retire --id lesson-x |
| notice | 席位间主动通知（settle/block 自动投递） | notice list --seat 一线席位（未读）；notice ack --seat 一线席位 [--id notice-x]；notice add --kind note --node s1 --summary 文本 --from 一线席位 |
| doctor | 环境自检（6 检查；--stats 账本侧派生度量；evidence-resolvability/ledger-size 为 warning 级不阻断） | doctor --sidecar atlas-state.json [--atlas <图谱目录>] [--stats] |

> 门户生成器（scripts/build-portal.mjs，独立脚本非十命令之一，参数不入命令预算）：
> `node scripts/build-portal.mjs --atlas <根> --project <名> [--source <源仓路径>] [--init <YYMMDD>]`
> 生成两级期门户 `<根>/<伞名>/<伞名>-<日期>/index.html`——伞名缺省 `<项目>-add`；同名异路源仓
> （--source 与登记值不同）自动派生 `<项目>-<路径简写>-add` 伞（首个登记者不带路径段）；机器可读
> 注册表在 `<根>/state/projects.json`（坏 JSON fail-loud）。
> `node scripts/build-portal.mjs --atlas <根> --root` 生成根可视化索引（两级导航：项目伞 → 各期门户）。
> 门户与根索引均为纯生成物，禁手改；重跑即覆盖，旧期保留为历史（atlas-layout §〇-v3）。

## 三、标准作业流（一刀完整示例）

开工五动作：
1. doctor --sidecar S （四检查，含 experience-pool）
2. lessons list （读经验池）
3. trace add --kind tool_call --note 'lessons-read' --sidecar S （留痕）
4. state set --node <项目>-<切片> --axis progress --value in_progress --reason 开工 --owner <席> --sidecar S
5. 执行切片

销账五动作：
1. state evidence-add --node <项目>-<切片> --locator <测试文件:行号> --sidecar S
2. state settle --node <项目>-<切片> --reason 交付 --owner <席> --sidecar S （progress→verified + ledger→settled 同回执）
3. trace add --kind diagram_diff --note '交付 SHA' --node <项目>-<切片> --sidecar S
4. report --sidecar S --slice <项目>-<切片> --code-sha ... --spec-sha ... （可加 --replay <焦点节点> 一并出时间线）
5. 图集反哺（活文档纪律）+ gate 三闸

销账/阻塞成功会自动投递一条席位通知（notice，B3）：他席位 notice list --seat <名> 即见未读，notice ack --seat <名> 确认。

## 四、位置与共享物

- 侧车（共用、写锁内置）：<数据根>/state/atlas-state.json（本机示例路径 <home>/demo-ledger）
- 活样图集：<数据根>（spec/artifacts/evidence/data/state/rulings/history 七区；本机示例路径 <home>/demo-ledger）
- 仓库：<repo>（本机）
- 设计文档五件：本仓 specs/ 为正本（设计案/市场全景/可行性/四概念/方法论基座的历史存档在早期项目根仓）

## 五、常见坑（已入经验池）

1. demo-harness 插件必须声明 demo-harness.bundle.patch，否则装为普通依赖不激活（0.1.0 教训）。
2. demo-harness plugin 依赖 pnpm 在 PATH。
3. 写状态必须走正规链：set 快捷置 verified 会触发 report 的 A3 门禁。
4. 侦察件引用的映射载体字段，开工前必须 grep 实测（S5b 首日实证）。
5. 交付 HTML 默认全图可见 + 当前焦点章节；禁止局部内容版本。
6. sidecar_conflict = 并发写被 CAS 拦截（store 持锁重读磁盘 revision，不一致即拒绝覆盖）：补救 = 重新 load 最新 sidecar，在其上重放变更再保存；不得强行覆盖。
7. A1 证据 locator 相对运行 root 解析（report --root，缺省 '.'）：跨仓证据须配 --root；locator 失效 = 证据按该 root 不可达，≠ 伪造，先查 root 再下结论。**2026-08-15 批二后**：新锚写入即绝对（state evidence-add 落账前绝对化，见契约 §5），跨仓失效基本绝迹；旧相对锚仍按 --root 解析，doctor evidence-resolvability 会具名提示改为绝对路径（warning 级，不阻断）。

## 六、验证方式

- 测试：cd atlas-engine && node --test test/*.test.mjs （测试，零依赖；勿用目录形式 `node --test test/`——Node v24.19 下有假失败 bug）
- 门禁：node scripts/verify-doc-test-count.mjs（文档测试数对账）+ node scripts/verify-contract-freshness.mjs（--help/错误码 vs command-contract 对账，D6）
- 部署注入对账：node scripts/verify-deploy-injection.mjs（仓外 注入块 的词表+命令名对账；本地部署机生效，CI 上文件不存在自动 skipped 不假红）
- 验收器：scripts/verify-plugin-bundle.cjs；项目侧切片验收器按项目仓自备（示范见早期试点仓 scripts/）
- 活样：trace replay --node <示范节点>（10 条三源时间线示范，见早期试点账）

