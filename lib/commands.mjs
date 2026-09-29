// 命令注册表与帮助文本单一来源：每命令 { name, usage（--help 拼装源）, flags（旗标白名单）, run(argv) }。
// 实现位于 lib/cmd-<族>.mjs（减法批三拆出）；run 收到的 argv = 去除顶级命令名后的剩余参数。
import { FLAGS } from './cli-options.mjs';
import { ENGINE_VERSION } from './version.mjs';
import { runInit } from './cmd-init.mjs';
import { runState } from './cmd-state.mjs';
import { runDiff } from './cmd-diff.mjs';
import { runCompile } from './cmd-compile.mjs';
import { runReport } from './cmd-report.mjs';
import { runGateCli } from './cmd-gate.mjs';
import { runTrace } from './cmd-trace.mjs';
import { runLessons } from './cmd-lessons.mjs';
import { runNotice } from './cmd-notice.mjs';
import { runDoctorCli } from './cmd-doctor.mjs';

const COMMANDS = [
  {
    name: 'init',
    flags: FLAGS.init,
    usage: [
      '[init] 初始化 v3 版式图谱目录（七区 + spec|evidence|data|artifacts 下 <项目>/ 子目录 + state/projects.json 注册表；--template minimal=缺省骨架 | demo=额外播种演示图全环）',
      'atlas-engine init --dir <目录> --title <标题> [--template minimal|demo] [--diagram-type architecture|workflow|sequence|dataflow|lifecycle] [--diagram-id <id>]',
    ],
    run: runInit,
  },
  {
    name: 'state',
    flags: FLAGS.state,
    usage: [
      '[state] 三轴状态机（truth/progress/ledger）',
      'atlas-engine state spec-ref --node <id> --ref <图件id> [--remove [true|false]] [--diagram <图名>] [--sidecar <path>]（A3：显式认领图件 id；--diagram 落账为 <图名>/<图内id> 限定该图生效，不带则全图生效——认领后 A1 不再报图件未入账）',
      'atlas-engine state active [--all] [--sidecar <path>]（活帐视图：默认列未完成活跃分类及未分类节点；--all 列全部；pendingSettlement 独立列出 verified/backlog 待销账节点）',
      'atlas-engine state get --node <id> [--sidecar <path>]（读属主与三轴当前值；回执含可选 class=账务分类——节点有则原样列出，无则省略）',
      'atlas-engine state set --node <id> --axis truth|progress|ledger|class --value <v> --reason <text> --owner <o> [--receipt <回执文件>] [--correction] [--kind meta] [--class <账务分类>] [--sidecar <path>]（class=账务分类：declared|registry|container|task|debt|batch-gated|trigger-gated；O3 起新建节点必须带 class——--axis class 或 --class <同类值>，否则 exit 1 class_required；--class 不改写已有分类）',
      'atlas-engine state transition --node <id> --axis truth|progress|ledger|class --from <s> --to <t> --reason <text> --owner <o> [--receipt <回执文件>] [--sidecar <path>]',
      'atlas-engine state evidence-add --node <id> --locator <文件:行号> [--reason <text>] [--allow-root <根>] [--sidecar <path>]（O1 锚根白名单：<侧车同目录>/projects.json 的 sourcePath ∪ atlas 根 ∪ anchor-roots.json ∪ --allow-root；根外锚 exit 1，存量走 anchor-root-exemptions.json 一次性豁免；--reason 记入 history 事件）',
      'atlas-engine state evidence-remove --node <id> --locator <锚> [--sidecar <path>]（移除+A3 守卫）｜ state evidence-reanchor --node <id> --from <旧锚> --to <新锚> [--reason <text>] [--allow-root <根>] [--sidecar <path>]（drifted 处置规范路径：原子改锚；新锚同过 O1 锚根白名单；锚改删禁手改 JSON）',
      'atlas-engine state settle --node <id> --reason <text> --owner <o> [--sidecar <path>]（progress 为 in_progress/verified 且 ledger 为 clean/backlog 时，一次事件写 verified+settled）',
      'atlas-engine state import --node <id> --reason <text> --owner <o> --locator <文件:行号> [--class <分类>] [--source <来源系统>] [--cutoff <截止日期>] [--sidecar <path>]（0.17.0：历史/迁移导入的唯一合法跨轴写——原子双写 verified+settled，强制证据锚，history kind=import 带溯源；只登记新节点或零执行史节点）',
      'atlas-engine state block --node <id> --reason <text> --owner <o> [--with-backlog] [--sidecar <path>]',
      '  set/transition：truth 轴前进写入必填 --receipt <负责人本地回执文件>（缺失/null 初态按 candidate；机器只校验普通文件，不校验语义）；set 对已存在节点轴值变更同过 A2 迁移表，初始化/该轴首写免表；写入规则按 ADD-SPEC §2.4.2 四族判定、违规全部报出：P 路径（illegal_transition、settled_requires_event——ledger→settled 只经 settle/import 事件）仅 state set --correction 可豁免（history corrected:true + waivedRules 留痕；transition 等其他子命令传 --correction = bad_args）；S 状态（组合表 settled_requires_verified / cancelled_requires_clean、verified/cancelled/settled/truth effective·closed 须有证据）、A 权限（owner、truth 回执）、X 外部事实（进入完成声称时锚须可解析，cancelled 只要求非空）一律不可纠错；未改动规则成员字段的写入不因存量违例被拒；仅 set 可初始化缺失账本',
    ],
    run: runState,
  },
  {
    name: 'diff',
    flags: FLAGS.diff,
    usage: [
      '[diff] 双 spec 差异 + 状态时间线',
      'atlas-engine diff spec --base <a.json> --head <b.json>',
      'atlas-engine diff state [--sidecar <path>] [--since <version>]',
    ],
    run: runDiff,
  },
  {
    name: 'compile',
    flags: FLAGS.compile,
    usage: [
      '[compile] sidecar 状态注入 spec（tag + 焦点章节；v3 另加焦点卡；补 meta.output）；运行后自动向侧车留痕 kind=command（--no-trace 关闭）',
      'atlas-engine compile --diagram <spec.json> --sidecar <state.json> --out <compiled.json> [--previous-receipt <compile-receipt.json>] [--no-trace]',
    ],
    run: runCompile,
  },
  {
    name: 'report',
    flags: FLAGS.report,
    usage: [
      '[report] 销账回执汇总（--spec 可重复；传入即启用 A1 图码对账；--replay 可重复，内联焦点节点时间线摘要；--brief 只出计数+error 摘要）；运行后自动留痕（CAS revision 推进，--no-trace 关闭）',
      'atlas-engine report [--slice <id>] [--sidecar <path>] [--root <dir>] [--verify <results.json>] [--code-sha <sha>] [--spec-sha <sha>] [--spec <archify-spec.json>] [--replay <节点id>] [--brief] [--no-trace]',
    ],
    run: runReport,
  },
  {
    name: 'gate',
    flags: FLAGS.gate,
    usage: [
      '[gate] 串行闸链（archify validate → deliver →〔v3：check〕→ visual-check）；给 --sidecar 时运行后自动留痕（--no-trace 关闭）且逐闸 detail 落 <atlas>/data/<项目>/gate-detail.jsonl（append-only 历史）',
      'atlas-engine gate --diagram <compiled.json> --out <out.html> [--sidecar <path>] [--no-trace]（--no-trace 同时关闭 gate-detail.jsonl 落盘）',
    ],
    run: runGateCli,
  },
  {
    name: 'trace',
    flags: FLAGS.trace,
    usage: [
      '[trace] 轨迹锚定与回溯（list/replay/order 支持 --since <ISO8601> 截窗，含边界；格式非法=exit 1 bad_args；import/order 只回溯不规划，不写任何状态轴）',
      'atlas-engine trace add --kind tool_call|decision|diagram_diff|evidence|ruling|command [--actor <name>] [--note <text>] [--node <id>] [--sidecar <path>]',
      'atlas-engine trace list [--node <id>] [--since <ISO8601>] [--sidecar <path>] ｜ trace replay --node <id> [--since <ISO8601>] [--sidecar <path>]',
      'atlas-engine trace import --source <规整事件 JSONL> [--sidecar <path>] ｜ trace order [--node <id>] [--since <ISO8601>] [--brief] [--sidecar <path>]（import 已冻结：实测会话提名无价值，保留不再投入；只追加至 <atlas>/data/<项目>/trajectory.jsonl、source+session+eventId 幂等去重，原始日志先经 scripts/trajectory-from-<harness>.mjs 规整；order 输出 facts=M 级〔提交序/HEAD import/同改〕、nominations=I 级提名〔会话读后写〕、blindSpots=看不见什么及原因〔锚不可用/节点未见/文件无锚/import 未解析〕，需 projects.json 登记 sourcePath）',
    ],
    run: runTrace,
  },
  {
    name: 'lessons',
    flags: FLAGS.lessons,
    usage: [
      '[lessons] 经验池（retire=置 retired 幂等；list 缺省只列 active，--all 含 retired；hits 字段保留为存量只读计数——写入口 lessons hit 已于 v0.10.0 移除）',
      'atlas-engine lessons add --lesson <text> [--rule <code>] [--source <id>] [--sidecar <path>]',
      'atlas-engine lessons retire --id <lesson-id> [--sidecar <path>] ｜ lessons list [--recent <N>] [--rule <code>] [--all] [--sidecar <path>]',
    ],
    run: runLessons,
  },
  {
    name: 'notice',
    flags: FLAGS.notice,
    usage: [
      '[notice] 席位间主动通知（一等数据非侧信道；settle/block 成功自动投递 kind=settled|blocked）',
      'atlas-engine notice list [--seat <名>（只列未读）] ｜ notice ack --seat <名> [--id <id>（缺省=全部未读）] ｜ notice add --kind note --node <id> --summary <text> --from <名> [--sidecar <path>]',
    ],
    run: runNotice,
  },
  {
    name: 'doctor',
    flags: FLAGS.doctor,
    usage: [
      '[doctor] 环境自检（8 检查；--stats 需 --sidecar：账本侧派生度量；evidence-resolvability/ledger-size/head-anchor-consistency 为 warning 级，不使 exit 1）',
      'atlas-engine doctor [--sidecar <path>] [--atlas <图谱目录>] [--stats]',
    ],
    run: runDoctorCli,
  },
];

// ---------- 帮助文本拼装（骨架固定，命令行全部取自注册表 usage 字段） ----------
// 版本印在首行而非独立 --version 旗标（2026-09-18 裁定：旗标预算 50/50 已满，需求只是「看到版本」）。
const USAGE_HEADER = 'atlas-engine ' + ENGINE_VERSION + ' — ADD 图谱驱动研发体系 L2 状态机层 CLI（统一 JSON 回执信封，契约见 specs/command-contract.md）';
const USAGE_TRACE_DISCIPLINE = '自动留痕纪律：gate/compile/report 成败均记；state 写命令不记（history 已覆盖）；留痕失败降级为 diagnostics warning 不阻断主结果';
const USAGE_FOOTER = '退出码：0=ok · 1=failed（校验/约束失败）· 2=内部错误；archify 解析顺序 ARCHIFY_BIN → PATH → 内置回退';

export function buildUsage() {
  const blocks = new Map(COMMANDS.map((c) => [c.name, c.usage.join('\n')]));
  return [
    USAGE_HEADER, '',
    blocks.get('init'), '',
    blocks.get('state'), '',
    blocks.get('diff'), '',
    blocks.get('compile'), '',
    blocks.get('report'), '',
    blocks.get('gate'), '',
    blocks.get('trace'), '',
    blocks.get('lessons'), '',
    blocks.get('notice'), '',
    USAGE_TRACE_DISCIPLINE, '',
    blocks.get('doctor'), '',
    USAGE_FOOTER,
  ].join('\n');
}

export { COMMANDS };
